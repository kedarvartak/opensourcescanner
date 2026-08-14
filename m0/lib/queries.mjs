// GraphQL documents for the M0 spike. See docs/07 §3.

/**
 * One request per 100 issues, carrying everything the hard gates need.
 * `rateLimit` is requested on every query so cost is measured, not assumed (docs/03 §2).
 */
// GitHub enforces an undocumented per-query resource limit well below the
// 500,000-node ceiling. 100 issues × (20 timeline + 20 labels + 10 comment
// bodies) trips it. 40 issues with trimmed connections is measured-safe, and the
// client halves this automatically on RESOURCE_LIMIT.
export const PAGE_SIZE = 40

export const SEARCH_ISSUES = /* GraphQL */ `
  query SearchIssues($q: String!, $after: String, $first: Int!) {
    rateLimit { cost remaining resetAt }
    search(query: $q, type: ISSUE, first: $first, after: $after) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        ... on Issue {
          id
          databaseId
          number
          title
          bodyText
          url
          locked
          createdAt
          updatedAt
          author { login __typename }
          assignees { totalCount }
          labels(first: 15) { nodes { name } }
          reactions { totalCount }
          comments(last: 6) {
            totalCount
            nodes {
              bodyText
              createdAt
              authorAssociation
              author { login }
            }
          }
          timelineItems(
            last: 12
            itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT, ASSIGNED_EVENT]
          ) {
            nodes {
              __typename
              ... on CrossReferencedEvent {
                source {
                  __typename
                  ... on PullRequest {
                    number
                    state
                    isDraft
                    author { login }
                  }
                }
              }
              ... on ConnectedEvent {
                subject {
                  __typename
                  ... on PullRequest { number state isDraft }
                }
              }
            }
          }
          repository {
            nameWithOwner
            stargazerCount
            isArchived
            isMirror
            isFork
            isDisabled
            hasIssuesEnabled
            pushedAt
            diskUsage
            primaryLanguage { name }
            licenseInfo { spdxId }
          }
        }
      }
    }
  }
`

/**
 * Probe a shard's size without paying to page through it.
 * Used by the bisecting sharder to stay under the 1,000-result cap (docs/07 §2).
 */
export const COUNT_ISSUES = /* GraphQL */ `
  query CountIssues($q: String!) {
    rateLimit { cost remaining resetAt }
    search(query: $q, type: ISSUE, first: 1) { issueCount }
  }
`

/**
 * Repo-level enrichment, batched via aliases (~20 repos/request).
 * Deduped across issues first — ~5,000 issues live in ~800 repos, so this is a
 * 6x saving over fetching repo data per issue.
 */
export function repoBatchQuery(repos) {
  const fields = /* GraphQL */ `
    nameWithOwner
    stargazerCount
    isArchived
    isMirror
    isFork
    isDisabled
    hasIssuesEnabled
    pushedAt
    diskUsage
    createdAt
    primaryLanguage { name }
    licenseInfo { spdxId }
    repositoryTopics(first: 10) { nodes { topic { name } } }
    contributing: object(expression: "HEAD:CONTRIBUTING.md") { __typename }
    contributingDocs: object(expression: "HEAD:.github/CONTRIBUTING.md") { __typename }
    readme: object(expression: "HEAD:README.md") { ... on Blob { byteSize text } }
    openIssues: issues(states: OPEN) { totalCount }
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 30, since: $since) {
            totalCount
            nodes { author { user { login } email } }
          }
        }
      }
    }
  `
  // 30 commits is plenty to answer "≥ 2 distinct authors in 90 days" (G3.6) and
  // keeps the aliased batch inside GitHub's per-query resource limit.
  const aliases = repos
    .map(
      (nameWithOwner, i) => {
        const [owner, name] = nameWithOwner.split('/')
        return `  r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} }`
      }
    )
    .join('\n')

  return /* GraphQL */ `
    query RepoBatch($since: GitTimestamp!) {
      rateLimit { cost remaining resetAt }
${aliases}
    }
  `
}

/**
 * Count how many of a repo's open issues carry a beginner label.
 * Feeds G6.1 (anti label-farming): legitimate projects label a minority of the backlog.
 */
export function labelRatioQuery(repos, labelQueryFragment) {
  const aliases = repos
    .map((nameWithOwner, i) => {
      const q = `repo:${nameWithOwner} is:issue is:open ${labelQueryFragment}`
      return `  c${i}: search(query: ${JSON.stringify(q)}, type: ISSUE, first: 1) { issueCount }`
    })
    .join('\n')

  return /* GraphQL */ `
    query LabelRatio {
      rateLimit { cost remaining resetAt }
${aliases}
    }
  `
}
