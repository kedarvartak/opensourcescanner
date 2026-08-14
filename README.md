# open

> Every issue here was verified **unclaimed, relevant, and in a live repo** within the
> last 24 hours.

A static site that lists open source issues you can actually start today. No backend —
a nightly GitHub Actions pipeline harvests, validates and scores issues, commits the
result as JSON, and the frontend filters it entirely client-side.

**Status:** Phase 0 — research and decisions complete. Next step is the **M0 measurement
spike** ([docs/11](docs/11-roadmap.md)): 3 days, throwaway script, produces the launch
statistic. Nothing is blocked on it.

**Objective:** pageviews and daily unique users. No monetization at any stage
([D30](docs/13-decision-log.md)). Target launch: first week of October, timed to the
Hacktoberfest demand spike.

## The thesis

Existing tools answer *"which issues have the `good first issue` label?"* — a question
GitHub search already answers, and the wrong one. Most labelled issues are already
assigned, already have an open PR, in an abandoned repo, or too vague to start.

We answer *"which issues are still free, still relevant, and attached to a maintainer who
will merge your PR?"* — which requires per-issue enrichment that no live search UI can
afford, and that a nightly build can.

## Docs

| Doc | Contents |
|---|---|
| [00 — Overview](docs/00-overview.md) | Thesis, constraints, success criteria |
| [01 — Problem research](docs/01-problem-research.md) | Evidence, the seven hassles, personas, JTBD |
| [02 — Competitive landscape](docs/02-competitive-landscape.md) | Every existing tool and how it fails |
| [03 — Data sources & API constraints](docs/03-data-sources-and-api-constraints.md) | Rate limits, quota budget math |
| [04 — Issue validity model](docs/04-issue-validity-model.md) | **Core IP** — hard gates + scoring |
| [05 — Architecture](docs/05-architecture.md) | No-backend design, Git as database |
| [06 — Data model](docs/06-data-model.md) | JSON schemas, payload budget |
| [07 — Pipeline spec](docs/07-pipeline-spec.md) | Harvest → enrich → validate → score → emit → assert |
| [08 — Frontend spec](docs/08-frontend-spec.md) | Client-side search, filters, UX, honesty rules |
| [09 — Refresh & freshness](docs/09-refresh-and-freshness.md) | 24h cadence, asymmetric refresh, failure modes |
| [10 — Risks & open questions](docs/10-risks-and-open-questions.md) | What could kill this |
| [11 — Roadmap](docs/11-roadmap.md) | Milestones and phase gates |
| [12 — Growth & audience](docs/12-growth-and-audience.md) | **How it gets found** — programmatic SEO, DAU surfaces, launch |
| [13 — Decision log](docs/13-decision-log.md) | **Every decision, locked** |

## The three decisions that shape everything

1. **Precision over recall.** A user who clicks two already-taken issues never returns; a
   user who never sees issue #4821 loses nothing. Every ambiguous signal excludes.
2. **~4,000 prerendered pages, not one SPA.** The demand is thousands of long-tail
   searches ("good first issues rust"), currently served by rotting listicles. This is the
   traffic engine, and it forces the framework choice (Astro).
3. **"Today's 10" on the homepage.** Finding an issue is an *episodic* job, so daily
   return has to be designed in — a small, finite, different-today object, not an
   infinite list.

Stack: Astro · Cloudflare Pages · GitHub Actions · no backend, no database, $0/month.
