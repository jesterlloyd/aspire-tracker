// COHORT-ORDER-1: three defects with one root, plus two Owner decisions.
//
// THE ROOT. cohorts.start_date is a free-text TEXT column - the unit-leader
// migration says so explicitly and refuses to read it. Every cohort list in the
// app was ordering by localeCompare over that column, and the Source ASPIRE
// cohort chips were labelling with start_date.slice(0, 7). Alphabetical order
// over free text put Winter 2027 above Fall 2026, and slicing "May 4, 2026"
// produced the ragged "May 4, " the Owner reported. Both stop reading that
// column: order comes from the cohort NAME, labels are parsed or omitted.
//
// THE DECISIONS. Ticking a unit means it is participating AND hiring, so it must
// say how many; unticking parks it rather than deleting it. The five published
// application requirements are locked and always lead the checklist.
//
// Run: node --test test/cohortOrderUnitsChecklist.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { seasonOf, cohortChronoKey, compareCohortsChrono } from '../src/lib/cohortSeason.js'
import {
  unitRoster, unitRosterByDivision, unitsToSave, unitsMissingSpots, unitDescription,
  OFF_CATALOG_DIVISION,
  checklistExtrasOf, buildChecklist, isOfficialChecklistItem, OFFICIAL_CHECKLIST_KEYS,
} from '../src/lib/ngrp/ngrpCohortForm.js'
import { UNIT_CATALOG, DIVISION_ORDER } from '../src/lib/unitCatalog.js'
import { DEFAULT_APPLICATION_CHECKLIST, validateApplicationChecklist } from '../lib/server/ngrpEligibility.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const settings = read('src/components/ngrp/CohortSettingsModal.jsx')
const createDlg = read('src/components/ngrp/CreateCohortDialog.jsx')
const app = read('src/App.jsx')
const intList = read('src/components/Header/scope/InternshipCohortList.jsx')

// ── Ordering ─────────────────────────────────────────────────────────────────

test('cohorts order the way the program runs, not the way the strings sort', () => {
  // The exact list the Owner reported, with the free-text dates that broke it.
  const rows = [
    { name: 'Winter 2027', start_date: 'January 5, 2027' },
    { name: 'Fall 2026', start_date: 'September 1, 2026' },
    { name: 'Summer 2026', start_date: 'May 4, 2026' },
  ]
  assert.deepEqual(
    [...rows].sort(compareCohortsChrono).map(c => c.name),
    ['Summer 2026', 'Fall 2026', 'Winter 2027'],
  )
  // The old rule, for the record: alphabetical over the free-text column.
  assert.notDeepEqual(
    [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date)).map(c => c.name),
    ['Summer 2026', 'Fall 2026', 'Winter 2027'],
  )
})

test('winter belongs to the year it names, so it follows the previous fall', () => {
  // "Winter 2027" starts in January 2027. Sorting it into 2027 rather than
  // treating winter as the start of its own year is the whole ordering.
  const [wy, ws] = cohortChronoKey('Winter 2027')
  const [fy, fs] = cohortChronoKey('Fall 2026')
  assert.equal(wy, 2027)
  assert.equal(fy, 2026)
  assert.ok(ws < fs, 'winter is the first season within its year')
  assert.ok(compareCohortsChrono({ name: 'Fall 2026' }, { name: 'Winter 2027' }) < 0)
  assert.deepEqual(
    ['Fall 2027', 'Winter 2027', 'Spring 2027', 'Summer 2027'].map(name => ({ name }))
      .sort(compareCohortsChrono).map(c => c.name),
    ['Winter 2027', 'Spring 2027', 'Summer 2027', 'Fall 2027'],
  )
})

