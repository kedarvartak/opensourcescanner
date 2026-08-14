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

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0])
  if (path.endsWith('/')) path += 'index.html'
  const url = new URL('.' + path, DIST)

  try {
    const info = await stat(url)
    if (info.isDirectory()) throw new Error('dir')
    const body = await readFile(url)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<h1>404</h1><p><a href="/">home</a></p>')
  }
}).listen(PORT, () => {
  console.log(`\n  unclaimed.dev preview → http://localhost:${PORT}\n`)
})
