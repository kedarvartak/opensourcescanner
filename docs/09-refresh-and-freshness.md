# 09 — Refresh, Freshness & Failure Modes

## 1. The freshness problem, stated honestly

A 24-hour refresh means a listed issue can be **up to 24 hours stale**. Someone can claim
an issue at 03:05, five minutes after the build, and it sits on our board all day.

With no backend, this is irreducible. There are three responses, and we do all three:

1. **Minimize the window for the issues that matter most** — asymmetric refresh (§3).
2. **Be honest about it** — every card timestamped (doc 08 §5).
3. **Bias the ranking toward issues unlikely to be claimed in 24h** — the D5 crowding
   dimension does this. An issue with zero recent commenters is far less likely to be
   claimed today than one with four people already circling. Freshness risk is a *ranking
   input*, not just a caveat.

## 2. Refresh schedule

```yaml
on:
  schedule:
    - cron: '0 3 * * *'      # 03:00 UTC daily — low GitHub API contention
  workflow_dispatch:          # manual recovery
concurrency:
  group: refresh
  cancel-in-progress: false   # never kill a build mid-write to state/
```

**Cron caveat (see [03](03-data-sources-and-api-constraints.md) §5):** scheduled runs are
delayed under load and can be silently dropped. Design for "roughly daily," never "exactly
at 03:00."

## 3. Asymmetric refresh — the important optimization

Not all issues carry equal staleness risk. **The issues on yesterday's board are the ones
people actually clicked**, so they're the most likely to have just been claimed — and
they're also the cheapest to check (~3,000 issues ≈ 30 GraphQL requests ≈ 1 minute).

So split the work:

| Pass | Scope | Cost | Frequency |
|---|---|---|---|
| **Re-validation** | Re-check every issue currently on the board against gates G1, G2, G4 | ~30 req | **Every run, always first** |
| **Delta harvest** | New/updated issues only (`updated:>=yesterday`) | ~50 shards | Every run |
| **Full sweep** | Complete sharded crawl | ~600 shards, ~25 min | Weekly (Sunday) |

Re-validation runs **first** and can succeed even if the harvest later fails. That
ordering matters: a partially-failed run that still removed the newly-claimed issues is
much better than one that adds new issues but leaves stale ones on the board.

This also makes a **more frequent re-validation-only run** cheap enough to consider:
a 6-hourly job doing *only* re-validation cuts worst-case claim staleness from 24h to 6h
for ~30 API requests. **Strongly recommended for v1.1** — it's the highest
value-per-unit-of-work improvement available, and it needs no architectural change.

## 4. Failure modes and responses

| # | Failure | Detection | Response |
|---|---|---|---|
| F1 | Cron never fired | Watchdog: `meta.generatedAt` > 30h | Alert + UI banner; `workflow_dispatch` manual run |
| F2 | Workflow auto-disabled (60d inactivity) | Watchdog | Prevented by committing every run; re-enable + push |
| F3 | Rate limited mid-run | 403 + `remaining: 0` | Sleep to `reset`, resume from `state/cursors.json` |
| F4 | PAT expired/revoked | 401 | Fail loudly; **never** silently fall back to unauthenticated (60 req/hr would produce a plausible-looking tiny board) |
| F5 | GitHub API schema change | GraphQL errors | Build fails at stage 2; yesterday's data stands |
| F6 | Board collapses (gate bug) | Assertion A1/A2 | Abort before commit; yesterday's data stands |
| F7 | Board balloons (gate inverted) | Assertion A2 | Same |
| F8 | Payload over budget | Assertion A5 | Abort; fix by sharding or tightening threshold |
| F9 | Partial harvest (some shards failed) | Shard success ratio < 90% | Merge partial results with yesterday's board rather than dropping issues; mark `partial: true` in meta |
| F10 | Deploy succeeded, data didn't update | Hash unchanged across runs | Watchdog compares hashes |

**The single most important response is F6/F7's:** *abort and keep yesterday's data.*
Every failure path should degrade toward "slightly stale but valid," never toward
"fresh but wrong."

## 5. Watchdog workflow

Separate, tiny, runs every 6 hours:

```yaml
# .github/workflows/watchdog.yml
on:
  schedule: [{ cron: '0 */6 * * *' }]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Assert data freshness
        run: node scripts/watchdog.mjs   # exits 1 if meta.generatedAt > 30h old
```

A failing workflow emails the repo owner by default — sufficient alerting for v1. Note
the watchdog is subject to the same cron unreliability it's monitoring; it reduces the
blind window, it doesn't eliminate it. The UI banner is the true backstop, because it's
computed in the user's browser from the data itself and cannot fail silently.

## 6. Issue lifecycle on the board

```
        harvested ──validate──▶ LISTED ──┬──▶ assigned      ─┐
                      │                  ├──▶ PR opened      ├─▶ DROPPED
                      ▼                  ├──▶ closed         │   (logged with
                   REJECTED              ├──▶ went stale     │    reason)
                 (logged, not            └──▶ score fell     ─┘
                  shown)                          │
                                                  ▼
                                         claim expired (>21d)
                                                  │
                                                  ▼
                                              RELISTED
```

Every transition is appended to `state/history/YYYY-MM.jsonl`. After ~30 days this yields
the empirical difficulty and calibration data described in [04](04-issue-validity-model.md) §5.

## 7. What "24 hours" actually buys the user

Worth stating plainly, since it's the honest version of the pitch:

- GitHub search: the issue was valid **the moment you loaded the page**, but nobody
  checked assignees-via-PR, repo liveness, or maintainer responsiveness — so a large
  fraction are dead on arrival.
- Us: the issue was **fully verified within the last 24 hours** (6 hours after v1.1).

Fresher-but-unverified loses to slightly-staler-but-verified, because the failure modes
we eliminate (dead repo, unresponsive maintainer, umbrella issue, no context) don't decay
in 24 hours — they're structural. Only the claim-status check is time-sensitive, and
that's exactly the one the asymmetric refresh in §3 targets.
