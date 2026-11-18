# CaptchaMe: briefing for the other layer

Verified against the code in this repo (`server.js`, `lib/*`, `app/*`, `public/*`). Items marked *(my reading)* are inferences from the code, not documented claims.

## 1. One-paragraph pitch

CaptchaMe replaces puzzle-based CAPTCHAs with a **presence check**. A visitor does a 7-11 second interactive task: follow a moving ring, tap a beat, hit random flashes, or speak words back. A server scores the **shape** of the behavior (reaction lag, micro-corrections, jitter, drift, vocal onset), not the answer. A pass yields a signed **pass token**.

Honest AI agents take a separate **declared lane**. They sign a nonce with an Ed25519 key and get their own budget. Behind both sits a **fair-share ledger**: every actor gets a dollar allowance on the protected API. When the allowance runs out, the block carries a plain reason and an appeal link. The thesis is that detection will always eventually be beaten, so the cap bounds the damage.

## 2. The problem it addresses

- Classic CAPTCHAs are solved as a commodity: Buster (audio puzzles via speech-to-text), and paid services such as CapSolver, 2Captcha and NopeCHA.
- AI agents that browse can simply look and click.
- CAPTCHAs test what a visitor can *see*, which machines are now good at.

CaptchaMe's answer has two parts:
1. Check that a live, embodied person is present.
2. Assume any check can be beaten, and cap what any one actor can take, in dollars, with a plain reason and a human appeal.

## 3. Three lanes through one door

| Lane | Who | How it is judged |
|---|---|---|
| Pointer path | Humans | Ring, beat, reflex or pulse challenge, scored on response shape. |
| Voice path | Humans who cannot use a pointer or timed visuals (accessibility, WCAG 2.2) | Four words spoken at a random cadence; say each back. Server checks word match and live-voice timing. |
| Declared AI agent | Honest bots | Signs a server nonce with an Ed25519 key, skips challenges, gets its own budget. |

## 4. Entities

| Entity | What it is |
|---|---|
| Challenge session | Stateless HMAC-signed blob: type, random params, issue time. Expires in 90 s, can be submitted once. |
| Actor | Ledger identity. `human:<hex>` from the `pop_actor` cookie. `agent:<12-char sha256 of pubkey>` from agent declaration. |
| Pass token | HMAC-signed `{jti, actor, kind: human or agent, exp}`. TTL 5 minutes. |
| Ledger record | `{id, kind, spent, granted, blocked, createdAt, note}` |
| Appeal | `{id, actorId, message, status: open / approved / denied, at}` |
| Event | Dashboard feed row `{seq, at, type, message, lane?, score?, flags?, actor?}`. Types: `pass`, `fail`, `replay`, `blocked`, `call`, `appeal`, `agent`, `trap`. |

## 5. API surface

All routes live in `server.js`, a zero-dependency Node handler. Next.js reuses it through the shim `pages/api/[...all].js`.

### Challenge flow
- `POST /api/challenge/start {type}` returns `{session, type, params, expires_in_ms}`.
  - `type` is `ring`, `beat`, `pulse`, `reflex` or `voice`. Anything else gets a 400.
  - Rate limit: 40 per minute per IP, in memory.
- `POST /api/challenge/submit {session, env:{webdriver}, ...telemetry}`
  - Ring and pulse send `samples:[{t,x,y}]`. Pulse and reflex also send `clicks`.
  - Beat sends `taps`.
  - Voice sends `wordTimings:[{promptStartMs, onsetMs}]` and `transcript`.
  - Pass returns `{result:'pass', score, flags, detail, pass_token, actor, budget_added:2}` and sets the cookie `pop_actor`.
  - Fail returns `{result:'fail', score, flags, detail, reason}`.
  - Expired or tampered session returns 410. Replay returns 409.
- `POST /api/voice/stt {session, audio(base64), mime}` returns `{transcript, engine:'sarvam'}`. Server-side speech-to-text through Sarvam, once per session and 300 per day. Otherwise the browser falls back to Web Speech.

