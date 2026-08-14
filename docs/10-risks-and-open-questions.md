# 10 — Risks & Open Questions

Ordered by how likely they are to kill the project.

## R1 — The validated corpus is too small *(highest risk)*

**Scenario:** hard gates retain 1% instead of 5%. 400 issues across 6 languages. The board
is thin, most visitors find nothing in their language, the site feels dead.

**Why plausible:** the gates are deliberately strict (doc 04's precision-over-recall
principle), and several — G3.6 (2+ committers/90d), G3.5 (OSI license), G6.1 (label ratio)
— each independently remove a big slice. Their intersection could be brutal.

**Detection:** M0 spike measures the real pass rate before any code is committed to the
strict design.

**Mitigations, in order of preference:**
1. Broaden the **seed** — tier-2 labels, more languages, longer date window. Cheap, and
   doesn't compromise validity.
2. Loosen *soft* gates only (stars floor 25→10, `pushedAt` 60→90 days). Never loosen
   G2 (takeability) or G3.5 (license) — those are the promise.
3. **Already handled by design (D02):** the homepage leads with "Today's 10" regardless of
   board size. If the corpus is 3,000 the ten are a curated entry point; if it's 200 the
   ten *are* the product. Same code, no pivot — which is why this risk was downgraded from
   "highest, blocking" to "affects traffic ceiling only."

**Residual risk after mitigation:** a thin corpus caps the SEO surface (fewer languages
clear the 8-issue minimum-inventory rule in R9), so it costs *views*, not viability.

## R2 — Precision doesn't actually improve

**Scenario:** we ship, and a manual audit shows 25% of listed issues are still practically
taken — via forks with unlinked PRs, Discord/Slack coordination, or maintainer intent
that's invisible in the API.

**Why plausible:** GitHub's data model only shows claims that were *recorded on GitHub*.
Off-platform coordination is invisible to any API-based approach.

**Detection:** the weekly 50-issue manual audit in doc 00 §5. Do it manually and honestly
from week one; automate never — this is the metric that must not be gamed.

