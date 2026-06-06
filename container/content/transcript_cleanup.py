"""Claude transcript cleanup for the reel editor.

Takes a Whisper word-level transcript (list of {word, start, end}) and asks Claude
to flag *additional* word ranges to drop beyond the basic FILLER_WORDS set in
reel_editor.py — false starts ("I — I think"), repeated words ("the the system"),
unfinished thoughts cut off mid-restart, off-list fillers ("ya know", "right so").

Returns a list of (start, end) tuples on the RAW timeline. Caller adds them to its
filler_spans list and feeds them into build_keep_segments() exactly like ffmpeg-detected
silences and on-list fillers.

Conservative by design — Claude is told to flag only obvious removals so we never
strip content the speaker meant to keep.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


CLEANUP_MODEL = "claude-haiku-4-5-20251001"
REPETITION_MODEL = "claude-sonnet-4-6"  # semantic redundancy → Sonnet > Haiku
MAX_DROP_FRACTION = 0.20  # filler-only safety
MAX_TOTAL_DROP_FRACTION = 0.35  # combined fillers + repetitions safety


SYSTEM_PROMPT = """You are an audio editor cleaning up a talking-head video transcript.

You will receive a JSON array of words with timestamps from a Whisper transcript of a vertical short-form reel (Instagram / TikTok / YouTube Shorts). The footage is already going to have a separate pass for: long silences (>0.9s), and basic single-word fillers from this set: um, uh, uhm, hmm, er, ah, erm.

Your job is to flag the OTHER stuff that should be cut:
- False starts: "I — I think the system…" → drop the first "I"
- Repeated words: "the the system" → drop one "the"
- Restart phrases: "wait let me try that again", "cut cut", "ok so"
- Off-list filler phrases: "ya know", "right so", "I mean like", "kind of like", "sort of"
- Unfinished words clipped mid-syllable
- Audible breaths, throat-clears, lip smacks transcribed as "[BLANK_AUDIO]" or single short tokens

Be CONSERVATIVE. If you are not sure, do NOT flag the word. The speaker has a distinct cadence and we'd rather keep an extra "like" than cut a real word.

Return ONLY a JSON object — no preamble, no markdown — in this exact shape:

{
  "drops": [
    {"i_start": 12, "i_end": 13, "reason": "false start"},
    {"i_start": 47, "i_end": 49, "reason": "restart phrase"}
  ]
}

