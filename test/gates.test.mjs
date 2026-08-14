// Gate tests. node:test is built in — still zero dependencies.
//   node --test test/
//
// These fixtures are the adversarial cases: the ones that LOOK fine and aren't.
// Every one of them corresponds to a bug found in real data.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  G1_structural, G2_takeability, G3_repoViability, G4_relevance,
  G5_actionability, G6_antiFarming, softClaim, validate, cleanBody,
  annotateTemplateFarms, titleSkeleton,
} from '../m0/lib/gates.mjs'

const NOW = Date.parse('2026-08-15T00:00:00Z')
const daysAgo = (d) => new Date(NOW - d * 86400_000).toISOString()

/** A minimal issue that passes every gate; tests override one field at a time. */
const good = (over = {}) => ({
  __typename: 'Issue',
  number: 42,
  title: 'Fix off-by-one in pagination cursor when limit exceeds page size',
  bodyText:
    'The cursor calculation in lib/paginate.ts:88 assumes the limit is always ' +
    'smaller than the page size. When it is larger we skip a record. Steps to ' +
    'reproduce: call paginate with limit=200 and pageSize=100, observe the gap ' +
    'between page one and page two in the returned ids.',
  locked: false,
  createdAt: daysAgo(30),
  updatedAt: daysAgo(3),
  author: { login: 'a-human', __typename: 'User' },
  assignees: { totalCount: 0 },
  labels: { nodes: [{ name: 'good first issue' }] },
  reactions: { totalCount: 2 },
  comments: { totalCount: 1, nodes: [] },
  timelineItems: { nodes: [] },
  repository: {
    nameWithOwner: 'acme/widget',
    stargazerCount: 900,
    isArchived: false,
    isMirror: false,
    isFork: false,
    isDisabled: false,
    hasIssuesEnabled: true,
    pushedAt: daysAgo(2),
    primaryLanguage: { name: 'TypeScript' },
    licenseInfo: { spdxId: 'MIT' },
    recentAuthors: 5,
    openIssues: { totalCount: 200 },
    beginnerLabelRatio: 0.02,
  },
  ...over,
})

test('baseline fixture passes every gate', () => {
  assert.equal(validate(good(), NOW).ok, true)
})

// ─── G2: takeability, the differentiator ────────────────────────────────────

test('G2 rejects an issue with an open linked PR', () => {
  const issue = good({
    timelineItems: {
      nodes: [{ __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 9, state: 'OPEN', author: { login: 'someone' } } }],
    },
  })
  const r = G2_takeability(issue, NOW)
  assert.equal(r.ok, false)
  assert.match(r.reason, /open linked PR/)
})

test('G2 rejects a DRAFT open PR too — a draft still means someone is on it', () => {
  const issue = good({
    timelineItems: {
      nodes: [{ __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 9, state: 'OPEN', isDraft: true, author: { login: 'x' } } }],
    },
  })
  assert.equal(G2_takeability(issue, NOW).ok, false)
})

test('G2 ignores a CLOSED linked PR — someone tried and gave up, so it is free', () => {
  const issue = good({
    timelineItems: {
      nodes: [{ __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 9, state: 'CLOSED', author: { login: 'x' } } }],
    },
  })
  assert.equal(G2_takeability(issue, NOW).ok, true)
})

test('G2 rejects a fresh soft claim from a non-maintainer', () => {
  const issue = good({
    comments: {
      totalCount: 1,
      nodes: [{ bodyText: "Hi! I'd like to work on this, can I take it?", createdAt: daysAgo(3), authorAssociation: 'NONE', author: { login: 'newbie' } }],
    },
  })
  assert.equal(G2_takeability(issue, NOW).ok, false)
})

test('a soft claim EXPIRES after the TTL — abandoned claims free the issue again', () => {
  const issue = good({
    comments: {
      totalCount: 1,
      nodes: [{ bodyText: "I'll take this one", createdAt: daysAgo(60), authorAssociation: 'NONE', author: { login: 'ghosted' } }],
    },
  })
  assert.equal(softClaim(issue, NOW), null)
  assert.equal(G2_takeability(issue, NOW).ok, true)
})

test('a maintainer saying "I am working on this" is not an outsider claim', () => {
  const issue = good({
    comments: {
      totalCount: 1,
      nodes: [{ bodyText: "I'm working on this", createdAt: daysAgo(1), authorAssociation: 'MEMBER', author: { login: 'maintainer' } }],
    },
  })
  assert.equal(softClaim(issue, NOW), null)
})

// ─── G3: repo viability ─────────────────────────────────────────────────────

test('G3 rejects an unlicensed repo — not legally contributable', () => {
  const r = G3_repoViability(good({ repository: { ...good().repository, licenseInfo: null } }), NOW)
  assert.equal(r.ok, false)
  assert.match(r.reason, /no license/)
})

test('G3 rejects a single-committer repo', () => {
  const r = G3_repoViability(good({ repository: { ...good().repository, recentAuthors: 1 } }), NOW)
  assert.equal(r.ok, false)
})

