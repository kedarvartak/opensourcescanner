# 13 — Decision Log

Every previously-open question in docs 00–12, decided. Nothing here is left to a future
conversation. Decisions are reversible **with data**, never by re-opening the debate.

Date: 2026-08-15. Owner: Kedar.

---

## Product

| # | Question | **Decision** | Reasoning |
|---|---|---|---|
| D01 | Name / domain | **`unclaimed.dev`** | The thesis is the name. Register before M1. |
| D02 | Browse product or curation product? | **Browse, with a curation surface on top** | Don't wait for M0 to choose. Ship the full board *and* a daily "Today's 10" hand-checkable set on the homepage. If M0's pass rate is low, "Today's 10" simply becomes the whole product — same code, no pivot. This removes the M0 blocking gate entirely. |
| D03 | Primary CTA | **"Show me one issue"** (deterministic daily pick, per filter) | Choosing is the paralysis. A single card converts better than a 3,000-row list for the largest persona. |
| D04 | Effort estimate ("~2h") | **Cut.** Replace with *"issues like this in this repo close in a median of 4 days"* | Resolves R6. The estimate was unfounded; the replacement is measured from data we already fetch. |
| D05 | Show score numerically? | **No.** Show the *reasons* as badges | "87/100" invites arguing with the algorithm. "7/10 outsider PRs merged" is a fact. |
| D06 | Accounts | **Never in v1.** Trigger for a backend = paid instant alerts (doc 12 §5, Tier 2) | |
| D07 | Saved list | **Yes, `localStorage`, in v1** — re-validated against fresh data on every load | Cheap retention. The re-validation is mandatory; a stale saved list is the bug we exist to kill. |

## Data & validity

| # | Question | **Decision** | Reasoning |
|---|---|---|---|
| D08 | RQ5 — scoring weights | **0.30 / 0.25 / 0.18 / 0.15 / 0.12** (resp / spec / open / appr / fresh) | Locked in [04](04-issue-validity-model.md) §3 with full rationale. |
| D09 | Score threshold | **55** (tier-1), **65** (tier-2) | Tuned up only once every top-20 language has ≥40 issues (assertion A10). |
| D10 | RQ4 — seed labels | **Both tiers ship in v1.** Tier-2 carries the higher threshold | Tier-1 alone is too thin to fill language pages, and language pages are the growth engine. |
| D11 | RQ3 — `CLAIM_TTL` | **21 days**, relisted with a `previously claimed` badge | Revisit with `state/history` data at month 2. Instrument now. |
| D12 | Stars floor | **25** | |
| D13 | Per-repo daily cap | **4 issues/repo/day**, rotated | Was an R5 mitigation "before traffic gets big" — pulled into v1. It's also a diversity/SEO win, so it pays for itself. |
| D14 | Loosening gates if corpus is thin | **Broaden seeds and languages first. G2 (takeability) and G3.5 (license) never loosen.** | Those two *are* the product. |
| D15 | RQ7 — payload sharding | **Ship per-language shards from day one** | Programmatic pages need per-language data anyway; sharding falls out for free and removes a future migration. |

## Architecture

| # | Question | **Decision** | Reasoning |
|---|---|---|---|
| D16 | Framework | **Astro** | Forced by programmatic SEO (doc 12 §1). Supersedes doc 08 §4. |
| D17 | Hosting | **Cloudflare Pages** | `_headers` control is required for the cache strategy; free analytics; free edge. |
| D18 | Refresh cadence | **Full pipeline daily 03:00 UTC + re-validation-only pass every 6 hours** | The 6-hourly pass was v1.1; **promoted to v1** because "verified free 4h ago" is the headline marketing claim and it costs ~30 API requests. |
| D19 | Weekly full sweep | **Sundays**, delta harvest other days | |
| D20 | State storage | **Git**, events-not-snapshots, monthly JSONL | Revisit at 50 MB. |
| D21 | Newsletter | **Buttondown**, embedded form, broadcast POSTed from the Action | Backend-free. Pulled into v1 (doc 12 §3). |
| D22 | RSS/JSON feeds | **v1**, one per language + topic | Free from build data; earns links. |

## Growth & audience

**Objective locked: pageviews and daily unique users. No monetization, at any stage.**

| # | Question | **Decision** | Reasoning |
|---|---|---|---|
| D23 | Primary acquisition channel | **Programmatic SEO** (~4,000 prerendered pages), backed by a launch data-story | Thousands of long-tail queries currently served by rotting listicles. Compounds forever, costs nothing. |
| D24 | Launch artifact | **The analysis post**, not the site announcement | "68% of good first issues are already taken" travels; "I built a website" doesn't. |
| D25 | RQ8 — maintainer relations | **Outreach to 20 maintainers before the HN post**, prominent one-PR opt-out | Being seen as parasitic is an extinction-level risk for this specific product. |
| D26 | **Primary DAU surface** | **"Today's 10"** — ten issues, changing daily, deterministic per date, on the homepage | Finding an issue is an *episodic* job, so daily return has to be designed in. A small, finite, different-today object is the only pattern that reliably creates a daily habit without accounts. |
| D27 | Secondary DAU surface | **"New today"** diff feed, own URL + feed + nav count badge | The one page guaranteed to differ every day. Free from `state/`. |
| D28 | Return-visit pump | **Weekly (opt-in daily) email via Buttondown + per-language RSS/JSON feeds**, live from launch hour | The only channel that reaches people who already left. An uncaptured launch spike is unrecoverable. |
| D29 | Habit reinforcement | **`localStorage` streaks, viewed-issue history, personal working-on list** | Real return driver, zero backend, no accounts. |
| D30 | Monetization | **None. Permanently out of scope.** No ads, no sponsorships, no job board, no paywall | Stated objective is reach. Ad surfaces cost trust and pageview quality, and this audience punishes them. |
| D31 | Rejected DAU tactics | Notification prompts on first visit, artificial scarcity, infinite scroll with no done-state, engagement bait | Trust is the only asset; dark patterns spend it for a short-term metric bump. |
| D32 | Analytics | **Cloudflare Web Analytics** | Free, privacy-preserving, no cookie banner (which itself protects conversion). |
| D33 | North-star metric | **Return-visitor %** (target ≥ 25% by month 6) | Pageviews can be bought with SEO; a daily habit can't. If the DAU surfaces aren't working, this shows it months before DAU does. |

## Process

| # | Question | **Decision** |
|---|---|---|
| D34 | RQ6 (pass rate) as a blocking gate | **No longer blocking** — D02 makes the product robust to any pass rate. Still measured in M0, because it's the launch statistic (D24). |
| D35 | Precision audit | **50 issues hand-audited weekly, by hand, forever.** Published on `/stats`. |
| D36 | RQ1/RQ2 | Measured in M0; RQ1 becomes the launch headline, RQ2 calibrates D1. |

---

## What is deliberately still unknown

Not decisions — **measurements**, which by definition can't be decided in advance. Each has
a locked default so nothing blocks on them:

| Measurement | Default until measured | Measured by |
|---|---|---|
| True hard-gate pass rate | Board is whatever survives; "Today's 10" backstops any size | M0 spike |
| Real GraphQL point cost/100 issues | Budget assumes ~21 pts (doc 03 §2) | M0, logged every run thereafter |
| Whether soft claims predict abandonment | `CLAIM_TTL = 21d` | `state/history`, month 2 |
| Which SEO pages actually rank | Ship all ~4,000 | Search Console, month 3 |
| Board daily variance | Assertion A2 at ±60%, tighten to ±25% | After 2 weeks of runs |
