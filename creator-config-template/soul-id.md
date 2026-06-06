# Soul Character ID (Phase 3 — avatar reels only)

Skip this file if you don't plan to use AI avatar reels.

## What it is
Your trained Higgsfield Soul Character reference. Looks like
`soul_abc123def456...`. The agent uses it when you ask for an "avatar reel"
or call POST `/trigger/avatar`.

## How to get it
1. Sign up at https://higgsfield.ai and grab an API key.
2. Train a Soul Character on your face (1–2 portrait photos, ~10 minutes).
3. Copy the returned `reference_id` — that's your soul_id.

## How to wire it in

Put the ID in the `SOUL_ID` KV key (NOT `soul-id.md` — this file is just a note for you):

```bash
bunx wrangler kv key put --binding=CONFIG SOUL_ID "soul_abc123def456..."
```

Then set the Higgsfield API key on the **Railway service** (not the Worker):

```bash
# in skalers/backend/acquisition-os-api
railway variables set HIGGSFIELD_API_KEY=hf_...
```

This keeps your Higgsfield key in one place (Railway) and out of the Worker's
agent context. Multiple creators can share the same Railway service safely
because each one's `soul_id` is just a routing identifier, not a secret.
