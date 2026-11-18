# abuseguard: the second layer behind CaptchaMe

CaptchaMe answers **"is a live person (or a declared agent) here?"** It cannot answer **"is this the same
person as the other twelve accounts that already took the free tier?"** abuseguard answers that, so the
two run in order:

1. **CaptchaMe** checks presence and issues the pass.
2. **abuseguard** decides how much that visitor may use, counted per *person* across every account, key
   and session linked to them, and handles what happens after a flag.

It is off until you set three environment variables. Without them nothing here runs and CaptchaMe behaves
exactly as before.

## Turn it on

Run abuseguard 0.4.0 as **one long-running service** (not inside Vercel functions: its live statistics are in
one process's memory). Then give CaptchaMe:

| Variable | Meaning | Default |
|---|---|---|
| `ABUSEGUARD_URL` | where the service runs | off |
| `ABUSEGUARD_KEY` | the tenant key (`AG_API_KEYS=captchame:<key>` on the service) | off |
| `ABUSEGUARD_SALT` | random secret; every identifier is hashed with it before it leaves CaptchaMe | off |
| `ABUSEGUARD_MODE` | `shadow` records only, `enforce` returns the verdicts | `shadow` |
| `ABUSEGUARD_STRICTNESS` | policy pushed to the service: `watch`, `gentle`, `strict` | `watch` |
| `ABUSEGUARD_WINDOW_S` | budget window (the CaptchaMe ledger is lifetime, abuseguard resets) | `86400` |
| `ABUSEGUARD_TIMEOUT_MS` | hard deadline per decision, then fail open | `300` |
| `ABUSEGUARD_WEBHOOK_SECRET` | secret returned once by `PUT /v1/webhook-endpoints` | unset (webhook refused) |
| `ABUSEGUARD_AUTOPOLICY` | `0` to manage the policy yourself | on |

On first use CaptchaMe pushes the policy: the `ai_app` preset, your window, the three plan budgets
(anonymous $0.50, human $2.00, agent $1.00 to match `lib/ledger.js`), the trap paths and the $0.10 cost of
`/api/protected/quote`.

Register the webhook once so flags and appeals show in the console feed:

```bash
curl -X PUT $ABUSEGUARD_URL/v1/webhook-endpoints -H "authorization: Bearer $ABUSEGUARD_KEY" \
  -H 'content-type: application/json' \
  -d '{"url":"https://YOUR-HOST/api/abuseguard-events","events":["subject.flagged","appeal.filed","appeal.resolved"]}'
```

Status and the shadow-mode comparison: `GET /api/admin/abuseguard` (admin key).

## What CaptchaMe sends, and when

| Moment | Call | Why |
|---|---|---|
| A check passes (any live format, invisible pass, button check) | `signup` event, `ip` link (network prefix), `device` link (the `cm_vid` browser id when present), `human_check` verification | New session exists and who it is linked to; a passed live check moves a step-up on |
| `/api/protected/quote` | `POST /v1/decisions` with plan, path, and a `human.liveness` or `agent.credential` signal carrying the pass's **real age** | The fair-share decision |
| A quote is served | `usage` event, $0.10 | Cost lands on the person, not the key |
| Trap link / hidden listing item | `request` event | Honeypot evidence |
| `/api/appeal` | `POST /v1/decisions/{id}/appeal` | Appeal exists on both sides, a block softens while it is open |
| Admin approves or denies | `PATCH /v1/appeals/{id}` (`overturned` / `upheld`) | Trust for 30 days on approval |

Links are sent immediately (a new actor must be assessed knowing who it shares a browser with); usage
events are batched every 2 s, or sent inline on Vercel. The browser never talks to abuseguard.

## Rules the integration keeps

- **Fail open.** Slow, down or erroring: the call is served, `ENGINE_UNAVAILABLE` is counted as `failOpen`.
- **Shadow first.** Nothing is enforced until `ABUSEGUARD_MODE=enforce` *and* strictness is raised.
- **Two caps, either can say no.** CaptchaMe's per-actor ledger stays as the backstop and the +$1 appeal
  grant is unchanged. abuseguard adds the per-person cap on top. (Decision D1 in the guide, "abuseguard owns
  the money", is a later step once the two have been compared in shadow mode.)
- **Honest age.** Passes carry an issue time; proofs older than 5 minutes are not presented as fresh.

## Rollout

1. **Week 1: shadow.** `stats.agree`, `abuseguardStricter`, `ledgerStricter` show where the layers differ.
   `abuseguardStricter` is the cost the old ledger was missing.
2. **Week 2: `ABUSEGUARD_STRICTNESS=gentle` + `ABUSEGUARD_MODE=enforce`.** Limits enforced, nothing blocked.
3. **Later: `strict`.** Back off if more than 1% of real users are limited or appeals sit over 24 h.

## Known gaps (from the integration guide, status here)

| Gap | Status |
|---|---|
| G1 per-person budget grant on appeal | Covered: CaptchaMe's own +$1 grant still runs; abuseguard only clears blocks and trusts for 30 days |
| G2 live state is per process | Open: run one abuseguard instance |
| G3 agent proofs older than 5 min ignored | Handled: age is sent honestly; a stale agent is simply treated as unverified |
| G4 abuseguard trusts caller signals | Server-side only; keep the key off the browser |
| G5 verifications held in memory | Mitigated: the pass is also sent as a signal on every call |
| G6 device links come from the caller | Partly: network prefix always, `cm_vid` only where the browser has one |

Unverified: the abuseguard Dockerfile and Postgres adapter were not run here, and no agent pass (`ag-pass`)
or edge adapter exists in 0.4.0.

## Test it

```bash
npm run test:abuseguard   # CaptchaMe against a stand-in service: shadow, enforce, appeals, webhooks, fail open
```

Against the real service: run abuseguard (`AG_API_KEYS=captchame:testkey AG_WEBHOOK_ALLOW_PRIVATE=1 npm start`
in its folder), start CaptchaMe with the variables above, then let several anonymous actors share one
`cm_vid` cookie and spend $0.40 each. A brand-new actor on that browser is limited with
`DEVICE_CLUSTER, COST_OVER_BUDGET`, although every one of them was under CaptchaMe's own cap.
