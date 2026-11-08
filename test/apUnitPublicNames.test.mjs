// AP-UNIT-NAMES-1 (Owner, 2026-11-08): a school reads "Neuroscience ICU", not "8 SCCT". Every unit in
// the catalog carries a public name; the Academic Partner roster and its Insights card read it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNIT_CATALOG, unitPublicName } from '../src/lib/unitCatalog.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('every catalog unit has a public name with no internal code in it', () => {
  for (const u of UNIT_CATALOG) {
    assert.ok(u.publicName && u.publicName.trim(), `${u.name} has a public name`)
    assert.doesNotMatch(u.publicName, /\bSCCT\b|^\d+\s*(NE|NW|North|South)\b/, `${u.name}: ${u.publicName}`)
  }
})

test('unitPublicName maps a code and passes through anything it does not know', () => {
  assert.equal(unitPublicName('5 SCCT'), 'Surgical ICU')
  assert.equal(unitPublicName('8 SCCT'), 'Neuroscience ICU')
  assert.equal(unitPublicName('Some New Unit'), 'Some New Unit')
  assert.equal(unitPublicName(null), null)
})

test('the Academic Partner surfaces read the public name', () => {
  assert.match(read('src/portal/AcademicPartnerPortal.jsx'), /unitPublicName\(s\.unit_name\)/)
  assert.match(read('src/components/insights/insightsCards.jsx'), /label: unitPublicName\(u\.unit\)/)
})
