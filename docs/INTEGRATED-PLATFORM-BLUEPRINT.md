# Acquisition OS — Integrated Platform Blueprint

> The single reference for how Acquisition OS (AOS) becomes one coherent platform a client uses to run and manage their **entire** client acquisition — from defining their offer, to producing content, to converting and closing, to tracking whether they're hitting their income goal.
>
> This document is proprietary. It contains no third-party product, person, or company names. Every mechanic described here is expressed as Skalers IP.

---

## 1. The thesis

Most operators run acquisition in one of two broken modes:

- **Generation 1 — Manual.** They do everything themselves: write the ads, send the DMs, take the calls, chase follow-ups. Revenue is a direct function of hours worked. Stop working, revenue stops.
- **Generation 2 — AI-assisted.** They use point AI tools to draft faster, but they're still the bottleneck making every decision and stitching ten disconnected tools together.

**Acquisition OS is Generation 3 — an AI operator that runs the whole acquisition system.** The client supplies a small amount of input (their foundation once, then one piece of raw material a week and a few approvals), and the platform plans the content, produces it, publishes it, runs the ads, works the inbound, closes in the DMs, and reports whether they're on pace to their income goal.

The wedge: we don't resell someone else's agent and we don't hand the client ten subscriptions to wire together. **AOS is one owned, installed system.** That is what the $10K install buys.

---

## 2. The product principle

> **One platform. One journey. One source of truth.**

Everything in AOS is organized around the **client-acquisition value chain**, because acquisition is a chain, not a menu:

```
   FOUNDATION  →  CREATE  →  CONVERT  →  DISTRIBUTE & CAPTURE  →  CLOSE  →  MEASURE & GROW
   (who/what/      (belief-     (assets that   (ads, outbound,        (AI SDR    (are we hitting
    why + goal)     shift        close w/o      partnerships, DMs)     books &    the Freedom
                    content)     calls)                                closes)    Number? cut fat)
```

You can't create content without an offer and a buyer. You can't convert without content. You can't close without captured intent. You can't grow without measurement. So each stage is a **prerequisite** for the next, and the navigation reads as a path the client walks — not a drawer of disconnected features.

**The retention loop is structural.** The client sets a **Freedom Number** on day one (Stage 1). The **Scoreboard** (Stage 6) measures progress against it forever. The **Profit Audit** tells them exactly what to double down on and what to cut. That single loop — "set the target → run the machine → see if you're on pace → adjust" — is why a client stays.

---

## 3. The six-stage journey (onboard → use → retain)

### Onboard — Stage 1: FOUNDATION
The first thing a client does after install. A guided, in-app worksheet flow that captures three things and turns them into a single source of truth every other module reads:

1. **Offer Builder** — what they sell, the transformation it creates, and the offer architecture.
2. **Buyer Profile + Language Library** — exactly who they serve, in the buyer's own words.
3. **Freedom Number** — the income/net-worth target that reverse-engineers the whole plan.

The moment Foundation is complete, the platform "knows the business." Content, sales pages, ad copy, DM scripts, and the Scoreboard all draw from it — so the client never re-explains themselves to the system.

### Use — Stages 2–5: CREATE → CONVERT → DISTRIBUTE → CLOSE
The daily/weekly loop:

- **Create.** The client films one piece of long-form material a week (or sends a voice note, or captures an idea). The operator transcribes it, clips it into short-form, writes captions/hooks, designs supporting graphics, and schedules it — all mapped to the **6 Buying Beliefs** so any prospect who enters the ecosystem encounters the full belief shift over time.
- **Convert.** From the Foundation offer, the operator generates a hosted sales/pitch page and a no-call **Self-Close** sequence so qualified buyers can convert without a call.
- **Distribute & Capture.** The operator runs the **Ad Engine** (cold → retargeting), cold outbound (Prospecting), partnership outreach (Dream-100), and the **DM Engine** (turning comments and inbound DMs into conversations).
- **Close.** Every captured intent — DM, email, LinkedIn — flows into one **Conversations** surface where the AI SDR works the thread, books, and closes, with human approval where it matters.

### Retain — Stage 6: MEASURE & GROW
- **Scoreboard.** A native dashboard showing the funnel (reach → leads → conversations → closed), spend/CAC/LTV/ROAS, and — the part that matters — **progress against the Freedom Number.**
- **Profit Audit.** Ranks clients and acquisition sources by margin and effort, and flags what to cut and what to scale, so the business gets leaner and more profitable over time instead of just busier.

