# Acquisition OS — Visual Diagrams

Companion to [STATUS.md](STATUS.md). All diagrams below are Mermaid — they render natively in this IDE, GitHub, and most markdown viewers.

---

## 1. System architecture (the big picture)

```mermaid
graph TB
  subgraph Creator["Creator's inputs"]
    EMAIL[/"Inbound email<br/>(agent@creator-domain)"/]
    TG[/"Telegram bot"/]
    HTTP[/"HTTP POST<br/>/trigger/*"/]
    CRON[/"Cloudflare cron<br/>0 7 * * *"/]
  end

  subgraph CF["Creator's Cloudflare account (one platform)"]
    direction TB
    WORKER{{"Acquisition OS Worker<br/>(Cloudflare Worker)"}}

    subgraph Storage["Cloudflare storage"]
      KV_C[("KV: CONFIG<br/>voice / business /<br/>hook bank / pillars")]
      KV_S[("KV: SECRETS<br/>access tokens")]
      R2[("R2: ASSETS<br/>PNGs + MP4s")]
      D1[("D1<br/>drafts +<br/>pillar_log +<br/>sessions")]
    end

    subgraph Compute["Cloudflare compute"]
      BROWSER["Browser Rendering<br/>HTML → PNG"]
      CONTAINER[["Processor Container<br/>FastAPI + ffmpeg +<br/>faster-whisper"]]
    end
  end

  subgraph Brain["Anthropic"]
    CLAUDE["Claude Opus 4.7<br/>tool-use loop"]
  end

  subgraph External["Third-party APIs"]
    HIGGS["Higgsfield Soul<br/>(avatar reels)"]
    META["Meta Graph API<br/>(ad drafts)"]
    ZERNIO["Zernio<br/>(IG / TT / LI / YT / FB / X / TG)"]
  end

  PREVIEW[/"Preview email<br/>to creator"/]

  EMAIL --> WORKER
  TG --> WORKER
  HTTP --> WORKER
  CRON --> WORKER

  WORKER <-.read.-> KV_C
  WORKER <-.read.-> KV_S
  WORKER <-.write/read.-> D1
  WORKER <-.write/read.-> R2
  WORKER -.HTML render.-> BROWSER
  WORKER <-->|"service binding<br/>(private, same colo)"| CONTAINER
  WORKER <-->|"Messages API<br/>+ tools"| CLAUDE

  CONTAINER -->|"X-Higgsfield-Key<br/>forwarded per request"| HIGGS
  WORKER -->|"Bearer META_ADS_TOKEN"| META
  WORKER -->|"Bearer ZERNIO_API_KEY"| ZERNIO

  WORKER --> PREVIEW
  PREVIEW -.reply ship/reject.-> EMAIL

  classDef cf fill:#f8d380,stroke:#222,color:#222
  classDef ext fill:#222,stroke:#f8d380,color:#fff
  class WORKER,KV_C,KV_S,R2,D1,BROWSER,CONTAINER cf
  class CLAUDE,HIGGS,META,ZERNIO ext
```

**Read this as**: the Worker is the only thing creators talk to. Everything else is either a Cloudflare resource bound to it, or a third-party API the Worker calls on the creator's behalf using their tokens.

---

## 2. The agent loop (what happens inside the Worker)

```mermaid
sequenceDiagram
  autonumber
  participant T as Trigger handler
  participant A as runSession() in agent.ts
  participant C as Claude (Anthropic)
  participant TS as TOOL_SCHEMAS<br/>dispatchTool()
  participant CF as Cloudflare<br/>R2 / D1 / Browser / Container
  participant E as External APIs<br/>Higgsfield / Meta / Zernio

  T->>A: framedIntent(brief)
  A->>A: buildSystemPrompt(env)<br/>(loads creator config from KV)
  loop up to 12 turns
    A->>C: messages.create({ system, tools, messages })
    C-->>A: tool_use blocks
    par parallel tool calls
      A->>TS: dispatchTool(name, input)
      TS->>CF: render / save / publish / fetch
      CF-->>TS: result
    and
      TS->>E: zernio / meta / higgsfield call
      E-->>TS: result
    end
    A->>C: tool_result blocks
  end
  C-->>A: final text (no more tool_use)
  A->>CF: logSession() → D1
  A-->>T: { sessionId, finalText, toolCalls }
```

