# Validation plan: real numbers, and the gaps that remain

Run everything with:

```bash
validation/fetch.sh          # pinned GitHub datasets into validation/data (git-ignored, not redistributed)
node validation/run.js       # audits each dataset, runs four experiments, writes validation/results.json
```

Every figure below was produced by that command on 2026-11-18. Datasets and licences are in `docs/DATASETS.md`.

## 1. The metrics

Convention: a higher score means "more bot-like". Every rate carries a confidence interval.

| # | Metric | Definition | Why it is here |
|---|---|---|---|
| M1 | **Human false-alarm rate** | Share of real people denied the invisible pass or failed, **with a person-level interval** (resample people, not samples) | Samples from one person are not independent. 20,400 typing samples are really 51 people |
| M2 | **Worst-group rate** | The same rate split by device, input method and individual. Report the worst group | A 0.5% average hid two typists at 11-12% and phones at 6% |
| M3 | **Attack resistance by level** | Share of adversaries denied, per level: L0 plain script, L1 random jitter, L2 fitted to human averages, L3 replay of a real human, L4 relayed or paid human | One number for "bots" hides that L1 already walks through |
| M4 | **Separability** | AUC, equal-error rate, TPR at 1% false alarms, d-prime, with bootstrap intervals, **per bot generator** | Shows which signals carry weight and which are decoration |
| M5 | **Shortcut risk** | Can a trivial artefact (screen size, sample clock, source) predict the label? | A recorder artefact can look like a perfect detector |
| M6 | **Calibration** | Expected calibration error of the score against outcome | Needed before any score is shown as a probability |
| M7 | **Attack economics** | Value an attacker gains per pass (the allowance: $2.00) divided by solve cost per pass (from the 2Captcha price list) | Detection can fail; the grant should still not be worth farming |
| M8 | **Adaptation** | Rounds an attacker with pass/fail feedback needs to get through | Static attackers flatter every defence |
| M9 | **Claimability** | Is the sample large enough to state the number? Zero errors in *n* independent people bounds the rate at about 3/*n*: 300 people for 1%, 3,000 for 0.1% | Stops a small test from being written up as a guarantee |
| M10 | **Data quality gates** | Duplicate rate, label conflicts, class balance, records dropped by reason, no filtering on the attribute under test | Every experiment prints these first |

## 2. The best validation set: a layered gold set

One file cannot do this. The gold set is five tiers, split **by person** (never by sample) and with **generators held out**,
so a result is never measured on an attacker the rules were tuned against.

| Tier | Contents | Built from | State |
|---|---|---|---|
| A. Human ground truth | Real people on many devices | CMU (51), Balabit (10), delbot humans (1,020 sessions), Stroop OSF (81); to add: Aalto 136M, CaptchaSolve30k | 4 of 6 sets run; 2 blocked-here |
| B. Public bots and agents | Bot mouse, agent user agents, crawler lists | delbot bots (2,596), mintlify (135), crawler list (~2,100); to add: ITI humanlike bots, BeCAPTCHA-Mouse | partly run |
| C. Synthetic adversaries L0-L3 | Seeded generators, fixed in git | typing: constant, uniform jitter, fitted, replay (in `validation/exp/keystrokes.js`); to add: ghost-cursor, humancursor, Playwright and Selenium streams | typing done, pointer partly |
| D. Real tools against our live endpoint | Paid solvers and real agents (browser-use, Comet, Atlas, ChatGPT agent) | none: needs spend and an owner's decision | **not run** |
| E. Our own tasks, our own people | Raw telemetry for ring, pulse, reflex, targets, beat, voice from consenting volunteers | none exists anywhere | **the largest gap** |

Rules for the gold set: no tuning on the test split; a new generator is added to a held-out list first; every record keeps
provenance (dataset, commit, licence); sets with non-commercial licences are used for evaluation only and never redistributed.

## 3. Baseline: what the data says today

### Typing (invisible pass, `lib/passive.js`) on 20,400 real samples from 51 typists

| Measure | Result |
|---|---|
| Humans given the invisible pass | **99.5%** [99.4, 99.6] |
| Humans sent to a full check (false alarms) | 0.5%; **person-level 0.5% [0.0, 1.2] across 51 people** |
| Worst individuals | **s036 12%, s028 11%** of their own attempts. The only rule that fired was "every key held the same time (sd < 6 ms)" |
| Plain script, fixed timing | denied 100% |
| Instant fill, page-script submit, webdriver flag | denied 100% |
| **Uniform random jitter** | **denied 0%** [0.0, 0.2]: passes |
| Fitted to human averages | denied 0%: passes |
| Replay of a real human sample | denied 0.7%: passes (by design) |

### Pointer (invisible pass on pointer evidence alone) on 3,616 delbot + Balabit sessions

| Measure | Result |
|---|---|
| Humans given the invisible pass | 99.3% [98.6, 99.7] |
| **Phone users not given it** | **6.1%** [2.8, 12.7], n=98, against about 0% on desktop, trackpad and VM |
| Bots that got the invisible pass | GAN **100%** (1,899/1,899), NaturalMouseMotion **100%** (234/234), PyHuman **100%** (55/55), pynput **98.0%** (400/408) |
| Why | The rule treats peak/mean speed of 1.4 or more as human evidence. **Every** class sits above it: humans median 2.35, GAN 5.5, NaturalMouseMotion 6.1, pynput 2.3. Fewer than 1% of any class falls below the 1.2 "constant speed" cut-off |

Feature separation (AUC against all humans; 0.5 = no signal; direction chosen on the data, so use as ranking only):

| Feature | GAN | NaturalMouseMotion | PyHuman | pynput |
|---|---|---|---|---|
| Peak/mean speed (used) | 0.81 | 0.82 | 0.67 | 0.51 |
| Sample-interval CV (used) | 0.58 | 0.90 | 0.60 | 0.64 |
| Event rate (not used; arXiv 2607.26935) | 0.96 | 0.80 | 0.56 | 0.75 |

The direction flips between generators (NaturalMouseMotion is *more* regular than humans, pynput *less*), so a one-sided
threshold cannot work. Teleport-click and straightness could not be computed: each recording starts at the click.

### Client identity on labelled user agents

| Class | n | Flagged as automated (shield or audit) | Shield alone |
|---|---|---|---|
| Agents (Claude Code, assistants, browsers) | 42 | **90.5%** [77.9, 96.2] | **16.7%** |
| AI crawlers | 46 | 95.7% [85.5, 98.8] | 76.1% |
| Search and other crawlers | 2,087 | 94.4% [93.3, 95.3] | 55.9% |
| Other bots | 27 | 77.8% [59.2, 89.4] | 44.4% |
| Real browsers (control) | 100 | **0%** (0/100; upper bound 3.7%) | 0% |

The live shield and the offline audit use different lists and disagree. Browser-shaped strings (37 in the crawler list, and
agents that borrow a Chrome string) are invisible to any user-agent rule.

### Colour clash (`scoreClash`) on 32,292 real Stroop trials from 81 people

| Measure | Result |
|---|---|
| Human reaction time | median **660 ms**, p5 422, p95 1,234, p99 1,474 |
| Trials slower than the 1,300 ms window | 3.5% [3.3, 3.7] |
| Human sessions that pass | 98.3% [97.7, 98.8]; **person-level failure 1.7% [0.9, 2.6] across 81 people** |
| Worst individual | fails 20% of their sessions |

Answer-window sweep on the same people (the agent side cannot be computed: no public agent reaction data):

| Window | 1.0 s | **1.3 s (now)** | 1.5 s | 1.8 s | 2.0 s |
|---|---|---|---|---|---|
| Humans passing | 83.4% | **98.3%** | 99.3% | 99.3% | 99.3% |

The current window sits on the knee of the curve. These are keyboard answers; clicking adds pointing time, so read this as a lower bound on how late people are.

## 4. Gaps, ranked

Findings are measured; "suggested" fixes are not yet tested and must go through the gold set before they ship.

| # | Gap | Evidence | Suggested next step |
|---|---|---|---|
| 1 | **No data for our own live tasks** (ring, pulse, reflex, targets, beat, voice) | Nothing public matches; the README's "80-350 ms behind a moving target" has no data behind it here | Add a consented calibration mode that stores raw telemetry; collect 300+ people across devices (M9) |
| 2 | **Pointer evidence lets every tested bot through** | 98-100% invisible pass; thresholds 1.2/1.4 sit outside both classes | Do not count pointer shape as human evidence. Test event rate and raw-stream features on the ITI set |
| 3 | **Typing rule passes any random jitter** | 0% denied | Needs shape features (hold-time skew, digraph effects) validated on Aalto free text before any change |
| 4 | **Consistent typists falsely flagged** | s036 12%, s028 11% | Relax or personalise the "same hold time" threshold; recheck on Aalto |
| 5 | **Phone users penalised** | 6.1% [2.8, 12.7] not given the invisible pass | Separate touch thresholds; collect touch data (CaptchaSolve30k has a touch flag) |
| 6 | **Shield and audit disagree on agents** | 16.7% vs 88% | One list, sourced from mintlify (MIT) with its IP-range verification |
| 7 | **Clash window sits on the knee** | 3.5% of human trials late; 1.7% of people fail | Test 1.5 s against real agent reaction times before moving it |
| 8 | **Replay and relayed humans cannot be stopped by shape** | 0.7% denied for replay; fitted passes | Keep measuring M7: the cap and per-person budgets are the defence, not the check |
| 9 | **Samples are small at person level** | 51 and 81 people; 1% cannot be claimed (needs 300) | Aalto (168,960 people) and CaptchaSolve30k |
| 10 | **Agents inside a person's own browser** | Invisible at HTTP level (stated by mintlify) | Only live behaviour can see them; needs tier D |
| 11 | **No audio corpus, no vendor datasets** | No open corpus found; no vendor publishes labelled data | Generate with go-captcha; use Open CaptchaWorld for agents |

## 5. Proposed acceptance gates (proposals, not agreed targets)

A release should not claim a lane is validated unless, on the held-out split: human false alarms have a person-level upper
bound at or below 1% on at least 300 people; the worst device group is within 2x of the average; every L0-L2 generator is
denied at least 95% with a lower bound above 90%; the shortcut-risk check shows no single artefact predicts the label; and
L3-L4 results are reported as *cost to the attacker*, never as detection.

## 6. Limits of this run

- GitHub-hosted data only. Eight datasets that matter most are **blocked-here**; their entries list what to allow.
- Humans and bots in delbot were recorded on different machines. AUCs there carry a shortcut risk; the harness prints it.
- Adversaries in the typing test are synthetic and mine; they bound the rules, they are not evidence about real attackers.
- CMU is one practised password and the Stroop data is keyboard-based. Both are favourable to the rules.
- Nothing here tests ring, pulse, reflex, targets, beat or voice on people. Their thresholds are still unvalidated.