### Pass verification (what a customer's backend calls)
- `POST /api/pass/verify {pass}` returns `{ok:true, subject:'human'|'agent', actor, share}` or `{ok:false, reason}`.

### Agent lane
- `POST /api/agent/nonce` returns `{nonce}`.
- `POST /api/agent/declare {pubkey(base64 SPKI DER), signature(base64), nonce, operator}` returns `{result:'declared', actor, agent_token, budget:1.00}`.

### Protected resource and ledger
- `GET /api/protected/quote` is a stand-in for a paid AI API, $0.10 per call. Accepts `Authorization: Bearer <pass or agent token>` or the `pop_actor` cookie. Returns `{quote, charged, remaining}`, or 429 `{error:'budget_exceeded', reason, actor, appeal_url}`.
- `GET /api/ledger/me` returns the caller's own record (cookie).
- `POST /api/appeal {actor, message}` returns `{ok, appeal_id}`.

### Admin (header `X-Admin-Key`, default `demo-admin`, override with `POP_ADMIN_KEY`)
- `GET /api/admin/events?since=`
- `GET /api/admin/actors`
- `GET /api/admin/appeals`
- `POST /api/admin/appeal/:id {action:'approve'|'deny'}` (approval grants +$1)

### Honeypot
- `GET /trap` (aliased to `/api/trap`) logs a `trap` event. The link is offscreen and `aria-hidden`, so only DOM-reading agents follow it.

### Embeddable widget
- `public/widget.js` injects an iframe pointing at `/check?embed=1&site=<key>`.
- On success it fires the DOM event `captchame:pass` with `{pass_token, score, site}`, and optionally calls the global named in `data-onpass`.

## 6. Decision rules

**Pass condition:** `score >= 60` and not too fast and no `navigator.webdriver` and no hard-flag keyword in the flags.

**Wall-clock floor:** the answer must take at least 70% of the challenge duration, otherwise the score is capped at 10. A webdriver flag also caps the score at 10.

**Scoring signals** (`lib/scoring.js`, pure functions returning `{score, flags, detail}`)
- **Ring:** best-fit lag from 0 to 600 ms against the Lissajous target.
  - Humans lag 80-350 ms.
  - Flags: zero-lag perfect tracking, very low RMSE, no micro-corrections, too-regular sample clock.
  - Lag drift across the three windows of one run must stay under 120 ms.
  - The ring also teleports twice (darts); a follower must re-acquire within 1.2 s.
- **Beat:** humans anticipate slightly (-30 to -150 ms) with spread. Scripts hit 0 ms.
- **Reflex:** five flashes, 900 ms window each. Fixed-offset timers show identical reaction times.
- **Pulse:** ring plus flashes. Checks the coupling: tracking degrades after each flash the way a person's does.
- **Voice:** transcript similarity by edit distance, mean onset latency and its coefficient of variation. Uniform latency suggests playback. Without a transcript the score is capped at 70.

**Ledger defaults:** anonymous $0.50, human $2.00 (granted on pass), agent $1.00. A call costs $0.10. The dashboard's "saved" figure is blocked calls x $0.10.

## 7. Persistence and deployment

- **Store:** `lib/store.js` uses Firestore over REST (no SDK) when `FIREBASE_SA_JSON` is set. Otherwise in-memory maps. Collections: `actors`, `events`, `appeals`, `counters`.
- **In memory regardless of store:** replay tracking (`doneSessions`), pass-token use tracking, agent nonces, rate-limit buckets, STT counters.
- **Frontend:** Next.js 16 App Router with Tailwind v4. Pages: `/`, `/check`, `/voice`, `/agent`, `/live`, `/dashboard`, `/appeal`, `/how`, `/compare`, `/use`. Client engines are plain JS in `public/engines/*`. Deployed to Vercel.
- **Env vars:** `POP_SECRET`, `POP_ADMIN_KEY`, `FIREBASE_SA_JSON`, `SARVAM_API_KEY`.
- **Run:** `npm run dev` (Next app), `npm run legacy` (plain Node server), `npm test` (e2e), `npm run demo:attack` (simulated attackers).

