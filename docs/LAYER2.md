# Layer 2: post-verification analysis

## Summary

1. Layer 1 (the CaptchaMe checks) decides one challenge: pass or fail.
2. Layer 2 keeps everything layer 1 saw and everything that happens after.
3. It merges requests into **one identity per real client**, even when the IP and browser name change.
4. It says **which bypass family** the identity belongs to: script, automation browser, solver service, LLM agent, human-mimic, scraper, declared agent, or human.
5. It says **which layer flagged it** and shows the raw evidence line.
6. It shows **what each identity cost you** and **what was scraped**.
7. The protected API asks layer 2 before it serves a call. A bad identity is refused with a reason, an appeal link and a way back.

Open `/layer2` for the analysis and `/live` to attack and watch. Code: [lib/layer2.js](../lib/layer2.js). Tests: [test/layer2.js](../test/layer2.js) (27 checks).

## Where it sits

```
visitor -> Layer 1 (CaptchaMe: ring, beat, voice, ... L0-L7 steps) -> pass / fail
                 |  every packet
                 v
           Layer 2 (this file): capture -> one identity -> bypass family -> decision
                 |
                 +-> protected API gate (block, step up, allow)
                 +-> /layer2 analysis, live room feed
                 +-> abuseguard (optional): dollar fair-share across linked accounts
```

Layer 2 is built in. abuseguard (see [ABUSEGUARD.md](ABUSEGUARD.md)) stays an optional separate service that caps dollars per person. Layer 2 answers "who really is this and how did they get through". abuseguard answers "how much may they use".

## What layer 2 captures

| Packet | From | What it records |
|---|---|---|
| `challenge.start` | layer 1 | network signature, address, user agent, signed challenge id |
| `challenge.submit` | layer 1 | pass or fail, score, every flag, raw measurements (lag, corrections), browser probe, wall clock, sample clock |
| `rival.verify` | other captcha styles | solved or not, time taken |
| `scrape` | scraper shield | page, decision, risk, canary |
| `protected` | protected API | which identity spent what |
| `trap`, `agent.declare` | trap link, agent lane | trap hit, declared agent |
| note | `/api/pass/verify` | a pass earned in one browser and presented from another |

## Who is it? One identity, many labels

Every packet carries links. Two identities merge when their shared links add up to **1.0 or more**.

| Link | Weight | Notes |
|---|---|---|
| cookie browser id, actor id, token id, signed challenge id | 1.0 | strong on their own |
| browser fingerprint (plugins, cores, languages, screen, window, time zone) | 0.7, or 0.3 if many share it | |
| network signature (header order and shapes) | 0.6 if rare, 0.15 if common | rare means two or fewer identities share it |
| TLS handshake hash from a trusted proxy | 0.6 if rare, 0.2 if common | only when a CDN or proxy adds it |
| exact IP address | 0.4, or 0.1 if more than 4 different browsers use it | many browsers on one address means a shared network |
| same address again within 20 seconds | +0.15 | one burst of activity |
| same /24 network | 0.15 | |
| same user agent | 0.2 | |
| next catalogue page, right after the last one, from another address | 0.4 | |

Effects, all tested:

- A scraper that changes IP and browser name on every request is **one** identity (24 addresses, 5 browser names).
- A solver farm and its remote worker are **one** identity, because they share the signed challenge id.
- Two different bots on the same network are **not** merged.
- Same IP + same browser + same stack merges only inside one 20-second burst (0.4 + 0.2 + 0.15 + 0.15 + 0.15 = 1.05). Slower than that it is 0.9 and stays separate. A shared office or campus looks exactly like that, and wrongly merging two people is worse than keeping two identities.

## Which bypass family? What it is built against

I read the public 2captcha libraries and demos (Python, JavaScript, the slider demo, the Cloudflare demo, the two MCP solver projects). This is what they do and what traces that leaves. It is a description for defence, not a how-to.

| Technique | What it does | What layer 2 sees | Evidence codes | Layer |
|---|---|---|---|---|
| Image, grid, rotate, canvas, coordinates | The picture is uploaded. A worker or vision model answers. | Answers at price-list speed across several formats; all correct; no pointer history | `MARKET_SOLVE_PACE`, `INSTANT_SOLVES`, `UNIFORM_AI_PACE` | L5 |
| Token relay | The caller sends its user agent, cookies and proxy to a worker. The worker solves and returns a token. | Pass earned in one browser, used from another. Started with one network signature, answered with another. Late answer. | `TOKEN_RELAY`, `SIGNATURE_SWITCH`, `NETWORK_SWITCH`, `LATE_ANSWER`, `BROWSER_SWITCH` | L6 |
| Slider demo (Puppeteer) | One coordinate from a worker, then a drag of 50-100 equal steps at a fixed delay from the knob centre. | Perfect sample clock, zero lag, no corrections, instant answer | `SYNTHETIC_CLOCK`, `SCRIPTED_RESPONSE`, `COMPUTED_NOT_PERFORMED` | L4, L5 |
| Retry loop with good and bad reports | Try, check, report, try again. | Many challenge starts a minute from one identity, whatever the address | `ATTEMPT_VELOCITY` | L7 |
| Selenium, Puppeteer, MCP browser tools | An agent calls tools. A driver clicks. | Automation flag, headless window, client hints missing or contradicting the user agent | `WEBDRIVER_FLAG`, `HEADLESS_WINDOW`, `UA_NO_CLIENT_HINTS`, `UA_HINT_VERSION_MISMATCH` | L1, L3 |
| Screenshot-think-act LLM agent | Looks, thinks for seconds, acts. | Cursor runs 500+ ms behind the ring, almost no corrections, steady 2-9 s pace on every format | `LAG_TOO_SLOW`, `FEW_CORRECTIONS`, `SLOW_REAIM`, `UNIFORM_AI_PACE` | L4, L5 |
| Rotating residential proxy | A new address and browser name per request. | One client stack under many labels. Same catalogue walk continued. | `IP_ROTATION`, `ONE_STACK_MANY_USER_AGENTS` | L1 |
| Generated human-shaped path | Synthetic lag and jitter, sent early. | The samples span more time than the server clock allowed | `CLOCK_SKEW` | L5 |

