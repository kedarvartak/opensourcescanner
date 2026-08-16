# 11 — Roadmap & Phase Gates

> Revised 2026-08-15 after [12](12-growth-and-audience.md) and [13](13-decision-log.md).
> The previous version blocked all work behind the M0 pass-rate measurement. Decision D02
> removed that dependency: we ship a browse board *and* a "Today's 10" curated surface from
> the same pipeline, so **any** pass rate yields a shippable product. M0 still runs — its
> output is now the launch statistic rather than a go/no-go gate.

Target: **launch in the first week of October** (Hacktoberfest demand spike, doc 12 §2).

---

## M0 — Measurement spike *(3 days)*

Throwaway script; produces `docs/14-m0-findings.md`.

1. Harvest ~5,000 candidates, tier-1 + tier-2 labels, top 10 languages.
2. Enrich via the full GraphQL query ([07](07-pipeline-spec.md) §3).
3. Record rejection rate **per gate, independently**, then jointly.
4. Hand-audit 30 survivors for genuine takeability.
5. Measure real GraphQL point cost per 100 issues.

**Output that matters:** the headline number for the launch post (D24) —
*"X% of issues labelled `good first issue` are already taken, dead, or unusable."*

**Gate:** hand-audit ≥ 80% takeable. Below that, a signal is lying — diagnose which before
writing pipeline code. (Pass *rate* no longer gates anything; pass *quality* does.)

---

## M1 — Pipeline *(2 weeks)*

- `Forge` interface + GitHub adapter (bisecting shards, resumable cursors, backoff)
- Batched GraphQL enrichment
- Hard gates G1–G6, each unit-tested against checked-in fixtures
- Scoring D1–D5 with the locked weights (D08), snapshot-tested per dimension
- Per-repo daily cap + rotation (D13)
- Emit per-language shards (D15) + `state/` history from the first run (doc 12 §6)
- Assertions A1–A10
- `refresh.yml` (daily 03:00 UTC), `revalidate.yml` (every 6h, D18), `watchdog.yml`

**Gate:** three consecutive green nightly runs, board size variance ±25%, zero manual
intervention.

---

## M2 — Site *(2 weeks)*

A zero-dependency static generator (D16, revised), deployed to **Vercel** (D17, revised).

- **"Today's 10"** homepage — the daily ritual object and primary DAU surface (D26)
- **"New today"** diff feed with its own URL, feed, and nav count badge (D27)
- Full board + card design; client-side filters as an enhancement layer
- **"Show me one issue"** CTA (D03)
- **Programmatic pages**: language, language×type, topic, repo, issue-detail, guides
  (~4,000 URLs), each prerendered with the top 30 inline
- `sitemap.xml`, JSON-LD, per-page OG images, canonical URLs, stable slugs
- `/how-it-works` (live rejection histogram) and `/stats` (running totals) — doc 12 §5
- Newsletter signup (Buttondown) + per-language RSS/JSON feeds (D28)
- `localStorage` saved list with mandatory re-validation (D07)
- Cloudflare Web Analytics (D32 — a script tag, host-independent); freshness banner; perf budget enforced in CI

**Gate:** 5-person usability test — time-to-first-useful-issue < 30s for ≥ 4 of 5, zero
participants landing on an already-taken issue. Lighthouse SEO 100 on a sample of each
page type.

---

## M3 — Launch *(1 week, target early October)*

1. Maintainer outreach to 20 repos **first** (D25); prominent one-PR opt-out documented.
2. Publish the analysis post (D24) — the data story, site attached.
3. Show HN → r/opensource, r/programming, r/learnprogramming (staggered).
4. Language-specific posts into the Rust/Go/Python/Elixir communities (highest conversion).
5. Submit sitemap to Search Console; monitor indexing daily for two weeks.
6. Weekly 50-issue precision audit begins (D30), published on `/stats`.

**Gate:** precision audit ≥ 90% on the first two weekly samples. Below that, stop
promoting and fix the pipeline — a trust product that ships untrustworthy is unrecoverable.

---

## M4 — Retention *(months 2–4, continuous)*

The objective is views and **daily uniques**, so the work after launch is habit
formation, not features. Watch **return-visitor %** (D33) — it moves months before DAU does.

1. **Tune "Today's 10"** against real return data: size (10 vs 5 vs 15), rotation rules,
   whether a visible "you've seen all 10 today" done-state improves next-day return.
2. **Daily email option** for subscribers who want it (weekly is the default).
3. **Streaks + viewed-history** in `localStorage` (D29), once there's traffic to measure against.
4. **Guides/editorial** targeting head terms that listings alone can't rank for.
5. **Search Console loop** — find which of the ~4,000 pages actually rank, then generate
   more of that shape and prune thin ones (R9).

**Gate:** return-visitor % ≥ 25% by month 6. If it stalls under 15%, the daily surfaces
aren't working — fix them before adding anything new, because no amount of SEO converts
one-time visitors into daily ones.

---

## Post-launch backlog

1. History-derived signals at ~30 days: empirical difficulty from time-on-board, measured
   maintainer response times, `CLAIM_TTL` calibration (D11).
2. GitLab + Codeberg adapters — proves the `Forge` seam, expands inventory (more inventory
   = more languages = more indexable pages).
3. GH Archive / ecosyste.ms for cheaper, deeper repo-health signals.
4. **Annual "State of Open Source Contribution" report** from `state/history` — a yearly
   traffic spike and a permanent backlink source (doc 12 §7).

## Permanently rejected

All monetization (D30): ads, sponsorships, job board, paywall, charging maintainers.
Plus the dark-pattern DAU tactics in D31 — notification prompts on first visit, artificial
scarcity, infinite scroll with no done-state.