## 8. Honest weaknesses

These are the places another layer would most naturally plug in or fix.

1. **Actor identity is free to mint** *(my reading)*. The actor is an unsigned `pop_actor` cookie. Dropping it creates a new actor with $0.50 free. Even a failed challenge lets the same client call `/quote` as a new anonymous actor. The cap is per actor, so the ledger is only as strong as the cost of making a new identity. This is the biggest structural gap.
2. **"Single-use" pass tokens are not enforced on the main paths** *(my reading)*. `/pass/verify` and `/quote` both call `verify(..., {consume:false})`, so within the 5 minute TTL a token is reusable and a captured one can be replayed. Tokens carry no site binding.
3. **The `data-site` key is cosmetic** *(my reading)*. No per-customer secret, origin check or tenant isolation. `/pass/verify` needs no customer credential.
4. **Naming mismatch.** The widget emits `pass_token`; `/pass/verify` expects the body key `pass`.
5. **Detection ceiling** (stated in the README).
   - A simulator that waits out the full duration and submits human-shaped samples can pass.
   - TTS plus STT with jitter can beat the voice path.
   - A prosody check is designed but not built.
   - Real agentic browsers (Comet, Atlas, ChatGPT agent mode) are not yet tested against it.
6. **Serverless state** *(my reading)*. Session and token secrets default to a random value per instance, so cold starts can invalidate tokens unless `POP_SECRET` is set.
7. **Agent lane is simplified.** It only proves key possession. No operator identity, key registry or revocation, and nonces never expire. The "10% of capacity" and "humans only" policies are described on `/use`, but I did not see them enforced in server code.
8. **Demo defaults.** Admin key defaults to `demo-admin`. The "protected API" is a fake quote endpoint.
9. **README is partly stale.** It mentions `api/[...all].js` (now `pages/api`), `dashboard.html` and `agent.html` (now Next routes), and "27 checks" (the landing page says 45).

## 9. Integration seams

I do not know what the other layer does, so these are phrased as slots.

- **Identity or sybil resistance:** replace or sign the `pop_actor` concept in `server.js` (`/challenge/submit`, `/protected/quote`). Tie actors to something expensive to mint.
- **Metering or billing:** `lib/ledger.js` (`spend`, `DEFAULTS`, `COST_PER_CALL`) is the clean interface for real per-customer, per-resource pricing.
- **Customer or tenant layer:** site keys, per-customer secrets, origin binding in tokens, an authenticated `/pass/verify`.
- **Agent trust:** `/api/agent/declare` could take a registry, attestation or reputation layer.
- **Detection signals:** add scorers in `lib/scoring.js`. Register a new challenge `type` in `/challenge/start` and `/submit`.
- **Storage:** swap `lib/store.js` behind its interface (`getActor`, `putActor`, `addEvent`, `addAppeal`, ...).
- **Observability:** consume `/api/admin/events`.

## 10. Questions to settle before bringing the other layer

1. Does it sit **before** the door (identity or device), **at** the door (more detection signals), or **after** it (metering, billing, policy)?
2. Will it be a separate service called over HTTP, or code merged into this repo?
3. Which weakness above does it solve? If it is #1, the ledger actor model changes shape.
4. Should the pass token become customer-bound and consumable before the integration is built?

## 11. Repo history, for context

1. Proof of Presence: ring and voice paths, agent lane, ledger.
2. Serverless hardening: stateless signed sessions, Vercel deploy.
3. Advanced challenges: darts, reflex flash, honeypot trap.
4. Round 3: pulse dual-task, drift check, `/compare` page, rename to CaptchaMe.
5. Adaptive-attacker coverage: wall-clock floor, webdriver probe.
6. Sarvam server-side speech-to-text for the voice path, capped.
7. UI redo: design system, live bot-vs-human page, embeddable widget, demo storefront.
8. Firestore-backed store with in-memory fallback, async ledger.
9. Migration to Next.js 16 and Tailwind v4, backend reused verbatim through the `/api` shim.