---

## 4. Naming — anchored on the SCALING System

AOS reuses Skalers' own **SCALING System** as its spine, so the platform and the curriculum speak one language. In the dashboard each letter is a masterclass you learn; in AOS each letter is a surface where you RUN that part of acquisition. Order is fixed: **S · C · A · L · I · N · G**.

| Letter | System | AOS surface | The borrowed mechanic it absorbs |
|---|---|---|---|
| **S** | SMART Offer | `/foundation` — Offer Builder + Buyer Profile/Language Library + Freedom Number | offer worksheet + avatar/language worksheet + freedom-number target |
| **C** | Conversion | `/convert` — Pitch Builder + Self-Close (+ AI-SDR Conversations) | VSL system + no-call close |
| **A** | Attention | `/posting` — Content Engine (the 6 Buying Beliefs) | belief-shift content system |
| **L** | Leads | `/leads` — DM Engine + ads + outbound + partnerships | comment/DM to conversation + lead gen |
| **I** | Implementation | the AOS Operator (drafts, you approve, it ships) | the AI agent that runs delivery |
| **N** | Nurture | `/convert?tab=nurture` — build-once sequences | long-term nurture / retargeting |
| **G** | Growth | `/scoreboard` — Scoreboard + Profit Audit | KPI "GPS" dashboard + roster profitability purge |

**Rule:** no competitor, person, or third-party product/tool name appears anywhere in the product, code, UI, or docs. Borrowed mechanics are expressed only under the Skalers/SCALING names above. A `grep` gate enforces this before any ship. The AI operator is **the AOS Operator** (the client's AI employee).

---

## 5. The modules in depth

### 5.1 Foundation (NEW — the spine)

A multi-step flow at `/foundation` (reached automatically after `/setup`, and always editable later). Three sub-tools. All fields persist to D1 and a synthesized **system-prompt block** is mirrored into CONFIG KV so the Operator and every tool read the foundation with zero extra round-trips.

**A) Offer Builder** — captures the offer and its proof, structured (not a prose blob) so it can render into worksheets, sales pages, and ad copy:
- **Best client** — name + what was done for them (the proof anchor the whole offer is built around).
- **Buyer snapshot at Point A** — title, what they do, 2–3 defining stats (e.g. years in business, team size, monthly revenue).
- **Transformation (Point A → Point B)** — paired rows in the buyer's words: tangible goal/result, intangible goal/result, three obstacles → three sub-results, old way → new way, operating basis before/after, frustration → pride, worry → gratitude.
- **Process** — the steps taken to get the result, the timeline, deliverables, guarantee, scarcity/urgency, bonuses, pay options.
- **Top 3 key drivers** — if only three things mattered, which three, and why.
- **The offer** — avatar, promise, timeline, phases (the named order), structure, guarantee, scarcity, bonuses, pay options.
- **Mechanism/messaging matrix** — for each of the top desires: big desire → top obstacles → obstacles flipped → the fix → the named mechanism → the outcome → the benefit of the outcome. (This matrix is what feeds headline/hook generation downstream.)
- **About the business** — mission, vision, purpose, values, primary thesis, credibility, principles, what they stand for, what they stand against.

**B) Buyer Profile + Language Library** — the marketing-language source of truth, captured in the buyer's *exact words* (raw, unpolished — real words convert):
- **Demographics & psychographics** — who they are, what they're trying to achieve, what keeps them up at night, what they've tried, what they've spent, who they trust.
- **Their words** — desires ("I want…", "if only…"), fears ("I'm afraid that…", "what if…"), frustrations ("I'm sick of…", "nothing works because…"). 10–20 verbatim quotes each.
- **The journey** — a concrete day/week/month in the life of someone stuck in the problem; drives (toward) and fears (away from); the identity they aspire to; their dreams; past failures; what they're suspicious of; the common enemy (external + internal).
- **Market research** — who they follow, what they spend annually, where they hang out, competing offers + pricing, the gap nobody fills.
- **Positioning** — USP (the converging things nobody else combines), the unique mechanism, why-they-buy, why-you, speed & effort, dogma/principles.
- **Objections & cost of inaction** — surface objections, internal/external/vehicle limiting beliefs, the 24-month "do nothing" scenario, the compounding cost.
- **The 5 emotional levers** — paint the dream / remove the blame / handle the fear / say what they're thinking / name the enemy, with deployment notes by surface (cold ad, mid-funnel, sales page, DM).
- **Ideal client & nightmare client** — the person to attract, and the anti-avatar to repel (repel twice as hard as you attract).
- **Testimonials** — collection questions + a structured library of quotes/results.

