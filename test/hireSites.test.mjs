import { test } from 'node:test'
import assert from 'node:assert/strict'

// HIRE-SITE-1 + HIRE-GNT-LICENSE-1 (Owner, 2026-11-07).
test('the hire picker offers Cedars-Sinai sites and GNT answers unlicensed', async () => {
  const { readFileSync } = await import('node:fs')
  const { HIRE_SITES, HIRED_AS_UNLICENSED, HIRED_AS } = await import('../src/lib/ngrp/ngrpResidents.js')
  assert.deepEqual([...HIRE_SITES], ['Marina del Rey Hospital', 'Cedars-Sinai Health System'])
  assert.ok(HIRED_AS.includes(HIRED_AS_UNLICENSED))
  const drawer = readFileSync('src/components/ngrp/ApplicantDrawer.jsx', 'utf8')
  assert.match(drawer, /<optgroup label="Elsewhere in Cedars-Sinai">/)
  assert.match(drawer, /\[\.\.\.getCanonicalUnitNames\(\), \.\.\.HIRE_SITES\]/)
  assert.match(drawer, /if \(e\.target\.value === HIRED_AS_UNLICENSED\) set\('licensed_at_application', 'no'\)/)
  assert.match(drawer, />Hired into</)
})
