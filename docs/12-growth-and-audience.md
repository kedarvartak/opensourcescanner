# 12 — Growth & Audience

> **Objective: maximize pageviews and daily unique users. No monetization.**
> Revised 2026-08-15 per direction: revenue is explicitly out of scope. Every decision in
> this doc optimizes for reach and return-visits.

**Name:** Open Source Scanner — `opensourcescanner.xyz` (changed from `unclaimed.dev`
on 2026-08-16, D01). The name is descriptive rather than clever, which matters here:
almost all of this site's traffic arrives from a search result where the name is one of
three lines a stranger reads before deciding to click.

---

## 1. The structural problem with DAU for this product

State it honestly, because it dictates everything else: **finding an open source issue is
an episodic job, not a daily one.** A user succeeds, contributes, and has no reason to
return for weeks. A pure "search for an issue" tool has terrible daily retention by
construction, no matter how good it is.

So the growth strategy splits into two mechanically different problems:

| Metric | Lever | Ceiling |
|---|---|---|
| **Pageviews / unique visitors** | Programmatic SEO (§2) | Very high — thousands of long-tail queries, compounding |
| **Daily uniques** | Turning the site into a **daily-changing object worth checking** (§3) | Requires deliberate product surface; won't happen for free |

Most of the raw numbers will come from §2. The daily habit has to be *designed in* — §3
is not a nice-to-have, it is the entire DAU strategy.

---

## 2. The traffic engine: programmatic SEO

The v1 design in [05](05-architecture.md)/[08](08-frontend-spec.md) — one page, fetch JSON,
filter client-side — is **an SEO dead zone**. One indexable URL; Google sees a spinner.

Actual demand is thousands of distinct long-tail queries: *"good first issues rust"*,
*"beginner friendly open source python"*, *"easy open source issues javascript"*,
*"open source issues for beginners react"*. Each has small persistent volume, obvious
intent, and is currently served by a rotting 2019 listicle.

We already compute every facet at build time, so emit a **prerendered page per facet**:

| Page type | Pattern | Count |
|---|---|---|
| Language | `/rust` | ~25 |
| Language × type | `/rust/bugs`, `/python/docs` | ~100 |
| Topic | `/topics/cli`, `/topics/machine-learning` | ~120 |
| Repo | `/repo/vercel/next.js` | ~800 |
| Issue detail | `/issue/vercel/next.js/51234` | ~3,000 |
| Guides | `/guides/first-pull-request` | ~15 |

**~4,000 indexable pages, free, from data we already have.** Each renders its top ~30
issues as static HTML, then hydrates into the filterable app. Users get the SPA; crawlers
get content.

> **This forces the framework choice: Astro.** Doc 08 §4 called it free; it isn't.
> Prerendering thousands of pages with partial hydration is precisely Astro's shape.
> **Locked (D16).**

### Why these will rank
- Competing results are static listicles that rot; ours update every 24h (freshness is a
  real ranking signal for this query class).
- Genuinely useful — live inventory, not a link to GitHub search.
- Densely interlinked: every issue → its repo, language, and topic pages.
- Carry data nobody else has ("maintainers reply in ~2 days", "7/10 outsider PRs merged").

**Required from day one:** regenerated `sitemap.xml`, `ItemList` + `SoftwareSourceCode`
JSON-LD, build-time OG images per page, canonical URLs, and **stable slugs across
rebuilds**. URL stability is why freshness carries a low scoring weight (doc 04 §3) — a
board that reshuffles daily churns its own rankings.

### Pageview multiplier: make the issue-detail page worth landing on
The 3,000 issue pages are the long-tail workhorse and the deepest part of the funnel. Each
should carry enough to earn the click *and* a second pageview: the issue excerpt, repo
health card, "3 similar unclaimed issues in this repo", "12 more {language} issues like
this", and a link to the setup guide. Every one of those is an internal link and a
potential next pageview.

---

## 3. The DAU engine: give people a reason to come back tomorrow

Four mechanisms, in order of expected impact. All are backend-free.

### 3.1 "Today's 10" — the daily ritual object *(highest impact)*
The homepage leads with **ten hand-checkable issues that change every day**, deterministic
per date, with a visible date stamp. This is the Wordle/HN-frontpage pattern: a small,
finite, complete-able, *different-today* object. Finite matters — an infinite list has no
"done" state, so there's no reason to return; ten items you can read in 90 seconds
creates one.

Rotation is drawn from the scored board with a per-repo cap, so the ten are genuinely
different each day even when the underlying board is stable. **This single surface is the
difference between "a tool I used once" and "a tab I open with my coffee."**

### 3.2 "New today" — the diff feed
Issues that entered the board since yesterday, computed free from `state/`. This is the
one page where the answer is *guaranteed different* every day, which makes it the natural
daily destination for the power user. Give it its own URL, its own feed, and a count badge
in the nav (`New today · 34`).

### 3.3 Email + RSS — the return-visit pump
- **Weekly digest** segmented by language, via Buttondown (embedded form = pure frontend;
  the Action POSTs the broadcast at build time). A daily option for the keen.
- **Per-language RSS/JSON feeds**, generated at build time. Free, serves power users, and
  gets syndicated by aggregators — which is both return visits *and* backlinks.

