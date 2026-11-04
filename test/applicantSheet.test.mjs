// APPLICANT-SHEET-1 (Owner, 2026-11-02): Interest & Eligibility opens the Transition Form answers
// in a shared Sheet (one per residency cohort) instead of downloading them. These pin that the
// Sheet holds what the Excel held, that marks are keyed to this cohort's applicants only, that a
// submitted answer is never written, that the export is the view with its highlights, and the
// wiring for both audiences.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Buffer } from 'node:buffer'
import {
  columnKey, sheetColumnKeys, loadApplicantSheet, saveApplicantSheetCells, saveApplicantSheetLayout, applicantSheetXlsx,
} from '../lib/server/ngrpApplicantSheet.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const CYCLE = '11111111-1111-4111-8111-111111111111'
const K1 = '22222222-2222-4222-8222-222222222222'
const K2 = '33333333-3333-4333-8333-333333333333'
const P9 = '55555555-5555-4555-8555-555555555555'
const OTHER = '44444444-4444-4444-8444-444444444444'
const FORM = { identity: { preferred_email: 'ace@example.com' }, education: { gpa: 3.6, school: 'CSUN' }, residency_interest: { unit_preferences: ['PICU'] } }
const VIEW = {
  students: [{ id: 's1', first_name: 'Ace', last_name: 'Capati', status: 'Completed' }, { id: 's2', first_name: 'Bea', last_name: 'Zed', status: 'Completed' }],
  candidates: [
    { id: K1, student_id: 's1', assignment_id: 'a1', form_submitted_at: '2026-10-01T00:00:00Z' },
    { id: K2, student_id: 's2', assignment_id: 'a2', form_submitted_at: '2026-10-02T00:00:00Z' },
  ],
}
const REVISIONS = new Map([['a1', FORM], ['a2', FORM]])

// A tiny stand-in for the service client: tables are arrays, filters are eq/in/or. Like
// PostgREST, a read returns at most CAP rows (SHEET-READ-ALL-1), and .range() pages.
const CAP = 1000
function fakeDb(tables) {
  const writes = []
  const deletes = []
  const from = name => {
    const filters = []
    let window = [0, CAP - 1]
    let deleting = false
    const q = {
      select: () => q,
      eq: (c, v) => { filters.push(r => r[c] === v); return q },
      in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
      or: () => { filters.push(r => r.value != null || r.format != null); return q },
      order: () => q,
      range: (a, b) => { window = [a, Math.min(b, a + CAP - 1)]; return q },
      delete: () => { deleting = true; return q },
      limit: () => q,
      maybeSingle: () => {
        if (tables[name] === undefined) return Promise.resolve({ data: null, error: { code: '42P01', message: 'does not exist' } })
        return Promise.resolve({ data: tables[name].filter(r => filters.every(f => f(r)))[0] || null, error: null })
      },
      upsert: (rows) => { writes.push({ name, rows }); return Promise.resolve({ error: tables[name] === undefined ? { code: '42P01' } : null }) },
      then: (ok, bad) => {
        if (tables[name] === undefined) return Promise.resolve({ data: null, error: { code: '42P01', message: 'does not exist' } }).then(ok, bad)
        const hit = tables[name].filter(r => filters.every(f => f(r)))
        if (deleting) { deletes.push({ name, rows: hit }); return Promise.resolve({ error: null }).then(ok, bad) }
        return Promise.resolve({ data: hit.slice(window[0], window[1] + 1), error: null }).then(ok, bad)
      },
    }
    return q
  }
  return { from, writes, deletes }
}

test('the Sheet is the Excel: one row per submitted form, keyed to the candidate, the name as lead', async () => {
  const db = fakeDb({ ngrp_sheet_views: [], ngrp_sheet_cells: [] })
  const s = await loadApplicantSheet(db, { cycleId: CYCLE, view: VIEW, revisions: REVISIONS })
  assert.equal(s.editable, true)
  assert.deepEqual(s.rows.map(r => [r.id, r.name]), [[K1, 'Capati, Ace'], [K2, 'Zed, Bea']])
  const gpa = s.columns.find(c => c.label === 'Cumulative GPA')
  assert.equal(gpa.type, 'number')
  assert.equal(s.rows[0].cells[gpa.key], '3.6')
  assert.ok(!s.columns.some(c => c.label.startsWith('Full Legal Name')), 'the name is the lead, not a column')
  assert.equal(s.layout.widths[columnKey('School')], 220, 'the workbook\'s widths until someone drags one')
  assert.ok(!JSON.stringify(s.rows).includes('raw'), 'the client gets text, not the workbook cells')
})