`i_start` and `i_end` are inclusive 0-based indices into the word array (so a single-word drop has i_start == i_end). The `reason` is one short phrase for the log."""


def _extract_json(text: str) -> dict:
    """Robustly extract the FIRST JSON object from an LLM response.

    Handles:
      - bare JSON
      - ```json fenced
      - ``` fenced (no language)
      - JSON object followed by trailing prose
    """
    s = text.strip()
    # Strip leading fence
    if s.startswith("```"):
        nl = s.find("\n")
        if nl >= 0:
            s = s[nl + 1:]
    # Find the FIRST `{` and walk to its matching `}` accounting for nesting
    start = s.find("{")
    if start < 0:
        raise json.JSONDecodeError("No '{' in response", s, 0)
    depth = 0
    in_str = False
    esc = False
    end = -1
    for i, ch in enumerate(s[start:], start=start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end < 0:
        raise json.JSONDecodeError("Unterminated JSON object", s, start)
    return json.loads(s[start:end])


def _cache_path(folder: Path, content_hash: str) -> Path:
    return folder / f"transcript-cleanup-{content_hash[:12]}.json"


def _hash_words(words: list[dict]) -> str:
    blob = json.dumps([w.get("word", "") for w in words], ensure_ascii=False)
    return hashlib.sha1(blob.encode()).hexdigest()


def request_drops(words: list[dict]) -> dict:
    """Call Claude. Returns parsed JSON {drops: [...]}. Raises on hard failure."""
    import anthropic

    client = anthropic.Anthropic()
    payload = [{"i": i, "w": w["word"]} for i, w in enumerate(words)]

    resp = client.messages.create(
        model=CLEANUP_MODEL,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": json.dumps(payload, ensure_ascii=False),
        }],
    )
    text = "".join(block.text for block in resp.content if getattr(block, "type", "") == "text")
    return _extract_json(text)


def cleanup_spans(
    words: list[dict],
    *,
    folder: Path | None = None,
    refresh: bool = False,
) -> tuple[list[tuple[float, float]], list[dict]]:
    """Return drop spans (raw timeline) + the underlying drop records for logging.

    If `folder` is provided, the Claude response is cached at
    `transcript-cleanup-<hash>.json` so re-runs of `cut` don't re-call the API.
    """
    if not words:
        return [], []

    content_hash = _hash_words(words)
    cache_file = _cache_path(folder, content_hash) if folder else None

    parsed: dict | None = None
    if cache_file and cache_file.exists() and not refresh:
        try:
            parsed = json.loads(cache_file.read_text())
        except Exception:
            parsed = None

    if parsed is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("[cleanup] ANTHROPIC_API_KEY missing — skipping Claude pass")
            return [], []
        parsed = request_drops(words)
        if cache_file:
            cache_file.write_text(json.dumps(parsed, indent=2))

    drops = parsed.get("drops", []) if isinstance(parsed, dict) else []

    spans: list[tuple[float, float]] = []
    accepted: list[dict] = []
    n = len(words)
    word_count_capped = max(1, int(n * MAX_DROP_FRACTION))

    for d in drops:
        if len(accepted) >= word_count_capped:
            break  # safety cap
        try:
            i0 = int(d["i_start"])
            i1 = int(d["i_end"])
        except (KeyError, ValueError, TypeError):
            continue
        if i0 < 0 or i1 < i0 or i1 >= n:
            continue
        s = float(words[i0]["start"])
        e = float(words[i1]["end"])
        if e <= s:
            continue
        spans.append((s, e))
        accepted.append({
            "i_start": i0,
            "i_end": i1,
            "start": round(s, 3),
            "end": round(e, 3),
            "text": " ".join(words[i]["word"].strip() for i in range(i0, i1 + 1)),
            "reason": str(d.get("reason", ""))[:80],
        })

    return spans, accepted


# ===========================================================================
# Semantic repetition pass (Sonnet 4.6) — catches re-asked questions and
# restated concepts that the Haiku filler pass doesn't see.
# ===========================================================================


REPETITION_PROMPT = """You are auditing a talking-head video transcript for SEMANTIC REPETITION the speaker should cut for tightness.

The speaker is filming a vertical short-form reel for Instagram / TikTok / YouTube Shorts. Social-media viewers don't tolerate stumbling — when the speaker re-asks the same question, restates the same point, or stutters their way to the same conclusion, the viewer scrolls.

You will receive a JSON array of words with timestamps (Whisper-aligned). You will also receive the basic single-word fillers + false starts that an earlier pass already flagged — DO NOT re-flag those. Your job is the SEMANTIC layer: spans where the speaker says effectively the same thing twice in close succession.

Examples of what to flag:
  - Question re-asked verbatim or with slight rewording within ~30s window
    ("How do you do this? Like... how do you actually do this?")
  - Concept restated verbatim or with slight rewording
    ("AI replaces tasks. AI literally takes over your tasks.")
  - Stuttering that ends at the same destination
    ("So the way I... the way I think about it is...")
  - "What I mean is" + restating

Examples of what NOT to flag:
  - Two genuinely different points that share a word
  - The CTA at the end (always keep)
  - The opening hook (always keep)
  - Building thoughts where each iteration ADDS information

For each cluster of repetition you find, decide which instance to KEEP (usually the LATEST, since the speaker is iterating toward clarity — but pick whichever delivery is cleanest) and which to DROP.

Be aggressive but safe: never drop a span where the surrounding meaning would collapse. If you're unsure whether two utterances are saying the same thing, DON'T flag them. Better to leave a soft repeat than cut something the speaker meant.

