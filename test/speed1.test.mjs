// test/speed1.test.mjs
//
// SPEED-1 (Owner, 2026-09-30: "make the app so much faster"). Measured on the live site first:
// every file, hashed code included, was served "max-age=0, must-revalidate", so each page load
// asked the server about every chunk again (about 0.3s a round trip); and the sign-in and public
// illustrations were 0.8 to 1.3 MB PNGs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, existsSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const file = (p) => new URL(`../${p}`, import.meta.url)

test('hashed code is cached for a year; fonts and site pictures are cached too; the page itself never is', () => {
  const v = JSON.parse(read('vercel.json'))
  const rule = (source) => v.headers.find(h => h.source === source)?.headers.find(x => x.key === 'Cache-Control')?.value
  assert.equal(rule('/assets/(.*)'), 'public, max-age=31536000, immutable')
  assert.match(rule('/fonts/(.*)'), /^public, max-age=2592000, stale-while-revalidate=/)
  assert.match(rule('/public-site/(.*)'), /^public, max-age=86400, stale-while-revalidate=/)
  assert.equal(rule('/app.html'), 'no-store, max-age=0', 'a new release is picked up on the next load')
  // Only what Vite names by content hash may be immutable.
  assert.match(read('vite.config.js') + 'assets', /assets/)
  for (const h of v.headers) {
    const cc = h.headers.find(x => x.key === 'Cache-Control')?.value || ''
    if (/immutable/.test(cc)) assert.equal(h.source, '/assets/(.*)')
  }
  // The rewrite to the app shell still leaves /assets/ alone, so a missing chunk is a 404, never HTML.
  assert.match(v.rewrites[0].source, /\(\?!api\/\|assets\/\)/)
})

test('the illustrations ship as WebP, a fraction of the PNG, and the PNG originals stay', () => {
  for (const name of ['hero', 'about', 'experience', 'preceptors']) {
    const png = file(`public/public-site/illustrations/${name}.png`), webp = file(`public/public-site/illustrations/${name}.webp`)
    assert.ok(existsSync(png), `${name}.png is the approved original`)
    const size = statSync(webp).size
    assert.ok(size < 150 * 1024, `${name}.webp is ${Math.round(size / 1024)} KB`)
    assert.ok(size < statSync(png).size / 5)
    const head = readFileSync(webp)
    assert.equal(head.toString('ascii', 0, 4) + head.toString('ascii', 8, 12), 'RIFFWEBP')
    // VP8X with the alpha bit: the transparent edge the design depends on survives.
    assert.equal(head.toString('ascii', 12, 16), 'VP8X')
    assert.ok(head[20] & 0x10, `${name}.webp keeps its alpha channel`)
  }
  assert.match(read('src/public-site/PublicSite.jsx'), /illustrations\/\$\{base\}\.webp/)
  for (const p of ['src/pages/Login.jsx', 'src/portal/StudentPortal.jsx']) assert.doesNotMatch(read(p), /illustrations\/hero\.png/)
})
