// test/formSheet.test.mjs
//
// FORM-SHEET-1, FORM-OTHER-1, FORM-CATEGORY-1 (2026-09-24, Owner): Responses gets a
// spreadsheet view with an Excel export; choice questions can offer "Other" with a text box;
// Build a form can add a Catalog category. The Sheet and the export run against real Postgres.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest, fakeMailer } from './helpers/pgliteRest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.env.FORM_TOKEN_SECRET ||= 'test-form-secret-0123456789abcdef0123456789'
const E = await import('../lib/server/forms/engine.js')
const M = await import('../src/lib/forms/formModel.js')
const { xlsxFor } = await import('../lib/server/forms/xlsx.js')
const read = (p) => readFileSync(join(root, p), 'utf8')
const PRELUDE = read('test/formsEngine.test.mjs').match(/const PRELUDE = `([\s\S]*?)`/)[1]

// Read one entry out of a stored (or deflated) ZIP, enough to check what Excel will open.
function unzip(buf) {
  const out = {}
  let i = 0
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28)
    const name = buf.subarray(i + 30, i + 30 + n).toString('utf8')
    const data = buf.subarray(i + 30 + n + x, i + 30 + n + x + size)
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    i += 30 + n + x + size
  }
  return out
}

test('"Other" is a choice with a text box, stored as "Other: <text>"', () => {
  const q = { id: 'a', type: 'choice', label: 'Shift', options: ['Days', 'Nights'], allowOther: true, required: true }
  const def = { questions: [q] }
  assert.deepEqual(M.answerIssues(def, { a: 'Other: Weekends' }), {})
  assert.deepEqual(M.answerIssues(def, { a: 'Other: ' }), { a: 'Say what "Other" is.' })
  assert.deepEqual(M.answerIssues({ questions: [{ ...q, allowOther: false }] }, { a: 'Other: x' }), { a: 'Choose one of the options.' })
  assert.deepEqual(M.cleanAnswers(def, { a: 'Other:   Weekends  ' }), { a: 'Other: Weekends' })
  const c = { id: 'b', type: 'checkboxes', label: 'Days', options: ['Mon', 'Tue'], allowOther: true }
  assert.deepEqual(M.answerIssues({ questions: [c] }, { b: ['Mon', 'Other: Sat'] }), {})
  assert.deepEqual(M.answerIssues({ questions: [c] }, { b: ['Mon', 'Other: Sat', 'Other: Sun'] }), { b: 'Choose from the options.' })
  assert.equal(M.answerText(c, ['Mon', 'Other: Sat']), 'Mon; Other: Sat')
  const renderer = read('src/components/forms/FormRenderer.jsx')
  assert.match(renderer, /function OtherText/)
  assert.match(renderer, /<option value="__other">Other…<\/option>/)
  assert.match(read('src/components/forms/FormBuilder.jsx'), /Add an "Other" choice with a text box/)
})

test('the Sheet has one column per question, keeps an earlier question, and filters like a spreadsheet', () => {
  const v1 = { version: 1, definition: { questions: [{ id: 'size', type: 'choice', label: 'Size', options: ['S', 'M'] }, { id: 'old', type: 'short', label: 'Pickup' }] } }
  const v2 = { version: 2, definition: { questions: [{ id: 'h', type: 'section', label: 'Part' }, { id: 'size', type: 'choice', label: 'Size', options: ['S', 'M'], allowOther: true }, { id: 'sig', type: 'signature', label: 'Sign' }, { id: 'n', type: 'short', label: 'Notes' }] } }
  const rows = [
    { id: 'r1', name: 'Ava', email: 'a@x.org', version: 1, answers: { size: 'S', old: 'Monday' } },
    { id: 'r2', name: 'Ben', email: 'b@x.org', version: 2, answers: { size: 'Other: XL', n: 'late' } },
  ]
  const { columns, rows: out } = M.sheetFor([v1, v2], rows)
  assert.deepEqual(columns.map(c => [c.key, !!c.earlier]), [['size', false], ['n', false], ['old', true]], 'section and signature are not columns; the earlier question stays')
  assert.deepEqual(columns[0].options, ['S', 'M', 'Other'])
  assert.deepEqual(out[0].cells, { size: 'S', n: '', old: 'Monday' })
  assert.deepEqual(out[1].cells, { size: 'Other: XL', n: 'late', old: '' })
  assert.equal(M.cellMatches(columns[0], 'Other: XL', 'Other'), true)
  assert.equal(M.cellMatches(columns[0], 'S', 'M'), false)
  assert.equal(M.cellMatches({ key: 'n' }, 'Running late', 'LATE'), true)
})