**C) Freedom Number** — the target that makes everything measurable:
- Inputs: desired monthly take-home profit, desired liquid net worth ("work becomes optional" number), current monthly profit, average client value, margin.
- Outputs: clients/month and revenue/month required to hit the target, the gap from today, and the implied acquisition math (how many conversations → closes per month). This output is what the Scoreboard tracks against.

**Data:** new D1 tables `foundation_offer`, `foundation_buyer`, `foundation_freedom` (one row per install; JSON columns for the repeating matrices) + a CONFIG KV key `foundation_prompt` holding the synthesized block.

**Reuse:** the skalers.io Offer-Architect 5-phase chat prompt and the brand-voice training flow are ported as prior art; the `0-voice-fingerprint`, `0-copywriting`, and `0-skalers-marketing-context` skills supply the lint-and-guidelines layer.

### 5.2 Content Engine (EXTEND `/posting` + the Operator)

AOS already renders carousels/quotes/reels and publishes to 20+ platforms via the publishing integration, on a pillar rotation. The change is to make it belief-driven and foundation-aware:

- **The 6 Buying Beliefs** become the pillar set: (1) the problem is real and urgent, (2) the old way is broken, (3) a better way exists, (4) *this* system is the better way, (5) you are the right guide, (6) now is the time. Every content piece maps to one or more, and the calendar rotates through all six so any prospect encounters the full shift.
- **Weekly rhythm:** one long-form input → transcribe → clip 5–10 shorts (15–35s sweet spot) → captions/hooks → supporting graphics → schedule → ad variations from the best organic.
- **Proprietary skill:** rebuild the content methodology (hooks, clip categories, copy gate, ad-creative formats, posting system) as a Skalers `.claude/skill` named `content-engine` that the Operator loads. The Foundation system-prompt block is injected into every brief so output is in the buyer's language by default.

No new publishing infrastructure — this is configuration + prompt + skill, on top of what exists.

### 5.3 Pitch Builder + Self-Close (NEW `/convert`)

The genuine product gap — AOS has no sales surface today.
- **Pitch Builder:** generates a sales/pitch page from the Foundation offer (the transformation, mechanism, proof, offer, guarantee, scarcity), rendered to HTML and hosted on a Worker route with the asset on R2. The client gets a live URL to use as the destination for ads and DMs.
- **Self-Close:** a no-call conversion sequence (email/DM) built from the 5 emotional levers and the cost-of-inaction, delivered through the existing notification + conversation rails, so qualified buyers convert without a call.

### 5.4 Ad Engine + DM Engine (EXTEND `/paid`, `/prospecting`)