Email is the only mechanism that reaches people who have left; it converts one-time SEO
visitors into recurring uniques. **Capture from hour one** — the launch spike is the
largest traffic event we're guaranteed, and an uncaptured spike is gone forever.

### 3.4 Streaks and progress, in `localStorage`
No accounts needed: track "issues you've viewed", "days visited in a row", and a
personal "I'm working on this" list (re-validated on every load, D07). A visible streak is
a genuine daily-return driver, and it costs one JSON blob in the browser.

### Explicitly rejected as DAU tactics
Notification permission prompts on first visit (hostile, and this audience blocks them),
artificial scarcity ("3 issues left today!"), infinite scroll without a done-state, and
engagement-bait. This audience is unusually good at detecting and punishing dark patterns —
and the product's only asset is trust.

---

## 4. Launch (the first 10,000 visitors)

SEO compounds but takes 3–6 months. The launch bridges that gap.

**The launch artifact is a statistic, not a product announcement.** M0 gives us a number
nobody has published:

> "We analyzed 41,203 issues labelled `good first issue`. **68% were already taken, dead,
> or unusable.** Here's the breakdown — and here are the 3,127 that weren't."

That's a data story with a product attached, which is what actually travels.

1. **Write the analysis post first**, site second.
2. **Hacker News** — *"Show HN: 68% of 'good first issues' are already taken. I built a
   board of the ones that aren't."* Exactly our audience, plus the maintainers whose
   opinion decides whether this reads as helpful or parasitic.
3. **r/opensource, r/programming, r/learnprogramming** — staggered, not same-day.
4. **Dev.to / Hashnode** cross-post, canonical back to us.
5. **Language communities** — Rust/Go/Python/Elixir forums and Discords. Post *their*
   language's board, not the generic one. Highest conversion of any channel.
6. **Maintainer outreach** — DM 20 maintainers with their repo page, **before** the HN
   post (D25). Converts them from "who is scraping me" into distributors.
7. **Newsletter capture live from hour one.**

**Time the launch for the first week of October.** Hacktoberfest multiplies query volume
for this exact intent, and the "which of these are actually real?" angle is sharpest
precisely when the label farms are at their worst.

---

## 5. Trust as a growth mechanic

The rejection stats aren't a footer detail — they're the most shareable object on the site.

- **`/how-it-works`** — the live per-gate rejection histogram. Dedicated, linkable.
- **`/stats`** — running totals: issues verified to date, % claimed within 48h of listing
  (proof the board *works*), median maintainer response time by language, weekly precision
  audit results.

Pages like these get cited. Citations are links, links are rankings, rankings are views.
This is the cheapest backlink strategy available and it's a byproduct of data we already
compute.

---

## 6. Metrics we actually track

Cloudflare Web Analytics — free, unlimited, privacy-preserving, no cookie banner (which
itself protects conversion). It is just a script tag, so it works fine on Vercel; Vercel's
own Web Analytics is capped at 2,500 events/month on Hobby, which this site would burn
through in a day.

| Metric | Target by month 6 | Why |
|---|---|---|
| Monthly unique visitors | 40k | The headline |
| **Daily unique visitors** | **2.5k** | The stated objective |
| Pages / session | ≥ 3.0 | Tests whether §2's internal linking works |
| Return-visitor % | ≥ 25% | Tests whether §3 works — the real DAU signal |
| Newsletter subscribers | 8k | The only channel that reaches people who left |
| Indexed pages | ≥ 3,000 of ~4,000 | Tests whether the pages are thin |
| Click-through to GitHub | ≥ 40% of sessions | Proof the board is useful, not just visited |

**Return-visitor % is the number to watch.** Pageviews can be bought with SEO; a daily
habit cannot, and if §3 isn't working it will show up there first — months before it shows
up in DAU.

---

## 7. The long-term asset

Even with no revenue motive, `state/history/` compounds into something unique: issue
lifecycles, real maintainer response times, outsider-PR merge rates, empirical contribution
difficulty. Nobody else has it because nobody else waited a year collecting it.

Its value here is **as a traffic engine**: annual "State of Open Source Contribution"
reports are exactly the kind of artifact that earns press, citations, and permanent
backlinks. That's a yearly traffic spike plus a permanent ranking lift, generated from
data we're logging anyway.

**Implication:** start the history log on day one. It cannot be back-filled.

---

## 8. What this doc changes in docs 00–11

| Doc | Change |
|---|---|
| [05](05-architecture.md) | Framework locked to **Astro**; build emits ~4,000 prerendered pages + sitemap + feeds |
| [08](08-frontend-spec.md) §4 | Superseded on framework; static pages primary, SPA filtering is enhancement |
| [08](08-frontend-spec.md) §8 | Newsletter, RSS, saved-list, streaks pulled into **v1** |
| [08](08-frontend-spec.md) | New surfaces: "Today's 10" homepage, "New today" diff feed |
| [11](11-roadmap.md) | M2 gains programmatic SEO + DAU surfaces; M3 is the analysis-post launch; M4 is retention, not revenue |
| [04](04-issue-validity-model.md) | Low freshness weight protects URL stability; per-repo cap now also a rotation input for "Today's 10" |
| [10](10-risks-and-open-questions.md) | New risks R9 (thin/unstable pages) and R10 (episodic-use ceiling on DAU) |
