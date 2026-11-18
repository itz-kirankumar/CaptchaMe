# CaptchaMe

The tools that beat CAPTCHAs are sold openly, some on the official Chrome Web
Store. Buster solves audio puzzles with speech-to-text for about 700,000
users. CapSolver, 2Captcha and NopeCHA solve puzzles in the background for a
fee. An AI agent that browses can solve a puzzle the way a person does: look
at it and click.

So this project stops testing what a visitor can *see* and tests whether a
live person is *there*, then does the part the industry skips: it caps what
any one actor can take, in dollars, with a plain reason and an appeal.

Three lanes through one door:

1. **Human, pointer path** - follow a moving ring or tap to a beat. Scored on
   the server on the *shape* of the response: reaction lag (people run 80-350
   ms behind a moving target), the spread of that lag, and the constant small
   corrections a hand makes. Scripts that read the published path track it at
   0 ms with zero corrections. Look-think-act agents re-aim every couple of
   seconds and glide in straight lines. Both fail.
2. **Human, voice path** - built for people who cannot use a pointer or a
   timed visual test. Four words appear and are spoken at a random cadence;
   say each one back. The server checks that the words match and that a live
   voice answered: when it started relative to each prompt, and how much that
   timing varies. Playback scripts answer at one uniform latency.
3. **Declared AI agent** - an honest agent should not have to fake being a
   person. It signs a server nonce with an Ed25519 key (the shape of the Web
   Bot Auth standard), skips the checks, and gets its own budget.

Behind the door: the **fair-share ledger**. Every actor gets a dollar
allowance on the protected API. At the cap, the block carries a plain reason
and an appeal link, and a human can overturn it. The dashboard counts what
the cap saved, in dollars.

## Run it

Node 18 or newer.

```
npm install
npm run build && npm start   # http://localhost:3000
npm test                     # 93 end-to-end checks: humans pass, bots fail, relays refused, caps bite
npm run demo:attack          # attack a running server; watch analytics catch each one
npm run demo:scrape          # a python-requests style crawler against the scraper shield
```

Admin key for the console and analytics: `demo-admin` (override with `POP_ADMIN_KEY`).

## The platform

