# 04 — Issue Validity Model

> This is the core IP of the project. The UI is replaceable; this document is not.

The model runs in two stages:

1. **Hard gates** — boolean. Any failure ⇒ the issue never reaches the board. No score
   can rescue it.
2. **Score** — 0–100 across five dimensions. Below the threshold ⇒ excluded. Above ⇒
   ranked.

**Governing principle (from [01](01-problem-research.md) §6):** precision over recall.
When a signal is ambiguous, **exclude**. A smaller trustworthy board beats a large
untrustworthy one, and trust is the only thing we have that GitHub search doesn't.

---

## 1. Hard gates

Grouped by what they protect against. Each gate names its data source so the pipeline
knows what to fetch.

### G1 — Structural (issue is real and open)

| ID | Gate | Source |
|---|---|---|
| G1.1 | `state == OPEN` | search |
| G1.2 | Is an Issue, **not** a PR (`__typename == "Issue"`) | search |
| G1.3 | Not locked (`locked == false`) | issue |
| G1.4 | Author is not a bot (`author.__typename != "Bot"`, and login not in `dependabot`, `renovate`, `github-actions`, `imgbot`, `snyk-bot`, `allcontributors`) | issue |

*Rationale for G1.4:* bot issues are dependency bumps and automated reports — never
suitable first tasks, and they'd otherwise flood the board.

### G2 — Takeability (the differentiator — see H1 in doc 01)