**Key invariant**: Claude never sees raw API keys. It only sees tool names + structured args. The Worker's TS code holds the keys and makes the network calls.

---

## 3. Static post flow (carousel / quote)

```mermaid
sequenceDiagram
  autonumber
  actor Cr as Creator
  participant W as Worker
  participant A as Agent (Claude)
  participant B as Browser Rendering
  participant R as R2
  participant D as D1
  participant Z as Zernio

  Cr->>W: POST /trigger/manual<br/>"Carousel about firing your VAs"
  W->>A: runSession()
  A->>A: PLAN — 5 slides
  loop per slide
    A->>B: render_html_to_png(slide template + vars)
    B-->>R: PNG bytes
    R-->>A: public_url
  end
  A->>D: save_draft(format=carousel, asset_urls, platforms)
  D-->>A: dft_abc12345
  A->>Cr: send_preview_email("[dft_abc12345] CAROUSEL — ...")
  Cr->>W: Email reply "ship dft_abc12345"
  W->>D: lookup draft → publish_draft_by_id
  D->>Z: zernio_publish(content, platforms, media_urls)
  Z-->>D: postId
  D->>D: status=published, log pillar
```

**Note**: the daily cron is the same flow except it ends at step ~10 — auto-publishes the static draft instead of requiring a `ship` reply.

---

## 4. Talking-head reel flow

```mermaid
sequenceDiagram
  autonumber
  actor Cr as Creator
  participant W as Worker
  participant R as R2
  participant A as Agent (Claude)
  participant C as Container<br/>(ffmpeg + whisper)
  participant B as Browser
  participant D as D1

  Cr->>W: POST /trigger/upload<br/>(raw MP4 body)
  W->>R: put raw MP4 → uploads/foo.mp4
  W->>A: runSession()
  A->>C: process_reel({ r2_key })<br/>via env.PROCESSOR
  Note over C: faster-whisper transcribe<br/>silence_cut_clips()<br/>opus ASS captions<br/>ffmpeg cut + burn
  C-->>R: processed_r2_key (cut + captioned)
  C-->>A: { processed_public_url, transcript, duration }
  A->>A: write IG / TT / LI / YT captions<br/>from transcript
  A->>B: render_thumbnail(hook from transcript)
  B-->>R: thumb PNG
  A->>D: save_draft(format=reel, asset_urls, thumbnail_url)
  A->>Cr: send_preview_email with video + thumb + draft_id
  Cr->>W: "ship dft_xxx"
  W->>D: publish_draft_by_id → zernio_publish
```

---

## 5. Avatar reel flow (Higgsfield)

```mermaid
sequenceDiagram
  autonumber
  actor Cr as Creator
  participant W as Worker
  participant A as Agent
  participant C as Container
  participant H as Higgsfield Soul
  participant R as R2
  participant D as D1

  Cr->>W: POST /trigger/avatar<br/>{ brief: "..." }
  W->>A: runSession()
  Note over A: read CONFIG.SOUL_ID
  A->>A: SCRIPT — 30–45s in creator voice<br/>~120 words, hook + CTA
  A->>C: higgsfield_soul_video({ soul_id, script })<br/>X-Higgsfield-Key forwarded
  C->>H: POST /videos<br/>{ model, soul_id, prompt }
  H-->>C: job_id
  loop poll every 4s, max 4 min
    C->>H: GET /videos/{job_id}
    H-->>C: status: processing / ready / error
  end
  H-->>C: video_url
  C->>C: download MP4<br/>burn captions (no silence cut)
  C-->>R: avatar-<soul>-<ts>.mp4
  C-->>A: { processed_public_url, transcript }
  A->>A: write platform captions + render_thumbnail
  A->>D: save_draft(format=reel)
  A->>Cr: send_preview_email — HARD STOP, no auto-publish
```

---

## 6. YouTube long-form flow

