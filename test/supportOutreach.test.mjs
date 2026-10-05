// SUPPORT-OUTREACH-1 (résumé review build, Phase 4): a résumé review sent from Outreach logs
// Résumé Review on the send date; a document request logs nothing; copying logs nothing.
// What these tests hold:
//   - the handoff is a claim, verified before any mail client exists (this recipient's review,
//     a student on that cycle's roster, a known document type);
//   - attachments come only from this student's own document versions, checked like Catalog files;
//   - the support entry is written once, for the Pacific send date, only after a logged send,
//     and marks the review Sent; a repeat the same day is "already logged", never an error;
//   - before the source migration, the same entry is written without the source columns;
//   - Log Group Activity no longer offers Résumé Review.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PDFDocument } from 'pdf-lib'
import { verifySupportHandoff, resolveDocumentAttachments, recordSupportSend, pacificDay } from '../lib/server/supportHandoff.js'
import { insertSupportEntries } from '../lib/server/ngrpSupportLog.js'
import { BULK_ACTIVITY_KEYS } from '../src/lib/ngrp/ngrpSupportActivities.js'
import { handoffChip, supportRefFor, sentMessage, resumeReviewHandoff, documentRequestHandoff, outreachHandoffPath } from '../src/lib/documents/supportHandoffModel.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const S = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const CYCLE = '22222222-2222-4222-8222-222222222222'
const REVIEW = '33333333-3333-4333-8333-333333333333'
const VER = '44444444-4444-4444-8444-444444444444'

function fakeDb(tables, { failSourceColumns = false, unique = [] } = {}) {
  let seq = 0
  const log = []
  return {
    log,
    tables,
    from(t) {
      tables[t] ||= []
      const f = []; let mode = 'select', payload = null, opts = {}
      const run = () => {
        const rows = tables[t]
        if (mode === 'select') return { data: rows.filter(r => f.every(x => x(r))), error: null }
        if (mode === 'update') { rows.filter(r => f.every(x => x(r))).forEach(r => Object.assign(r, payload)); log.push(`update:${t}`); return { data: null, error: null } }
        const list = Array.isArray(payload) ? payload : [payload]
        if (t === 'ngrp_support_entries' && failSourceColumns && list.some(r => 'source' in r)) return { data: null, error: { code: '42703', message: 'column source does not exist' } }
        if (t === 'ngrp_support_entries' && list.some(p => rows.some(r => !r.voided_at && r.candidate_id === p.candidate_id && r.activity === p.activity && r.occurred_on === p.occurred_on))) return { data: null, error: { code: '23505' } }
        const made = []
        for (const p of list) {
          if (t === 'ngrp_candidates' && opts.ignoreDuplicates && rows.some(r => r.cycle_id === p.cycle_id && r.student_id === p.student_id)) continue
          const r = { id: `${t}-${++seq}`, ...p }; rows.push(r); made.push(r)
        }
        log.push(`insert:${t}`)
        return { data: made, error: null }
      }
      const q = {
        select() { return q }, order() { return q }, limit() { return q },
        eq(k, v) { f.push(r => r[k] === v); return q }, in(k, v) { f.push(r => v.includes(r[k])); return q },
        is(k, v) { f.push(r => (r[k] ?? null) === v); return q },
        insert(p) { mode = 'insert'; payload = p; return q }, upsert(p, o) { mode = 'insert'; payload = p; opts = o || {}; return q },
        update(p) { mode = 'update'; payload = p; return q },
        maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }) },
        then(a, b) { return Promise.resolve(run()).then(a, b) },
      }
      void unique
      return q
    },
  }
}
const roster = (ids) => async () => ({ state: 'ok', students: ids.map(id => ({ id })) })