Return ONLY a JSON object — no preamble, no markdown — in this exact shape:

{
  "repetitions": [
    {
      "drop_i_start": 142,
      "drop_i_end": 168,
      "kept_i_start": 169,
      "kept_i_end": 195,
      "reason": "question re-asked verbatim, second delivery is cleaner"
    }
  ]
}

`drop_*` are inclusive 0-based word indices for the redundant span to remove. `kept_*` are the indices of the version the viewer keeps. Always validate: drops MUST come before keeps in time, and the two spans MUST NOT overlap. The `reason` is one short phrase for the log."""


def _repetition_cache_path(folder: Path, content_hash: str) -> Path:
    return folder / f"transcript-repetition-{content_hash[:12]}.json"


def request_repetitions(words: list[dict]) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    payload = [
        {"i": i, "t": round(float(w.get("start", 0)), 2), "w": w["word"]}
        for i, w in enumerate(words)
    ]
    resp = client.messages.create(
        model=REPETITION_MODEL,
        max_tokens=2048,
        system=REPETITION_PROMPT,
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    )
    text = "".join(block.text for block in resp.content if getattr(block, "type", "") == "text")
    return _extract_json(text)


def repetition_spans(
    words: list[dict],
    *,
    folder: Path | None = None,
    refresh: bool = False,
    already_flagged_count: int = 0,
) -> tuple[list[tuple[float, float]], list[dict]]:
    """Sonnet 4.6 second pass for semantic repetition.

    Returns (spans, log_records). `already_flagged_count` is the number of
    words the filler pass already dropped — this counts toward the combined
    `MAX_TOTAL_DROP_FRACTION` cap so we don't over-prune.
    """
    if not words:
        return [], []

    content_hash = _hash_words(words)
    cache_file = _repetition_cache_path(folder, content_hash) if folder else None

    parsed: dict | None = None
    if cache_file and cache_file.exists() and not refresh:
        try:
            parsed = json.loads(cache_file.read_text())
        except Exception:
            parsed = None

    if parsed is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("[repetition] ANTHROPIC_API_KEY missing — skipping Sonnet pass")
            return [], []
        parsed = request_repetitions(words)
        if cache_file:
            cache_file.write_text(json.dumps(parsed, indent=2))

    raw = parsed.get("repetitions", []) if isinstance(parsed, dict) else []
    n = len(words)
    combined_cap = max(1, int(n * MAX_TOTAL_DROP_FRACTION)) - already_flagged_count
    if combined_cap <= 0:
        return [], []

    spans: list[tuple[float, float]] = []
    accepted: list[dict] = []
    flagged = 0

    for r in raw:
        try:
            d0 = int(r["drop_i_start"])
            d1 = int(r["drop_i_end"])
            k0 = int(r["kept_i_start"])
            k1 = int(r["kept_i_end"])
        except (KeyError, ValueError, TypeError):
            continue
        if d0 < 0 or d1 < d0 or d1 >= n or k0 < 0 or k1 < k0 or k1 >= n:
            continue
        # Sanity: drop and keep MUST NOT overlap.
        if not (d1 < k0 or k1 < d0):
            continue
        span_words = d1 - d0 + 1
        if flagged + span_words > combined_cap:
            break
        s = float(words[d0]["start"])
        e = float(words[d1]["end"])
        if e <= s:
            continue
        spans.append((s, e))
        accepted.append({
            "drop_i_start": d0,
            "drop_i_end": d1,
            "kept_i_start": k0,
            "kept_i_end": k1,
            "drop_start": round(s, 3),
            "drop_end": round(e, 3),
            "drop_text": " ".join(words[i]["word"].strip() for i in range(d0, d1 + 1))[:200],
            "kept_text": " ".join(words[i]["word"].strip() for i in range(k0, k1 + 1))[:200],
            "reason": str(r.get("reason", ""))[:120],
        })
        flagged += span_words

    return spans, accepted
