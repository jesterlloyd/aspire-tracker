// test/preceptorUnitOptions.test.mjs
//
// PRECEPTOR-UNIT-DROPDOWN-1.
//
// The defect: `units` is cohort-scoped, so the same physical unit exists once
// per cohort. PreceptorFormModal ignored its cohortId and queried the whole
// table, listing PACU once per cohort with no way to tell the entries apart.
//
// Every fixture below therefore uses TWO cohorts containing identically named
// units - the exact shape that produced the duplicates.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  canonicalUnitName, cohortUnits, buildUnitOptions, optionLabel,
  resolveUnitName, duplicateNamesWithinCohort, LEGACY_OPTION_SUFFIX,
} from '../src/lib/preceptorUnitOptions.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const FALL = 'cohort-fall'
const SPRING = 'cohort-spring'

// The same three physical units, duplicated across two cohorts.
const UNITS = [
  { id: 'f-pacu', unit_name: 'PACU',  cohort_id: FALL },
  { id: 'f-6ne',  unit_name: '6 NE',  cohort_id: FALL },
  { id: 'f-icu',  unit_name: 'ICU',   cohort_id: FALL },
  { id: 's-pacu', unit_name: 'PACU',  cohort_id: SPRING },
  { id: 's-6ne',  unit_name: '6 NE',  cohort_id: SPRING },
  { id: 's-icu',  unit_name: 'ICU',   cohort_id: SPRING },
]

const names = opts => opts.map(o => o.unit_name)
const ids = opts => opts.map(o => o.id)

// ── The duplicate itself ────────────────────────────────────────────────────

test('each active-cohort unit appears exactly once', () => {
  const fall = cohortUnits(UNITS, FALL)
  assert.deepEqual(ids(fall), ['f-6ne', 'f-icu', 'f-pacu'])
  assert.equal(fall.length, 3, 'three units, not six')
  // No name appears twice.
  assert.equal(new Set(names(fall)).size, fall.length)
  // And nothing from the other cohort leaked in.
  assert.ok(fall.every(u => u.cohort_id === FALL))
})

test('the option list is alphabetical by unit name', () => {
  assert.deepEqual(names(cohortUnits(UNITS, FALL)), ['6 NE', 'ICU', 'PACU'])
  // Sorting is case-insensitive and independent of input order.
  const messy = [
    { id: 'a', unit_name: 'pacu', cohort_id: FALL },
    { id: 'b', unit_name: 'ICU', cohort_id: FALL },
    { id: 'c', unit_name: '6 NE', cohort_id: FALL },
  ]
  assert.deepEqual(names(cohortUnits(messy, FALL)), ['6 NE', 'ICU', 'pacu'])
})

test('switching cohorts swaps the whole list, never blending the two', () => {
  const fall = cohortUnits(UNITS, FALL)
  const spring = cohortUnits(UNITS, SPRING)
  assert.deepEqual(names(fall), names(spring), 'same unit names in both')
  assert.deepEqual(ids(spring), ['s-6ne', 's-icu', 's-pacu'])
  // No id is shared, so the selected value genuinely changes cohort.
  assert.equal(ids(fall).filter(id => ids(spring).includes(id)).length, 0)
})

test('a units prop lagging a cohort switch cannot show the previous cohort', () => {
  // The prop still holds Fall rows while cohortId has already moved to Spring.
  const stale = cohortUnits(UNITS.filter(u => u.cohort_id === FALL), SPRING)
  assert.deepEqual(stale, [], 'nothing is rendered rather than the old cohort')
})

test('an already-scoped list without cohort_id is still accepted', () => {
  const scoped = [{ id: 'x', unit_name: 'PACU' }, { id: 'y', unit_name: '6 NE' }]
  assert.deepEqual(names(cohortUnits(scoped, FALL)), ['6 NE', 'PACU'])
})

// ── Adding ─────────────────────────────────────────────────────────────────

test('the Add form offers only the active cohort, with nothing preselected', () => {
  const { options, selectedId, resolution } = buildUnitOptions(UNITS, FALL, {})
  assert.deepEqual(ids(options), ['f-6ne', 'f-icu', 'f-pacu'])
  assert.equal(selectedId, '')
  assert.equal(resolution, 'none')
  assert.equal(options.filter(o => o.__legacy).length, 0, 'no legacy entry when adding')
})