test('before the migration the Sheet is view-only', async () => {
  const s = await loadApplicantSheet(fakeDb({}), { cycleId: CYCLE, view: VIEW, revisions: REVISIONS })
  assert.equal(s.editable, false)
  assert.equal(s.rows.length, 2)
})

test('highlights and staff values: this cohort\'s applicants only, a value only in a staff column', async () => {
  const tier = { key: 's_tier01', label: 'Tier', type: 'choice', options: ['A', 'B'] }
  const db = fakeDb({
    ngrp_candidates: [{ id: K1, cycle_id: CYCLE }, { id: OTHER, cycle_id: 'elsewhere' }],
    ngrp_sheet_views: [{ cycle_id: CYCLE, layout: { staffColumns: [tier] } }],
    ngrp_sheet_cells: [],
  })
  const school = columnKey('School')
  const r = await saveApplicantSheetCells(db, { cycleId: CYCLE, profileId: 'p1', updates: [
    { rowId: K1, key: school, format: { fill: 'yellow' } },
    { rowId: K1, key: 's_tier01', value: 'A' },
    { rowId: OTHER, key: school, format: { fill: 'red' } },
  ] })
  assert.equal(r.saved, 2)
  const rows = db.writes[0].rows
  assert.ok(rows.every(x => x.candidate_id === K1 && x.cycle_id === CYCLE && x.updated_by === 'p1'))
  const answer = rows.find(x => x.column_key === school)
  assert.equal(answer.value, null, 'a submitted answer is never written')
  // SHEET-CORRECT-1 (the commit that adds corrections): a caller who may not correct is refused,
  // where the value used to be dropped silently.
  assert.deepEqual(await saveApplicantSheetCells(db, { cycleId: CYCLE, profileId: 'p1', updates: [{ rowId: K1, key: school, value: 'overwritten?' }] }),
    { error: 'correct_not_allowed', status: 403 })
  assert.equal(rows.find(x => x.column_key === 's_tier01').value, 'A')
  assert.deepEqual(await saveApplicantSheetCells(fakeDb({ ngrp_candidates: [{ id: K1, cycle_id: CYCLE }] }), { cycleId: CYCLE, updates: [{ rowId: K1, key: school, format: {} }] }),
    { error: 'not_enabled', status: 409 })
})

test('the layout keeps only this Sheet\'s columns', async () => {
  const db = fakeDb({ ngrp_sheet_views: [] })
  const r = await saveApplicantSheetLayout(db, { cycleId: CYCLE, columnKeys: sheetColumnKeys(), profileId: 'p1',
    layout: { order: [columnKey('School'), 'nope'], hidden: [columnKey('Phone Number')], frozen: 2 } })
  assert.deepEqual(r.layout.order, [columnKey('School')])
  assert.deepEqual(r.layout.hidden, [columnKey('Phone Number')])
  assert.equal(db.writes[0].rows.cycle_id, CYCLE)
})

test('Download Excel is the view: the rows and columns shown, with their fills, and no formulas', async () => {
  const school = columnKey('School')
  const db = fakeDb({ ngrp_sheet_views: [], ngrp_sheet_cells: [{ candidate_id: K2, column_key: school, value: null, format: { fill: 'yellow', b: true } }] })
  const s = await loadApplicantSheet(db, { cycleId: CYCLE, view: VIEW, revisions: REVISIONS })
  const xml = Buffer.from(applicantSheetXlsx(s, { rowIds: [K2], columnKeys: [school, columnKey('Cumulative GPA')] })).toString('utf8')
  assert.match(xml, /Zed, Bea/)
  assert.doesNotMatch(xml, /Capati/)
  assert.doesNotMatch(xml, /Phone Number/)
  assert.match(xml, /patternType="solid"/, 'the highlight goes with it')
  assert.match(xml, /<v>3\.6<\/v>/, 'a number stays a number')
  assert.ok(!/<f>/.test(xml))
})

