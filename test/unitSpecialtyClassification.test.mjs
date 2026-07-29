// Unit specialty classification: 6 NE and 6 NW belong to the Critical Care Division.
//
// Guards the correction against regression. Functional tests assert the code catalogs (unitCatalog +
// constants) classify both units as Critical Care while preserving their PCU / Medical-Surgical /
// transplant / trauma / thoracic descriptors and leaving unrelated units and compatibility areas
// unchanged. Source guards assert the Owner-gated DB migration is a safe, idempotent, division-only
// correction (no row creation, stable ids, no scope/RLS change) and that the source doc exists.
//
// Run: node --test test/unitSpecialtyClassification.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getUnit, getUnitsByDivision, UNIT_CATALOG } from '../src/lib/unitCatalog.js'
import { UNIT_DIVISION_MAP, UNITS_BY_DIVISION, PATIENT_POPULATION_MAP, UNIT_AREAS } from '../src/lib/constants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const migration = read('supabase/migrations/20260731020000_correct_6ne_6nw_critical_care_division.sql')
const doc = read('docs/product/UNIT_SPECIALTY_CLASSIFICATION.md')

// ─── Primary classification (1, 2, 9) ───────────────────────────────────────────

test('6 NE primary division is Critical Care in both catalogs', () => {
  assert.equal(getUnit('6 NE').division, 'Critical Care')
  assert.equal(UNIT_DIVISION_MAP['6 NE'], 'Critical Care')
})

test('6 NW primary division is Critical Care in both catalogs', () => {
  assert.equal(getUnit('6 NW').division, 'Critical Care')
  assert.equal(UNIT_DIVISION_MAP['6 NW'], 'Critical Care')
})

test('the two conflicting sources now agree for 6 NE / 6 NW', () => {
  for (const name of ['6 NE', '6 NW']) {
    assert.equal(getUnit(name).division, UNIT_DIVISION_MAP[name])
  }
})

// ─── Not Medical (3, 10) ────────────────────────────────────────────────────────

test('neither unit is grouped under Medical', () => {
  const grouped = getUnitsByDivision(true)
  const medical = (grouped['Medical'] || []).map(u => u.name)
  const critical = (grouped['Critical Care'] || []).map(u => u.name)
  assert.ok(!medical.includes('6 NE') && !medical.includes('6 NW'), '6 NE / 6 NW must not be in Medical')
  assert.ok(critical.includes('6 NE') && critical.includes('6 NW'), '6 NE / 6 NW must be in Critical Care')
  // Canonical constants list agrees.
  assert.ok(UNITS_BY_DIVISION['Critical Care'].includes('6 NE'))
  assert.ok(UNITS_BY_DIVISION['Critical Care'].includes('6 NW'))
  assert.ok(!UNITS_BY_DIVISION['Medical'].includes('6 NE'))
  assert.ok(!UNITS_BY_DIVISION['Medical'].includes('6 NW'))
  assert.notEqual(UNIT_DIVISION_MAP['6 NE'], 'Medical')
  assert.notEqual(UNIT_DIVISION_MAP['6 NW'], 'Medical')
})

// ─── Descriptors preserved (4, 5, 12) ───────────────────────────────────────────

test('6 NE retains PCU, transplant, and mechanical-support descriptors', () => {
  const desc = getUnit('6 NE').description
  for (const t of ['PCU', 'Heart Transplant', 'Lung Transplant', 'Mechanical Circulatory Support']) {
    assert.match(desc, new RegExp(t))
  }
  assert.match(PATIENT_POPULATION_MAP['6 NE'], /PCU/)
  assert.match(PATIENT_POPULATION_MAP['6 NE'], /Heart Transplant/)
})

test('6 NW retains PCU, Medical-Surgical, transplant, trauma, and thoracic descriptors', () => {
  const desc = getUnit('6 NW').description
  for (const t of ['PCU', 'Medical-Surgical', 'Transplant', 'Trauma', 'Thoracic']) {
    assert.match(desc, new RegExp(t))
  }
  assert.match(PATIENT_POPULATION_MAP['6 NW'], /PCU/)
  assert.match(PATIENT_POPULATION_MAP['6 NW'], /Trauma/)
})