| ID | Gate | Source |
|---|---|---|
| G2.1 | `assignees.totalCount == 0` | issue |
| G2.2 | **No open PR cross-references this issue** | `timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT])` |
| G2.3 | No **merged** PR cross-references it (issue should have been closed; it's stale) | same |
| G2.4 | Soft-claim check — see §2 below | recent comments |

G2.2 is the single highest-value gate in the system. It is invisible in GitHub's issue
list and is, by hypothesis (RQ1), 15–30% of the labelled pool.

### G3 — Repo viability (protects against H2, dead repos)

| ID | Gate | Threshold | Source |
|---|---|---|---|
| G3.1 | `isArchived == false` | | repo |
| G3.2 | `hasIssuesEnabled == true` | | repo |
| G3.3 | `isMirror == false` and not a fork (unless the fork is the active upstream) | | repo |
| G3.4 | `pushedAt` within | **60 days** | repo |
| G3.5 | Has an **OSI-approved license** (`licenseInfo.spdxId` in allowlist; reject `null`, `NOASSERTION`, `other`) | | repo |
| G3.6 | Default branch has commits from **≥ 2 distinct authors in the last 90 days** | | repo commit history |
| G3.7 | `stargazerCount >= 25` | tunable | repo |
| G3.8 | Not on the **denylist** (see §4) | | our config |

*Rationale for G3.5:* a repo with no license is not legally contributable — your PR has
undefined terms. Excluding these is correctness, not taste.

*Rationale for G3.6:* the strongest available "someone will review your PR" proxy that
doesn't require full history analysis. A single-author repo where the author is the only
committer is a high-risk PR destination.

*Rationale for G3.7:* a floor, not a popularity contest. Below ~25 stars the repo is
usually a personal project or a tutorial artifact. Tunable; measure the effect in M0.

### G4 — Issue relevance (protects against H3, staleness)

| ID | Gate | Threshold |
|---|---|---|
| G4.1 | `updatedAt` within | **120 days** |
| G4.2 | If `createdAt` older than 18 months, require `updatedAt` within 30 days | |
| G4.3 | No blocking label: `wontfix`, `invalid`, `duplicate`, `blocked`, `on-hold`, `needs-triage`, `needs-info`, `question`, `discussion`, `rfc`, `epic`, `meta`, `tracking` | |
| G4.4 | Not part of a tracking/umbrella issue (body contains > 5 unchecked task-list items) | |

*Rationale for G4.4:* umbrella issues look approachable and are weeks of work. Task-list
density is a cheap, reliable detector.

### G5 — Actionability (protects against H4, missing context)

| ID | Gate | Threshold |
|---|---|---|
| G5.1 | Body length ≥ **160 characters** after stripping markdown, code fences, images and HTML comments | |
| G5.2 | Body is not solely a template with unfilled placeholders (`<!-- ... -->` residue, `[ ] I have searched`) | |
| G5.3 | Title is not a bare placeholder (`test`, `issue`, `asdf`, < 15 chars) | |

### G6 — Anti-farming (protects against H5)

| ID | Gate | Detection |
|---|---|---|
| G6.1 | Repo's beginner-labelled issues are **< 40%** of its open issues | ratio anomaly |
| G6.2 | Repo is not a known contribution-playground (`first-contributions`, `hacktoberfest-practice`, `awesome-*` lists, `*-tutorial`, `learn-*`) | name/topic heuristics + denylist |
| G6.3 | Repo has ≥ 3 non-doc source files and a recognized `primaryLanguage` (excludes pure-README repos) | repo |

*Rationale for G6.1:* legitimate projects label a **minority** of their backlog as
beginner-friendly. A repo where most issues carry the label is farming for contributors
or for stars, and the label carries no information there.

---

## 2. Soft-claim detection (G2.4) — the subtle one

Formal assignment is rare; the real-world claim is a comment: *"I'd like to work on this"*,
*"can I take this?"*, *"/assign"*, *"working on it"*, *"taking this up"*, *"PR incoming"*.

The design question is not detection (a regex over the last N comments handles it) but
**expiry**: people claim issues and abandon them constantly. An issue claimed 6 months ago
by someone who never opened a PR **is free again**, and permanently excluding it throws
away a large, high-quality slice of the board.

**Proposed rule:**

```
soft_claimed = ∃ comment C where:
    matches(C.body, CLAIM_PATTERNS)
    AND C.author is not a maintainer   (not in repo.assignableUsers / no write perm)
    AND age(C) <= CLAIM_TTL
    AND no PR by C.author references this issue
```

`CLAIM_TTL = 21 days` as the starting value: long enough to respect a genuine
in-progress effort, short enough to recycle abandoned claims. Beyond the TTL the issue
returns to the board, with a `previously claimed` note in the UI so the user isn't blindsided.

**RQ3 in doc 01 measures whether 21 days is right.** Instrument it: log claim events
with their eventual outcome (PR opened / issue closed / nothing) and tune from real data
after the first month of `state/` history.

---

## 3. Scoring model

Five dimensions, each normalized to 0–100, then weighted. Only issues **passing all hard
gates** are scored.

### D1 — Maintainer responsiveness *(answers JTBD-2)*
Computed **per repo**, cached, recomputed weekly.
- Median time-to-first-maintainer-response on the last 30 closed issues
- Median time-to-first-review on the last 30 PRs from **non-members**
- % of last 20 outsider PRs that were merged (vs. closed unmerged vs. rotting open)
- Count of PRs open > 90 days with no maintainer comment *(strong negative)*

### D2 — Issue specificity *(answers H4)*
- Body length (log-scaled, saturating around 1,200 chars)
- Contains a code block / stack trace / error message: **+**
- Contains a file path or `path/to/file.ext:123` reference: **++**
- Contains reproduction steps (numbered list / "Steps to reproduce" heading): **++**
- Contains acceptance criteria or a checklist ≤ 5 items: **+**
- Maintainer has commented with guidance after the issue was filed: **+++**
  *(the strongest single signal that a human will help you)*

### D3 — Project approachability
- `CONTRIBUTING.md` present: **++**
- Development setup section in README (heading match): **+**
- CI configured (`.github/workflows/` non-empty): **+**
- Tests directory present: **+**
- Repo size percentile *(smaller = more approachable, inverted, weak weight)*
- Has `good first issue` **and** a difficulty-tier label system: **+**

### D4 — Freshness
- Days since `issue.updatedAt` (decay)
- Days since `repo.pushedAt` (decay)
- Issue age *(mild penalty — old-and-untouched correlates with "actually hard")*

### D5 — Openness / low crowding
- Distinct commenters in last 30 days *(more = more crowded = lower score)*
- Reaction count *(mild positive — signals the issue matters)*
- Days on **our** board without being claimed *(from `state/` — see §5)*

### Composite

```
score = w1·D1 + w2·D2 + w3·D3 + w4·D4 + w5·D5      where Σw = 1
board  = { issue | passes_all_gates(issue) ∧ score >= SCORE_THRESHOLD }
```

### LOCKED — weights and thresholds

`pipeline/scoring/weights.ts`:

```ts
// LOCKED 2026-08-15. Rationale below. Change only with data from state/history.
// Build assertion A7 enforces Σ === 1.0.
export const WEIGHTS = {
  responsiveness:  0.30,  // D1 — will a human review my PR?
  specificity:     0.25,  // D2 — can I start without asking questions?
  openness:        0.18,  // D5 — am I competing with 6 other people?
  approachability: 0.15,  // D3 — is the project set up for newcomers?
  freshness:       0.12,  // D4 — is this still live?
}

export const SCORE_THRESHOLD      = 55  // tier-1 labels
export const SCORE_THRESHOLD_T2   = 65  // tier-2 ("help wanted") — must clear a higher bar
export const CLAIM_TTL_DAYS       = 21
export const MIN_STARS            = 25
export const MAX_ISSUES_PER_REPO  = 4   // per day on the board (see R5)
```

**Why responsiveness leads (0.30):** the growth loop of this product is *a user gets a PR
merged and tells someone*. Nothing else produces word-of-mouth. An issue in a repo that
never merges outsider PRs is a user we lose permanently even though every gate passed —
it's the one remaining silent failure after the hard gates, so it gets the largest weight.
The board-diversity assertion (A8, max 5% per repo) prevents the predicted failure mode of
collapsing into twenty famously well-run repos.

**Why specificity is second (0.25):** it's the difference between "I started in 5 minutes"
and "I closed the tab." It also directly feeds the SEO surface — a specific issue title
makes a better indexable page than "improve error handling."

**Why openness is third and deliberately high (0.18):** uncrowded issues are what
*only we can show*. Anything crowded is already discoverable via GitHub search, so ranking
it highly makes us look like a mirror of GitHub. It also mitigates R5 (not dogpiling
maintainers) — the ranking and the ethics point the same way.

**Why freshness is last (0.12):** the hard gates G4.1/G4.2 already removed everything
stale. Past that bar, extra recency adds little, and weighting it heavily would churn the
board daily and destroy the URL stability the SEO strategy depends on
([12](12-growth-and-audience.md) §3).

**Why threshold 55, not higher:** below ~55 the board thins past the point where every
language has enough inventory to justify its landing page. If M0 shows the corpus is large
enough, raise it — quality per issue beats quantity, but *only after* every top-20 language
has ≥ 40 issues. That constraint is checked by assertion A10.

---

## 4. Denylist / allowlist

Two hand-maintained files in the repo, editable by PR (the one good idea borrowed from
Up For Grabs — see [02](02-competitive-landscape.md) §3):

- `config/denylist.yml` — repos never to list. Reasons: contribution playgrounds, known
  hostile maintainers, label farms, spam. **Every entry must carry a `reason:` field**;
  an unexplained denylist rots into superstition.
- `config/allowlist.yml` — repos to include even if they fail a *soft* gate (e.g. a
  beloved 20-star project). **Never overrides G1, G2, or G3.5** — takeability and
  licensing are not negotiable.

## 5. Feedback loop from `state/`

Because every build commits its output, we accumulate history for free. After ~30 days
this unlocks signals no competitor can copy without also waiting 30 days:

- **Time-on-board before disappearing** → empirical difficulty proxy. Issues that vanish
  within 48h were easy and attractive; issues sitting for 60 days are secretly hard.
- **Disappearance reason** (closed / assigned / PR opened) → validates that the board
  produces real contributions, and calibrates `CLAIM_TTL` for RQ3.
- **Maintainer response times measured directly** rather than sampled per build.

Log this from day one even though nothing consumes it yet. Historical data cannot be
back-filled, and it is the compounding part of the moat.
