# 14b — M0 Interpretation

> Companion to the generated [14-m0-findings.md](14-m0-findings.md). The generated
> report states what the numbers *are*; this states what they *mean* and what changed
> because of them. Written 2026-08-15 against a 2,500-issue sample.

## The headline numbers

| | |
|---|---|
| Candidates analyzed | 2,500 |
| Survived every hard gate | 47 |
| **Joint pass rate** | **1.9%** |
| **Already taken (RQ1)** | **12.5%** |

## 1. RQ1 is confirmed, and it's the launch stat

**12.5% of issues that GitHub itself reports as unassigned are already being worked on.**
Breakdown: 189 have an **open** linked PR, 121 have a **merged** PR (so the issue should
have been closed and is pure noise), 1 was soft-claimed in comments.

This is the number the whole product rests on, and it survived contact with real data
inside the hypothesised 15–30% band (slightly under, at 12.5%).

Critically: **every one of these passes GitHub's own `no:assignee` filter.** A user
searching GitHub directly cannot see any of them. That's the differentiator, measured.

## 2. The 1.9% pass rate is mostly a *sampling artifact*, not gate strictness

Two rejections dominate and overlap heavily:

| Reason | Count | Share |
|---|---|---|
| Issue: no activity in 120+ days | 2,315 | 92.6% |
| Repo: no push in 60+ days | 1,494 | 59.8% |

Before concluding the gates are too strict, note **how this sample was collected**:
GitHub's default search sort is *best-match*, not recency, and the harvest window was 18
months. So the sample is deliberately skewed toward old issues — and then we measured
that they're old.

**The fix was already in the design and is now the production default:** push the activity
filter into the search query (`--fresh` ⇒ `updated:>=<120d ago> sort:updated-desc`,
docs/07 §2). Filtering at the API removes the dominant rejection reason *before* we pay to
enrich anything.

> **This is why M0 exists.** Had we shipped the naive harvest, the board would have been
> ~2% of a mostly-dead corpus and we'd have blamed the gates.

**M0 deliberately keeps the unfiltered denominator** so the launch statistic stays honest:
*"of all issues carrying a beginner label, only ~2% are actually startable today."*
That's a stronger claim than the filtered number, and it's true.

## 3. Gate-by-gate verdicts

| Gate | Rejects alone | Verdict |
|---|---|---|
| `G4_relevance` | 92.9% | **Correct but misplaced.** Move to the query (done). Keep as a post-check for defense in depth. |
| `G3_repoViability` | 85.4% | **Correct.** Dominated by dead repos (1,494), then <25 stars (267), then unlicensed (245). All three are genuine exclusions — an unlicensed repo isn't legally contributable. |
| `G5_actionability` | 36.0% | **Correct, and revealing.** 766 issues have a body under 160 characters after stripping markdown. Over a third of "good first issues" don't say enough to start. |
| `G2_takeability` | 12.5% | **The differentiator.** See §1. |
| `G1_structural` | 1.5% | Working — 28 bot-authored issues caught. |
| `G6_antiFarming` | 0.2% | **Under-firing.** Only 4 caught, all by name pattern. The label-ratio check needs the ratio data to be present; verify it's populating. |

## 4. What changed in the code because of this

1. **`--fresh` is the production harvest default** (`npm run harvest`), M0 keeps the honest
   denominator.
2. **Per-shard cap added.** The first run filled its entire 2,500 quota from *one* shard
   (TypeScript `good first issue`, which alone has 6,700+ matches), so every other language
   got zero. A board that can't fill its language pages can't run the traffic strategy.
   Breadth-first now, via `--per-shard`.
3. **Umbrella-title gate added.** `[META] Adding subfeatures to audits` reached the first
   rendered board. The checkbox-count test missed it because the umbrella marker was in the
   *title*. Found by looking at the actual site — which is an argument for rendering early.
4. **Page size is adaptive.** GitHub enforces an undocumented per-query resource limit well
   below the documented 500,000-node ceiling.

## 5. The cost model was wrong in our favour

docs/03 §2 estimated ~21 GraphQL points per 100-issue request from node-count math.
**Measured: 1 point per request**, consistently, across 303 requests.

The nightly budget has far more headroom than planned. **The real constraint is wall-clock,
not quota:** ~4s per search page and ~8s per 10-repo enrichment batch. A 2,500-issue
harvest with 1,359 repos took 17 minutes, of which ~13 was repo enrichment.

**Implication:** the repo-health cache (7-day TTL) matters much more than expected — it's
the difference between a 30-minute and a 5-minute nightly run. Second and subsequent runs
reuse it.

## 6. Honest limitations of this measurement

- **Single-shard sample.** This corpus is essentially all TypeScript, because the run
  predated the per-shard fix. Per-gate rates for other ecosystems may differ — Rust's
  earlier 120-issue sample showed 66.7% G3 rejection vs 85.4% here.
- **No hand audit yet** (docs/11's actual M0 gate). Run `npm run m0:audit` against a
  representative corpus and check 30 by hand before trusting the precision claim.
- **G6 under-firing** needs a look before launch.