```mermaid
sequenceDiagram
  autonumber
  actor Cr as Creator
  participant W as Worker
  participant A as Agent
  participant C as Container
  participant B as Browser
  participant D as D1

  Cr->>W: POST /trigger/youtube-upload<br/>(raw long MP4)
  W->>A: runSession()
  A->>C: transcribe_video({ r2_key })<br/>(no ffmpeg, no caption burn)
  C-->>A: full transcript + segments + words
  A->>A: design 5–10 chapters<br/>(first at 0:00, ~30–90s each)
  A->>A: write SEO description<br/>(hook + summary + chapters + alt titles + hashtags)
  A->>A: write 3 title variants<br/>(primary / contrarian / numbered)
  par 3 thumbnail renders
    A->>B: render_thumbnail(angle A)
    A->>B: render_thumbnail(angle B)
    A->>B: render_thumbnail(angle C)
  end
  A->>D: save_youtube_draft<br/>(titles[3], thumbnail_urls[3], chapters, tags, video_url)
  A->>Cr: send_preview_email listing all 3 titles + 3 thumbs + description
  Cr->>W: "ship dft_xxx"
  W->>D: publish_draft_by_id<br/>routes to zernio_youtube_publish<br/>(primary title + thumb)
  W->>Cr: response email: "add other 2 of each in YT Studio for native A/B"
```

---

## 7. Meta Ads draft flow (with mixed image/video)

```mermaid
sequenceDiagram
  autonumber
  actor Cr as Creator
  participant W as Worker
  participant A as Agent
  participant B as Browser
  participant C as Container
  participant R as R2
  participant M as Meta Graph

  Cr->>W: POST /trigger/meta-ad<br/>{ brief, offer_url, count: 6 }
  W->>A: runSession()
  A->>A: PICK MEDIA STRATEGY (image / video / mix)
  par render image variants
    A->>B: render_quote_post(angle 1)
    B-->>R: PNG
  and source video variants
    A->>C: process_reel OR higgsfield_soul_video
    C-->>R: MP4 + transcript
    A->>B: render_thumbnail(transcript hook)
    B-->>R: thumbnail PNG
  end
  A->>M: meta_ads_create_draft({ ads[] })
  Note over M: parallel for each variant:<br/>upload image_url → hash<br/>OR upload video_url → poll status: ready<br/>(image_hash thumbnail in parallel)
  M->>M: create campaign (status: PAUSED)
  M->>M: create ad set (daily_budget: 0, PAUSED)
  loop per variant
    M->>M: create adcreative<br/>(link_data.image_hash OR<br/>video_data.video_id + thumbnail)
    M->>M: create ad (status: PAUSED)
  end
  M-->>A: ads[] with manager_urls + campaign_id
  A->>R: save_draft(format=meta_ads, manager_urls in caption)
  A->>Cr: send_preview_email<br/>"6 ads PAUSED in Ads Manager.<br/>Set budget + unpause."
  Note over Cr,M: publish_draft_by_id<br/>REFUSED for meta_ads.<br/>Creator unpauses in Ads Manager directly.
```

**Three independent gates** prevent accidental ad spend:
1. Campaign `status: PAUSED`
2. Ad set `daily_budget: 0` (Meta refuses to spend $0)
3. `publishDraftById` explicitly refuses `meta_ads` drafts

---

## 8. Draft state machine

```mermaid
stateDiagram-v2
  [*] --> pending : save_draft<br/>save_youtube_draft

  pending --> approved : (transient, immediately publishes)
  pending --> rejected : email/telegram reply "no"
  pending --> failed : Zernio API error during publish

  approved --> published : zernioPublish / zernioYoutubePublish ok
  approved --> failed : Zernio API error

  published --> [*] : terminal — logged in pillar_log
  rejected --> [*] : terminal
  failed --> [*] : terminal — manual retry needed

  note right of pending
    Cron-triggered static drafts:
    pending → approved → published
    in one agent session (no human).
    All other formats wait for creator reply.
  end note

  note left of pending
    meta_ads drafts stay pending
    forever — they're managed
    in Ads Manager, not here.
  end note
```

---

## 9. Trigger × output matrix