test('Add saves the id and name of the chosen current-cohort unit', () => {
  const { options } = buildUnitOptions(UNITS, FALL, {})
  assert.equal(resolveUnitName(options, 'f-pacu'), 'PACU')
  assert.equal(resolveUnitName(options, ''), null, 'no unit selected saves null')
})

// ── Editing ────────────────────────────────────────────────────────────────

test('editing a preceptor already on a current-cohort unit selects it exactly', () => {
  const { selectedId, resolution, options } = buildUnitOptions(UNITS, FALL, {
    unit_id: 'f-icu', unit_name: 'ICU',
  })
  assert.equal(selectedId, 'f-icu')
  assert.equal(resolution, 'exact')
  assert.equal(options.length, 3, 'no extra entry is added')
  assert.equal(resolveUnitName(options, selectedId), 'ICU')
})

test("a preceptor stored against an older cohort resolves to this cohort's equivalent", () => {
  // Stored on Spring's PACU while Fall is active.
  const { selectedId, resolution, options } = buildUnitOptions(UNITS, FALL, {
    unit_id: 's-pacu', unit_name: 'PACU',
  })
  assert.equal(selectedId, 'f-pacu', "remapped to Fall's PACU by canonical name")
  assert.equal(resolution, 'remapped')
  assert.equal(options.length, 3, 'no legacy entry needed - a real equivalent exists')
  assert.equal(resolveUnitName(options, selectedId), 'PACU')
})

test('remapping ignores case and spacing differences in the stored name', () => {
  const { selectedId, resolution } = buildUnitOptions(UNITS, FALL, {
    unit_id: 'old-x', unit_name: '  pacu  ',
  })
  assert.equal(selectedId, 'f-pacu')
  assert.equal(resolution, 'remapped')
  assert.equal(canonicalUnitName(' PACU  '), 'pacu')
  assert.equal(canonicalUnitName('6   NE'), '6 ne')
})

test('a stored unit with no equivalent is preserved and clearly identified', () => {
  const { selectedId, resolution, options } = buildUnitOptions(UNITS, FALL, {
    unit_id: 'retired-1', unit_name: 'Old Tower 3',
  })
  assert.equal(selectedId, 'retired-1', 'the stored value stays selected')
  assert.equal(resolution, 'legacy')
  const legacy = options.find(o => o.id === 'retired-1')
  assert.ok(legacy?.__legacy)
  assert.equal(optionLabel(legacy), `Old Tower 3${LEGACY_OPTION_SUFFIX}`)
  // Saving another field must not clear or change the unit.
  assert.equal(resolveUnitName(options, selectedId), 'Old Tower 3',
    'the name is preserved, NOT written as null')
  // The current cohort's own units are still offered alongside it.
  assert.deepEqual(ids(options).slice(0, 3), ['f-6ne', 'f-icu', 'f-pacu'])
})

test('a stored unit whose name is duplicated in this cohort is never guessed', () => {
  // A within-cohort duplicate: two Fall rows both named PACU.
  const dupes = [...UNITS, { id: 'f-pacu-2', unit_name: 'PACU', cohort_id: FALL }]
  const { selectedId, resolution, options } = buildUnitOptions(dupes, FALL, {
    unit_id: 's-pacu', unit_name: 'PACU',
  })
  assert.equal(resolution, 'ambiguous')
  assert.equal(selectedId, 's-pacu', 'the stored value is kept as saved')
  assert.notEqual(selectedId, 'f-pacu')
  assert.notEqual(selectedId, 'f-pacu-2', 'neither duplicate is arbitrarily chosen')
  assert.equal(resolveUnitName(options, selectedId), 'PACU', 'name still preserved')
})

test('editing an unchanged preceptor round-trips the same unit_id and unit_name', () => {
  for (const stored of [
    { unit_id: 'f-pacu', unit_name: 'PACU' },      // exact
    { unit_id: 'retired-1', unit_name: 'Old T3' }, // legacy
  ]) {
    const { options, selectedId } = buildUnitOptions(UNITS, FALL, stored)
    assert.equal(selectedId, stored.unit_id === 'f-pacu' ? 'f-pacu' : 'retired-1')
    assert.equal(resolveUnitName(options, selectedId), stored.unit_name)
  }
})

