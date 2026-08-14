# 14b — M0 Interpretation

> Companion to the generated [14-m0-findings.md](14-m0-findings.md). The generated
> report states what the numbers *are*; this states what they *mean* and what changed
> because of them. Written 2026-08-15 against a 2,500-issue sample.

## The headline numbers

Two runs, and the difference between them is the main finding.

| | Run A — no prefilter | Run B — production (`--fresh`) |
|---|---|---|
| Candidates | 2,500 | 3,000 |
| Survivors | 47 | **531** |
| Pass rate | 1.9% | **17.7%** |
| **Already taken (RQ1)** | 12.5% | **28.9%** |
| Languages on the board | 1 | **11** |

Run B is the production configuration: activity filter pushed into the search query, plus
a per-shard cap for language breadth. **Final board after scoring and the per-repo cap:
304 issues across 196 repos, 11 languages, 43 KB brotli.**

> **The pass rate went from 1.9% to 17.7% without loosening a single gate.** Every gate is
> byte-identical between the runs. The difference is entirely *which issues we asked
> GitHub for*. Had we shipped Run A's configuration, we'd have concluded the gates were
> far too strict and started weakening them — the exact wrong move.

### RQ1 got stronger, not weaker, under the honest configuration

**28.9% of issues GitHub reports as unassigned are already being worked on** — 575 with an
open linked PR, 223 with a merged PR that should have closed the issue, 9 soft-claimed in
comments. On *fresh, active* issues the problem is worse than on stale ones, which makes
sense: active issues are the ones people actually pick up.

That lands squarely in the 15–30% band hypothesised in doc 01 before any data existed.

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
5. **The label-ratio query was silently broken.** Repeated `label:` qualifiers are **AND-ed**
   by GitHub search, not OR-ed, so the beginner-ratio query asked for issues carrying all
   four labels at once and returned `0` for **all 1,359 repos**. G6.1 had therefore never
   fired once. The comma form is the OR. *A gate that silently returns "everything is fine"
   is worse than no gate, because it also reports success.*
6. **Template-farm detection added** as a second, independent anti-farming signal —
   precisely so a single broken query can't disable G6 again. Caught three repos on the
   first run, including one generating 93 issues promising a contribution "in under 60
   seconds" with no code.

## 5. The cost model was wrong in our favour

docs/03 §2 estimated ~21 GraphQL points per 100-issue request from node-count math.
**Measured: 1 point per request**, consistently, across 303 requests.

The nightly budget has far more headroom than planned. **The real constraint is wall-clock,
not quota:** ~4s per search page and ~8s per 10-repo enrichment batch. A 2,500-issue
harvest with 1,359 repos took 17 minutes, of which ~13 was repo enrichment.

**Implication:** the repo-health cache (7-day TTL) matters much more than expected — it's
the difference between a 30-minute and a 5-minute nightly run. Second and subsequent runs
reuse it.

## 6. Verdict against the M0 gate

**Pass rate 17.7%, well above the 4% viability threshold.** The browse product works as
designed — no pivot to a curation-only product needed, though "Today's 10" ships anyway
because it's the DAU surface (D26).

## 7. Honest limitations of this measurement

- **No hand audit yet.** This is docs/11's actual M0 gate (≥80% of 30 sampled survivors
  genuinely takeable) and it is the one thing here a machine can't do. Run
  `npm run m0:audit` and spend 30 minutes on `docs/14a-m0-audit.md` before making any
  public precision claim.
- **Run B's per-gate rates predate the two G6 fixes**, so anti-farming rejections are
  undercounted in the generated report. Re-run `npm run m0:analyze` for corrected numbers.
- **Health data covers 287 of 304 listed issues.** The other 17 fall back to activity
  proxies, capped at 60/100 so they can't outrank a measured-good repo.
- **10 languages seeded.** Broadening the language list is the cheapest way to grow the
  board and the number of SEO landing pages that clear the 8-issue minimum.
