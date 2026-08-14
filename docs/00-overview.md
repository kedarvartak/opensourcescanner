# 00 — Overview & Thesis

**Project codename:** `open`
**Date:** 2026-08-15
**Status:** Phase 0 — research complete, pre-implementation

---

## 1. One-line thesis

> Finding an open source issue you can actually *start today* is a hassle not because
> issues are scarce, but because **the listed ones are almost always already taken,
> stale, or in a dead repo.** We ship a static site that does the rejection work —
> every issue on the board is re-validated every 24 hours and proven **takeable**.

## 2. The reframe

Every existing tool answers:

> "Which issues have the `good first issue` label?"

That question is trivially answerable with one GitHub search URL, and it is **the wrong
question**. It returns tens of thousands of results, of which the overwhelming majority
fail at least one of these:

| Failure mode | User-visible symptom |
|---|---|
| Already assigned | "Someone's on it, I wasted 20 minutes reading" |
| Has an open linked PR | Same, but invisible from the issue list |
| Soft-claimed in comments | 6 people said "I'd like to work on this" |
| Repo abandoned | PR sits unreviewed for 8 months |
| Issue is stale/obsolete | Maintainer already fixed it another way |
| No context in body | "Improve error handling" — improve *what*, *where*? |
| Label farming | Repo tagged everything `good first issue` for Hacktoberfest stars |

We answer the harder question:

> "Which issues are **unclaimed, well-specified, in a repo whose maintainers are alive
> and merge outsider PRs** — right now?"

## 3. Product shape (locked constraints from the brief)

- **Frontend only.** No servers, no database, no runtime API calls to GitHub from the browser.
- **Static hosting.** GitHub Pages or Cloudflare Pages.
- **24-hour refresh.** A scheduled CI job regenerates the dataset and commits it.
- **Validity is non-negotiable.** A stale or claimed issue on the board is a product bug,
  not a data imperfection.

The architecture that falls out of this: a **build-time data pipeline** that ships a
pre-computed, pre-validated JSON dataset, and a **pure client** that filters/searches it
locally. See [05-architecture.md](05-architecture.md).

## 4. What "valid" means (short version)

An issue reaches the board only if it passes **every** hard gate and clears a score
threshold. Full rubric in [04-issue-validity-model.md](04-issue-validity-model.md).

**Hard gates (any failure ⇒ excluded):**
`open` · `not a PR` · `no assignees` · `no linked open PR` · `repo not archived` ·
`issues enabled` · `OSI license` · `repo pushed within 60d` · `issue activity within 120d` ·
`body has real content` · `not bot-authored` · `no blocking labels` · `repo not on denylist`

**Then scored on:** maintainer responsiveness, outsider-merge rate, issue specificity,
project onboarding quality, and crowding (how many people are already circling it).

## 5. Success criteria

**Objective: pageviews and daily unique users. No monetization, at any stage** (D30).

### Audience targets (month 6)

| Metric | Target |
|---|---|
| Monthly unique visitors | 40,000 |
| **Daily unique visitors** | **2,500** |
| **Return-visitor %** *(north star — D33)* | **≥ 25%** |
| Indexed pages | ≥ 3,000 of ~4,000 |
| Newsletter subscribers | 8,000 |
| Click-through to GitHub | ≥ 40% of sessions |

Return-visitor % is the north star because pageviews can be bought with SEO and a daily
habit cannot — if the DAU surfaces aren't working, this number says so months before DAU
does. Full strategy in [12-growth-and-audience.md](12-growth-and-audience.md).

### Product quality gates (these enable the above)

| Metric | Target | How measured |
|---|---|---|
| **Precision @ board** | ≥ 90% of listed issues genuinely takeable | Manual audit, 50 random listings/week |
| **Staleness** | 0 issues assigned >6h ago still listed | Post-build assertion + 6-hourly revalidation |
| **Coverage** | ≥ 2,000 validated issues, ≥ 15 languages | Build output |
| **Payload** | ≤ 500 KB brotli initial load | CI-enforced build assertion |
| **Time-to-first-useful-issue** | < 30 seconds | Usability test, n=5 |
| **Build cost** | $0/month, indefinitely | GitHub Actions free tier (public repo) |

Precision is the quality metric that matters, and it feeds the audience metrics directly:
a board of 300 *real* issues earns the word-of-mouth and the backlinks that a board of
30,000 GitHub-search clones never will.

## 6. Non-goals for v1

- User accounts, saved issues, claiming/reserving issues (would require a backend).
- Non-GitHub forges (GitLab, Codeberg, Gitea) — designed for in the adapter layer, not shipped.
- Mentorship matching, chat, or any social layer.
- Recommending *repos*. We recommend *issues*. Repo-level recommendation is what Up For
  Grabs already does adequately.

## 7. Document map

| Doc | Contents |
|---|---|
| [01-problem-research.md](01-problem-research.md) | Evidence for the problem, personas, JTBD |
| [02-competitive-landscape.md](02-competitive-landscape.md) | Every existing tool and precisely how it fails |
| [03-data-sources-and-api-constraints.md](03-data-sources-and-api-constraints.md) | GitHub API limits, quota budget math |
| [04-issue-validity-model.md](04-issue-validity-model.md) | Hard gates + scoring rubric (the core IP) |
| [05-architecture.md](05-architecture.md) | No-backend architecture, Git-as-database |
| [06-data-model.md](06-data-model.md) | JSON schemas, payload budget |
| [07-pipeline-spec.md](07-pipeline-spec.md) | Harvest → enrich → validate → score → emit |
| [08-frontend-spec.md](08-frontend-spec.md) | Client-side search, filters, UX |
| [09-refresh-and-freshness.md](09-refresh-and-freshness.md) | 24h cadence, delta strategy, failure modes |
| [10-risks-and-open-questions.md](10-risks-and-open-questions.md) | What could kill this |
| [11-roadmap.md](11-roadmap.md) | Milestones and phase gates |
| [12-growth-and-audience.md](12-growth-and-audience.md) | **How it gets found** — programmatic SEO, DAU surfaces, launch |
| [13-decision-log.md](13-decision-log.md) | **Every decision, locked.** Nothing left open |