test('the handoff is verified: this recipient\'s scored review, a student on that cycle, a known document type', async () => {
  const db = fakeDb({ resume_reviews: [{ id: REVIEW, student_id: S, status: 'scored', document_version_id: VER }], student_document_types: [{ key: 'bls', label: 'BLS Card' }] })
  const ok = await verifySupportHandoff({ db, ref: { kind: 'resume_review', cycle_id: CYCLE, resume_review_id: REVIEW }, recipientType: 'student', recipientId: S, loadPayload: roster([S]) })
  assert.equal(ok.ok, true)
  assert.deepEqual([ok.handoff.templateKey, ok.handoff.reviewId], ['support_resume_review', REVIEW])
  const wrongStudent = await verifySupportHandoff({ db, ref: { kind: 'resume_review', cycle_id: CYCLE, resume_review_id: REVIEW }, recipientType: 'student', recipientId: OTHER, loadPayload: roster([OTHER]) })
  assert.equal(wrongStudent.code, 'review_mismatch')
  const offRoster = await verifySupportHandoff({ db, ref: { kind: 'resume_review', cycle_id: CYCLE, resume_review_id: REVIEW }, recipientType: 'student', recipientId: S, loadPayload: roster([]) })
  assert.equal(offRoster.code, 'not_on_roster')
  db.tables.resume_reviews[0].status = 'scoring'
  const unscored = await verifySupportHandoff({ db, ref: { kind: 'resume_review', cycle_id: CYCLE, resume_review_id: REVIEW }, recipientType: 'student', recipientId: S, loadPayload: roster([S]) })
  assert.equal(unscored.code, 'review_not_scored')
  const req = await verifySupportHandoff({ db, ref: { kind: 'document_request', cycle_id: CYCLE, doc_type: 'bls' }, recipientType: 'student', recipientId: S, loadPayload: roster([S]) })
  assert.deepEqual([req.ok, req.handoff.templateKey, req.handoff.meta.document_type], [true, 'support_document_request', 'bls'])
  const bad = await verifySupportHandoff({ db, ref: { kind: 'document_request', cycle_id: CYCLE, doc_type: 'passport' }, recipientType: 'student', recipientId: S, loadPayload: roster([S]) })
  assert.equal(bad.code, 'bad_doc_type')
  const contact = await verifySupportHandoff({ db, ref: { kind: 'resume_review', cycle_id: CYCLE, resume_review_id: REVIEW }, recipientType: 'contact', recipientId: S, loadPayload: roster([S]) })
  assert.equal(contact.code, 'not_student')
})

test('attachments: only this student\'s own versions, checked like a Catalog file', async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  const pdf = Buffer.from(await doc.save())
  const tables = {
    student_document_versions: [{ id: VER, document_id: 'd1', storage_bucket: 'student-documents', storage_path: 'x/resume/a.pdf', file_name: 'Ortiz_Resume.pdf' }],
    student_documents: [{ id: 'd1', student_id: S }],
  }
  const storage = { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.length) }, error: null }) }) }
  const ok = await resolveDocumentAttachments({ db: fakeDb(tables), storage, versionIds: [VER], studentId: S })
  assert.equal(ok.ok, true)
  assert.deepEqual([ok.attachments[0].filename, ok.attachments[0].contentType, ok.summary[0].source], ['Ortiz_Resume.pdf', 'application/pdf', 'student_document'])
  const other = await resolveDocumentAttachments({ db: fakeDb(tables), storage, versionIds: [VER], studentId: OTHER })
  assert.equal(other.code, 'document_mismatch')
  const fake = { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => Buffer.from('not a pdf').buffer }, error: null }) }) }
  const bad = await resolveDocumentAttachments({ db: fakeDb(tables), storage: fake, versionIds: [VER], studentId: S })
  assert.equal(bad.code, 'document_invalid')
  assert.equal((await resolveDocumentAttachments({ db: fakeDb(tables), storage, versionIds: ['nope'], studentId: S })).code, 'bad_documents')
})

test('a sent review logs Résumé Review once, for the Pacific send date, and marks the review Sent', async () => {
  const tables = { ngrp_candidates: [], ngrp_support_entries: [], resume_reviews: [{ id: REVIEW, student_id: S, status: 'scored' }] }
  const db = fakeDb(tables)
  const handoff = { kind: 'resume_review', cycleId: CYCLE, reviewId: REVIEW }
  // 01:30 UTC on Oct 6 is still Oct 5 in Los Angeles.
  const sentAt = '2026-10-06T01:30:00.000Z'
  const a = await recordSupportSend({ db, handoff, studentId: S, notificationLogId: 'log-1', actorId: 'owner', sentAt })
  assert.deepEqual(a, { occurredOn: '2026-10-05', alreadyRecorded: false })
  const e = tables.ngrp_support_entries[0]
  assert.deepEqual([e.activity, e.occurred_on, e.source, e.source_ref, e.cycle_id], ['resume_review', '2026-10-05', 'outreach', 'log-1', CYCLE])
  assert.equal(tables.ngrp_candidates.length, 1, 'an alumnus with no form is enrolled as the entry is written')
  assert.deepEqual([tables.resume_reviews[0].status, tables.resume_reviews[0].outreach_message_id], ['sent', 'log-1'])
  const b = await recordSupportSend({ db, handoff, studentId: S, notificationLogId: 'log-2', actorId: 'owner', sentAt: '2026-10-05T20:00:00.000Z' })
  assert.deepEqual(b, { occurredOn: '2026-10-05', alreadyRecorded: true })
  assert.equal(tables.ngrp_support_entries.length, 1, 'a second send the same day is one entry')
  assert.deepEqual(await recordSupportSend({ db, handoff: { kind: 'document_request' }, studentId: S, sentAt }), { skipped: true })
  assert.equal(pacificDay('2026-07-01T06:59:00Z'), '2026-06-30')
})

test('before the source migration the same entry is written without the source columns', async () => {
  const tables = { ngrp_support_entries: [] }
  const r = await insertSupportEntries(fakeDb(tables, { failSourceColumns: true }), [{ candidate_id: 'c', activity: 'town_hall', occurred_on: '2026-10-01', source: 'bulk', source_ref: null }])
  assert.equal(r.error, null)
  assert.equal('source' in tables.ngrp_support_entries[0], false)
})

