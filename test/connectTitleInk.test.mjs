// test/connectTitleInk.test.mjs
//
// CONNECT-TITLE-INK-1 (2026-09-21): "ASPIRE Connect" was invisible in dark mode. Its ink
// read var(--text-primary), which no stylesheet defines, so it always fell back to
// #0E1428, near-black on the dark page. The title and its line sit on the page
// background, which follows the theme, so both must read theme tokens that theme.css
// defines in BOTH themes (see CLAUDE.md, "A colour pair travels together").

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const connect = read('src/pages/Connect.jsx')
const theme = read('src/styles/theme.css')

const header = connect.slice(connect.indexOf('<h1 style={{'), connect.indexOf('Contacts, outreach, and announcements across cohorts.'))

test('the Connect title and its line read theme tokens, not an undefined variable or a literal', () => {
  assert.match(header, /color: 'var\(--color-text-primary, #191919\)'/)
  assert.match(header, /color: 'var\(--color-text-secondary, #4A5560\)'/)
  assert.doesNotMatch(header, /--text-primary\b|#6b7280|#0E1428/)
})

test('both tokens exist in the light theme and are redefined for dark', () => {
  const dark = theme.slice(theme.indexOf(':root[data-theme="dark"]'))
  const light = theme.slice(0, theme.indexOf(':root[data-theme="dark"]'))
  for (const token of ['--color-text-primary', '--color-text-secondary']) {
    assert.match(light, new RegExp(`${token}:\\s*#`), `${token} is defined for light`)
    assert.match(dark, new RegExp(`${token}:\\s*#`), `${token} is redefined for dark`)
  }
})
