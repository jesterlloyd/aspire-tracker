// test/formsEngine.test.mjs
//
// FORMS-PHASE3: the forms engine end to end against real Postgres (PGlite) with both
// migrations it depends on, a fake mailer and an in-memory bucket. No network.
//   - the migration applies twice, a published version is frozen, the checks file reads PASS
//   - starters install once; ScrubEx publishes, Parking stays a draft
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

test('starters install once: ScrubEx is published, Parking waits as a draft', async () => {
  const w = await world()
  const first = await E.installStarters(w.db, w.owner)
  assert.deepEqual(first.map(r => [r.key, r.added, !!r.published]), [['scrubex-request-form', true, true], ['student-parking-request', true, false]])
  const again = await E.installStarters(w.db, w.owner)
  assert.ok(again.every(r => r.added === false))
  const { rows } = await w.pg.query(`SELECT c.slug, c.kind, c.storage_path, f.status, f.current_version FROM catalog_resources c JOIN catalog_forms f ON f.catalog_resource_id = c.id ORDER BY c.slug`)
  assert.deepEqual(rows.map(r => [r.slug, r.kind, r.status, r.current_version]), [['scrubex-request-form', 'form', 'published', 1], ['student-parking-request', 'form', 'draft', 0]])
  assert.ok(rows.every(r => /^form:/.test(r.storage_path)))
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