| Page | What it is for |
|---|---|
| `/check` | Seven live formats: ring, colour clash, targets (Fitts' law), flash, follow + catch, beat, and Surprise me (server picks) |
| `/live` | Pick a format and an attacker; watch both sides play out; the real server judges |
| `/arena` | Classic formats (text, image grid, math, slider, rotate, click-in-order, checkbox, proof of work) and real Turnstile / hCaptcha / reCAPTCHA widgets beside CaptchaMe, with an attacker label and a live scoreboard |
| `/scraper` | The scraper shield on a demo catalogue: allow, slow, decoy (with a traceable canary), block |
| `/integrations` | Snippets for HTML, Next.js, Express, Python, edge middleware, cURL and the agent lane |
| `/analytics` | Developer analytics: traffic, verdicts by format, reasons, shield decisions, attackers |
| `/dry-run` | 18 scripted scenarios against the live server in about 20 seconds, plus a stage checklist |
| `/dashboard` | Console: ledger, appeals, event feed |

### Against solver farms

Solver services beat classic captchas two ways: ship the content (image, audio, question) to a model or a worker, or ship the token a worker earned elsewhere. CaptchaMe has no content to ship (a live interaction with sub-second windows, where relay delay shows up as lag) and refuses relayed tokens: every pass is bound to the browser that earned it. Send the visitor's `remoteip`, `user_agent` and `accept_language` to `/api/pass/verify` to check it.

### Real vendor widgets in the arena

Without keys the arena uses each vendor's public test keys, which always pass, and says so on the card. For a real comparison set `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`, `HCAPTCHA_SITE_KEY`/`HCAPTCHA_SECRET_KEY` and `RECAPTCHA_SITE_KEY`/`RECAPTCHA_SECRET_KEY`.

## The second layer: abuseguard (optional)

CaptchaMe proves a live person is there. It cannot see that twelve "different" visitors are one person who
keeps taking the free tier. [abuseguard](docs/ABUSEGUARD.md) sits behind it and caps dollars **per person
across every account, key and session linked to them**, with named reasons, appeals and signed alerts.
Set `ABUSEGUARD_URL`, `ABUSEGUARD_KEY` and `ABUSEGUARD_SALT` to turn it on; it starts in shadow mode and
fails open, and with the variables unset nothing changes. Status and the shadow comparison:
`GET /api/admin/abuseguard`. Test: `npm run test:abuseguard`. Full guide: [docs/ABUSEGUARD.md](docs/ABUSEGUARD.md).

## Validation on public data

`npm run validate:fetch && npm run validate` audits and runs the checks against real public datasets
(typing, pointer, client identity, Stroop) with person-level confidence intervals. What exists, what it can and cannot
prove, and the measured gaps are in [docs/DATASETS.md](docs/DATASETS.md) and [docs/VALIDATION-PLAN.md](docs/VALIDATION-PLAN.md).

## Vercel

The repo deploys to Vercel as-is: `api/[...all].js` handles every `/api/*`
route and `public/` is served statically. Two honest limits on serverless:
challenge replay tracking and the fair-share ledger live in memory per
instance, so a cold start resets the ledger and a replay is only caught when
it lands on the instance that saw the first answer. For a stage demo on one
warm instance this holds; for production, move both to a shared store.

## Five-minute stage demo

1. Open the dashboard on the projector.
2. On your phone or a second tab, pass the ring check, then the voice check.
   Each pass appears live.
3. Run `npm run demo:attack`. Seven attacks - script bot, look-think-act
   agent, beat bot, voice playback, replay, scraper, and finally an honest
   agent - are caught one by one on the dashboard.
4. Open `/agent.html` and run the in-browser agent: it declares, spends its
   budget, hits the cap, and files an appeal. Approve it on the dashboard.
   Its allowance grows, live.
5. Close on the ledger: "Detection is rented. The cap is the product."

## Honest scope

No single check proves humanity forever, and this one does not claim to.
Published work already pairs slow planners with fast reactive models, and
mouse-path generators beat movement detectors. Voice cloning can imitate a
voice. The design takes that seriously:

- every challenge works once and expires in 90 seconds (replays are refused),
- scoring judges response shape, never raw speed,
- the voice path exists so the door does not depend on sight, hearing, or
  fine movement (WCAG 2.2 requires an equal way through),
- and when any check is beaten, the fair-share ledger still caps what the
  attacker can take. The check raises the cost. The ledger bounds the damage.

## API sketch

```
POST /api/challenge/start   {type: ring|beat|voice} -> {session, params}
POST /api/challenge/submit  {session, ...telemetry} -> {pass_token} | {reason}
POST /api/agent/nonce       -> {nonce}
POST /api/agent/declare     {pubkey, signature, nonce, operator} -> {agent_token}
GET  /api/protected/quote   Bearer token or browser actor cookie; $0.10/call
POST /api/appeal            {actor, message}
GET  /api/admin/events      X-Admin-Key (dashboard feed)
```

MIT licensed.


## The advanced challenges (v2)

Three layers beyond the base build, aimed at the tools people actually use to get past captchas:

- **Follow the ring, with darts** - the ring teleports to a new path twice at random moments. A script that read the path from the challenge response tracks the jump with zero reaction time (flagged). A look-think-act browser agent takes seconds to re-aim (flagged). A person re-acquires in a few hundred ms with a visible swoop.
- **Catch the flash** - five flashes at random gaps, click each within a sub-second window. Timers that click at a fixed offset show identical reaction times (flagged). Agents whose screenshot-think-act loop takes over a second miss every window. People land at 200-450 ms, scattered.
- **Honeypot trap link** - an offscreen, aria-hidden link labelled for machines ("complete verification here"). People never see it; screen readers skip it; DOM-reading agents follow it and get logged as automated traffic.

STT-based audio solvers (the Buster approach) hit the voice path, which scores vocal onset timing per word and caps a no-transcript pass at 70, so a solved voice challenge is worth less on the ledger than a solved interactive one.

## Round 3: dual-task and drift

- **Pulse (dual-task)** - follow the ring while random flashes demand a click within 800 ms. A person splits attention and wobbles on the ring while reacting. A step agent (screenshot, think, click) reacts too slowly to the flashes and its ring tracking collapses while it is busy. Scoring checks reaction windows plus tracking degradation during each flash.
- **Rhythm drift check** - the ring scorer now fits the tracking lag per window and flags when the lag drifts more than 120 ms across one challenge. A bot whose synthetic lag random-walks shows drift a steady human arm does not.
- **/compare.html** - the captcha types on 2captcha's demo page next to that vendor's own published prices and solve speeds, with sources. The point: every classic type is solved as a paid service today; CaptchaMe checks for a live, embodied person instead of a puzzle answer.

## What still gets through (honest residuals)

- A dedicated simulator that waits the full challenge time and submits human-shaped tracking samples can pass pulse today. The wall-clock floor still forces it to spend real seconds per attempt and the fair-share ledger caps what any actor can earn, so farming stays unprofitable - but we do not claim it is stopped.
- A good TTS+STT pipeline with human-like jitter passes the voice path at full score. Same backstop: the ledger cap. A prosody check (say the second word louder) is designed but not built.
- Real commercial agentic browsers (Comet, Atlas, ChatGPT agent mode) have not been run against the live site yet. Our own cloud-browser agent attempt failed the flash check.

Human friction budget: ring 7s, beat ~9s, voice ~8s, flash ~11s. One screen, one try, no puzzles.


## Layer 2: post-verification analysis

Layer 1 decides one challenge. Layer 2 keeps every packet layer 1 produces, merges them into one identity per real client (across IP, network signature, TLS hash when a proxy supplies one, browser fingerprint, cookies and tokens), names the bypass family (script, automation browser, solver service, LLM agent, human-mimic, scraper, declared agent, human), shows which layer flagged it, and reports what each identity cost and scraped. The protected API asks layer 2 before it serves a call.

Open `/layer2` for the analysis and `/live` to attack both layers side by side. Full write-up, evidence codes, red-team notes and limits: [docs/LAYER2.md](docs/LAYER2.md). `npm run test:layer2` runs 27 checks.
