# 02 — Competitive Landscape

## 1. The field

| Tool | Model | Freshness | Claim detection | Repo-health filter | Verdict |
|---|---|---|---|---|---|
| **GitHub search** (`label:"good first issue" no:assignee sort:updated`) | Live query | Real-time | Assignee only | None | The baseline everyone falls back to. Free, live, and *bad* — no linked-PR check, no repo health, brutal UX. |
| **goodfirstissue.dev** | Curated repo list → live/periodic issue fetch | Good | Assignee (varies) | Manual curation of repos | Clean UX. Curation limits breadth and biases to famous, complex repos — amplifying H3 from doc 01. |
| **Up For Grabs** | Community-maintained YAML of *projects* | Project entries drift | None (project-level) | Manual | Recommends projects, not issues. Long tail of entries are years stale. |
| **First Timers Only** | Editorial / links out | Static | N/A | N/A | A landing page of advice, not a search tool. |
| **CodeTriage** | Subscribe to repo, daily email of one random open issue | Live | None | None | Different job (triage help, not "find a task"). Random selection means most emails are unactionable. |
| **goodfirstissues.com / issuehub-likes** | Thin wrappers over GitHub search | Live | Assignee at best | None | Same results as the baseline with nicer chrome. |
| **DeepSource good-first-issue** | Curated repo list, static build | Periodic | None | Manual curation | Nice static-build precedent architecturally; no validity layer. |
| **OpenSauced / Quira-type analytics** | Contributor analytics platforms | Live | N/A | Rich repo data | Adjacent, not competing — aimed at measuring contributors, not routing them. |

## 2. The pattern in the failures

Sort every tool above into one of two buckets:

**Bucket A — "prettier GitHub search."**
Passes the label query through to a nicer UI. Inherits every validity problem in doc 01.
Cheap to build, which is why there are a dozen of them, and why none has won.

**Bucket B — "human-curated repo directory."**
A person maintains a list of good projects. High quality at first; decays because nobody
re-audits. Curation cost scales linearly with breadth, so these plateau at a few hundred
repos and then rot.

**Nobody occupies Bucket C: machine-verified, continuously re-validated issue-level data.**
That's the gap, and it exists because it's the only one that requires a real data
pipeline — you cannot do it inside a browser at page-load time (the per-issue enrichment
alone is 1 API request per 100 issues, plus rate limits, plus a token you can't ship to a
client).

Our "no backend" constraint is not a limitation here. It's the same insight: do the
expensive work **once per day at build time**, ship the answer as a flat file.

## 3. What each competitor teaches us

**From goodfirstissue.dev:** curation of the *repo set* genuinely improves quality — but
do it algorithmically (repo health score) rather than manually, so it scales and self-heals.

**From Up For Grabs:** a community-maintained list in a git repo is a great *supplement*
(allowlist/denylist as PRs) but a terrible *primary* datastore.

**From CodeTriage:** the "one issue, delivered" framing beats an infinite list for the
overwhelmed beginner. Consider a "surprise me / pick one for me" primary CTA rather than
dumping a 2,000-row table.

**From the whole field:** every one of these is fast to clone. Our moat is not the UI —
it's the validity model plus the accumulated `state/` history (issue lifecycles, maintainer
response times) that only exists after months of daily snapshots. Start accumulating that
on day one, even before the features that consume it exist. See
[09-refresh-and-freshness.md](09-refresh-and-freshness.md).

## 4. Positioning statement

> Other tools tell you which issues have the label.
> We tell you which issues are **still free, still relevant, and attached to a maintainer
> who will actually merge your PR** — re-checked every 24 hours.

Concretely, the homepage promise is a claim we can defend with the data we compute:
**"Every issue here was verified unclaimed within the last 24 hours."**

## 5. Differentiating UI elements (downstream of the data)

These only exist because of the pipeline, and each is a visible reason to prefer us:

- **`Verified free 4h ago`** badge — timestamp of last validation pass.
- **`Maintainer replies in ~2 days`** — median first-response time, computed from the
  repo's recent issue history.
- **`7 of last 10 outsider PRs merged`** — the answer to JTBD-2, which no competitor shows.
- **`3 people circling`** — comment-level interest count, so the user can judge crowding.
- **`On the board 12 days`** — from our own `state/` history; a long-lived unclaimed issue
  is a *good* signal (nobody's competing) or a *bad* one (nobody can solve it) — worth
  surfacing either way.

## 6. Sources

- [First Timers Only](https://www.firsttimersonly.com/)
- [CodeTriage](https://github.com/codetriage/codetriage)
- [Good First Issues](https://goodfirstissues.com/)
- [DeepSource good-first-issue](https://github.com/deepsourcecorp/good-first-issue)
- [Top 10 Platforms To Find Beginner-Friendly Open-Source Projects](https://medium.com/tech-and-tricks/top-10-platforms-to-find-beginner-friendly-open-source-projects-efddd72d98dc)
- [How to Find Open Source Projects for Beginners — HackerNoon](https://hackernoon.com/how-to-find-open-source-projects-for-beginners)
