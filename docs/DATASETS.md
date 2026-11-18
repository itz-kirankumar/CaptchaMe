# Datasets for validating CaptchaMe

What exists in the open, what each set can and cannot tell us, and how far each one was verified. The
machine-readable list is `validation/MANIFEST.json` (34 entries). The numbers measured on the sets that could be
run are in `docs/VALIDATION-PLAN.md`.

**How to read the status.** *run* = downloaded and executed here. *page-read* = the dataset's own page was read, data
not downloaded. *search-only* = seen in search results, not opened; treat every field as unverified. *gated* = needs a
signed agreement. *blocked-here* = open, but the host (Hugging Face, Zenodo, Kaggle, university sites) is unreachable
from this GitHub-only environment. Only the 7 *run* sets were audited for quality. GitHub's API was denied for
repositories outside this project, so sizes of the image-captcha repositories were not measured.

## The main finding

CaptchaMe is mostly a **behavioural** check (timing, pointer shape, typing). Most captcha datasets are **images with
answers**, which test the classic formats in the arena, not the product. Public data fits the product like this:

| Lane | Public ground truth | Verdict |
|---|---|---|
| Typing (invisible pass) | CMU 51 typists (run); Aalto 136M, 168,960 people (blocked-here) | Good for false alarms. No bot typists |
| Pointer, human vs bot | delbot-mouse 1,020 human / 2,596 bot (run); ITI logs+mouse with humanlike bots (blocked-here); BeCAPTCHA-Mouse (gated) | Partial. Bots recorded on different machines |
| Client identity | mintlify 135 agent UAs, crawler list ~2,100, 100 browsers (run) | Good for what a client *claims* |
| Colour clash | Stroop 48,517 trials, 81 people (run) | Good for humans, nothing for bots |
| Ring, pulse, reflex, targets, beat | none that matches our tasks | **Blind spot** |
| Voice | ASVspoof for TTS artefacts (blocked-here) | Cannot test onset timing |
| Classic text / image / slider / rotate / click | many, mostly unverified | Tests the arena, not the product |
| Classic audio | papers only; no open corpus found | **Gap** |
| Web logs, bot vs human | ITI, Zenodo robot logs (blocked-here) | Mostly unlabelled or unreachable |
| Fair-share ledger | LLM request traces with invented identities | No real multi-account farm data exists openly |

## A. Typing

| Dataset | Size | Labels | License | Status | Notes |
|---|---|---|---|---|---|
| CMU Keystroke Benchmark | 20,400 samples, 51 typists | human | none stated in the mirror | **run** | 0 invalid, 0 duplicates. One practised password |
| Aalto 136M Keystrokes | 168,960 people, 1.4 GB zipped | human | research use | blocked-here | The set to use for any new typing rule |
| KeyRecs | fixed + free text, demographics | human | unverified | search-only | Demographic slices |

## B. Pointer movement

| Dataset | Size | Labels | License | Status | Notes |
|---|---|---|---|---|---|
| delbot-mouse | 1,020 human, 2,596 bot | human / bot by generator | MIT | **run** | Bots: GAN, pynput, NaturalMouseMotion, PyHuman. Humans: 2 PCs, trackpad, phone, VM. 0 duplicates. Collected on different machines: shortcut risk |
| Balabit Mouse Challenge | 10 users, 242 MB | human only | none stated | **run** | "Illegal" sessions are other users mixed in, not bots |
| ITI Web Bot Detection | 50 + 56 human sessions, equal numbers of moderate and advanced bots | human / moderate / advanced bot | CC BY-NC-SA | blocked-here | Logs **and** mouse. Advanced bots act like people. Priority |
| CaptchaSolve30k | 30,000 sessions, 4.83 GB, 1000 Hz | human | Apache-2.0 | blocked-here | Tracking and drag tasks, touch flag. Closest to our ring and targets |
| BeCAPTCHA-Mouse | >200K human trajectories + GAN bots | human / bot | signed agreement | gated | The standard published benchmark |
| SapiMouse | 120 subjects | human | Apache-2.0 (code) | page-read | Raw data on an external host |

## C. Human norms for the live tasks

| Dataset | For | Status | Notes |
|---|---|---|---|
| Stroop trials (OSF via erfanjaripour) | clash | **run** | 48,517 trials, 81 people. Keyboard responses |
| Lakens/Stroop | clash | page-read | **Unusable**: one total per person, not per trial |
| Moving-target selection with delay (WPI) | reflex, pulse | search-only | Human reaction under latency |
| Visuomotor pursuit-tracking papers | ring | search-only | The README's "80-350 ms behind" claim needs a source |
| Finger-tapping synchronisation studies | beat | search-only | Small N, no large open set found |

## D. Client identity, agents, crawlers

| Dataset | Size | License | Status | Notes |
|---|---|---|---|---|
| mintlify/agent-traffic | 98 entries, 135 real UAs, verified 2026-10 | MIT | **run** | Includes IP-range verification sources |
| monperrus/crawler-user-agents | ~2,100 | MIT | **run** | 58 duplicates removed; 37 look like browsers |
| microlinkhq/top-user-agents | 100 browsers | MIT | **run** | False-positive control |