Classes: `human`, `declared_agent`, `llm_agent`, `solver_service`, `scripted_bot`, `automation_browser`, `human_mimic`, `scraper`, `unknown`.

Rules worth knowing:

- Evidence from several signs combines: each family score is `1 - product(1 - weight)`.
- **Human-mimic** means "passed layer 1, then failed the clock". An identity that already failed layer 1 is judged by how it failed, not called a mimic.
- A verified declared agent stays `declared_agent` unless there is strong contrary evidence. Honest agents are not punished.

## Decisions

| Class and confidence | Decision |
|---|---|
| script, automation browser, solver service, 80% or more | block |
| LLM agent, 60% or more | block (with a link to declare the agent) |
| human-mimic, 50% or more | step up: ask for a fresh live check |
| scraper, 50% or more | slow |
| weak evidence | step up |
| human, declared agent, unknown | allow |

`LAYER2_MODE=enforce` (default) makes the protected API refuse block and step-up with HTTP 403, a plain reason, an appeal link and `/check` for a retest. `LAYER2_MODE=shadow` only records and adds an `X-CaptchaMe-L2` header. The old test suites run in shadow mode because their test clients cheat the clock the way a mimic does.

## Resource and scraping analysis

`GET /api/layer2/overview` (admin key) and the `/layer2` page report:

- identities by class, with cost, packets, and merges;
- a layer by family grid of evidence counts (where things are caught, where they are not);
- dollars on bots versus people (unit prices are assumptions in `lib/layer2.js`: replace them with your own);
- scraping: catalogue pages touched, requests, decoys served, canaries tied to a visitor, by class;
- bypass: other captchas beaten, what that cost the attacker at the 2captcha rate, layer 1 passes and blocks;
- identities that were merged and why.

`GET /api/layer2/subject/:id` gives one identity: all evidence by layer, every address and browser name, the links used, the merge log and a timeline. IP addresses are masked to the network. Keys are hashed with `LAYER2_SALT` (random per process if unset).

## Red-team notes (method from the `rea` skills)

The `rea` skills ask for evidence checked against something independent, and for reproduced bugs, limits and unverified claims to be kept apart. I used that method. I did **not** run the REA tools: they reverse-engineer binaries and this is a source-available web service.

### Verified (test/layer2.js, real server, real HTTP)

- Admin-only read side.
- Python script, solver farm, headless browser and LLM agent are classed and blocked.
- The human-mimic passes layer 1, is caught by layer 2 and gets step-up.
- A plain scraper is a `scraper`. A rotating-proxy scraper is **one** identity.
- Solver farm and worker merge. Different bots do not.
- Protected API: a person who performs the whole challenge gets through; a generated path answered early is refused with `step_up_required`, evidence at L5.
- Totals and the layer by family grid are filled.

Found and fixed during this work (each was a real bug caught by running it): a test client whose user agent and client hint disagreed was flagged (correct); two test clients with the same fingerprint merged (correct); an aggregate tell was recounted per packet and tipped the mimic into the wrong class; the agent's class hung on random jump sizes, so layer 2 now uses the raw lag and correction counts.

### Known limits

1. **No TLS handshake from this process.** Node sees HTTP only. A handshake hash is used when a trusted proxy or CDN adds one (`x-ja4`, `x-ja3-hash`, `cf-ja4`...). Without it the network signature (header order and shapes) is a weaker stand-in. Real browsers of one version share it.
2. **The attackers are my own simulators.** I wrote the bots and the detectors. Passing proves the logic works; it does not prove it beats a real 2captcha worker pool, Buster, Comet or Atlas.
3. **A patient mimic gets through the clock check.** One that performs the full 7 seconds, with human-like lag, passes layer 1 and layer 2. What remains is velocity (retry rate), cost cap, and identity merging. Not built: a check that human lag varies across sessions.
4. **`CLOCK_SKEW` trusts the client's sample times.** A client that waits the whole time passes it.
5. **Shared networks.** Two real people behind one address with the same browser stay separate (by design), but evidence about one cannot protect the other.
6. **In memory, one instance.** No persistence, no shared store across instances.
7. **Unit costs are assumptions.**
8. **The live-room routes (`/api/live/*`) are demo only and unauthenticated.** Do not expose them on a production host.

### Not exercised

Real solver services, real agentic browsers, real residential proxies, a CDN that forwards TLS fingerprints, more than one server instance, real traffic volume. I did not call any bypass service.

## Run it

```
npm run build && npm start        # http://localhost:3000, /live and /layer2
npm run test:layer2               # 27 checks, about 40 seconds
npm test                          # all three suites
```

Settings: `LAYER2_MODE` (`enforce` or `shadow`), `LAYER2_SALT`, `POP_ADMIN_KEY` (admin key for the read side).