test('a name that states no season or no year sorts last, never guessed at', () => {
  const rows = [
    { name: 'Pilot Group', created_at: '2026-01-01' },
    { name: 'Fall 2026' },
    { name: 'Cohort A', created_at: '2025-01-01' },
    { name: 'Summer 2026' },
  ]
  const order = [...rows].sort(compareCohortsChrono).map(c => c.name)
  assert.deepEqual(order.slice(0, 2), ['Summer 2026', 'Fall 2026'])
  // The two nameless-season rows stay put behind them, ordered by created_at so
  // the list does not drift with fetch order.
  assert.deepEqual(order.slice(2), ['Cohort A', 'Pilot Group'])
  assert.equal(seasonOf('Pilot Group'), null)
})

test('a term split keeps a stable order beside its own season', () => {
  // "Fall II 2026" is a real shape in this program and ties with "Fall 2026" on
  // both year and season; the name is the tiebreak, not fetch order.
  assert.deepEqual(
    [{ name: 'Fall II 2026' }, { name: 'Fall 2026' }].sort(compareCohortsChrono).map(c => c.name),
    ['Fall 2026', 'Fall II 2026'],
  )
})

// ── The chip label ───────────────────────────────────────────────────────────

test('the cohort chips carry the name alone', () => {
  // The name already states season and year, which is the whole claim. The old
  // suffix added a second, less reliable one straight off the free-text column,
  // and "May 4, 2026".slice(0, 7) is the ragged "May 4, " the Owner reported.
  assert.equal('May 4, 2026'.slice(0, 7), 'May 4, ', 'the old rule, for the record')
  for (const src of [settings, createDlg]) {
    assert.match(src, /<SeasonMark name=\{c\.name\} \/>/)
    assert.doesNotMatch(src, /cohortStartLabel/, 'no date beside the name')
  }
  // The formatter went with the dates rather than lingering as dead code.
  assert.doesNotMatch(read('src/lib/cohortSeason.js'), /cohortStartLabel/)
})

test('no cohort list reads the free-text date column for order or label', () => {
  for (const [name, src] of [['settings modal', settings], ['create dialog', createDlg]]) {
    assert.match(src, /compareCohortsChrono/, `${name} orders by name`)
    assert.doesNotMatch(src, /start_date \|\| ''\)\.localeCompare/, `${name} must not sort on start_date`)
    assert.doesNotMatch(src, /start_date\.slice/, `${name} must not slice start_date`)
    assert.doesNotMatch(src, /c\.start_date/, `${name} must not read start_date at all`)
  }
  assert.match(app, /const sortedCohorts = \[\.\.\.cohorts\]\.sort\(compareCohortsChrono\)/)
  assert.doesNotMatch(intList, /start_date\.slice/)
})

// ── Participating units ──────────────────────────────────────────────────────

const DATA = {
  units: [
    { unit_name: '5 SCCT', is_active: true, capacity: 4 },
    { unit_name: 'NICU-Overflow', is_active: false, capacity: 2 },
  ],
  unitNameSuggestions: ['5 SCCT', 'Off Catalog Unit'],
}

test('EVERY catalog unit is listed, exactly once, and none is invented', () => {
  const rows = unitRoster(DATA)
  // The whole canonical catalog, not a filtered suggestion list: a residency
  // cohort can hire into a unit that never hosted an ASPIRE student, and the
  // list used to be empty until source cohorts were mapped.
  for (const u of UNIT_CATALOG) {
    assert.ok(rows.some(r => r.unit_name === u.name), `${u.name} is offered`)
  }
  assert.equal(rows.filter(r => r.division !== OFF_CATALOG_DIVISION).length, UNIT_CATALOG.length,
    'exactly the catalog, nothing invented')
  // A unit is listed exactly once, however many sources name it.
  assert.equal(new Set(rows.map(r => r.unit_name.toLowerCase())).size, rows.length)
  // Saved state survives being placed by division rather than led with.
  const scct = rows.find(r => r.unit_name === '5 SCCT')
  assert.deepEqual([scct.is_active, scct.capacity, scct.persisted], [true, 4, true])
  // Offered units arrive unpicked and unpriced - nothing is assumed to be hiring.
  assert.deepEqual([...new Set(rows.filter(u => !u.persisted).map(u => `${u.is_active}:${u.capacity}`))], ['false:'])
})