- **Ad Engine:** formalize a three-campaign structure in the existing Meta tools — **TOF** (cold, purchase-optimized, broad/interest/lookalike, many diverse creatives), **MOF** (retargeting engagers with belief-shift content optimized for watch time — the "binge" that pre-sells), **BOF** (warm retargeting with proof/objection-handlers/offer). Includes the kill/scale rules and pre-launch pixel checklist as Operator guidance. Campaigns continue to be created paused for human launch.
- **DM Engine:** a new trigger + playbooks that route inbound comments and DMs (via the publishing integration's DM tools the Operator already has access to) into the existing `conversations` table. We reuse the AI SDR rather than building a second inbox.

### 5.5 Conversations — Close (EXTEND `/prospecting/conversations`)

Unify DM + email + LinkedIn threads into the one existing AI-SDR surface; add **Self-Close** playbooks in settings (softeners, hell→heaven gap, tie-downs, relentless-but-not-annoying follow-up, clean hand-off). Booking and CRM routing already exist.

### 5.6 Scoreboard + Profit Audit (NEW `/scoreboard`)

- **Scoreboard:** a native dashboard (replacing the analytics dead-end) showing the funnel (reach → leads → conversations → closed), spend/CAC/LTV/ROAS, and **progress vs the Freedom Number**, pulling from existing `campaigns`, `meta_insights`, `conversations`, and CRM/payment data.
- **Profit Audit:** ranks clients and acquisition sources by margin and effort and flags what to cut and what to scale — turning the platform from "do more" into "do more of what's profitable."

---

## 6. Data model & state changes

| Change | Where | Purpose |
|---|---|---|
| `foundation_offer`, `foundation_buyer`, `foundation_freedom` tables | new migration `0026_foundation.sql` | Persist the three Foundation worksheets (one row/install; JSON for repeating matrices) |
| `foundation_prompt` KV key | CONFIG KV | Synthesized system-prompt block the Operator + tools read |
| `content_pillars` ← 6 Buying Beliefs | CONFIG KV / existing pillar config | Belief-driven content rotation |
| `sales_pages` table | later migration | Generated pitch pages + hosted URL + R2 asset key |
| `conversations.channel` includes `dm` | existing `conversations` | DM Engine routes into the unified SDR |
| Scoreboard read-model | new `src/api/scoreboard.ts` | Aggregates existing campaigns/insights/conversations + CRM/payments vs Freedom Number |

---

## 7. Information architecture (so it reads as one journey)

The dashboard nav is re-grouped from a flat card grid into the **six-stage path**, in order:

```
1 Foundation   →   2 Create   →   3 Convert   →   4 Capture   →   5 Close   →   6 Scoreboard
 (offer/buyer/      (posting +     (pitch pages   (paid +          (convos)     (+ Profit
  freedom)          calendar)      + self-close)   prospecting +                 Audit)
                                                   partnerships +
                                                   DM engine)
```

Settings remains the cross-cutting drawer (health, integrations, model, playbooks, brand). The "Today" home becomes the operator's daily standup across all six stages, each line linking into its stage. A first-run state nudges the client to complete Foundation before anything else unlocks meaningfully.

---

## 8. Build roadmap

Each phase is independently shippable and demo-able.

- **Phase 1 — Foundation onboarding.** D1 migration + API + `/foundation` UI (Offer Builder, Buyer Profile/Language Library, Freedom Number) + CONFIG KV mirror. Highest leverage: everything downstream reads it, and it's the strongest demo of "the platform knows your business."
- **Phase 2 — Foundation → Content Engine + Pitch Builder/Convert.** Belief-driven pillars, foundation-injected briefs, the `content-engine` skill, and the `/convert` sales-page generator + hosting.
- **Phase 3 — DM Engine + unified Conversations.** New DM trigger + playbooks routing into the AI SDR; Self-Close playbooks.
- **Phase 4 — Scoreboard + Freedom Number tracking + Profit Audit.** Native funnel/wealth dashboard + roster/source P&L.
- **Cross-cutting** — proprietary naming everywhere + the six-stage navigation IA.

---

## 9. Reuse map (what we deliberately do NOT rebuild)

- **Publishing** to 20+ platforms — already exists via the integration; Content Engine sits on top.
- **The Operator + tool loop + render pipeline** — already exists; we add a skill + foundation injection, not a new agent.
- **The AI SDR + conversations + bookings + CRM routing** — already exists; DM Engine and Self-Close extend it.
- **The `/setup` wizard + CONFIG KV + auth + per-install isolation** — already exists; Foundation expands setup.
- **Meta Ads tools + insights sync + audiences** — already exist; Ad Engine formalizes the campaign structure.
- **Prospecting + Dream-100** — already exist; they become the "Capture" stage.

Only genuinely new surfaces: Foundation, Pitch Builder/Convert, the Scoreboard, Profit Audit, the DM trigger, and the `content-engine` skill.

---

## 10. Verification

- **Proprietary gate:** `grep -ri` the deliverable + all new code/UI for the banned names and borrowed product names — must return zero.
- **Flow walkthrough:** in `wrangler dev`, `/setup → /foundation` persists; `/posting`, `/convert`, `/scoreboard` each read the Foundation; nav reads onboard → use → retain.
- **Per phase:** migration applies cleanly; `cd ui && bun run build` then `wrangler deploy`; the Operator's brief includes the Foundation block; a generated pitch page hosts and loads; the Scoreboard shows progress vs the Freedom Number.
