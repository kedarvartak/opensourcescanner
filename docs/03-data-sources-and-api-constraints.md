# 03 — Data Sources & API Constraints

Everything in the architecture is downstream of the numbers in this doc. Read it before
designing the pipeline.

## 1. GitHub API rate limits (verified, Aug 2026)

### Primary limits

| Credential | Core REST | Notes |
|---|---|---|
| Unauthenticated | **60 req/hour** | Unusable for us |
| Personal access token (PAT) | **5,000 req/hour** | Our harvest credential |
| `GITHUB_TOKEN` in Actions | **1,000 req/hour per repository** | Too small for the harvest; fine for housekeeping |
| GraphQL (any auth) | **5,000 points/hour** | Points ≠ requests — see §2 |

### Secondary limits

- **≤ 100 concurrent requests**
- **≤ 900 points/minute** (REST) · **≤ 2,000 points/minute** (GraphQL)
- REST `GET` = 1 point; `POST/PATCH/PUT/DELETE` = 5 points

### Search endpoint limits (much tighter — these bind us)

| | Limit |
|---|---|
| Authenticated, most search endpoints | **30 requests/minute** |
| Authenticated, code search | 10 requests/minute |
| Unauthenticated, all search | 10 requests/minute |
| **Max results per query** | **1,000** (hard cap, no pagination past it) |
| Max `per_page` | 100 |

> **Design consequence #1 — the 1,000-result cap.**
> No single query can harvest the corpus. The harvest must be **sharded** into queries
> that each return < 1,000 results, and we must *verify* each shard's `total_count` is
> under the cap — a shard at exactly 1,000 is silently truncated, meaning silent data
> loss. Shard on `language` × `label` × `created:` date-window, splitting any window
> that overflows. See [07-pipeline-spec.md](07-pipeline-spec.md) §3.

> **Design consequence #2 — 30 searches/minute.**
> A full sweep of ~600 shards takes ≥ 20 minutes of wall-clock just in search calls.
> That's fine for a nightly job, and fatal for a live frontend. Confirms the
> build-time-pipeline architecture.