test('null safety', () => {
  assert.deepEqual(cohortUnits(null, FALL), [])
  assert.deepEqual(buildUnitOptions(undefined, FALL, {}).options, [])
  assert.equal(buildUnitOptions(null, null, null).selectedId, '')
  assert.equal(resolveUnitName(null, 'x'), null)
  assert.equal(canonicalUnitName(null), '')
})

// ── The within-cohort integrity helper ─────────────────────────────────────

test('duplicate names ACROSS cohorts are not an integrity problem', () => {
  assert.deepEqual(duplicateNamesWithinCohort(cohortUnits(UNITS, FALL)), [],
    'PACU existing in both cohorts is by design')
})

test('duplicate names WITHIN one cohort are reported', () => {
  const bad = [...cohortUnits(UNITS, FALL), { id: 'f-pacu-2', unit_name: ' pacu ', cohort_id: FALL }]
  assert.deepEqual(duplicateNamesWithinCohort(bad), ['pacu'])
})

// ── The wiring, so the fix cannot be undone ────────────────────────────────

test('the unscoped units query is gone at its source', () => {
  const modal = read('src/components/PreceptorFormModal.jsx')
  // NEGATIVE CONTROL: the original leaking call must not exist in any form.
  assert.doesNotMatch(modal, /from\('units'\)\s*\.select\([^)]*\)\s*\.order\(/,
    'no units query without a cohort filter')
  // Any remaining units query is cohort-scoped.
  const queries = modal.match(/from\('units'\)[\s\S]{0,220}/g) || []
  for (const q of queries) {
    assert.match(q, /\.eq\('cohort_id', cohortId\)/,
      'every units query filters by the active cohort')
  }
  // And it is skipped entirely when App already supplied the units.
  assert.match(modal, /if \(usingProvidedUnits\) return/)
  assert.match(modal, /const usingProvidedUnits = Array\.isArray\(unitsProp\)/)
})

test('units are threaded from App through to both preceptor form modals', () => {
  const rotation = read('src/components/RotationTab.jsx')
  assert.match(rotation, /<PreceptorsTable[\s\S]{0,220}units=\{props\.units\}/,
    'RotationTab passes its units to PreceptorsTable')

  const table = read('src/components/PreceptorsTable.jsx')
  assert.match(table, /function PreceptorsTable\(\{[^}]*units = \[\][^}]*\}\)/,
    'PreceptorsTable accepts units')
  const modalUses = table.match(/<PreceptorFormModal[\s\S]*?\/>/g) || []
  assert.equal(modalUses.length, 2, 'both instances are present')
  for (const m of modalUses) assert.match(m, /units=\{units\}/, 'each receives units')

  // App already loads units for the active cohort only - the source of truth.
  const app = read('src/App.jsx')
  assert.match(app, /from\('units'\)\.select\('\*'\)\.eq\('cohort_id', id\)/)
  assert.match(app, /<RotationTab[\s\S]{0,400}units=\{units\}/)
})

test('the saved unit_name comes from the built options, not the raw list', () => {
  const modal = read('src/components/PreceptorFormModal.jsx')
  assert.match(modal, /unit_name:\s*resolveUnitName\(unitOptions, form\.unit_id\)/)
  // NEGATIVE CONTROL: the old lookup would return undefined for a preserved
  // legacy unit and silently save null.
  assert.doesNotMatch(modal, /units\.find\(u => u\.id === form\.unit_id\)/)
})

test('no migration or SQL was added for this change', () => {
  const modal = read('src/components/PreceptorFormModal.jsx')
  assert.doesNotMatch(modal, /\bCREATE\b|\bALTER\b|\brpc\(/)
  // Code lines only: the header comment explains the defect and quotes the
  // very call it describes, which a naive match would flag.
  const lib = read('src/lib/preceptorUnitOptions.js')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.doesNotMatch(lib, /supabase|\.from\(|rpc\(/, 'the rule module touches no data layer')
})
