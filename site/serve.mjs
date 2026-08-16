#!/usr/bin/env node
// Local preview server. Dev-only — production is a static host, so this exists
// purely so `npm run dev` shows you the real pages.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

const DIST = new URL('../dist/', import.meta.url)
const PORT = Number(process.env.PORT || 4321)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
}

/**
 * Resolve a request path the way a static host does, so the preview isn't
 * stricter than production: `/browse`, `/browse/` and `/browse/index.html` all
 * have to reach the same file, otherwise you chase 404s that don't exist live.
 */
async function resolve(path) {
  const candidates = path.endsWith('/')
    ? [path + 'index.html']
    : [path, path + '/index.html', path + '.html']

  for (const candidate of candidates) {
    const url = new URL('.' + candidate, DIST)
    try {
      if ((await stat(url)).isDirectory()) continue
      return { url, ext: extname(candidate) }
    } catch {}
  }
  return null
}

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0])
  const hit = await resolve(path)

  if (hit) {
    const body = await readFile(hit.url)
    res.writeHead(200, { 'content-type': TYPES[hit.ext] ?? 'application/octet-stream' })
    res.end(body)
  } else {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<h1>404</h1><p><a href="/">home</a></p>')
  }
}).listen(PORT, () => {
  console.log(`\n  Open Source Scanner preview → http://localhost:${PORT}\n`)
})
