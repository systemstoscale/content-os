from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from faster_whisper import WhisperModel


_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


@dataclass
class Word:
    start: float
    end: float
    word: str


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    text: str
    language: str
    duration_seconds: float
    segments: List[Segment] = field(default_factory=list)
    words: List[Word] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "language": self.language,
            "duration_seconds": self.duration_seconds,
            "segments": [
                {"start": s.start, "end": s.end, "text": s.text} for s in self.segments
            ],
            "words": [
                {"start": w.start, "end": w.end, "word": w.word} for w in self.words
            ],
        }


def transcribe(audio_path: str) -> Transcript:
    model = get_model()
    segments_iter, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
    )

    segments: List[Segment] = []
    words: List[Word] = []
    full_text_parts: List[str] = []

    for seg in segments_iter:
        text = seg.text.strip()
        if text:
            segments.append(Segment(start=seg.start, end=seg.end, text=text))
            full_text_parts.append(text)
        if seg.words:
            for w in seg.words:
                token = w.word.strip()
                if not token:
                    continue
                words.append(Word(start=w.start, end=w.end, word=token))

    return Transcript(
        text=" ".join(full_text_parts).strip(),
        language=info.language or "en",
        duration_seconds=info.duration or 0.0,
        segments=segments,
        words=words,
    )
