import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GitHubClient } from '../m0/lib/gh.mjs'

test('retries when response body stream is terminated', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  let calls = 0

  globalThis.setTimeout = (fn) => {
    fn()
    return 0
  }
  globalThis.fetch = async () => {
    calls++
    if (calls === 1) {
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => {
          throw new TypeError('terminated')
        },
      }
    }
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: { ping: 'ok' } }),
    }
  }

  try {
    const client = new GitHubClient('test-token')
    const data = await client.graphql('query { ping }', {}, { retries: 1 })
    assert.equal(data.ping, 'ok')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})