test('Responses reads the Sheet live and exports exactly what is shown to Excel', async () => {
  const pg = new PGlite()
  await pg.exec(PRELUDE); await pg.exec(read('supabase/migrations/20260927000000_signatures_phase2.sql')); await pg.exec(read('supabase/migrations/20260928000000_forms_phase3.sql'))
  const db = pgliteRest(pg)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (role, is_owner, email, full_name) VALUES ('owner', true, 'o@cshs.org', 'Owner') RETURNING *`)
  const { rows: [st] } = await pg.query(`INSERT INTO students (first_name, last_name, school, school_email) VALUES ('Ava', 'Reyes', 'UCLA', 'ava@ucla.edu') RETURNING *`)
  const form = await E.createForm(db, { title: 'Sizes', definition: { title: 'Sizes', questions: [
    { id: 'size', type: 'choice', label: 'Size', options: ['S', 'M'], allowOther: true, required: true }, { id: 'n', type: 'short', label: 'Notes' }] } }, owner)
  assert.equal(form.draft.questions[0].allowOther, true, 'the builder\'s Other switch is saved')
  await E.publish(db, form.id, owner)
  const mailer = fakeMailer()
  await E.sendForm(db, { formId: form.id, people: [{ name: 'Ava Reyes', email: 'ava@ucla.edu', studentId: st.id }, { name: 'Ben Cho', email: 'ben@x.org', schoolName: 'CSUN' }] }, { appUrl: 'https://a.test', mailer, sender: owner })
  const tok = (i) => mailer.sent[i].html.match(/#t=([A-Za-z0-9_-]{43})/)[1]
  await E.submit(db, { ...(await E.resolveLink(db, tok(0))), answers: { size: 'M', n: '=HYPERLINK("x")' } }, { mailer, appUrl: 'https://a.test' })
  await E.submit(db, { ...(await E.resolveLink(db, tok(1))), answers: { size: 'Other: XL' } }, { mailer, appUrl: 'https://a.test' })

  const sheet = await E.sheetData(db, form.id)
  assert.equal(sheet.rows.length, 2)
  const ava = sheet.rows.find(r => r.name === 'Ava Reyes')
  assert.equal(ava.school, 'UCLA', 'a student\'s school comes from their record')
  assert.equal(sheet.rows.find(r => r.name === 'Ben Cho').school, 'CSUN')

  const ben = sheet.rows.find(r => r.name === 'Ben Cho')
  const { bytes, fileName } = await E.sheetXlsx(db, form.id, { rowIds: [ben.id, ava.id], columnKeys: ['size'] })
  assert.equal(fileName, 'Sizes responses.xlsx')
  const files = unzip(bytes)
  assert.ok(files['[Content_Types].xml'] && files['xl/workbook.xml'] && files['_rels/.rels'], 'a real Office package, folders kept')
  const xml = files['xl/worksheets/sheet1.xml']
  const cells = [...xml.matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map(m => m[1])
  // FORM-SHEET-2 (this commit): School and Submitted are columns like any other, exported only
  // when shown; Name and Email always lead. Version was dropped.
  // FORM-SHEET-3: Email is a column like the others (@email), so only Name always leads.
  assert.deepEqual(cells.slice(0, 2), ['Name', 'Size'], 'only the columns shown')
  assert.equal(cells[2], 'Ben Cho', 'in the order shown')
  assert.ok(cells.includes('Other: XL'))
  assert.doesNotMatch(xml, /Notes|HYPERLINK/, 'a hidden column is not exported')
  assert.doesNotMatch(xml, /<f>/, 'no cell is a formula')
  assert.match(xml, /state="frozen"/)
})

test('the workbook escapes what XML cannot hold and never writes a formula', () => {
  const x = unzip(xlsxFor({ header: ['A'], rows: [['<b>&"\u0001'], ['=1+1']] }))['xl/worksheets/sheet1.xml']
  assert.match(x, /&lt;b&gt;&amp;&quot;<\/t>/)
  assert.match(x, /t="inlineStr".*=1\+1/)
})

test('Responses has People and Sheet; Build a form can add a category', () => {
  const r = read('src/components/forms/FormResponses.jsx')
  // RESPONSES-CANON-1 (this commit): the views are the app's SegmentedPicker, not local buttons.
  assert.match(r, /<SegmentedPicker ariaLabel="View"/)
  assert.match(r, /label: 'People'/); assert.match(r, /label: 'Sheet'/); assert.match(r, /label: 'Summary'/)
  assert.match(r, /<FormSheet formId=\{form\.id\}/)
  assert.match(r, /\{view === 'people' && \(\s*<button[^>]*remind_overdue|\{view === 'people' && \(/, 'Remind all overdue belongs to People')
  assert.match(r, /<Download size=\{16\} aria-hidden="true" \/> Download CSV/)
  assert.match(read('api/form-staff.js'), /case 'sheet_xlsx'/)
  const page = read('src/components/catalog/CatalogPage.jsx')
  assert.match(page, /\+ New category…/)
  assert.match(page, /action: 'create', display_name: newName\.trim\(\)/)
  assert.match(page, /canAddCategory=\{isOwner\}/, 'creating a category stays Owner-only, as the endpoint enforces')
})

// FORM-SUMMARY-1 (2026-09-24): Responses > Summary, per question, like Microsoft Forms.
test('the Summary counts options and Other, groups short answers, and sums up numbers and dates', () => {
  const def = { questions: [
    { id: 'h', type: 'section', label: 'Part' },
    { id: 'size', type: 'choice', label: 'Size', options: ['S', 'M', 'L'], allowOther: true },
    { id: 'days', type: 'checkboxes', label: 'Days', options: ['Mon', 'Tue'] },
    { id: 'dept', type: 'short', label: 'Department' },
    { id: 'why', type: 'paragraph', label: 'Why' },
    { id: 'sets', type: 'number', label: 'Sets' },
    { id: 'start', type: 'date', label: 'Start' },
    { id: 'sig', type: 'signature', label: 'Sign' },
  ] }
  const rows = [
    { name: 'Ava', submittedAt: '2026-09-20', answers: { size: 'M', days: ['Mon', 'Tue'], dept: 'Nursing Education', why: 'first', sets: 1, start: '2026-10-05' } },
    { name: 'Ben', submittedAt: '2026-09-22', answers: { size: 'Other: Tall', days: ['Mon'], dept: 'nursing education', why: 'second', sets: 3, start: '2026-09-01' } },
    { name: 'Cy', submittedAt: '2026-09-21', answers: { size: 'M', dept: 'ICU', sets: 2 } },
  ]
  const s = Object.fromEntries(M.summaryFor([{ version: 1, definition: def }], rows).map(q => [q.key, q]))
  assert.deepEqual(Object.keys(s), ['size', 'days', 'dept', 'why', 'sets', 'start'], 'no section, no signature')
  assert.deepEqual(s.size.options, [{ label: 'S', count: 0 }, { label: 'M', count: 2 }, { label: 'L', count: 0 }, { label: 'Other', count: 1, other: true }])
  assert.deepEqual(s.size.otherAnswers, ['Tall'])
  assert.equal(s.days.multi, true); assert.equal(s.days.answered, 2)
  assert.deepEqual(s.days.options, [{ label: 'Mon', count: 2 }, { label: 'Tue', count: 1 }])
  assert.deepEqual(s.dept.groups, [{ text: 'Nursing Education', count: 2 }, { text: 'ICU', count: 1 }], 'the same answer in any case is one group')
  assert.deepEqual(s.why.samples.map(x => x.name), ['Ben', 'Ava'], 'latest first')
  assert.deepEqual([s.sets.mean, s.sets.median, s.sets.min, s.sets.max], [2, 2, 1, 3])
  assert.deepEqual([s.start.earliest, s.start.latest, s.start.answered], ['2026-09-01', '2026-10-05', 2])
  const src = read('src/components/forms/FormSummary.jsx')
  assert.match(src, /aria-label=\{say\}/, 'every bar says its count in words')
  assert.match(read('src/components/forms/FormResponses.jsx'), /value: 'summary', label: 'Summary'/)
})

// FORM-SHEET-2 (2026-09-24, Owner: "also edit their answers"): Smartsheet-style editing. The
// submission and its PDF never change: layouts, staff values and formats are their own rows,
// and a correction is an append-only record laid over the answer.
async function sheetWorld({ migrate = true } = {}) {
  const pg = new PGlite()
  await pg.exec(PRELUDE); await pg.exec(read('supabase/migrations/20260927000000_signatures_phase2.sql')); await pg.exec(read('supabase/migrations/20260928000000_forms_phase3.sql'))
  if (migrate) { await pg.exec(read('supabase/migrations/20260929000000_form_sheet.sql')); await pg.exec(read('supabase/migrations/20260929000000_form_sheet.sql')) }
  const db = pgliteRest(pg)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (role, is_owner, email, full_name) VALUES ('owner', true, 'o@cshs.org', 'Jester') RETURNING *`)
  const form = await E.createForm(db, { title: 'Parking', definition: { title: 'Parking', questions: [
    { id: 'plate', type: 'short', label: 'Plate', required: true }, { id: 'size', type: 'choice', label: 'Size', options: ['S', 'M'] }, { id: 'sig', type: 'signature', label: 'Sign' }] } }, owner)
  await E.publish(db, form.id, owner)
  const mailer = fakeMailer()
  await E.sendForm(db, { formId: form.id, people: [{ name: 'Ava', email: 'ava@x.org', schoolName: 'CSULB' }, { name: 'Ben', email: 'ben@x.org', schoolName: 'APU' }, { name: 'Cy', email: 'cy@x.org', schoolName: 'CSULB' }] }, { appUrl: 'https://a.test', mailer, sender: owner })
  const ids = []
  for (let i = 0; i < 3; i++) {
    const link = await E.resolveLink(db, mailer.sent[i].html.match(/#t=([A-Za-z0-9_-]{43})/)[1])
    await E.submit(db, { ...link, answers: { plate: `8ABC12${i}`, size: 'S', sig: { kind: 'type', text: 'x' } } }, { mailer, appUrl: 'https://a.test' })
    ids.push(link.assignment.id)
  }
  return { pg, db, owner, form, ids }
}

test('the Sheet migration applies twice, is Owner/Admin read-only, and corrections are append-only', async () => {
  const w = await sheetWorld()
  const { rows } = await w.pg.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('form_sheet_views','form_sheet_cells','form_answer_corrections') ORDER BY relname`)
  assert.deepEqual(rows.map(r => [r.relname, r.relrowsecurity]), [['form_answer_corrections', true], ['form_sheet_cells', true], ['form_sheet_views', true]])
  await E.correctAnswer(w.db, { formId: w.form.id, assignmentId: w.ids[0], questionId: 'plate', value: '8ABD120' }, w.owner)
  await assert.rejects(w.pg.query(`UPDATE form_answer_corrections SET value = '"x"'`), /append-only/)
  await assert.rejects(w.pg.query(`DELETE FROM form_answer_corrections`), /append-only/)
  const checks = read('db/audit/form_sheet_checks.sql')
  assert.match(checks, /PRE 1\./); assert.match(checks, /POST 3\./)
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /20260929000000_form_sheet\.sql/)
})

test('a correction shows in the Sheet with who and the original, while the submission keeps what was sent', async () => {
  const w = await sheetWorld()
  await assert.rejects(E.correctAnswer(w.db, { formId: w.form.id, assignmentId: w.ids[0], questionId: 'size', value: 'XL' }, w.owner), /Choose one of the options/)
  await assert.rejects(E.correctAnswer(w.db, { formId: w.form.id, assignmentId: w.ids[0], questionId: 'sig', value: 'y' }, w.owner), /cannot be corrected/)
  await E.correctAnswer(w.db, { formId: w.form.id, assignmentId: w.ids[0], questionId: 'plate', value: ' 8ABD120 ', reason: 'Typo, confirmed by phone' }, w.owner)
  const sheet = await E.sheetData(w.db, w.form.id)
  assert.equal(sheet.editable, true)
  const ava = sheet.rows.find(r => r.id === w.ids[0])
  assert.equal(ava.cells.plate, '8ABD120')
  assert.deepEqual({ ...ava.corrected.plate, at: undefined }, { by: 'Jester', at: undefined, original: '8ABC120', reason: 'Typo, confirmed by phone' })
  const { rows: [sub] } = await w.pg.query(`SELECT answers FROM form_submissions WHERE assignment_id = $1`, [w.ids[0]])
  assert.equal(sub.answers.plate, '8ABC120', 'the submission is never changed')
  // Putting it back ends the Corrected tag; the history keeps both records.
  await E.correctAnswer(w.db, { formId: w.form.id, assignmentId: w.ids[0], questionId: 'plate', value: '8ABC120' }, w.owner)
  const again = (await E.sheetData(w.db, w.form.id)).rows.find(r => r.id === w.ids[0])
  assert.equal(again.cells.plate, '8ABC120'); assert.equal(again.corrected.plate, undefined)
  const { rows: hist } = await w.pg.query(`SELECT count(*)::int AS n FROM form_answer_corrections`)
  assert.equal(hist[0].n, 2)
})

test('layout, staff columns, values and formats save, and a format never wipes a value', async () => {
  const w = await sheetWorld()
  const layout = await E.saveSheetLayout(w.db, w.form.id, { order: ['size', 'plate'], widths: { plate: 220 }, frozen: 1, groupBy: '@school',
    staffColumns: [{ key: 's_lot001', label: 'Lot assignment', type: 'choice', options: ['P1', 'P3'] }, { key: 's_done01', label: 'Processed', type: 'check' }] }, w.owner)
  assert.equal(layout.groupBy, '@school'); assert.equal(layout.staffColumns.length, 2)
  await E.saveSheetCells(w.db, w.form.id, [{ assignmentId: w.ids[0], key: 's_lot001', value: 'P3' }, { assignmentId: w.ids[0], key: 'plate', value: 'HACK', format: { b: true, fill: 'yellow' } }], w.owner)
  await E.saveSheetCells(w.db, w.form.id, [{ assignmentId: w.ids[0], key: 's_lot001', format: { fill: 'green' } }], w.owner)
  const ava = (await E.sheetData(w.db, w.form.id)).rows.find(r => r.id === w.ids[0])
  assert.equal(ava.cells.s_lot001, 'P3', 'formatting a staff cell keeps its value')
  assert.deepEqual(ava.format.s_lot001, { fill: 'green' })
  assert.equal(ava.cells.plate, '8ABC120', 'a value sent for an answer column is ignored: answers change only by correction')
  assert.deepEqual(ava.format.plate, { b: true, fill: 'yellow' })
  const other = await E.createForm(w.db, { title: 'Other', definition: { title: 'Other', questions: [{ id: 'a', type: 'short', label: 'A' }] } }, w.owner)
  const r = await E.saveSheetCells(w.db, other.id, [{ assignmentId: w.ids[1], key: 'a', format: { b: true } }], w.owner)
  assert.equal(r.saved, 0, 'a response from another form is not touched')
})

test('the export carries order, formats, groups, staff columns and a Corrections column', async () => {
  const w = await sheetWorld()
  await E.saveSheetLayout(w.db, w.form.id, { staffColumns: [{ key: 's_lot001', label: 'Lot assignment', type: 'text' }] }, w.owner)
  await E.saveSheetCells(w.db, w.form.id, [{ assignmentId: w.ids[0], key: 's_lot001', value: 'P3', format: { b: true, fill: 'yellow', ink: 'red' } }], w.owner)
  await E.correctAnswer(w.db, { formId: w.form.id, assignmentId: w.ids[0], questionId: 'plate', value: '8ABD120' }, w.owner)
  const { bytes } = await E.sheetXlsx(w.db, w.form.id, { rowIds: w.ids, columnKeys: ['s_lot001', 'plate'], groupBy: '@school' })
  const files = unzip(bytes)
  const xml = files['xl/worksheets/sheet1.xml']
  const cells = [...xml.matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map(m => m[1])
  assert.deepEqual(cells.slice(0, 4), ['Name', 'Lot assignment', 'Plate', 'Corrections'])
  assert.equal(cells[4], 'CSULB (2)', 'a group row, like Smartsheet')
  assert.ok(cells.includes('APU (1)'))
  assert.ok(cells.some(c => /^Plate: was &quot;8ABC120&quot; \(Jester, /.test(c)), 'the export says what changed and who')
  assert.match(xml, /outlineLevel="1"/)
  assert.match(files['xl/styles.xml'], /<b\/><sz val="11"\/><color rgb="FFA32A32"\/>/)
  assert.match(files['xl/styles.xml'], /FFFFF4C2/)
})

test('before the migration the Sheet reads and exports, and says editing needs the update', async () => {
  const w = await sheetWorld({ migrate: false })
  const sheet = await E.sheetData(w.db, w.form.id)
  assert.equal(sheet.editable, false); assert.equal(sheet.rows.length, 3)
  await assert.rejects(E.saveSheetLayout(w.db, w.form.id, {}, w.owner), /database update the Owner applies/)
  await assert.rejects(E.correctAnswer(w.db, { formId: w.form.id, assignmentId: w.ids[0], questionId: 'plate', value: 'x' }, w.owner), /database update the Owner applies/)
  const { bytes } = await E.sheetXlsx(w.db, w.form.id, {})
  assert.ok(unzip(bytes)['xl/worksheets/sheet1.xml'])
})

test('every Sheet ink reads on every fill and on white', () => {
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  for (const ink of [...M.SHEET_INKS.map(i => i.hex), M.SHEET_DEFAULT_INK]) {
    for (const fill of [...M.SHEET_FILLS.map(f => f.hex), '#FFFFFF']) assert.ok(ratio(ink, fill) >= 4.5, `${ink} on ${fill}: ${ratio(ink, fill).toFixed(2)}`)
  }
})

test('the Sheet screen has the Smartsheet toolbar and never presents a correction as the original', () => {
  const src = read('src/components/forms/FormSheet.jsx')
  for (const label of ['Bold', 'Italic', 'Underline', 'Text colour', 'Fill colour', 'Wrap text', 'Clear formatting']) assert.match(src, new RegExp(`aria-label="${label}"`), label)
  assert.match(src, /Group by/); assert.match(src, /Freeze/); assert.match(src, /Column<\/button>/)
  assert.match(src, /formStaff\('sheet_correct'/)
  assert.match(src, /submitted answer and PDF stay as sent/, 'the editor says the submission is untouched')
  assert.match(src, /fs-corrtag">Corrected</)
  assert.match(src, /position: 'fixed'/, 'the editor floats so the scrolling frame never clips it')
  assert.match(src, /Formatting, staff columns and corrections need a database update/)
})

// FORM-SHEET-3 (Owner, 2026-09-24): Smartsheet's $, %, decimals, dates and column summaries.
test('number and date formats change the look, never the value, and summaries count what they should', () => {
  assert.equal(M.displayValue('1250.5', { num: 'currency' }), '$1,250.50')
  assert.equal(M.displayValue('0.256', { num: 'percent', dec: 1 }), '25.6%')
  assert.equal(M.displayValue('1234567', { comma: true }), '1,234,567')
  assert.equal(M.displayValue('3.14159', { dec: 2 }), '3.14')
  assert.equal(M.displayValue('09/15/2026', { date: 'short' }), 'Sep 15, 2026')
  assert.equal(M.displayValue('2026-09-15', { date: 'mdy' }), '09/15/2026')
  assert.equal(M.displayValue('8ABC120', { num: 'currency' }), '8ABC120', 'a plate is not a number')
  assert.equal(M.parseNumber('$1,250.50'), 1250.5); assert.equal(M.parseNumber('25%'), 0.25); assert.equal(M.parseNumber('abc'), null)
  assert.equal(M.summarize(['45', '30', 'n/a', ''], 'sum'), 75)
  assert.equal(M.summarize(['45', '30', 'n/a', ''], 'count'), 2)
  assert.equal(M.summarize(['45', '30', 'n/a', ''], 'counta'), 3)
  assert.equal(M.summarize(['1', '2'], 'avg'), 1.5)
  const l = M.cleanLayout({ colFormats: { fee: { num: 'currency', dec: 9, evil: 1 } }, summaries: { fee: 'sum', '@name': 'sum', x: 'bad' } }, ['fee'])
  assert.deepEqual(l.colFormats, { fee: { num: 'currency' } }); assert.deepEqual(l.summaries, { fee: 'sum' })
  assert.deepEqual(M.mergeFormat({ num: 'currency', b: true }, { b: false, fill: 'yellow' }), { num: 'currency', b: false, fill: 'yellow' })
})

test('the export writes formatted numbers as numbers and the summary row as real formulas', async () => {
  const w = await sheetWorld()
  const form = await E.createForm(w.db, { title: 'Fees', definition: { title: 'Fees', questions: [{ id: 'fee', type: 'number', label: 'Fee' }, { id: 'up', type: 'file', label: 'Proof' }] } }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  const mailer = fakeMailer()
  await E.sendForm(w.db, { formId: form.id, people: [{ name: 'Ava', email: 'a@x.org' }, { name: 'Ben', email: 'b@x.org' }] }, { appUrl: 'https://a.test', mailer, sender: w.owner })
  for (const [i, fee] of [[0, 45], [1, 30.5]]) {
    const link = await E.resolveLink(w.db, mailer.sent[i].html.match(/#t=([A-Za-z0-9_-]{43})/)[1])
    await E.submit(w.db, { ...link, answers: { fee } }, { mailer, appUrl: 'https://a.test' })
  }
  await E.saveSheetLayout(w.db, form.id, { colFormats: { fee: { num: 'currency' } }, summaries: { fee: 'sum' } }, w.owner)
  const files = unzip((await E.sheetXlsx(w.db, form.id, { columnKeys: ['fee'] })).bytes)
  const xml = files['xl/worksheets/sheet1.xml']
  assert.match(xml, /<v>45<\/v>/); assert.match(xml, /<v>30\.5<\/v>/)
  assert.match(xml, /<f>SUM\(B2:B3\)<\/f><v>75\.5<\/v>/, 'a real formula with its value worked out')
  assert.match(files['xl/styles.xml'], /formatCode="&quot;\$&quot;#,##0\.00"/)
  const sheet = await E.sheetData(w.db, form.id)
  assert.ok(sheet.columns.some(c => c.key === 'up' && c.type === 'file'), 'a file question is a column, shown as a link to the file')
})