**Source:** [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) ·
[Search API](https://docs.github.com/en/rest/search/search)

## 2. Why GraphQL, not REST, for enrichment

The validity model needs, per issue: assignees, labels, comment count, reactions, recent
comment authors, **cross-referenced PRs**, plus repo-level license/archived/pushedAt/
stars/language.

- **REST:** that's ~3–4 requests *per issue* (issue, timeline, repo). At 5,000/hour, we
  enrich ~1,400 issues/hour. Unworkable.
- **GraphQL:** `search(type: ISSUE, first: 100)` with nested fields returns all of it for
  100 issues in **one request**.

GraphQL cost is computed from **node count**, not request count: sum the nodes each
connection could return, divide by 100, round up. A query fetching 100 issues × (10
timeline items + 10 labels + repo scalars) costs roughly:

```
100 issues                       → 100 nodes
100 × 10 timelineItems           → 1,000 nodes
100 × 10 labels                  → 1,000 nodes
------------------------------------------------
~2,100 nodes ÷ 100               ≈ 21 points
```

At 5,000 points/hour that's ~230 such calls/hour ⇒ **~23,000 issues enriched per hour.**
Comfortably enough.

> **Rule:** every GraphQL query must request the `rateLimit { cost remaining resetAt }`
> block and the pipeline must log it. Budget assumptions decay; measurement doesn't.

**Source:** [GraphQL rate & node limits](https://docs.github.com/en/enterprise-cloud@latest/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)

## 3. Quota budget for one nightly run

Working target: **~40,000 candidate issues** scanned per full sweep.

| Stage | Mechanism | Cost | Wall clock |
|---|---|---|---|
| Shard discovery (`total_count` probes) | REST search, ~120 calls | 120 search calls | ~4 min @ 30/min |
| Harvest issue IDs | GraphQL search, 400 pages × 100 | ~400 req, ~2,000 pts | ~10 min |
| Enrich (timeline, repo, comments) | Batched into harvest query | included above | — |
| Repo-health lookups (deduped, ~3,000 repos) | GraphQL, 30 repos/query = 100 req | ~600 pts | ~2 min |
| **Re-validate yesterday's board** (~3,000 issues) | GraphQL, 30 req | ~600 pts | ~1 min |
| **Total** | | **~3,200 / 5,000 points** | **~20–25 min** |

Headroom: ~35%. Job must be **resumable** — persist per-shard cursors so a rate-limit
stall resumes rather than restarts. See [09](09-refresh-and-freshness.md) §4.

## 4. Credential strategy

- `GITHUB_TOKEN` (auto-provided in Actions) is capped at 1,000 req/hr/repo → **not enough**.
- Use a **fine-grained PAT with public-read scope only**, stored as an Actions secret
  (`GH_HARVEST_TOKEN`). Read-only on public data; blast radius of a leak is negligible,
  but rotate on a schedule anyway.
- **Never ship any token to the client.** The browser makes zero GitHub API calls. This is
  a hard architectural invariant — a client-side "refresh" button is not implementable and
  must not appear in any design.
- Optional hardening: a second PAT as failover on `RATE_LIMITED`.

## 5. GitHub Actions constraints

> **Repo is PRIVATE** (`kedarvartak/unclaimed`, decided 2026-08-15). That reverses the
> assumption below — see §5a for what it costs.
- **Scheduled workflows are unreliable in two specific ways:**
  1. `schedule:` triggers are **delayed**, sometimes 30+ minutes, and can be **silently
     dropped** under load. GitHub does not notify you about a skipped run.
  2. In a public repo, scheduled workflows are **auto-disabled after 60 days with no
     repository activity.** A successful scheduled run does **not** count as activity —
     only commits do.

> **Mitigation (both problems, one mechanism):** the build **commits its output to the
> repo every run.** That commit is repo activity, so the 60-day timer never fires. And a
> missing/old commit timestamp is a directly observable liveness signal — the site itself
> renders "data as of <timestamp>", so a silently dropped run is visible to us and honest
> to the user rather than hidden.
>
> Add a `workflow_dispatch` trigger for manual recovery, and a separate cheap watchdog
> workflow that fails loudly if `data/meta.json` is older than 30 hours.

**Sources:** [Scheduled workflow delays](https://github.com/orgs/community/discussions/156282) ·
[60-day auto-disable](https://github.com/efrecon/gh-action-keepalive)

## 5a. Consequences of a private repo

**Minutes are no longer unlimited.** Private repos get **2,000 free Actions minutes/month**
(Free plan; 3,000 on Pro). Our budget:

| Job | Per run | Runs/month | Minutes/month |
|---|---|---|---|
| Daily full/delta refresh | ~25 min | 30 | 750 |
| 6-hourly re-validation (D18) | ~2 min | 120 | 240 |
| Watchdog | ~0.5 min | 120 | 60 |
| **Total** | | | **~1,050 / 2,000** |

Fits, with ~45% headroom — but the margin is real, not comfortable. **Guard rails:**
- Keep the weekly full sweep to Sundays; deltas on other days (D19).
- If minutes get tight, move the 6-hourly re-validation to Vercel deploy hooks
  or drop it to 12-hourly. Re-validation is the *last* thing to cut, since it backs the
  headline freshness claim.
- Add a monthly minute-usage check to the watchdog so this is measured, not assumed.

**Two things private-repo status changes for the better:**
- The 60-day scheduled-workflow auto-disable applies to *public* repos; private repos are
  not covered by that statement. The commit-every-run mechanism stays anyway — it's still
  our freshness signal and revert point.
- The harvest token and any future secrets are less exposed.

**One thing it costs:** the validity model is no longer publicly auditable, which was a
trust argument in [02](02-competitive-landscape.md) §4. Mitigation: the `/how-it-works`
page publishes the gate list and the live rejection histogram, so the *claims* stay
verifiable even while the source isn't. If the repo is ever made public, that argument
returns for free.

**GitHub Pages from a private repo requires a paid plan** — another reason
[05](05-architecture.md) §6 lands on **Vercel**, which builds from private repos
on the free tier.

## 6. Other data sources considered

| Source | Use | Decision |
|---|---|---|
| **GH Archive** (BigQuery public dataset of all GitHub events) | Historical event stream — could compute maintainer response times cheaply over months | **v2.** Powerful for the responsiveness model; adds BigQuery cost + complexity. Note it in the roadmap, don't build it now. |
| **GitHub REST `/repos/{o}/{r}/community/profile`** | CONTRIBUTING/CoC/README presence in one call | **v1, optional.** Cheap onboarding-quality signal, but 1 REST call per repo (~3,000/run) — fits the budget only just. Prefer deriving from the GraphQL `repository.object(expression: "HEAD:CONTRIBUTING.md")` field, which is free inside the existing query. |
| **GitLab / Codeberg / Gitea APIs** | Broader coverage | **v2.** Keep the `Forge` adapter interface in the pipeline from day one so this is additive, not a rewrite. |
| **libraries.io / ecosyste.ms** | Package-level popularity, maintenance signals | **Evaluate in v2.** ecosyste.ms is open-data and could supply repo-health signals without burning GitHub quota. |

## 7. Legal / ToS notes

- We store and republish public issue metadata (titles, labels, URLs, counts). This is
  ordinary use of the public API. **Do not** mirror full issue bodies verbatim in bulk —
  store a truncated excerpt (≤ 300 chars) plus a link, which is what the UI needs anyway
  and keeps the payload budget honest.
- Attribute GitHub as the data source and always deep-link to the canonical issue.
- Respect `robots.txt` if any HTML scraping is ever added. (v1 adds none — API only.)
