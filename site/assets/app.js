// Progressive enhancement only.
//
// Every card is already in the HTML at build time (that's the SEO strategy —
// docs/12 §2). This script filters what's already there. With JS disabled the
// page is a complete, working list of issues; nothing here is load-bearing.

(function () {
  'use strict'

  const board = document.getElementById('board')
  if (!board) return

  const cards = Array.from(board.children)
  const $ = (id) => document.getElementById(id)
  const controls = {
    q: $('f-search'),
    lang: $('f-lang'),
    type: $('f-type'),
    sort: $('f-sort'),
    quiet: $('f-quiet'),
    responsive: $('f-responsive'),
  }
  const countEl = $('result-count')
  if (!Object.values(controls).some(Boolean)) return

  // ── URL state: every view is linkable and shareable (docs/08 §3) ─────────
  function readURL() {
    const p = new URLSearchParams(location.search)
    for (const [key, el] of Object.entries(controls)) {
      if (!el) continue
      const v = p.get(key)
      if (v == null) continue
      if (el.type === 'checkbox') el.checked = v === '1'
      else el.value = v
    }
  }

  function writeURL() {
    const p = new URLSearchParams()
    for (const [key, el] of Object.entries(controls)) {
      if (!el) continue
      const v = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value
      if (v) p.set(key, v)
    }
    const qs = p.toString()
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
  }

  function apply() {
    const q = (controls.q?.value || '').trim().toLowerCase()
    const lang = controls.lang?.value || ''
    const type = controls.type?.value || ''
    const quiet = controls.quiet?.checked
    const responsive = controls.responsive?.checked

    let shown = 0
    for (const li of cards) {
      const card = li.querySelector('.card') || li
      const d = card.dataset
      let ok = true
      if (lang && d.lang !== lang) ok = false
      if (ok && type && d.type !== type) ok = false
      if (ok && quiet && Number(d.comments) > 2) ok = false
      if (ok && responsive) {
        const r = d.resp === '' ? Infinity : Number(d.resp)
        if (!(r <= 168)) ok = false // replies within a week
      }
      if (ok && q && !d.text.includes(q)) ok = false
      li.hidden = !ok
      if (ok) shown++
    }

    if (countEl) {
      countEl.textContent = shown === cards.length
        ? `${cards.length} issues`
        : `${shown} of ${cards.length} issues`
    }

    let empty = document.getElementById('no-results')
    if (!shown && !empty) {
      empty = document.createElement('div')
      empty.id = 'no-results'
      empty.className = 'empty'
      empty.innerHTML = '<p>No issues match those filters.</p>'
      board.after(empty)
    } else if (shown && empty) {
      empty.remove()
    }

    sort()
    writeURL()
  }

  function sort() {
    const mode = controls.sort?.value
    if (!mode) return
    const visible = cards.filter((li) => !li.hidden)
    const key = {
      score: (li) => -num(li, 'score'),
      newest: (li) => -num(li, 'score'), // placeholder; server pre-sorts by score
      stars: (li) => -num(li, 'stars'),
      quiet: (li) => num(li, 'comments'),
    }[mode]
    if (!key) return
    visible.sort((a, b) => key(a) - key(b)).forEach((li) => board.appendChild(li))
  }

  const num = (li, k) => Number((li.querySelector('.card') || li).dataset[k] || 0)

  let t
  for (const el of Object.values(controls)) {
    if (!el) continue
    const ev = el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change'
    el.addEventListener(ev, () => {
      clearTimeout(t)
      t = setTimeout(apply, ev === 'input' ? 120 : 0)
    })
  }

  readURL()
  apply()

  // ── Keyboard nav: this audience expects it ───────────────────────────────
  let cursor = -1
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      if (e.key === 'Escape') e.target.blur()
      return
    }
    const visible = cards.filter((li) => !li.hidden)
    if (!visible.length) return

    if (e.key === 'j' || e.key === 'k') {
      cursor += e.key === 'j' ? 1 : -1
      cursor = Math.max(0, Math.min(visible.length - 1, cursor))
      const el = visible[cursor]
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.querySelector('h3 a')?.focus()
      e.preventDefault()
    } else if (e.key === '/') {
      controls.q?.focus()
      e.preventDefault()
    }
  })
})()

// ── Saved list, localStorage only, re-validated on every load ──────────────
// A saved issue can be claimed by someone else tomorrow. A stale saved list is
// exactly the bug this site exists to eliminate, so entries are always checked
// against the fresh dataset rather than trusted (docs/08 §8).
window.unclaimed = {
  key: 'unclaimed:saved',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]') } catch { return [] }
  },
  save(list) {
    try { localStorage.setItem(this.key, JSON.stringify(list.slice(0, 200))) } catch {}
  },
  toggle(id) {
    const list = this.read()
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
    else list.push(id)
    this.save(list)
    return i < 0
  },
}