test('wiring: both audiences read and mark the Sheet; the table\'s button opens it', () => {
  const ws = read('api/ngrp-workspace.js')
  assert.ok(ws.indexOf("action === 'sheet' || action === 'sheet_xlsx'") > ws.indexOf('narrowPayloadForTalentAcquisition(payload)'), 'built from the narrowed view')
  const manage = read('api/ngrp-manage.js')
  assert.match(manage, /'sheet_layout', 'sheet_cells',/)
  const at = manage.indexOf("if (action === 'sheet_layout' || action === 'sheet_cells')")
  // SHEET-CORRECT-1: the handler names Talent Acquisition only to let it correct answers; nothing refuses it.
  const handler = manage.slice(at, manage.indexOf('ADD-ALUMNUS-1: Add alumnus', at))
  assert.ok(at > 0 && !/isTalentAcquisition\)? return|if \(isTalentAcquisition/.test(handler), 'Talent Acquisition marks the same sheet')
  assert.match(handler, /canCorrect: isTalentAcquisition \|\| caller\.profile\?\.is_owner === true/)
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /onClick=\{\(\) => setParam\('sheet', '1'\)\}/)
  assert.match(tab, /const sheetOpen = view === 'interest' && searchParams\.get\('sheet'\) === '1'/)
  assert.match(read('src/components/ngrp/ngrp.css'), /\.ngrp-sheet \{\n {2}--ctl-surface/)
  const mig = read('supabase/migrations/20261119000000_ngrp_applicant_sheet.sql')
  assert.match(mig, /REVOKE ALL PRIVILEGES ON TABLE public\.ngrp_sheet_cells FROM PUBLIC, anon, authenticated, service_role;/)
  assert.doesNotMatch(mig, /CREATE POLICY/)
})

// ── SHEET-CORRECT-1 (Owner, 2026-11-02) ──────────────────────────────────────

test('a correction lays over the answer with who and the original, and the Excel carries it', async () => {
  const school = columnKey('School'), gpa = columnKey('Cumulative GPA')
  const db = fakeDb({
    ngrp_sheet_views: [],
    ngrp_sheet_cells: [
      { cycle_id: CYCLE, candidate_id: K1, column_key: school, value: 'CSU Northridge', updated_by: P9, updated_at: '2026-11-02T18:00:00Z' },
      { cycle_id: CYCLE, candidate_id: K1, column_key: gpa, value: '3.7', updated_by: P9, updated_at: '2026-11-02T18:00:00Z' },
      { cycle_id: CYCLE, candidate_id: K2, column_key: school, value: null, format: { b: true } },
    ],
    user_profiles: [{ id: P9, full_name: 'Ray Hiring' }],
  })
  const s = await loadApplicantSheet(db, { cycleId: CYCLE, view: VIEW, revisions: REVISIONS })
  const ace = s.rows.find(r => r.id === K1), bea = s.rows.find(r => r.id === K2)
  assert.equal(ace.cells[school], 'CSU Northridge')
  assert.deepEqual(ace.corrected[school], { original: 'CSUN', by: 'Ray Hiring', at: '2026-11-02T18:00:00Z' })
  assert.equal(bea.corrected, undefined, 'a highlight is not a correction')
  assert.ok(s.columns.find(c => c.key === school).correctable)
  for (const label of ['Id', 'Completion time', 'Fit Score', 'Fit']) assert.ok(!s.columns.find(c => c.label === label).correctable, `${label} is computed`)
  const xml = Buffer.from(applicantSheetXlsx(s, { rowIds: [K1], columnKeys: [school, gpa] })).toString('utf8')
  assert.match(xml, /CSU Northridge/)
  assert.match(xml, /<v>3\.7<\/v>/, 'a corrected number is still a number')
})

