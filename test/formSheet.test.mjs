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
  assert.deepEqual(cells.slice(0, 6), ['Name', 'Email', 'School', 'Submitted', 'Version', 'Size'], 'only the columns shown')
  assert.equal(cells[6], 'Ben Cho', 'in the order shown')
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
  assert.match(r, />People<\/button>/); assert.match(r, />Sheet<\/button>/); assert.match(r, /<FormSheet formId=\{form\.id\}/)
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
  assert.match(read('src/components/forms/FormResponses.jsx'), />Summary<\/button>/)
})
