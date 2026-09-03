// TYPOGRAPHY-1: static-source guards for the self-hosted type contract - the
// face files ship with their OFL notices, the @font-face declarations match
// the two variable families, the stylesheet loads before anything else, the
// head preloads and never reaches Google Fonts, the functional token layers
// resolve through the two core brand tokens, and no client surface still
// names a retired family (DM Sans, Pangram Sans, Fraunces).
// Run: node --test test/typographyFonts.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const fonts = read('src/styles/fonts.css')
const indexCss = read('src/index.css')
const html = read('index.html')
const brand = read('src/styles/aspireBrand.css')

const FACES = [
  ['plus-jakarta-sans', 'PlusJakartaSans-Variable.woff2', 'Plus Jakarta Sans', '200 800', 'normal'],
  ['plus-jakarta-sans', 'PlusJakartaSans-Italic-Variable.woff2', 'Plus Jakarta Sans', '200 800', 'italic'],
  ['playfair-display', 'PlayfairDisplay-Variable.woff2', 'Playfair Display', '400 900', 'normal'],
  ['playfair-display', 'PlayfairDisplay-Italic-Variable.woff2', 'Playfair Display', '400 900', 'italic'],
]
const RETIRED = ['DM Sans', 'Pangram Sans', 'Fraunces']

test('the four variable faces exist, carry their OFL notice, and are declared with the documented ranges', () => {
  for (const [dir, file, family, weight, style] of FACES) {
    const p = join(root, 'public/fonts', dir, file)
    assert.ok(existsSync(p), `${file} missing from public/fonts/${dir}`)
    assert.ok(statSync(p).size > 20_000, `${file} looks truncated`)
    assert.ok(existsSync(join(root, 'public/fonts', dir, 'OFL.txt')), `${dir}/OFL.txt missing (the OFL requires the notice to travel with the files)`)
    const block = new RegExp(
      `@font-face \\{[^}]*font-family: '${family}';[^}]*url\\('/fonts/${dir}/${file.replace('.', '\\.')}'\\) format\\('woff2'\\);[^}]*font-weight: ${weight};[^}]*font-style: ${style};[^}]*font-display: swap;`
    )
    assert.match(fonts, block, `${file} @font-face block (${family} ${weight} ${style})`)
  }
  assert.equal((fonts.match(/@font-face/g) || []).length, FACES.length, 'exactly one block per shipped face')
})

test('fonts.css is the first import in index.css, ahead of the theme layer', () => {
  const fontsAt = indexCss.indexOf("@import './styles/fonts.css';")
  const themeAt = indexCss.indexOf("@import './styles/theme.css';")
  assert.ok(fontsAt >= 0 && themeAt > fontsAt)
})

test('index.html preloads the two upright variable files and never reaches Google Fonts', () => {
  assert.match(html, /<link rel="preload" href="\/fonts\/plus-jakarta-sans\/PlusJakartaSans-Variable\.woff2" as="font" type="font\/woff2" crossorigin>/)
  assert.match(html, /<link rel="preload" href="\/fonts\/playfair-display\/PlayfairDisplay-Variable\.woff2" as="font" type="font\/woff2" crossorigin>/)
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/)
})

test('the core brand tokens name the sans and the serif once, and the functional layers resolve through them', () => {
  assert.match(brand, /--aspire-sans: 'Plus Jakarta Sans', -apple-system/)
  assert.match(brand, /--aspire-serif: 'Playfair Display', Georgia/)
  assert.match(read('src/styles/chartTokens.css'), /--chart-sans: var\(--aspire-sans/)
  assert.match(read('src/styles/chartTokens.css'), /--chart-serif: var\(--aspire-serif/)
  assert.match(read('src/public-site/publicSite.css'), /--ps-sans: var\(--aspire-sans/)
  assert.match(read('src/public-site/publicSite.css'), /--ps-serif: var\(--aspire-serif/)
  assert.match(read('src/portal/portal.css'), /--ptl-serif: var\(--aspire-serif/)
})

test('no client surface still names a retired family (email templates under lib/ and api/ are intentionally exempt)', () => {
  const offenders = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      // Finder-style numbered duplicates are untracked scratch; skip them.
      if (/ \d+\.[a-z]+$/.test(name)) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(css|jsx?|html)$/.test(name)) continue
      const text = readFileSync(p, 'utf8')
      for (const family of RETIRED) if (text.includes(family)) offenders.push(`${p.slice(root.length + 1)}: ${family}`)
    }
  }
  walk(join(root, 'src'))
  assert.deepEqual(offenders, [])
})
