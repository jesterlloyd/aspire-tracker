// test/formsEngine.test.mjs
//
// FORMS-PHASE3: the forms engine end to end against real Postgres (PGlite) with both
// migrations it depends on, a fake mailer and an in-memory bucket. No network.
//   - the migration applies twice, a published version is frozen, the checks file reads PASS
//   - starters install once, both published; an untouched old Parking draft is replaced
//   - publish refuses an unfinished form; versioning: new sends use the latest version,
//     a submission keeps the version it was answered on
//   - send -> link -> prefill from the student record -> submit -> PDF filed to the record,
//     assignment done, a second submit refused
//   - close after due, reminders, CSV (formula cells neutralised)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PDFDocument } from 'pdf-lib'
import { pgliteRest, fakeMailer } from './helpers/pgliteRest.mjs'

process.env.FORM_TOKEN_SECRET = 'f'.repeat(48)
const E = await import('../lib/server/forms/engine.js')
const { formTokenFor } = await import('../lib/server/forms/tokens.js')
const M = await import('../src/lib/forms/formModel.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sigMigration = readFileSync(join(root, 'supabase/migrations/20260927000000_signatures_phase2.sql'), 'utf8')
const formsMigration = readFileSync(join(root, 'supabase/migrations/20260928000000_forms_phase3.sql'), 'utf8')

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, role text, is_owner boolean DEFAULT false, is_active boolean DEFAULT true, email text, full_name text);
  CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, status text, start_date date, end_date date);
  CREATE TABLE cohort_school_rotations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rotation_start_date date, rotation_end_date date);
  CREATE TABLE students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, first_name text, preferred_first_name text, last_name text,
    school text, status text, unit text, preceptor_name text, term_dates text, hours_required int, approved_hours int, pending_hours int,
    headshot_url text, phone text, badge_created boolean, cohort_school_rotation_id uuid, is_demo boolean DEFAULT false, school_email text);
  CREATE TABLE contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, phone text);
  CREATE TABLE catalog_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, title text, description text, category text,
    resource_type text, storage_path text, file_type_label text, kind text DEFAULT 'file', audience text[], tags text[], is_pinned boolean,
    is_active boolean, created_by uuid, updated_by uuid, updated_at timestamptz);
  CREATE TABLE record_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text, student_id uuid, school_name text, title text, file_name text,
    storage_path text, content_type text, size_bytes bigint, source text, source_ref uuid, is_demo boolean, created_by uuid, created_at timestamptz DEFAULT now());
  CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE OR REPLACE FUNCTION public.is_active_owner_or_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`

async function world() {
  const pg = new PGlite()
  await pg.exec(PRELUDE); await pg.exec(sigMigration); await pg.exec(formsMigration)
  const db = pgliteRest(pg)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (role, is_owner, email, full_name) VALUES ('owner', true, 'owner@cshs.org', 'Jester Lloyd Bautista') RETURNING *`)
  const { rows: [rot] } = await pg.query(`INSERT INTO cohort_school_rotations (rotation_start_date, rotation_end_date) VALUES ('2026-10-05', '2026-12-11') RETURNING id`)
  const { rows: [student] } = await pg.query(`INSERT INTO students (first_name, last_name, school, unit, phone, cohort_school_rotation_id, school_email)
    VALUES ('Ava', 'Reyes', 'UCLA', '6 NE', '(310) 555-0101', $1, 'ava@ucla.edu') RETURNING *`, [rot.id])
  return { pg, db, owner, student, mailer: fakeMailer() }
}
const appUrl = 'https://aspire.test'
const tokenOf = (url) => url.match(/#t=([A-Za-z0-9_-]{43})/)[1]

test('the migration applies twice; a published version cannot be changed', async () => {
  const w = await world()
  await w.pg.exec(formsMigration)
  const form = await E.createForm(w.db, { title: 'Test form', definition: { title: 'Test form', questions: [M.newQuestion('short', 'a')] } }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  await assert.rejects(w.pg.query(`UPDATE catalog_form_versions SET definition = '{"questions":[]}' WHERE form_id = $1`, [form.id]), /frozen/)
  const { rows } = await w.pg.query(`SELECT public FROM storage.buckets WHERE id = 'form-files'`)
  assert.equal(rows[0].public, false)
})

// PARKING-FORM-1 (2026-09-24): Parking now ships published, as Parking Services' own form.
test('starters install once, both published', async () => {
  const w = await world()
  const first = await E.installStarters(w.db, w.owner)
  assert.deepEqual(first.map(r => [r.key, r.added, !!r.published]), [['scrubex-request-form', true, true], ['student-parking-request', true, true]])
  const again = await E.installStarters(w.db, w.owner)
  assert.ok(again.every(r => r.added === false && !r.refreshed))
  const { rows } = await w.pg.query(`SELECT c.slug, c.kind, c.storage_path, f.status, f.current_version FROM catalog_resources c JOIN catalog_forms f ON f.catalog_resource_id = c.id ORDER BY c.slug`)
  assert.deepEqual(rows.map(r => [r.slug, r.kind, r.status, r.current_version]), [['scrubex-request-form', 'form', 'published', 1], ['student-parking-request', 'form', 'published', 1]])
  assert.ok(rows.every(r => /^form:/.test(r.storage_path)))
})

test('an untouched earlier Parking draft gets Parking Services\' form; an edited one is left alone', async () => {
  const w = await world()
  const old = M.RETIRED_STARTER_DRAFTS['student-parking-request'][0]
  const untouched = await E.createForm(w.db, { title: old.title, starterKey: 'student-parking-request', definition: old }, w.owner)
  const out = await E.installStarters(w.db, w.owner)
  assert.deepEqual(out.find(r => r.key === 'student-parking-request'), { key: 'student-parking-request', id: untouched.id, added: false, refreshed: true, published: true })
  const { rows: [v] } = await w.pg.query(`SELECT definition FROM catalog_form_versions WHERE form_id = $1`, [untouched.id])
  assert.deepEqual(v.definition.questions.map(q => q.id), M.STARTER_FORMS[1].definition.questions.map(q => q.id))

  const w2 = await world()
  const edited = await E.createForm(w2.db, { title: old.title, starterKey: 'student-parking-request', definition: { ...old, description: 'Mine.' } }, w2.owner)
  const out2 = await E.installStarters(w2.db, w2.owner)
  assert.deepEqual(out2.find(r => r.key === 'student-parking-request'), { key: 'student-parking-request', id: edited.id, added: false })
  const { rows: [f] } = await w2.pg.query(`SELECT status, draft FROM catalog_forms WHERE id = $1`, [edited.id])
  assert.equal(f.status, 'draft')
  assert.equal(f.draft.description, 'Mine.')
})

// PARKING-PDF-1: the Owner published the earlier draft before the correction; its sent
// links keep version 1, new links get Parking Services' form as version 2.
test('an earlier Parking form that was published unedited gets the new form as version 2', async () => {
  const w = await world()
  const old = M.RETIRED_STARTER_DRAFTS['student-parking-request'][0]
  const form = await E.createForm(w.db, { title: old.title, starterKey: 'student-parking-request', definition: old }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  const out = await E.installStarters(w.db, w.owner)
  assert.deepEqual(out.find(r => r.key === 'student-parking-request'), { key: 'student-parking-request', id: form.id, added: false, refreshed: true, published: true })
  const { rows } = await w.pg.query(`SELECT version, definition FROM catalog_form_versions WHERE form_id = $1 ORDER BY version`, [form.id])
  assert.deepEqual(rows.map(r => r.version), [1, 2])
  assert.ok(rows[0].definition.questions.some(q => q.id === 'full_name'), 'version 1 is untouched')
  assert.ok(E.layoutFor({ starter_key: 'student-parking-request' }, rows[1].definition))
  const again = await E.installStarters(w.db, w.owner)
  assert.ok(!again.find(r => r.key === 'student-parking-request').refreshed, 'it happens once')

  // A link sent now is answered on version 2 and filed in Parking Services' layout.
  await E.sendForm(w.db, { formId: form.id, people: [{ name: 'Ava Reyes', email: 'ava@ucla.edu', studentId: w.student.id }] }, { appUrl, mailer: w.mailer, sender: w.owner })
  const link = await E.resolveLink(w.db, tokenOf(w.mailer.sent.at(-1).html))
  assert.equal(link.assignment.form_version, 2)
  const answers = { first_name: 'Ava', last_name: 'Reyes', school: 'UCLA', phone: '310-555-0100', email: 'ava@ucla.edu', department: '6 NE', parking_app: 'No',
    shift: 'Days', status: 'Part-time (PT)', start: '2026-09-15', end: '2026-12-15', duration: '13 weeks', days: ['Monday'],
    v1_make: 'Honda Civic', v1_color: 'Blue', v1_state: 'CA', v1_plate: '8ABC123', sig: { kind: 'type', text: 'Ava Reyes' } }
  const done = await E.submit(w.db, { ...link, answers }, { mailer: w.mailer, appUrl })
  const pdf = await PDFDocument.load(Buffer.from(done.pdf, 'base64'))
  assert.equal(pdf.getSubject(), 'Students Parking Data (SPD)')
  assert.equal(pdf.getPageCount(), 1)
})

test('the Parking form asks every field on Parking Services\' form, and prefills what ASPIRE knows', () => {
  const parking = M.STARTER_FORMS.find(s => s.slug === 'student-parking-request')
  const labels = parking.definition.questions.map(q => q.label)
  for (const l of ['Badge number', 'First name', 'Last name', 'School name', 'Telephone', 'Email', 'Building', 'Department', 'Parking App access',
    'Shift', 'Status', 'Start date', 'End date', 'Rotation duration', 'Days of the week',
    'Vehicle 1 make and model', 'Vehicle 1 color', 'Vehicle 1 state', 'Vehicle 1 license plate',
    'Vehicle 2 make and model', 'Vehicle 2 color', 'Vehicle 2 state', 'Vehicle 2 license plate', 'Signature']) assert.ok(labels.includes(l), l)
  assert.deepEqual(M.definitionIssues(parking.definition), [])
  assert.match(parking.definition.questions.find(q => q.type === 'signature').help, /agree to comply .* Parking Guide/)
  for (const q of parking.definition.questions) {
    if (q.prefill) assert.ok(M.prefillSource(q.prefill) && M.prefillFits(q.type, q.prefill), q.id)
    for (const o of q.options || []) assert.ok(o.length <= 120, `${q.id} option fits the stored limit`)
    assert.ok(q.help.length <= 500 && q.label.length <= 300, q.id)
  }
})

test('publish refuses an unfinished form, in words', async () => {
  const w = await world()
  const form = await E.createForm(w.db, { title: 'Empty' }, w.owner)
  await assert.rejects(E.publish(w.db, form.id, w.owner), /Add at least one question/)
  await assert.rejects(E.sendForm(w.db, { formId: form.id, people: [{ name: 'X', email: 'x@y.org' }] }, { appUrl, mailer: w.mailer, sender: w.owner }), /Publish the form/)
})

test('send, prefill, submit: the PDF is filed to the student record and the link closes', async () => {
  const w = await world()
  await E.installStarters(w.db, w.owner)
  const { rows: [f] } = await w.pg.query(`SELECT id FROM catalog_forms WHERE starter_key = 'scrubex-request-form'`)
  const out = await E.sendForm(w.db, { formId: f.id, people: [{ name: 'Ava Reyes', email: 'ava@ucla.edu', studentId: w.student.id }, { name: 'dup', email: 'AVA@ucla.edu' }],
    dueAt: '2026-10-01T23:59:00Z', subject: 'ScrubEx sizes', message: 'Hi {first name}, please fill this in.' }, { appUrl, mailer: w.mailer, sender: w.owner })
  assert.equal(out.created, 1, 'a duplicate address is sent once')
  assert.equal(out.sent, 1)
  const mail = w.mailer.sent[0]
  assert.equal(mail.subject, 'ScrubEx sizes')
  assert.match(mail.html, /Hi Ava, please fill this in\./)
  const token = tokenOf(mail.html)
  const { rows: [a0] } = await w.pg.query(`SELECT token_hash FROM form_assignments`)
  assert.notEqual(a0.token_hash, token, 'only the hash is stored')

  const link = await E.resolveLink(w.db, token)
  const state = await E.respondentState(w.db, link)
  assert.equal(state.state, 'open')
  assert.equal(state.prefill.full_name, 'Ava Reyes')
  assert.equal(state.prefill.unit, '6 NE')
  const known = await E.prefillFor(w.db, link.assignment)
  assert.equal(known['student.first_name'], 'Ava', 'the Parking form splits the legal name')
  assert.equal(known['student.last_name'], 'Reyes')

  await assert.rejects(E.submit(w.db, { ...(await E.resolveLink(w.db, token)), answers: { full_name: 'Ava Reyes', unit: '6 NE', top: 'M', pant: 'L', sets: 9, sig: { kind: 'type', text: 'Ava Reyes' } } },
    { mailer: w.mailer, appUrl }), /Sets needed: The largest allowed is 3/)

  const done = await E.submit(w.db, { ...(await E.resolveLink(w.db, token)), answers: { full_name: 'Ava Reyes', unit: '6 NE', top: 'M', pant: 'L', sets: 2, pickup: '2026-10-02', sig: { kind: 'type', text: 'Ava Reyes' }, junk: 'x' }, ctx: { ip: '10.0.0.9', userAgent: 'UA' } },
    { mailer: w.mailer, appUrl })
  assert.equal(done.filed, true)
  const pdf = await PDFDocument.load(Buffer.from(done.pdf, 'base64'))
  assert.ok(pdf.getPageCount() >= 1)
  const { rows: [rec] } = await w.pg.query(`SELECT * FROM record_documents`)
  assert.equal(rec.student_id, w.student.id)
  assert.equal(rec.source, 'form_submission')
  const { rows: [sub] } = await w.pg.query(`SELECT answers, form_version, ip FROM form_submissions`)
  assert.equal(sub.form_version, 1)
  assert.equal(sub.answers.junk, undefined, 'answers to questions the form does not have are dropped')
  assert.equal(sub.ip, '10.0.0.9')
  const after = await E.respondentState(w.db, await E.resolveLink(w.db, token))
  assert.equal(after.state, 'done')
  await assert.rejects(E.submit(w.db, { ...(await E.resolveLink(w.db, token)), answers: {} }, { mailer: w.mailer, appUrl }), /already submitted/)
})

test('a new version reaches new links only; the earlier submission keeps its version', async () => {
  const w = await world()
  const form = await E.createForm(w.db, { title: 'Versioned', definition: { title: 'Versioned', questions: [{ id: 'a', type: 'short', label: 'A', required: true }] } }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  await E.sendForm(w.db, { formId: form.id, people: [{ name: 'One', email: 'one@x.org' }] }, { appUrl, mailer: w.mailer, sender: w.owner })
  await E.saveDraft(w.db, form.id, { draft: { title: 'Versioned', questions: [{ id: 'a', type: 'short', label: 'A', required: true }, { id: 'b', type: 'short', label: 'B', required: true }] } }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  await E.sendForm(w.db, { formId: form.id, people: [{ name: 'Two', email: 'two@x.org' }] }, { appUrl, mailer: w.mailer, sender: w.owner })
  const one = await E.respondentState(w.db, await E.resolveLink(w.db, tokenOf(w.mailer.sent[0].html)))
  const two = await E.respondentState(w.db, await E.resolveLink(w.db, tokenOf(w.mailer.sent[1].html)))
  assert.equal(one.definition.questions.length, 1)
  assert.equal(two.definition.questions.length, 2)
  assert.equal(two.version, 2)
})

test('close after due, reminders, and the CSV export', async () => {
  const w = await world()
  const form = await E.createForm(w.db, { title: 'Parking', definition: { title: 'Parking', questions: [{ id: 'plate', type: 'short', label: 'Plate', required: true }] }, settings: { closeAfterDue: true } }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  await E.sendForm(w.db, { formId: form.id, people: [{ name: 'Late', email: 'late@x.org' }, { name: 'Ok', email: 'ok@x.org' }], dueAt: '2026-10-01T00:00:00Z' }, { appUrl, mailer: w.mailer, sender: w.owner })
  const okToken = tokenOf(w.mailer.sent[1].html)
  const [lateLink, okLink] = [await E.resolveLink(w.db, tokenOf(w.mailer.sent[0].html)), await E.resolveLink(w.db, okToken)]
  assert.equal(E.linkState(lateLink.assignment, lateLink.version.settings, Date.parse('2026-10-02')).open, false)
  await E.submit(w.db, { ...okLink, answers: { plate: '=HYPERLINK("x")' } }, { mailer: w.mailer, appUrl })

  // Three days after sending, before the due date: one reminder to the one still open.
  await w.pg.query(`UPDATE form_assignments SET sent_at = now() - interval '4 days', due_at = now() + interval '10 days'`)
  const r1 = await E.maintenance(w.db, { appUrl, mailer: w.mailer })
  assert.equal(r1.reminded, 1)
  assert.match(w.mailer.sent.at(-1).subject, /^Reminder: /)
  // Past the due date: closed, no more reminders.
  await w.pg.query(`UPDATE form_assignments SET due_at = now() - interval '1 day' WHERE status IN ('sent','opened')`)
  const r2 = await E.maintenance(w.db, { appUrl, mailer: w.mailer })
  assert.equal(r2.closed, 1)
  assert.equal(r2.reminded, 0)

  const { csv } = await E.exportCsv(w.db, form.id)
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0], 'Submitted,Name,Email,Plate')
  assert.match(lines[1], /,Ok,ok@x\.org,"'=HYPERLINK\(""x""\)"$/, 'a formula is exported as text')
  assert.equal(lines.length, 2, 'only submitted answers are exported')
})

test('the PDF takes every question type, a drawn signature and characters its fonts cannot encode', async () => {
  const { buildSubmissionPdf } = await import('../lib/server/forms/formPdf.js')
  const def = { title: 'Everything “quoted” 日本', description: 'A long description '.repeat(30), questions: [
    { id: 's', type: 'section', label: 'Part one', help: 'Intro' },
    { id: 'a', type: 'short', label: 'Short', required: true }, { id: 'b', type: 'paragraph', label: 'Paragraph' },
    { id: 'c', type: 'choice', label: 'Choice', options: ['X', 'Y'] }, { id: 'd', type: 'checkboxes', label: 'Boxes', options: ['X', 'Y'] },
    { id: 'e', type: 'dropdown', label: 'Drop', options: ['X', 'Y'] }, { id: 'f', type: 'number', label: 'Number' },
    { id: 'g', type: 'date', label: 'Date' }, { id: 'h', type: 'file', label: 'File' }, { id: 'i', type: 'signature', label: 'Sign', help: 'I agree.' },
    ...Array.from({ length: 30 }, (_, n) => ({ id: `z${n}`, type: 'short', label: `Filler ${n}` })),
  ] }
  const bytes = await buildSubmissionPdf({ definition: def, who: { name: 'Zoë 李', email: 'z@x.org' }, meta: { submissionId: 'abc', version: 3 },
    answers: { a: 'Hello 👋', b: 'Line one\nLine two '.repeat(40), c: 'X', d: ['X', 'Y'], e: 'Y', f: 2, g: '2026-10-02', h: { path: 'uploads/x/y.pdf', name: 'proof.pdf' },
      i: { kind: 'draw', path: 'M10 20 L40 5 L70 25 Q85 10 95 20', text: 'Zoe' } } })
  const pdf = await PDFDocument.load(bytes)
  assert.ok(pdf.getPageCount() >= 2, 'long answers flow onto more pages')
})

// STARTER-RESET-1 (2026-09-24): the Owner's form was the old Parking draft published as v1
// AND v2, so no automatic refresh applied. The builder offers the starter; one click replaces it.
test('a starter form that drifted from its starter is offered it, and replaced only on request', async () => {
  const w = await world()
  const old = M.RETIRED_STARTER_DRAFTS['student-parking-request'][0]
  const form = await E.createForm(w.db, { title: old.title, starterKey: 'student-parking-request', definition: old }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  await E.saveDraft(w.db, form.id, { draft: { ...old, description: old.description + ' ' } }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  const before = await E.loadForm(w.db, form.id)
  assert.equal(M.starterUpdateFor(before)?.slug, 'student-parking-request', 'the builder offers the updated starter')
  assert.equal(M.starterUpdateFor({ ...before, starter_key: null }), null, 'a form of your own is never offered one')

  const saved = await E.applyStarter(w.db, form.id, w.owner)
  assert.equal(saved.status, 'published')
  assert.equal(saved.current_version, 2, 'replacing the draft publishes nothing')
  assert.equal(saved.draft.questions[1].id, 'badge')
  assert.equal(M.starterUpdateFor(saved), null, 'once replaced, the offer goes away')
  await assert.rejects(E.applyStarter(w.db, form.id, w.owner), /already matches its starter/)
  const v3 = await E.publish(w.db, form.id, w.owner)
  assert.equal(v3.current_version, 3)
  assert.equal(E.layoutFor(v3, (await E.versionOf(w.db, form.id, 3)).definition), 'parking-spd')
})

test('the same definition compares equal whatever jsonb and the builder did to it', () => {
  const d = M.STARTER_FORMS[1].definition
  const shuffled = { questions: d.questions.map(q => Object.fromEntries(Object.entries({ ...q, prefill: q.prefill ?? '' }).reverse())), description: d.description, title: ` ${d.title} ` }
  assert.ok(M.sameDefinition(d, shuffled))
  assert.ok(!M.sameDefinition(d, { ...d, questions: d.questions.slice(1) }))
})

// PARKING-PDF-1: the Parking request is filed in Parking Services' own layout.
test('the Parking PDF is drawn in the SPD layout, and nothing answered is dropped', async () => {
  const { buildSubmissionPdf } = await import('../lib/server/forms/formPdf.js')
  const parking = M.STARTER_FORMS.find(s => s.slug === 'student-parking-request')
  const old = M.RETIRED_STARTER_DRAFTS['student-parking-request'][0]
  assert.equal(E.layoutFor({ starter_key: 'student-parking-request' }, parking.definition), 'parking-spd')
  assert.equal(E.layoutFor({ starter_key: 'student-parking-request' }, old), null, 'a version answered on the old questions keeps the plain PDF')
  assert.equal(E.layoutFor({ starter_key: 'scrubex-request-form' }, parking.definition), null)
  assert.equal(E.layoutFor({ starter_key: null }, parking.definition), null)

  const answers = { first_name: 'Ava', last_name: 'Reyes', school: 'UCLA', parking_app: 'Yes', days: ['Monday', 'Friday'], start: '2026-09-15',
    v1_make: 'A very long make and model name that cannot possibly fit its box', v1_plate: '9G0S24', sig: { kind: 'type', text: 'Ava Reyes' } }
  const meta = { submissionId: 'abc', version: 2, submittedAt: '2026-09-24T09:08:00Z' }
  const one = await PDFDocument.load(await buildSubmissionPdf({ definition: parking.definition, answers, who: { name: 'Ava' }, meta, layout: 'parking-spd' }))
  assert.equal(one.getPageCount(), 1, 'the SPD form is one page, as theirs is')
  assert.equal(one.getSubject(), 'Students Parking Data (SPD)')
  assert.deepEqual(one.getPage(0).getSize(), { width: 612, height: 792 })

  const withExtra = { ...parking.definition, questions: [...parking.definition.questions, { id: 'added', type: 'short', label: 'Emergency contact', help: '', required: false }] }
  const two = await PDFDocument.load(await buildSubmissionPdf({ definition: withExtra, answers: { ...answers, added: 'Mom' }, who: { name: 'Ava' }, meta, layout: 'parking-spd',
    logo: readFileSync(join(root, 'public/Cedars-Sinai.png')) }))
  assert.equal(two.getPageCount(), 2, 'a question the layout has no box for is listed on a second page')
  const drawn = await PDFDocument.load(await buildSubmissionPdf({ definition: parking.definition, answers: { ...answers, sig: { kind: 'draw', path: 'M10 20 L40 5 L70 25' } }, who: {}, meta, layout: 'parking-spd', logo: Buffer.from('not an image') }))
  assert.equal(drawn.getPageCount(), 1, 'a drawn signature and an unreadable logo still file one page')
})

// The Owner's checks file is run here, so its SQL parses and its PASS values are real.
test('db/audit/forms_phase3_checks.sql: PRE 1 all false before, POST reads PASS after', async () => {
  const checks = readFileSync(join(root, 'db/audit/forms_phase3_checks.sql'), 'utf8')
  const sections = {}
  for (const part of checks.split(/\n(?=-- ── )/)) {
    const m = part.match(/^-- ── (PRE|POST) (\d)\./)
    if (m) sections[`${m[1]} ${m[2]}`] = part.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  }
  assert.deepEqual(Object.keys(sections), ['PRE 1', 'PRE 2', 'POST 1', 'POST 2', 'POST 3', 'POST 4', 'POST 5'])
  const pg = new PGlite()
  await pg.exec(PRELUDE); await pg.exec(sigMigration)
  const pre1 = (await pg.query(sections['PRE 1'])).rows[0]
  assert.ok(Object.values(pre1).every(v => v === false), JSON.stringify(pre1))
  await pg.query(sections['PRE 2'])
  await pg.exec(formsMigration)
  const post1 = (await pg.query(sections['POST 1'])).rows
  assert.deepEqual(post1.map(r => [r.table_name, r.rls, r.has_org_id]),
    [['catalog_form_versions', true, true], ['catalog_forms', true, true], ['form_assignments', true, true], ['form_submissions', true, true]])
  const post2 = (await pg.query(sections['POST 2'])).rows
  assert.equal(post2.length, 4)
  assert.ok(post2.every(r => r.cmd === 'SELECT'))
  assert.deepEqual((await pg.query(sections['POST 3'])).rows.map(r => r.tgname), ['trg_catalog_form_versions_frozen'])
  const post4 = (await pg.query(sections['POST 4'])).rows[0]
  assert.deepEqual([post4.public, Number(post4.file_size_limit)], [false, 10485760])
  assert.deepEqual(Object.values((await pg.query(sections['POST 5'])).rows[0]).map(Number), [0, 0, 0])
})