test('G3 tolerates missing commit data rather than rejecting on absence', () => {
  const repo = { ...good().repository }
  delete repo.recentAuthors
  assert.equal(G3_repoViability(good({ repository: repo }), NOW).ok, true)
})

// ─── G4: relevance ──────────────────────────────────────────────────────────

test('G4 rejects an umbrella issue marked only in the TITLE', () => {
  // Regression: "[META] Adding subfeatures to audits" reached the live board
  // because the checkbox test found no checkboxes.
  const r = G4_relevance(good({ title: '[META] Adding subfeatures to audits' }), NOW)
  assert.equal(r.ok, false)
  assert.match(r.reason, /umbrella/)
})

test('G4 rejects an umbrella issue by checkbox count', () => {
  const body = Array.from({ length: 9 }, (_, i) => `- [ ] task ${i}`).join('\n')
  assert.equal(G4_relevance(good({ bodyText: body + '\n'.repeat(3) + 'x'.repeat(200) }), NOW).ok, false)
})

test('G4 allows a short checklist — that is acceptance criteria, not an epic', () => {
  const body = 'Fix the thing.\n- [ ] update parser\n- [ ] add test\n' + 'x'.repeat(200)
  assert.equal(G4_relevance(good({ bodyText: body }), NOW).ok, true)
})

// ─── G5: actionability ──────────────────────────────────────────────────────

test('G5 rejects a body that is thin once markdown is stripped', () => {
  const issue = good({ bodyText: '```\n' + 'x'.repeat(5000) + '\n```\nfix pls' })
  assert.equal(G5_actionability(issue).ok, false)
})

test('cleanBody strips fences, images, links and HTML comments', () => {
  const out = cleanBody('<!-- hi -->text ```code``` ![img](u) https://example.com more')
  assert.equal(out.includes('code'), false)
  assert.equal(out.includes('example.com'), false)
  assert.match(out, /text/)
})

// ─── G6: anti-farming ───────────────────────────────────────────────────────

test('G6 rejects a repo labelling most of its backlog beginner-friendly', () => {
  const repo = { ...good().repository, beginnerLabelRatio: 0.8, openIssues: { totalCount: 50 } }
  const r = G6_antiFarming(good({ repository: repo }))
  assert.equal(r.ok, false)
  assert.match(r.reason, /farming/)
})

test('G6 rejects contribution playgrounds by name', () => {
  const repo = { ...good().repository, nameWithOwner: 'someone/first-contributions' }
  assert.equal(G6_antiFarming(good({ repository: repo })).ok, false)
})

test('G6 does not punish a small repo with a high ratio but few issues', () => {
  const repo = { ...good().repository, beginnerLabelRatio: 0.9, openIssues: { totalCount: 4 } }
  assert.equal(G6_antiFarming(good({ repository: repo })).ok, true)
})

test('template farms are detected across a repo and rejected', () => {
  // Regression: lingdojo/kana-dojo shipped 93 issues titled "[Good First
  // Issue] <emoji> Add new <Thing> <N> - Beginner-Friendly Open-source
  // Contribution", body promising a contribution "in under 60 seconds" with no
  // code. Every one passed every other gate and reached the live board.
  const things = ['Trivia Question', 'Grammar Point', 'Japanese Proverb', 'Japan Fact', 'Anime Quote', 'Video Game Quote']
  const farmed = things.map((thing, n) =>
    good({
      number: 100 + n,
      title: `[Good First Issue] 🍣 Add new ${thing} ${n * 7} - Beginner-Friendly Open-source Contribution`,
      repository: { ...good().repository, nameWithOwner: 'farm/kana' },
    })
  )
  const honest = good({ repository: { ...good().repository, nameWithOwner: 'acme/widget' } })

  const farms = annotateTemplateFarms([...farmed, honest])

  assert.equal(farms.has('farm/kana'), true)
  assert.equal(farms.has('acme/widget'), false)
  assert.equal(G6_antiFarming(farmed[0]).ok, false)
  assert.match(G6_antiFarming(farmed[0]).reason, /template-farmed/)
  assert.equal(G6_antiFarming(honest).ok, true)
})

test('titleSkeleton collapses generated titles but keeps distinct ones apart', () => {
  const a = titleSkeleton('[Good First Issue] 🍣 Add new Trivia Question 42 - Beginner-Friendly Open-source Contribution')
  const b = titleSkeleton('[Good First Issue] 🎐 Add new Japan Fact 117 - Beginner-Friendly Open-source Contribution')
  const c = titleSkeleton('Fix off-by-one in pagination cursor when limit exceeds page size')
  assert.equal(a, b)
  assert.notEqual(a, c)
})

// ─── G1 ─────────────────────────────────────────────────────────────────────

test('G1 rejects bot-authored issues', () => {
  assert.equal(G1_structural(good({ author: { login: 'dependabot[bot]', __typename: 'Bot' } })).ok, false)
})

test('G1 rejects pull requests masquerading as issues in search results', () => {
  assert.equal(G1_structural(good({ __typename: 'PullRequest' })).ok, false)
})