## E. Web logs

| Dataset | Status | Notes |
|---|---|---|
| Zenodo "Web robot detection - Server logs" | blocked-here | JSON logs; labels not confirmed |
| ocatak/apache-http-logs | page-read | 17,849 scanner requests (via abuseguard's validation) |
| elastic/examples nginx and Apache logs | page-read | No ground truth |
| Zanbil e-commerce logs (Kaggle) | blocked-here | 3.3 GB; the audit loads whole files into memory |

## F. Classic captcha formats (the arena)

| Format | Datasets and generators | Status |
|---|---|---|
| Text | captcha_images_v2 (1,040 PNG), szili2011 (1.8M synthetic) | search-only / blocked-here |
| Image grid | ssivakorn/reCAPTCHA-study, DannyLuna 57k, Plesner et al. (ETH) | search-only |
| Slider, rotate, click | go-captcha (open generator), behavior_captcha_cracker (GeeTest, Yidun, Yunpian) | search-only / gated |
| Audio | uncaptcha, AdvCAPTCHA, other papers; **no open corpus found** | none |
| Proof of work | nothing to label: it is compute, not recognition | n/a |
| Math, checkbox | trivial to generate | n/a |
| Agent-vs-puzzle | **Open CaptchaWorld** (MIT, 20 types with ground truth, agent harness), NextGen-CAPTCHAs (519 puzzles) | page-read |

## G. What the companies on the 2Captcha page offer

Read from the page you attached (prices per 1,000 solves, speed) plus the searches. "Data" means a labelled dataset or
API we could use; none of these vendors publishes one.

| Company / type | Offers raw data or a research API? | Public attack data or tooling found |
|---|---|---|
| reCAPTCHA v2/v3/Enterprise (Google) | No dataset. Enterprise has an assessment API (product, not data) | Plesner et al. YOLO attack; uncaptcha (audio); 57k-image models; ETH reCAPTCHA clone for testing |
| hCaptcha | No dataset. Blog publishes aggregate attack figures | arXiv 2104.04683: >95% accuracy, <19 s (search excerpt); hcaptcha-challenger solver |
| Cloudflare Turnstile | Widget-management and verify API; no labelled data found | Open-source Turnstile solvers on GitHub |
| Arkose Labs (FunCaptcha) | No dataset | Solver services (2Captcha lists $1.45 to $50 per 1,000) |
| GeeTest, Tencent, Yidun | No dataset | Slider/click crackers on GitHub; 2019 academic study of Tencent slide puzzles |
| DataDome, Imperva (Thales), HUMAN | Aggregate bad-bot reports only | DataDome threat research on a captcha farm |
| Friendly Captcha, ALTCHA, Prosopo | Open-source proof of work; no attack datasets found | 2Captcha still sells solves (ALTCHA $2.99, Friendly $1.45) |
| Castle | Device-fingerprint docs only | none found |
| Not researched | AWS WAF, Cutcaptcha, MTCaptcha, CaptchaFox, VK, atbCAPTCHA, Lemin, Capy, Temu, Binance, Hunt, TSPD, Basilisk, Alibaba, KeyCAPTCHA, CyberSiARA | Listed so the gap is visible |
| **2Captcha itself** | Public solver API and SDKs on GitHub; demo pages per type | It is the attacker; its price list is the **cost baseline** below |

### Attack cost baseline (from the attached page, per 1,000 solves)

| Type | Price | Speed |
|---|---|---|
| Text / normal image | $0.5 to $1 | 1 to 3 s |
| Math | $0.5 to $1 | 3 s |
| Rotate | $0.5 | 6 s |
| Audio | $0.5 | 14 s |
| Slider | $1.2 | 9 s |
| Click | $1.2 | 13 s |
| Cloudflare Turnstile | $1.45 | 1 s |
| reCAPTCHA v2 | $1 to $2.99 | 2 s |
| Arkose / FunCaptcha | $1.45 to $50 | 18 s |

These prices are what any check on this list costs an attacker. At $0.003 per solve, a pass that grants a $2.00 human
allowance returns about 670 times its cost; even at Arkose's top price ($0.05) it returns 40 times. This is why the
validation plan treats the **grant size versus attack cost** as a metric, not only detection rates.

## What to obtain next, in order

1. **ITI Web Bot Detection Dataset** (CC BY-NC-SA): logs + mouse with humanlike bots. Allow `m4d.iti.gr`.
2. **CaptchaSolve30k** (Apache-2.0): allow `huggingface.co`.
3. **Aalto 136M**: allow `userinterfaces.aalto.fi`.
4. **BeCAPTCHA-Mouse**: apply with the licence form.
5. **Open CaptchaWorld**: allow `huggingface.co`; run the agent harness against our classic arena.
6. Zenodo robot logs: allow `zenodo.org`.