```mermaid
graph LR
  T1[/trigger/manual/] --> O_static[Static post<br/>carousel / quote / thumbnail]
  T2[/trigger/upload/] --> O_reel[Reel<br/>cut + opus captions]
  T3[/trigger/reel/] --> O_reel
  T4[/trigger/avatar/] --> O_avatar[Avatar reel<br/>Higgsfield + captions]
  T5[/trigger/youtube-upload/] --> O_yt[YouTube long-form<br/>3 titles + 3 thumbs + chapters]
  T6[/trigger/youtube/] --> O_yt
  T7[/trigger/meta-ad/] --> O_meta[Meta Ads draft<br/>image / video / mixed]
  T8[/trigger/meta-ad-from-draft/] --> O_meta
  T9[Daily cron] --> O_static
  T10[Inbound email] --> O_static
  T10 --> O_reel
  T10 --> O_yt
  T11[Telegram message] --> O_static

  O_static --> P_zernio[Zernio multi-platform]
  O_reel --> P_zernio
  O_avatar --> P_zernio
  O_yt --> P_yt[Zernio YT upload<br/>+ A/B reminder]
  O_meta --> P_meta[Meta Ads Manager<br/>PAUSED $0/day]

  classDef trigger fill:#222,stroke:#f8d380,color:#fff
  classDef output fill:#f8d380,stroke:#222,color:#222
  classDef publish fill:#fff,stroke:#222,color:#222
  class T1,T2,T3,T4,T5,T6,T7,T8,T9,T10,T11 trigger
  class O_static,O_reel,O_avatar,O_yt,O_meta output
  class P_zernio,P_yt,P_meta publish
```

---

## 10. Security boundaries (where secrets live and what can see what)

```mermaid
graph TB
  subgraph Public["Public internet"]
    BAD[/"Anyone with the URL"/]
  end

  subgraph WorkerScope["Worker (env access)"]
    direction TB
    SECRETS["ANTHROPIC_API_KEY<br/>ZERNIO_API_KEY<br/>META_ADS_TOKEN<br/>HIGGSFIELD_API_KEY<br/>ACQUISITION_OS_API_TOKEN<br/>TELEGRAM_BOT_TOKEN"]
    TOOLS_TS["TOOL_SCHEMAS dispatch<br/>(TypeScript code)"]
  end

  subgraph ClaudeScope["Claude (agent context)"]
    AGENT["Tool names + structured args ONLY<br/>NO raw secrets ever"]
  end

  subgraph ContainerScope["Container (env access)"]
    NONE["No secrets at rest<br/>X-Higgsfield-Key only<br/>received per request"]
  end

  BAD -- "Bearer ACQUISITION_OS_API_TOKEN<br/>required for /trigger/*" --> WorkerScope
  BAD -. "no public route<br/>(only via service binding)" .-x ContainerScope

  WorkerScope -- "Anthropic call<br/>(no secrets in messages)" --> ClaudeScope
  ClaudeScope -- "tool_use blocks" --> TOOLS_TS
  TOOLS_TS -- "outbound fetch<br/>secrets stay in TS scope" --> EXT[/External APIs/]

  WorkerScope -- "X-Higgsfield-Key per request<br/>(only on /generate-avatar-reel)" --> ContainerScope
  ContainerScope -- "calls Higgsfield<br/>using header value" --> EXT

  classDef danger fill:#fff,stroke:#c00,color:#c00
  classDef safe fill:#f8d380,stroke:#222,color:#222
  class BAD danger
  class SECRETS,TOOLS_TS,AGENT,NONE safe
```

**Key invariants** the diagram encodes:
- Prompt injection that says "print env vars" returns nothing — agent never had access
- Public attackers hit a token-gated boundary at `/trigger/*`
- Container has zero secrets at rest; the key only exists in transit on the one endpoint that needs it
- Service binding means the container's network surface is invisible to the public internet

---

## How to use these diagrams in another conversation

```
Read skalers/acquisition-os/STATUS.md for the prose handoff,
and skalers/acquisition-os/DIAGRAMS.md for the visual model.
```

The next session will have:
- STATUS.md → what's built, what's known-guessed, what's next
- DIAGRAMS.md → how it all fits together visually
- README.md → user-facing setup