test('same-area compatibility (Medical-Surgical) is preserved so matching does not regress', () => {
  assert.equal(UNIT_AREAS['6 NE'], 'Medical-Surgical')
  assert.equal(UNIT_AREAS['6 NW'], 'Medical-Surgical')
})

// ─── No duplicates / unrelated unchanged (6, 13) ────────────────────────────────

test('no duplicate catalog records for 6 NE / 6 NW', () => {
  assert.equal(UNIT_CATALOG.filter(u => u.name === '6 NE').length, 1)
  assert.equal(UNIT_CATALOG.filter(u => u.name === '6 NW').length, 1)
})

test('unrelated units keep their divisions', () => {
  assert.equal(getUnit('5 South').division, 'Medical')
  assert.equal(getUnit('6 South').division, 'Medical')
  assert.equal(getUnit('3 SCCT').division, 'Critical Care')
  assert.equal(getUnit('7 North').division, 'Surgical')
  assert.equal(UNIT_DIVISION_MAP['5 SE / 5 SW'], 'Medical')
})

// ─── Aliases (14) ───────────────────────────────────────────────────────────────

test('spaced and compact aliases resolve to Critical Care', () => {
  assert.equal(UNIT_DIVISION_MAP['6NE'], 'Critical Care')
  assert.equal(UNIT_DIVISION_MAP['6NW'], 'Critical Care')
  assert.equal(UNIT_DIVISION_MAP['6 NE'], 'Critical Care')
  assert.equal(UNIT_DIVISION_MAP['6 NW'], 'Critical Care')
})

// ─── Owner-gated migration safety (7, 8, 11) ────────────────────────────────────

test('migration corrects only the division field for the exact target names', () => {
  assert.match(migration, /SET division = 'Critical Care'/)
  assert.match(migration, /unit_name IN \('6 NE', '6 NW', '6NE', '6NW'\)/)
  assert.match(migration, /IS DISTINCT FROM 'Critical Care'/)      // idempotent, no-op when already correct
  // Data-only: no row creation/deletion, no id mutation, exact-name matching (no LIKE/free-text).
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.units/i)
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.units/i)
  assert.doesNotMatch(migration, /\bSET\s+id\s*=|,\s*id\s*=/i)   // id is never an assignment target
  assert.doesNotMatch(migration, /unit_name\s+LIKE/i)
})

test('migration preflights, fails closed on zero rows, and documents rollback', () => {
  assert.match(migration, /RAISE EXCEPTION/)
  assert.match(migration, /preflight/i)
  assert.match(migration, /Rollback/i)
})

test('migration changes no authorization/scope/RLS/grants (division only)', () => {
  // Assert against real DDL/DML statements (not the descriptive safety comments).
  assert.doesNotMatch(migration, /CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY/i)
  assert.doesNotMatch(migration, /\bGRANT\s+\w+\s+ON\b|\bREVOKE\s+\w+\s+ON\b/i)
  assert.doesNotMatch(migration, /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.user_unit_scopes/i)
  // The only column written is division.
  assert.doesNotMatch(migration, /SET\s+(patient_population|cohort_id|slots_remaining|total_slots|is_participating)/i)
})

// ─── Source documentation (15) ──────────────────────────────────────────────────

test('source-of-truth documentation is present and complete', () => {
  assert.match(doc, /6\s*NE/)
  assert.match(doc, /6\s*NW/)
  assert.match(doc, /Critical Care/)
  assert.match(doc, /Unit Specialty Resource Chart\.pdf.*page 3|page 3/)
  assert.match(doc, /December 1, 2022|2022-12-01/)
  assert.match(doc, /Medical-Surgical/)   // 6NW mixed population note preserved
})
