# 07 — Pipeline Specification

Six stages. Each is a pure function over its input plus `state/`, independently testable,
and independently re-runnable from cached intermediates during development.

```
 config + state ──▶ [1 HARVEST] ──▶ candidates.jsonl
                    [2 ENRICH ] ──▶ enriched.jsonl
                    [3 VALIDATE] ─▶ passed.jsonl + rejections.jsonl
                    [4 SCORE  ] ──▶ scored.jsonl
                    [5 EMIT   ] ──▶ data/*.json + state/*
                    [6 ASSERT ] ──▶ ✅ commit  |  ❌ abort, keep yesterday's data
```

**Cardinal rule:** stage 6 can veto the whole run. A failed build must leave yesterday's
`data/` in place. Serving day-old validated data is strictly better than serving fresh
broken data.

---

## 1. Stage 0 — Configuration

`config/labels.yml` — the seed vocabulary. RQ4 in [01](01-problem-research.md) asks
whether `good first issue` alone is the right seed; the answer is almost certainly no,
because well-run projects use their own taxonomies.

```yaml
tier_1:            # explicitly beginner-targeted
  - "good first issue"
  - "good-first-issue"
  - "beginner friendly"
  - "beginner-friendly"
  - "first-timers-only"
  - "up-for-grabs"
  - "low hanging fruit"
  - "E-easy"        # Rust ecosystem
  - "D-easy"
  - "difficulty:easy"
  - "level:starter"
tier_2:            # open for contribution, difficulty unstated
  - "help wanted"
  - "help-wanted"
  - "contributions welcome"
  - "pr welcome"
  - "hacktoberfest"   # NOTE: strong farming correlation — apply G6 strictly
```

Tier-2 issues enter the corpus but carry a `tier: 2` marker and face a **higher score
threshold**, because "help wanted" says nothing about difficulty. Track tier-1 vs tier-2
outcomes separately in `state/history` so the tiering can be validated rather than assumed.

---

## 2. Stage 1 — Harvest

**Goal:** produce a candidate set of issue references without ever hitting the 1,000-result
truncation wall.

### The sharding algorithm

```
for label in config.labels:
  for language in TOP_LANGUAGES:                  # ~25
    shard = query(label, language, window = last 18 months)
    probe total_count
    if total_count == 0:      skip
    if total_count < 1000:    harvest(shard)
    else:                     bisect(shard)       # split date window, recurse
```

`bisect` splits the `created:` range in half and recurses, with a depth cap. This
guarantees every executed query is under the cap.

```ts
async function harvestShard(q: ShardQuery, depth = 0): Promise<IssueRef[]> {
  const total = await probeCount(q)
  if (total === 0) return []
  if (total < 1000) return await paginate(q)          // ≤10 pages of 100
  if (depth >= MAX_BISECT_DEPTH) {
    // Do NOT silently truncate — that's invisible data loss.
    logShardOverflow(q, total)
    return await paginate(q)                          // take the 1,000 we can get
  }
  const [a, b] = splitDateRange(q.window)
  return [...await harvestShard({...q, window: a}, depth + 1),
          ...await harvestShard({...q, window: b}, depth + 1)]
}
```

> **Why `created:` and not `updated:` for the shard key:** `created` is immutable, so
> shards are stable across runs and cursors stay valid. Sharding on a mutable field means
> issues migrate between shards mid-crawl and get double-counted or dropped.

### Pre-filters pushed into the query

Cheap gates belong in the search string, not in stage 3 — every issue filtered at the API
is one we don't pay to enrich:

```
is:issue is:open no:assignee archived:false
label:"good first issue" language:TypeScript
created:2025-02-15..2026-08-15
-label:wontfix -label:invalid -label:duplicate
```

`no:assignee` and `archived:false` alone remove a large fraction of the pool for free.

### Rate discipline
- Token bucket at **25 search req/min** (headroom under the 30 limit).
- On HTTP 403 + `x-ratelimit-remaining: 0`: sleep until `x-ratelimit-reset`, then resume.
- On secondary-limit signal (`retry-after`): honor it exactly, then exponential backoff.
- Persist `state/cursors.json` after **every** shard — the job must resume, not restart.

---

## 3. Stage 2 — Enrich

One GraphQL query per 100 issues, fetching everything the gates and scorers need.

```graphql
query Enrich($q: String!, $after: String) {
  rateLimit { cost remaining resetAt }
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        databaseId number title bodyText url locked
        createdAt updatedAt
        author { login __typename }
        assignees { totalCount }
        labels(first: 15) { nodes { name } }
        comments(last: 10) {
          totalCount
          nodes { author { login } bodyText createdAt authorAssociation }
        }
        reactions { totalCount }
        timelineItems(last: 20, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT, ASSIGNED_EVENT]) {
          nodes {
            ... on CrossReferencedEvent {
              source { ... on PullRequest { number state isDraft author { login } } }
            }
          }
        }
        repository {
          nameWithOwner stargazerCount isArchived isMirror isFork
          hasIssuesEnabled pushedAt diskUsage
          primaryLanguage { name }
          licenseInfo { spdxId }
          repositoryTopics(first: 10) { nodes { topic { name } } }
          contributing: object(expression: "HEAD:CONTRIBUTING.md") { __typename }
          openIssues: issues(states: OPEN) { totalCount }
        }
      }
    }
  }
}
```