test('units are grouped by division, in the org chart order', () => {
  const groups = unitRosterByDivision(unitRoster(DATA))
  // DIVISION_ORDER is the org chart's order and is where someone looks for a
  // unit; it doubles as the order the Transition Form offers picked units in.
  assert.deepEqual(
    groups.map(g => g.division).filter(d => d !== OFF_CATALOG_DIVISION),
    DIVISION_ORDER.filter(d => UNIT_CATALOG.some(u => u.division === d)),
  )
  // Each division holds exactly its own units, in catalog order.
  for (const g of groups) {
    if (g.division === OFF_CATALOG_DIVISION) continue
    assert.deepEqual(g.units.map(u => u.unit_name), UNIT_CATALOG.filter(u => u.division === g.division).map(u => u.name), g.division)
  }
  // Every division appears once, and none appears empty.
  assert.equal(new Set(groups.map(g => g.division)).size, groups.length)
  assert.ok(groups.every(g => g.units.length > 0))
})

test('a unit the catalog does not carry keeps its own group, never a borrowed one', () => {
  const groups = unitRosterByDivision(unitRoster(DATA))
  const other = groups[groups.length - 1]
  assert.equal(other.division, OFF_CATALOG_DIVISION, 'and it sorts last')
  assert.deepEqual(other.units.map(u => u.unit_name), ['NICU-Overflow', 'Off Catalog Unit'])
  // A saved off-catalog unit keeps its saved state rather than being dropped.
  assert.equal(other.units[0].capacity, 2)
  assert.equal(other.units[0].persisted, true)
})

test('the roster is full before any ASPIRE cohort is chosen', () => {
  // The old roster was drawn from the mapped cohorts' units, so a brand-new
  // residency cohort opened its units card to an empty list and a text box.
  const rows = unitRoster({ units: [], unitNameSuggestions: [] })
  assert.equal(rows.length, UNIT_CATALOG.length)
  assert.ok(rows.every(r => !r.is_active && !r.persisted))
  assert.ok(unitRosterByDivision(rows).every(g => g.division !== OFF_CATALOG_DIVISION))
})

test('a unit carries the catalog description, because numbers alone do not distinguish it', () => {
  assert.match(unitDescription('5 SCCT'), /Surgical Trauma Transplant ICU/)
  assert.notEqual(unitDescription('5 SCCT'), unitDescription('6 SCCT'))
  assert.equal(unitDescription('Off Catalog Unit'), '', 'no description is not an error')
  assert.equal(unitDescription(null), '')
})

test('an offered unit nobody ticked is not written back; a parked one is', () => {
  const rows = unitRoster(DATA)
  const saved = unitsToSave(rows)
  // The other twenty-eight catalog units were only ever offered, so they are not
  // facts about this cohort and none of them is stored.
  assert.deepEqual(saved.map(u => u.unit_name), ['5 SCCT', 'NICU-Overflow'])
  // The parked unit is not deleted: unpicking keeps the row and its number.
  const nicu = saved.find(u => u.unit_name === 'NICU-Overflow')
  assert.equal(nicu.is_active, false)
  assert.equal(nicu.capacity, 2)
  // Ticking an offered unit makes it a fact, and display_order follows the list.
  const ticked = unitsToSave(rows.map(u => u.unit_name === '6 NE' ? { ...u, is_active: true, capacity: '3' } : u))
  // display_order follows the division-grouped roster, so 6 NE (Critical Care)
  // precedes the off-catalog group at the end.
  assert.deepEqual(ticked.map(u => u.unit_name), ['6 NE', '5 SCCT', 'NICU-Overflow'])
  assert.deepEqual(ticked.map(u => u.display_order), [0, 1, 2])
  assert.equal(ticked.find(u => u.unit_name === '6 NE').capacity, 3, 'the typed string becomes a number')
})