test('only a caller who may correct writes an answer; null removes the correction, blank is kept', async () => {
  const school = columnKey('School')
  const db = fakeDb({ ngrp_candidates: [{ id: K1, cycle_id: CYCLE }], ngrp_sheet_views: [], ngrp_sheet_cells: [] })
  const r = await saveApplicantSheetCells(db, { cycleId: CYCLE, profileId: 'p1', canCorrect: true, updates: [
    { rowId: K1, key: school, value: '' },
    { rowId: K1, key: columnKey('Id'), value: '99' },
  ] })
  assert.equal(r.saved, 1, 'Id is never correctable')
  assert.equal(db.writes[0].rows[0].value, '', 'a correction to blank stays blank')
  // SHEET-READ-ALL-1 (the commit that removes emptied cells): putting it back deletes the stored row.
  const back = fakeDb({ ngrp_candidates: [{ id: K1, cycle_id: CYCLE }], ngrp_sheet_views: [],
    ngrp_sheet_cells: [{ cycle_id: CYCLE, candidate_id: K1, column_key: school, value: 'CSU', format: null }] })
  await saveApplicantSheetCells(back, { cycleId: CYCLE, profileId: 'p1', canCorrect: true, updates: [{ rowId: K1, key: school, value: null }] })
  assert.equal(back.writes.length, 0)
  assert.deepEqual(back.deletes[0].rows.map(x => x.column_key), [school], 'putting it back removes the correction')
})

test('wiring: corrections for the Owner and Talent Acquisition, saves toast, Undo and a confirm before clearing', () => {
  const ws = read('api/ngrp-workspace.js')
  assert.match(ws, /const canCorrect = caller\.audience === TALENT_ACQUISITION \|\| caller\.profile\?\.is_owner === true/)
  const ui = read('src/components/ngrp/ApplicantSheet.jsx')
  assert.match(ui, /const canEditColumn = col => canCorrect && !!col\.correctable/)
  assert.match(ui, /confirmLabel: 'Clear answer', danger: true/)
  assert.match(ui, /action: \{ label: 'Undo', onClick: \(\) => undoRef\.current\?\.\(\) \}/)
  assert.match(ui, /toast\?\.success\?\.\('Saved', 'Changes to the Sheet save automatically\.'/)
  assert.match(read('src/components/sheet/EditableSheet.jsx'), /useEffect\(\(\) => \{ if \(undoRef\) undoRef\.current = undo \}\)/)
  // SHEET-WIDE-1: the KPI cards filter the roster, so they step aside for the Sheet.
  assert.match(read('src/components/ngrp/ProfilesTab.jsx'), /\{!sheetOpen && <div className="ngrp-kpis"/)
})

// ── SHEET-READ-ALL-1 (2026-11-03) ────────────────────────────────────────────

test('every saved cell comes back, even past the first thousand (the newest edit is last)', async () => {
  const school = columnKey('School')
  const filler = Array.from({ length: 1033 }, (_, i) => ({ cycle_id: CYCLE, candidate_id: K2, column_key: `x_${i}`, value: null, format: { i: true } }))
  const db = fakeDb({ ngrp_sheet_views: [], ngrp_sheet_cells: [...filler,
    { cycle_id: CYCLE, candidate_id: K1, column_key: school, value: null, format: { fill: 'yellow' } }] })
  const s = await loadApplicantSheet(db, { cycleId: CYCLE, view: VIEW, revisions: REVISIONS })
  assert.deepEqual(s.rows.find(r => r.id === K1).format[school], { fill: 'yellow' }, 'the 1,034th cell is read')
})

test('an empty cell is skipped on read and removed on save, never kept as a row', async () => {
  const school = columnKey('School')
  const db = fakeDb({
    ngrp_candidates: [{ id: K1, cycle_id: CYCLE }], ngrp_sheet_views: [],
    ngrp_sheet_cells: [{ cycle_id: CYCLE, candidate_id: K1, column_key: school, value: null, format: { b: true } }],
  })
  const r = await saveApplicantSheetCells(db, { cycleId: CYCLE, profileId: 'p1', updates: [
    { rowId: K1, key: school, format: null },
    { rowId: K1, key: columnKey('Phone Number'), format: null },
  ] })
  assert.equal(r.saved, 2)
  assert.equal(db.writes.length, 0, 'nothing empty is written')
  assert.equal(db.deletes.length, 1, 'only the stored cell is removed')
  assert.deepEqual(db.deletes[0].rows.map(x => x.column_key), [school])
  assert.match(read('lib/server/forms/engine.js'), /readAll\(\(\) => db\.from\('form_sheet_cells'\)/, 'the Forms Sheet pages too')
})