Notes:
- `authorAssociation` on comments distinguishes `MEMBER`/`OWNER`/`COLLABORATOR` from
  `NONE` — this is how soft-claim detection (doc 04 §2) tells a maintainer's "go ahead"
  from a stranger's "I'll take this," and how D2's "maintainer gave guidance" is detected.
- `contributing:` uses the object-expression trick to test file existence **inside the
  same query** — no extra REST call per repo.
- `timelineItems` is the G2.2 workhorse: an open or merged PR in `CrossReferencedEvent`
  means the issue is taken.
- Log `rateLimit.cost` per query. Budget assumptions must be measured, not trusted.

### Repo-health enrichment (D1, cached)
Runs only for repos whose `state/repo-health.json` entry is missing or > 7 days old.
Separate query pulling the last 30 closed issues and 20 outsider PRs per repo (batched
~20 repos/query via aliases).

---

## 4. Stage 3 — Validate

Applies gates G1–G6 from [04](04-issue-validity-model.md) in **cheapest-first** order and
short-circuits.

```ts
const GATES = [G1_structural, G4_relevance, G5_actionability,
               G2_takeability, G3_repoViability, G6_antiFarming]

function validate(issue: Enriched): Verdict {
  for (const gate of GATES) {
    const r = gate(issue)
    if (!r.ok) return { ok: false, gate: gate.name, reason: r.reason }
  }
  return { ok: true }
}
```

**Every rejection is recorded** with its gate and reason to `rejections.jsonl`. This
feeds `meta.stats.rejected` (the trust number in the UI) and is the primary debugging
surface when the board shrinks unexpectedly.

**Testing:** each gate gets a fixture-based unit test with real captured payloads,
including the adversarial cases — the issue with an open draft PR, the repo with 90% of
issues labelled beginner-friendly, the umbrella issue with 30 checkboxes. Fixtures live
in `pipeline/validate/__fixtures__/` and are checked in.

---

## 5. Stage 4 — Score

Pure function, no I/O. Each dimension is its own module returning 0–100; the composite
applies `WEIGHTS` (see the TODO in doc 04 §3) and filters on `SCORE_THRESHOLD`.

Dimension modules must be **individually snapshot-tested**, because a scoring regression
is silent — nothing errors, the board just gets worse.

---

## 6. Stage 5 — Emit

1. Normalize: build the repo table, replace repo objects with indices.
2. Build the facet vocabularies and counts.
3. Truncate excerpts to 300 chars at a word boundary; strip markdown, images, HTML comments.
4. Content-hash each shard; write `data/<name>.<hash>.json`.
5. Write `meta.json` last (it references the hashes — write order matters if a deploy
   races a build).
6. Update `state/current.json`, append lifecycle events to `state/history/YYYY-MM.jsonl`,
   refresh `state/repo-health.json`.
7. Garbage-collect orphaned hashed files older than 7 days.

---

## 7. Stage 6 — Assert (the safety net)

Build fails, and yesterday's data survives, if **any** of these trip:

| # | Assertion | Rationale |
|---|---|---|
| A1 | `issues.length >= 300` | A near-empty board means the pipeline broke, not that open source ran out of issues |
| A2 | `issues.length` within **±60%** of yesterday | Catches a gate inverting or a query silently failing |
| A3 | Every emitted issue re-passes all hard gates | Defense in depth against a scoring/emit bug |
| A4 | No duplicate `repo#number` keys | |
| A5 | Brotli size of initial payload ≤ 500 KB | Performance budget as a hard gate |
| A6 | Zero issues from `config/denylist.yml` | |
| A7 | `Σ WEIGHTS == 1.0` | |
| A8 | ≥ 8 distinct languages, no single repo > 5% of the board | Diversity — prevents one huge repo dominating |
| A9 | Spot-check: 20 random issues re-fetched live still `OPEN` + unassigned | Catches enrichment staleness within the run |

A2 is deliberately wide on day one (there's no yesterday) and should be tightened to ±25%
once the board's daily variance is known from real data.

---

## 8. Observability

The run writes `data/build-log.json` (committed, and linked from the site footer):
duration per stage, API points consumed, shard overflow warnings, rejection histogram,
board delta vs. yesterday (added / dropped / reasons).

Making this public is a feature, not just ops hygiene — it's the audit trail behind the
"every issue verified free" claim, and it's what makes the validity model credible to a
skeptical developer audience.