test('the send endpoint verifies before it mails, and logs support only after a logged send', () => {
  const src = read('api/connect-send-direct-email.js')
  const verifyAt = src.indexOf('verifySupportHandoff({')
  const mailerAt = src.indexOf('const resend = createMailer()')
  const previewAt = src.indexOf('if (isPreview) {')
  assert.ok(verifyAt > 0 && verifyAt < previewAt && previewAt < mailerAt, 'the handoff is proved before preview and before any mail client exists')
  assert.match(src, /if \(supportHandoff && auditLogged\) \{\s*const rec = await recordSupportSend/)
  assert.match(src, /if \(templateKey && !supportRefRaw\)/, 'a template key without a handoff is refused')
  assert.match(src, /if \(documentVersionIds\.length && !supportRefRaw\)/, 'student documents only travel with a handoff')
  assert.match(src, /emailSource: 'personal'/)
  for (const f of ['recipient', 'recipient_email', 'email', 'to', 'bcc']) assert.ok(src.includes(`'${f}'`), `${f} is still refused`)
})

test('Outreach sends the claim only while the handoff applies to the recipient on screen', () => {
  const src = read('src/components/connect/OutreachView.jsx')
  assert.match(src, /String\(supportLaunch\.support\?\.studentId \|\| ''\) === String\(studentId\)/)
  assert.equal((src.match(/\.\.\.\(activeSupport \? \{ support_ref: supportRefFor\(activeSupport\)/g) || []).length, 2, 'preview and send, nothing else')
  assert.match(src, /clearLaunchContext\(\)/)
})

test('the handoff model: chip, note, claim and the sent message', () => {
  const student = { id: S, first_name: 'Maya', last_name: 'Ortiz' }
  const review = { id: REVIEW, score: 72, readiness: 'Competitive', draft_subject: 'Feedback on your résumé', draft_body: 'Hi Maya,\n\nGood start.', full_report: { rewritten_bullets: [] } }
  const h = resumeReviewHandoff({ review, student, cycle: { id: CYCLE, name: 'Winter 2027' }, version: { id: VER, file_name: 'a.pdf' }, includeScore: true, includeBullets: false })
  assert.equal(h.cycleId, CYCLE)
  assert.match(h.draft.body, /scored 72 of 100/)
  assert.ok(h.draft.body.endsWith('Warmly,'), 'Outreach adds the sender\'s signature; the draft does not repeat it')
  assert.deepEqual(h.documents, [{ versionId: VER, fileName: 'a.pdf' }])
  assert.deepEqual(supportRefFor(h), { kind: 'resume_review', cycle_id: CYCLE, resume_review_id: REVIEW })
  assert.match(handoffChip(h.support).label, /Support · Résumé Review · Ortiz, Maya/)
  assert.match(handoffChip(h.support).note, /logged as supported for Résumé Review on the send date/)
  const req = documentRequestHandoff({ type: { key: 'transcript', label: 'Transcript', qualifier: 'Official or unofficial' }, student, cycle: { id: CYCLE } })
  assert.deepEqual(supportRefFor(req), { kind: 'document_request', cycle_id: CYCLE, doc_type: 'transcript' })
  assert.match(handoffChip(req.support).note, /does not log support/)
  assert.equal(sentMessage({ support: h.support, supportEntry: { logged: true, occurred_on: '2026-10-05' } }), 'Sent to Maya. Résumé Review logged for Oct 5.')
  assert.match(sentMessage({ support: h.support, supportEntry: { logged: true, occurred_on: '2026-10-05', already_recorded: true } }), /already logged/)
  assert.equal(sentMessage({ support: req.support, supportEntry: null, fallback: 'Email sent to Maya' }), 'Email sent to Maya')
  assert.equal(outreachHandoffPath(S), `/connect/outreach?launch=1&mode=message&recipientType=student&recipientId=${S}`)
  assert.ok(!BULK_ACTIVITY_KEYS.includes('resume_review'), 'Résumé Review is not logged by hand any more')
})

test('the source migration on Postgres: existing rows read manual, a bad source is refused', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE public.ngrp_support_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity text, voided_at timestamptz);
    INSERT INTO public.ngrp_support_entries (activity) VALUES ('town_hall');
  `)
  const sql = read('supabase/migrations/20261106000000_support_entry_source.sql')
  await db.exec(sql)
  await db.exec(sql)
  assert.equal((await db.query(`SELECT source FROM ngrp_support_entries`)).rows[0].source, 'manual')
  await db.query(`INSERT INTO ngrp_support_entries (activity, source, source_ref) VALUES ('resume_review', 'outreach', 'log-1')`)
  await assert.rejects(db.query(`INSERT INTO ngrp_support_entries (activity, source) VALUES ('town_hall', 'email')`))
})