test('a hiring unit must say how many, and blank stays null rather than zero', () => {
  assert.deepEqual(unitsMissingSpots([{ unit_name: 'A', is_active: true, capacity: '' }]), ['A'])
  assert.deepEqual(unitsMissingSpots([{ unit_name: 'A', is_active: true, capacity: 0 }]), ['A'], 'zero is not a hiring number')
  assert.deepEqual(unitsMissingSpots([{ unit_name: 'A', is_active: true, capacity: 4 }]), [])
  // A parked unit is not hiring, so it is never asked.
  assert.deepEqual(unitsMissingSpots([{ unit_name: 'A', is_active: false, capacity: '' }]), [])
  // Blank persists as null, never as 0, so Seats reports "no number set" rather
  // than claiming the unit is hiring nobody.
  assert.equal(unitsToSave([{ unit_name: 'A', is_active: false, persisted: true, capacity: '' }])[0].capacity, null)
})

test('the units card blocks its own save and says which unit is at fault', () => {
  assert.match(settings, /saveDisabledReason=\{missingSpots\.length/)
  assert.match(settings, /Set the number of new grads being hired for \$\{missingSpots\.join\(', '\)\} before saving\./)
  assert.match(read('src/components/ngrp/NgrpFormUi.jsx'), /disabled=\{!dirty \|\| saving \|\| Boolean\(saveDisabledReason\)\}/)
  // A dead button that will not say why reads as a broken form.
  assert.match(read('src/components/ngrp/NgrpFormUi.jsx'), /role="alert"[\s\S]{0,220}\{saveDisabledReason\}/)
})

test('ticking and deleting stay different controls, because they are different acts', () => {
  // One tickbox that also deleted would conflate "not hiring this cycle" with
  // "this unit does not exist", and lose the number either way.
  assert.match(settings, /aria-label=\{`\$\{u\.unit_name\} is participating and hiring`\}/)
  assert.match(settings, /aria-label=\{`New grads \$\{u\.unit_name\} is hiring`\}/)
  // Nothing is typed any more: no free-text add box, and no per-unit delete,
  // because there is nothing to delete from a canonical catalog. Unticking is
  // the way a unit leaves this cohort, and it keeps the number.
  assert.doesNotMatch(settings, /Add a unit not listed above/)
  assert.doesNotMatch(settings, /datalist/)
  assert.doesNotMatch(settings, /setNewUnit/)
  assert.doesNotMatch(settings, /aria-label=\{`Remove \$\{u\.unit_name\}`\}/)
})

// ── Application checklist ────────────────────────────────────────────────────

test('the five locked items are exactly the published requirements', () => {
  assert.deepEqual(DEFAULT_APPLICATION_CHECKLIST.map(i => i.key), OFFICIAL_CHECKLIST_KEYS)
  assert.equal(DEFAULT_APPLICATION_CHECKLIST.length, 5)
  const labels = DEFAULT_APPLICATION_CHECKLIST.map(i => i.label).join(' | ')
  assert.match(labels, /Online application/)
  assert.match(labels, /clinical hours/)
  assert.match(labels, /two pages/)
  assert.match(labels, /graduation date/)
  assert.match(labels, /Two recommendation letters/)
})

test('official-versus-extra is decided by key, so array order cannot promote an extra', () => {
  assert.ok(isOfficialChecklistItem({ key: 'personal_statement' }))
  assert.ok(!isOfficialChecklistItem({ key: 'extra_1' }))
  assert.ok(!isOfficialChecklistItem({}))
  // An extra sitting FIRST in a stored array is still an extra.
  const stored = { application_checklist: [
    { key: 'extra_1', label: 'BLS card' },
    ...DEFAULT_APPLICATION_CHECKLIST,
  ] }
  assert.deepEqual(checklistExtrasOf(stored).map(i => i.label), ['BLS card'])
})

test('the five survive every save, and always lead', () => {
  const out = buildChecklist(DEFAULT_APPLICATION_CHECKLIST, [{ key: 'extra_1', label: 'BLS card' }])
  assert.deepEqual(out.slice(0, 5).map(i => i.key), OFFICIAL_CHECKLIST_KEYS)
  assert.deepEqual(out.slice(5).map(i => i.label), ['BLS card'])
  // An extra cannot impersonate a requirement by claiming its key.
  const spoof = buildChecklist(DEFAULT_APPLICATION_CHECKLIST, [{ key: 'resume', label: 'Resume (optional)' }])
  assert.equal(spoof.length, 5)
  assert.equal(spoof.find(i => i.key === 'resume').label, DEFAULT_APPLICATION_CHECKLIST[1].label)
  // Blank rows are dropped rather than saved as empty checkboxes for alumni.
  assert.equal(buildChecklist(DEFAULT_APPLICATION_CHECKLIST, [{ key: 'e', label: '   ' }]).length, 5)
})

test('a cohort storing the column default is not a cohort with no checklist', () => {
  // The DB default is []. The editor used to render that as a blank list with an
  // Add item button, so staff could not see what alumni were actually shown -
  // while the server was substituting the five all along.
  assert.deepEqual(checklistExtrasOf({ application_checklist: [] }), [])
  assert.deepEqual(validateApplicationChecklist([]).map(i => i.key), OFFICIAL_CHECKLIST_KEYS)
  assert.deepEqual(validateApplicationChecklist(undefined).map(i => i.key), OFFICIAL_CHECKLIST_KEYS)
  // The editor now renders the five from the same constant the server uses.
  assert.match(settings, /import \{ DEFAULT_APPLICATION_CHECKLIST \} from '\.\.\/\.\.\/\.\.\/lib\/server\/ngrpEligibility\.js'/)
  assert.match(settings, /application_checklist: buildChecklist\(DEFAULT_APPLICATION_CHECKLIST, extras\)/)
  // Only the extras are editable state.
  assert.doesNotMatch(settings, /setChecklist\(/)
})

test('the locked five are not rendered as disabled inputs', () => {
  // A greyed-out text field invites people to try to type in it. They are a
  // statement of what the program requires.
  assert.match(settings, /Official program requirements/)
  assert.match(settings, /Additional items for this cohort/)
  assert.match(settings, /<ul className="ngrp-cl-official">/)
  assert.doesNotMatch(settings, /disabled[\s\S]{0,60}item\.label/)
})

test('the Planning summary cannot disagree with the pickers that set it', () => {
  const planning = read('src/components/ngrp/PlanningTab.jsx')
  // Same ordering rule as the two source-cohort pickers.
  assert.match(planning, /const sources = \[\.\.\.\(data\?\.sourceCohorts \|\| \[\]\)\]\.sort\(compareCohortsChrono\)/)
  // The stale hedge is gone: the five requirements are always in force, so
  // "Using the default checklist" was describing a state that no longer exists.
  assert.doesNotMatch(planning, /Using the default checklist/)
  assert.match(planning, /DEFAULT_APPLICATION_CHECKLIST\.length\} required item/)
})

test('the scope dropdown closes behind the dialog it just opened', () => {
  // Both cohort lists have always called onDone?.() after a selection or a
  // footer action, and nothing ever supplied it, so the panel sat open behind
  // the Edit and Add dialogs. ScopePicker owns the open state, so it is the one
  // that can hand the pane a way to close it.
  const scope = read('src/components/Header/scope/ScopePicker.jsx')
  assert.match(scope, /cloneElement\(cohortPane, \{ onDone: \(\) => setOpen\(false\) \}\)/)
  assert.match(scope, /isValidElement\(cohortPane\)/, 'a non-element pane still renders')
  for (const f of ['src/components/Header/scope/InternshipCohortList.jsx', 'src/components/Header/scope/ResidencyCohortList.jsx']) {
    assert.match(read(f), /onDone\?\.\(\)/, f)
  }
})

test('units are tiles, the same gesture as the cohort chips above them', () => {
  // Twenty-nine full-width rows carrying a checkbox, a name, a number and two
  // arrows consumed the card. A tile is pick-or-do-not-pick, like the ASPIRE
  // cohort chips in the card above, and only grows a number box once picked.
  const css = read('src/components/ngrp/ngrp.css')
  assert.match(settings, /className="ngrp-unittiles"/)
  assert.match(settings, /unitRosterByDivision\(units\)/)
  assert.match(css, /\.ngrp-unitdiv-name \{/)
  assert.match(settings, /\{u\.is_active && \(/, 'the number box exists only on a picked tile')
  assert.match(css, /\.ngrp-unittiles \{[\s\S]{0,200}flex-wrap: wrap/)
  // The row grid and its reorder arrows went with it: a tile wrap has no column
  // to move within, and the roster's own order is stable without curation.
  assert.doesNotMatch(settings, /moveUnit/)
  assert.doesNotMatch(settings, /ChevronUp|ChevronDown/)
  assert.doesNotMatch(css, /ngrp-unitgrid/)
  // The checkbox is the real control, visually hidden, so the tile must carry
  // the focus ring on its behalf.
  assert.match(settings, /type="checkbox" className="sr-only"/)
  assert.match(css, /\.ngrp-unittile:has\(\.ngrp-unittile-pick input:focus-visible\)/)
  assert.match(read('src/index.css'), /^\.sr-only \{/m, 'the global utility the tile relies on')
})

test('the dialog is rounded on all four corners, not two', () => {
  // The scrolling body paints its own background to the panel edge, so the two
  // bottom corners squared off while the header kept its radius.
  const ui = read('src/components/ngrp/NgrpFormUi.jsx')
  const panel = ui.slice(ui.indexOf('borderRadius: 16'), ui.indexOf('borderRadius: 16') + 900)
  // CLIP, not HIDDEN. `hidden` rounds the corners and makes the panel a scroll
  // container: one pixel of overflow is enough for scrollIntoView, or the
  // browser's own scroll-on-focus when tabbing to a field near the bottom, to
  // push the header off the top with no way back. Measured at -14px in exactly
  // that state. `clip` rounds the corners and refuses to scroll.
  assert.match(panel, /overflow: 'clip'/)
  assert.doesNotMatch(panel, /overflow: 'hidden'/)
  // And the two bars are pinned, so the body is the only part that can flex.
  for (const [f, n] of [
    ['src/components/ngrp/NgrpFormUi.jsx', 2],
    ['src/components/ngrp/CreateCohortDialog.jsx', 2],
    ['src/components/ngrp/CohortSettingsModal.jsx', 1],
  ]) {
    assert.equal((read(f).match(/flexShrink: 0/g) || []).length, n, `${f} pins its bars`)
  }
  // Clipping the panel exposed the next one: the panel is a flex column capped
  // at 88vh, and a scrolling body with no flex sizes itself to content, so once
  // the cap was reached the body stopped short and the panel's white showed
  // beneath it. minHeight:0 is what lets a flex child scroll at all.
  for (const f of [
    'src/components/ngrp/NgrpFormUi.jsx',
    'src/components/ngrp/CohortSettingsModal.jsx',
    'src/components/ngrp/CreateCohortDialog.jsx',
  ]) {
    assert.match(read(f), /flex: 1, minHeight: 0, [\s\S]{0,120}overflowY: 'auto'/, f)
  }
})

test('no em dash in anything this change added', () => {
  for (const f of [
    'src/lib/cohortSeason.js', 'src/lib/ngrp/ngrpCohortForm.js',
    'src/components/ngrp/CohortSettingsModal.jsx', 'src/components/ngrp/CreateCohortDialog.jsx',
    'src/components/Header/scope/SeasonMark.jsx', 'src/components/ngrp/ngrp.css',
  ]) {
    assert.doesNotMatch(read(f), /—/, `${f} must not contain an em dash`)
  }
})
