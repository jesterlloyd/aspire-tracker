// STUDENT-IMPORT-KEITH-1 (Owner, 2026-11-03): Keith's spreadsheet import. These pin the reader,
// what Keith is and is not shown, the closed mapping, the duplicate plan, the Owner-only Opus rule,
// and that SKILL.md is what the migration seeds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'
import { readSheet, readCsvGrid, gridToSheet, serialToIso, SheetReadError } from '../lib/server/sheet/readSheet.js'
import { xlsxFor } from '../lib/server/sheet/xlsx.js'
import {
  diffAgainst, profileColumns, maskValue, sanitizeMapping, questionsFor, applyAnswers, rowValues, planRows, decide,
  splitName, toIsoDate, guessMapping, IGNORE,
} from '../src/lib/studentImport/importModel.js'
import { ownerOpusRouteFor, resolveRoute, isKnownRoute, ROUTE_NAMES } from '../lib/server/keith/modelRouting.js'
import { IMPORT_STUDENTS, SKILL_DEFS } from '../lib/server/keith/skillDefs.js'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

// A deflated workbook with shared strings and a date-styled cell, as Excel and Microsoft Forms write them.
function zip(files) {
  const locals = []; const centrals = []; let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, 'utf8'))
    const n = Buffer.from(name, 'utf8')
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(Buffer.byteLength(text), 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(Buffer.byteLength(text), 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42)
    locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
const formsWorkbook = () => zip({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Born</t></si><si><r><t>Bay</t></r><r><t>araa, Emi</t></r></si><si><t xml:space="preserve">A &amp; B</t></si></sst>',
  'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="m/d/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Note</t></is></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45658</v></c><c r="C2"><v>3.5</v></c><c r="D2" t="s"><v>3</v></c></row><row r="3"/></sheetData></worksheet>',
})

test('an .xlsx is read: shared strings, rich text, inline strings, dates, gaps', () => {
  const s = readSheet(formsWorkbook(), 'intake.xlsx')
  assert.deepEqual(s.headers, ['Name', 'Born', 'Column 3', 'Note'])
  assert.deepEqual(s.rows, [['Bayaraa, Emi', '2025-01-01', '3.5', 'A & B']])
  assert.equal(serialToIso(45658.5), '2025-01-01T12:00')
})

test('the app\'s own Excel export reads back, and a CSV keeps quoted commas and newlines', () => {
  const s = readSheet(xlsxFor({ header: ['First', 'Email'], rows: [['Emi', 'emi@x.edu']] }), 'a.xlsx')
  assert.deepEqual(s, { headers: ['First', 'Email'], rows: [['Emi', 'emi@x.edu']], truncated: false })
  const c = gridToSheet(readCsvGrid('﻿Name,Why\r\n"Lee, Sam","one\ntwo"\r\n,\r\n'))
  assert.deepEqual(c.rows, [['Lee, Sam', 'one\ntwo']], 'a blank row is dropped')
  assert.throws(() => readSheet(Buffer.from('x'), 'old.xls'), SheetReadError)
})

const headers = ['Student Full Name (Last, First)', 'Personal Email', 'Social Security Number', 'School', 'Preferred Units', 'Interview Notes', 'Phone']
const rows = [
  ['Bayaraa, Emi', 'emi@gmail.com', '1234', 'CSULB', '6 NE (Heart);Somewhere Else', 'strong candidate', '3235550101'],
  ['Lee, Sam', 'sam@gmail.com', '5678', 'UCLA', 'NICU', 'call back', '3235550102'],
]

test('Keith is shown categories and masked samples only: no name, email, phone, note or SSN', () => {
  const cols = profileColumns(headers, rows)
  const json = JSON.stringify(cols)
  for (const secret of ['Bayaraa', 'Emi', 'emi@gmail', '1234', '5678', '3235550101', 'strong candidate', 'call back']) assert.ok(!json.includes(secret), secret)
  assert.equal(cols[2].withheld, true)
  assert.deepEqual(cols[3].values, ['CSULB', 'UCLA'])
  assert.deepEqual(cols[4].items, ['6 NE (Heart)', 'NICU', 'Somewhere Else'])
  assert.deepEqual(cols[1].samples, ['***@gmail.com', '***@gmail.com'])
  assert.equal(maskValue('Mary-Ann 3'), 'a-a 9')
})

test('the mapping is closed: unknown fields, unknown values and an SSN column mapped elsewhere are dropped', () => {
  const m = sanitizeMapping({
    columns: [
      { index: 0, field: 'full_name', confidence: 'high' }, { index: 1, field: 'personal_email', confidence: 'high' },
      { index: 2, field: 'phone', confidence: 'high' }, { index: 3, field: 'school', confidence: 'high' },
      { index: 4, field: 'unit_preferences', confidence: 'medium' }, { index: 5, field: 'drop_table', confidence: 'high' },
      { index: 99, field: 'phone' },
    ],
    values: { school: [{ from: 'CSULB', to: 'Cal State Long Beach' }, { from: 'UCLA', to: 'University of Somewhere' }], unit_preferences: [{ from: '6 NE (Heart)', to: '6 NE' }, { from: 'NICU', to: 'NICU' }] },
    name_format: 'last_first', status: 'Form Received',
  }, headers)
  assert.equal(m.columns[2].field, IGNORE, 'the SSN column may only be ssn_last4')
  assert.equal(m.columns[5].field, IGNORE)
  assert.equal(m.columns[6].field, IGNORE, 'a column Keith skipped is left out')
  assert.deepEqual(m.values.school, { CSULB: 'Cal State Long Beach', UCLA: null })
  const qs = questionsFor(m, headers, rows, { target: 'internship' })
  assert.ok(qs.some(q => q.kind === 'value' && q.value === 'Somewhere Else'), 'an item Keith did not map is asked')
  assert.ok(!qs.some(q => q.kind === 'value' && q.value === 'NICU'), 'a unit already named exactly needs no question')
  assert.ok(!qs.some(q => q.kind === 'value' && q.value === 'UCLA'), 'an exact school name needs no question')
  assert.ok(qs.some(q => q.kind === 'column' && q.index === 6), 'a low-confidence column is asked')
  assert.ok(qs.some(q => q.kind === 'status'))
})

test('names, dates and values convert; a bad value is named, never guessed', () => {
  assert.deepEqual(splitName('Bayaraa, Emi Rose', 'first_last'), { first_name: 'Emi Rose', last_name: 'Bayaraa' })
  assert.deepEqual(splitName('Emi Rose Bayaraa', 'first_last'), { first_name: 'Emi Rose', last_name: 'Bayaraa' })
  assert.equal(toIsoDate('3/7/2026'), '2026-03-07')
  assert.equal(toIsoDate('soon'), null)
  const m = applyAnswers(sanitizeMapping({ columns: [{ index: 0, field: 'full_name' }, { index: 1, field: 'cumulative_gpa' }, { index: 2, field: 'ssn_last4' }] }, ['n', 'g', 's']), {})
  const v = rowValues(['Lee, Sam', '7.2', '***-**-1234'], m)
  assert.equal(v.values.ssn_last4, '1234')
  assert.equal(v.values.cumulative_gpa, undefined)
  assert.match(v.problems[0], /not on a 4.0 scale/)
})

const mapping = applyAnswers(sanitizeMapping({
  columns: [{ index: 0, field: 'full_name', confidence: 'high' }, { index: 1, field: 'personal_email', confidence: 'high' }, { index: 2, field: 'school', confidence: 'high' }, { index: 3, field: 'aspire_cohort', confidence: 'high' }],
  values: { school: [{ from: 'CSULB', to: 'Cal State Long Beach' }] }, status: 'Form Received',
}, ['Name', 'Email', 'School', 'Cohort'], { cohortNames: ['Fall 2026', 'Spring 2026'] }), {})
const pool = [
  { id: 'a', first_name: 'Emi', last_name: 'Bayaraa', personal_email: 'emi@gmail.com', school: '', status: 'Form Received', cohort_id: 'fall', cohort_name: 'Fall 2026' },
  { id: 'b', first_name: 'Sam', last_name: 'Lee', personal_email: 'sam@gmail.com', school: 'UCLA', status: 'Completed', cohort_id: 'spring', cohort_name: 'Spring 2026' },
  { id: 'c', first_name: 'Ana', last_name: 'Ruiz', personal_email: 'ana@gmail.com', school: 'Cal State Long Beach', status: 'Completed', cohort_id: 'fall', cohort_name: 'Fall 2026' },
  { id: 'd', first_name: 'Kim', last_name: 'Park', personal_email: 'kim@old.com', status: 'Placed', cohort_id: 'fall', cohort_name: 'Fall 2026' },
]
const file = [
  ['Bayaraa, Emi', 'EMI@gmail.com', 'CSULB', 'Fall 2026'], // here by email: fills school
  ['Lee, Sam', 'sam@gmail.com', 'CSULB', 'Spring 2026'],   // another cohort
  ['Ruiz, Ana', 'ana@gmail.com', 'CSULB', 'Fall 2026'],    // here, nothing new
  ['Park, Kim', 'kim@new.com', '', 'Fall 2026'],           // same name, different email
  ['New, Person', 'new@gmail.com', 'CSULB', 'Winter 2025'],
  ['Bayaraa, Emi', 'emi@gmail.com', '', ''],               // repeated in the file
  ['', 'x@y.com', '', ''],
]

test('Internship: never a second record without an answer', () => {
  const p = planRows(file, mapping, pool, { target: 'internship', cohortId: 'fall', cohortNames: ['Fall 2026', 'Spring 2026'] })
  assert.deepEqual(p.map(r => [r.action, r.reason]), [
    ['update', 'fill'], ['ask', 'other_cohort'], ['skip', 'nothing_new'], ['ask', 'name_only'],
    ['create', 'new'], ['skip', 'repeat_in_file'], ['skip', 'no_name'],
  ])
  assert.deepEqual(p[0].fill, ['school'])
  assert.deepEqual(p[1].options, ['skip', 'create'], 'the safe answer comes first')
  const d = decide(p, { 5: 'create', 3: 'nonsense' }) // keyed by the sheet's row number
  assert.equal(d[1].action, 'skip', 'no answer is the default')
  assert.equal(d[3].action, 'create')
})

test('a stored value that is not one of the choices is filled from the file, not a conflict (Sierra Jennings)', () => {
  const legacy = { school: 'West Coast University', program_type: 'BSN Semester', phone: '555' }
  const d = diffAgainst(legacy, { school: 'West Coast University North Hollywood', program_type: 'Accelerated BSN', phone: '556' })
  assert.deepEqual(d.fill, ['school'], 'the campus-less school is unknown, so the campus fills it')
  assert.deepEqual(d.upgrades, [{ field: 'school', from: 'West Coast University', to: 'West Coast University North Hollywood' }])
  assert.deepEqual(d.conflicts.map(c => c.field), ['program_type', 'phone'], 'a free value and a real choice still ask')
  const real = diffAgainst({ school: 'UCLA' }, { school: 'West Coast University North Hollywood' })
  assert.deepEqual([real.fill, real.conflicts.map(c => c.field)], [[], ['school']], 'a real choice is never overwritten without Replace')
  const offToOff = diffAgainst({ school: 'West Coast University' }, { school: 'Somewhere Else' })
  assert.deepEqual(offToOff.conflicts.map(c => c.field), ['school'], 'only a real choice can fill it')
})

test('Residency: alumni are Completed students; a new one needs a known cohort', () => {
  const p = planRows(file, mapping, pool, { target: 'residency', cohortNames: ['Fall 2026', 'Spring 2026'], onRosterIds: ['c'] })
  assert.deepEqual(p.map(r => [r.action, r.reason]), [
    ['skip', 'not_completed'], ['ask', 'conflicts'], ['skip', 'on_roster'], ['skip', 'not_completed'],
    ['skip', 'no_cohort'], ['skip', 'repeat_in_file'], ['skip', 'no_name'],
  ])
  assert.deepEqual(p[1].options, ['add', 'replace', 'skip'])
  assert.deepEqual(p[1].conflicts.map(c => c.field), ['school'])
  const withNew = planRows(file, applyAnswers(mapping, { 'val:aspire_cohort:Winter 2025': 'new:Winter 2025' }), pool,
    { target: 'residency', cohortNames: ['Fall 2026', 'Spring 2026'], onRosterIds: ['c'], newCohorts: ['Winter 2025'] })
  assert.equal(withNew[4].action, 'create')
  assert.equal(withNew[4].cohort, 'Winter 2025')
})

test('without Keith, the headers give a guess the person confirms', () => {
  const g = guessMapping(['Student Full Name', 'Personal Email', 'School Email', 'GPA'])
  assert.deepEqual(g.columns.map(c => c.field), ['full_name', 'personal_email', 'school_email', 'cumulative_gpa'])
  assert.ok(g.columns.every(c => c.confidence === 'low'))
})

test('Opus is the Owner\'s, by person, and only this Skill asks for it', () => {
  assert.equal(ownerOpusRouteFor({ is_owner: true }).route, 'owner_opus')
  assert.equal(ownerOpusRouteFor({ role: 'admin', is_owner: false }), null)
  assert.equal(ownerOpusRouteFor({ role: 'owner' }), null, 'the role word is not the Owner')
  assert.equal(isKnownRoute('owner_opus'), false)
  assert.equal(ROUTE_NAMES.includes('owner_opus'), false)
  const input = { sheet: { value: { target: 'internship', rowCount: 1, columns: [] } }, fields: { value: [] } }
  const skill = { instruction_body: 'X' }
  const base = resolveRoute('quality')
  const owner = IMPORT_STUDENTS.request({ skill, input, context: { actor: { is_owner: true } } })
  const admin = IMPORT_STUDENTS.request({ skill, input, context: { actor: { role: 'admin' } } })
  assert.equal(owner.route(base).route, 'owner_opus')
  assert.equal(admin.route(base).model, base.model)
  assert.equal(SKILL_DEFS['import-students'], IMPORT_STUDENTS)
  const callers = execSync('git grep -l "ownerOpusRouteFor" -- lib api src', { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
  assert.deepEqual(callers, ['lib/server/keith/modelRouting.js', 'lib/server/keith/skillDefs.js'])
})

test('SKILL.md is exactly what the migration seeds, for Owner and Admin, and the migration activates it', () => {
  const md = read('skills/import-students/SKILL.md')
  const body = md.split('---\n').slice(2).join('---\n').trim()
  const sql = read('supabase/migrations/20261123000000_import_students_skill.sql')
  const written = sql.match(/v_body  text := E'([\s\S]*?)';\n/)[1].replace(/''/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
  assert.equal(written, body)
  assert.match(sql, /ARRAY\['owner', 'admin'\]/)
  assert.match(sql, /PERFORM public\.keith_activate_skill\(/)
  assert.match(sql, /IF v_skill\.status <> 'draft' THEN RETURN; END IF;/)
  assert.match(body, /never see a whole row/)
})

test('the endpoint is Owner and Admin, scoped to the population, with a minute', () => {
  const api = read('api/student-import.js')
  assert.match(api, /verifyOwnerAdmin\(req, service\)/)
  assert.match(api, /serviceDbForRequest\(service, req\)/)
  assert.match(read('vercel.json'), /"api\/student-import\.js":\s*\{ "maxDuration": 60 \}/)
  const srv = read('lib/server/studentImport.js')
  assert.match(srv, /if \(isDemo\) row\.is_demo = true/)
  assert.match(srv, /eventType: 'alumnus_added'/)
  assert.doesNotMatch(srv, /\.delete\(/, 'an import never deletes')
  const tab = read('src/components/StudentProfilesTab.jsx')
  assert.match(tab, /<KeithImportDrawer target="internship"/)
  assert.match(read('src/components/ngrp/ResidencyRosterActions.jsx'), /<KeithImportDrawer target="residency"/)
})
