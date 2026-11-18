# Proof of Presence

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

No dependencies. Node 18 or newer.

```
npm start          # http://localhost:3000
npm test           # 27 end-to-end checks: humans pass, bots fail, caps bite
npm run demo:attack  # attack a running server; watch the dashboard catch each one
```

Dashboard: http://localhost:3000/dashboard.html (admin key `demo-admin`,
override with `POP_ADMIN_KEY`).

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

Human friction budget: ring 7s, beat ~9s, voice ~8s, flash ~11s. One screen, one try, no puzzles.