**Mitigation:** if the ceiling is ~85% rather than 95%, say so on the site ("~9 in 10 are
genuinely free"). A truthful 85% still crushes GitHub search's baseline, but only if we
never claimed 100%.

## R3 — Scheduled builds silently stop

Covered by [09](09-refresh-and-freshness.md) §4–5 (watchdog + commit-every-run + UI banner).
**Residual risk:** the watchdog is the same unreliable cron mechanism. The client-side
banner is the real backstop because it's computed from the data itself in the user's
browser.

## R4 — GitHub changes the rules

Rate limits tighten, search endpoints change, or the ToS restricts bulk republication.

**Mitigation:** the `Forge` adapter interface ([05](05-architecture.md) §4) exists for
this. `state/` and `data/` are forge-agnostic. Worst case we're a GitLab + Codeberg site,
which is a smaller market but a working product. Keep the adapter seam real from day
one — a fake abstraction with one implementation is worthless, so write the GitHub
adapter *against* the interface, not the other way round.

## R5 — We become a load-generator on maintainers

**The ethical risk, and it's real.** If we route 500 beginners at the same 100 issues,
we've made maintainers' lives worse — which is the opposite of the point, and would earn
the project a deservedly bad reputation in the community.

**Mitigations:**
- D5 (crowding) already de-ranks issues that are getting attention.
- Diversity assertion A8: no repo may exceed 5% of the board.
- **Add a repo-level daily cap:** at most N issues per repo on the board per day, rotated.
- Provide an obvious opt-out: a maintainer opens a PR adding their repo to
  `config/denylist.yml`. Document this prominently on the site — visible, easy opt-out is
  the difference between a good citizen and a scraper.
- Consider *not* linking with a referral param that makes us look like traffic-farming.

## R6 — Effort estimates are wrong and mislead people — **RESOLVED (D04)**

Doc 08's "~2h" estimate was derived from body length and keywords. Too weak to defend.

**Decision:** cut it. Replaced with a measured fact — *"issues like this in this repo close
in a median of 4 days"* — computed from data we already fetch, which doesn't pretend to
know how fast *you* are.

## R7 — Cold-start for the moat

The compounding advantage ([04](04-issue-validity-model.md) §5) needs 30+ days of history.
For the first month we're only marginally better than a well-tuned search.

**Mitigation:** the takeability gates (G2) deliver value on **day one** without any
history. Ship those first; treat the history-derived features as month-2 additions. Just
make sure logging starts on day one, since history can't be back-filled.

## R8 — Repo bloat from committed state

Daily commits of `data/` + `state/` grow the repo indefinitely.

**Mitigation:** commit only current state plus append-only monthly JSONL (doc 05 §3).
**Revisit trigger:** `state/` > 50 MB or clone > 60s. Then move history to release assets
or R2. Estimate: ~3,000 issues × ~250 B × 365 days ≈ 270 MB/yr if we snapshot everything
— hence "events, not snapshots."

## R9 — The SEO strategy produces thin pages *(added with doc 12)*

**Scenario:** we generate ~4,000 pages; Google indexes 400, classifies the rest as thin or
duplicate, and the traffic engine never starts. Worse, a mass of low-quality pages can drag
the whole domain's ranking down.

**Why plausible:** `/topics/cli` with 3 issues on it is a thin page. Issue-detail pages
that are just a title + link are near-duplicates of GitHub's own page, which will always
outrank us for that content.

**Mitigations:**
- **Minimum-inventory rule:** don't generate a facet page with fewer than 8 issues.
  Fold the rest into a parent page. Fewer, denser pages beat more, thinner ones.
- Make issue-detail pages *additive* rather than duplicative — repo health card, "3
  similar unclaimed issues", maintainer responsiveness. Content GitHub doesn't have.
- Stable slugs across rebuilds (this is why freshness has a low scoring weight).
- Month 3: use Search Console to find what actually ranks, generate more of that shape,
  **prune what doesn't**. Pruning is as important as generating.

## R10 — DAU has a structural ceiling *(added with doc 12)*

**Scenario:** views grow nicely via SEO, but daily uniques flatline, because finding an
issue is an episodic job. People arrive from search, find an issue, and leave for a month.

**Why plausible:** it's the honest default behaviour for this product category. No
competitor has solved it either.

**Mitigations:** the entire §3 of doc 12 — "Today's 10", the "New today" diff feed, email,
RSS, streaks. These are the DAU strategy; without them the ceiling is real.

**Detection:** return-visitor % (D33), which moves months earlier than DAU.

**If it stalls anyway:** the honest response is to grow *uniques* rather than fake
*dailies*. A site with 60k monthly uniques and 12% return rate is a better outcome than one
that manipulates people into daily visits and burns its credibility doing it. Do not reach
for notification prompts or engagement bait (D31).

---

## Open questions — all resolved

Every RQ below is now decided in [13-decision-log.md](13-decision-log.md). The table is
kept for provenance: what was asked, and where the answer lives.

| ID | Question | **Resolution** |
|---|---|---|
| RQ1 | What % of labelled open issues have an open linked PR? | Measured in M0. Not a decision — it's the **launch headline** (D24). |
| RQ2 | Median time-to-first-maintainer-response distribution? | Measured in M0, calibrates D1. Default weights ship regardless (D08). |
| RQ3 | Does a soft claim predict abandonment? Is `CLAIM_TTL = 21d` right? | **21 days, locked** (D11). Instrumented now, revisited month 2 with real data. |
| RQ4 | Is `good first issue` the right seed? | **Both tiers ship** (D10). Tier-1 alone can't fill the language pages that drive traffic. |
| RQ5 | What are the scoring weights? | **Locked** (D08): 0.30 / 0.25 / 0.18 / 0.15 / 0.12. |
| RQ6 | True pass rate through all hard gates? | **No longer gates anything** (D02/D34). "Today's 10" makes the product viable at any corpus size. Still measured for the launch stat. |
| RQ7 | Is per-language payload sharding necessary? | **Ship it from day one** (D15) — the programmatic pages need per-language data anyway. |
| RQ8 | Will maintainers see this as helpful or a firehose? | **Outreach to 20 maintainers before launch** (D25), plus per-repo cap (D13) and one-PR opt-out. |

**Nothing is blocked on an unanswered question.** The three remaining unknowns (true pass
rate, real API point cost, which pages rank) are *measurements* with locked defaults —
they refine the system, they don't gate it. Full list in
[13-decision-log.md](13-decision-log.md) § "What is deliberately still unknown".
