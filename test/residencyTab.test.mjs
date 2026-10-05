// RESIDENCY-TAB-1 (résumé review build, Phase 5): the Student Portal's Residency tab for ASPIRE
// alumni, and the two Needs you items it feeds. What these tests hold:
//   - the tab is the alumnus's own, resolved from the session, Completed only, and never sends
//     a Keith score, a draft, a note, or who uploaded or confirmed a file;
//   - the Transition Form is status words only (a pending send reads Not sent);
//   - a document request stays open until a version of that type is uploaded after it;
//   - the staff feed lists one population and drops a scored résumé;
//   - Residency takes Shift Log's place for alumni, and the portal reads its flag before use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cycleForStudent, keyDates, transitionFormStatus, supportReceived, alumnusDocuments, openRequests } from '../lib/server/alumnusResidency.js'
import { documentActivity } from '../lib/server/documentActivity.js'
import { formWords, supportSummary, upcomingResidencyEvents, rangeLabel } from '../src/lib/residencyTabModel.js'
import { residencyDocsGroup, alumnusDocumentsPath, GROUP_ORDER } from '../src/lib/home/needsYouModel.js'
import { normalizeHomeQueue, ACTION_CENTER_GROUPS } from '../src/lib/actionCenter/queueModel.js'
import { portalActionsFor } from '../src/portal/portalCommandModel.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const S = '11111111-1111-4111-8111-111111111111'

function fakeDb(tables) {
  return {
    from(t) {
      const f = []
      const q = {
        select() { return q }, order() { return q }, limit() { return q },
        eq(k, v) { f.push(r => r[k] === v); return q }, in(k, v) { f.push(r => v.includes(r[k])); return q },
        is(k, v) { f.push(r => (r[k] ?? null) === v); return q }, gte(k, v) { f.push(r => String(r[k]) >= v); return q },
        maybeSingle() { const rows = (tables[t] || []).filter(r => f.every(x => x(r))); return Promise.resolve({ data: rows[0] || null, error: null }) },
        then(a, b) { return Promise.resolve({ data: (tables[t] || []).filter(r => f.every(x => x(r))), error: null }).then(a, b) },
      }
      return q
    },
  }
}

test('the alumnus\'s cohort, dates, form and support: the active cycle wins; status words only', async () => {
  const db = fakeDb({
    ngrp_cycle_source_cohorts: [{ cycle_id: 'old', cohort_id: 'co' }, { cycle_id: 'now', cohort_id: 'co' }],
    ngrp_cycles: [
      { id: 'old', name: 'Summer 2026', is_active: false, residency_start_date: '2026-07-01' },
      { id: 'now', name: 'Winter 2027', is_active: true, application_open_date: '2026-10-01', application_deadline: '2026-10-31', interview_window_start: '2026-11-10', interview_window_end: '2026-11-20', residency_start_date: '2027-01-11' },
    ],
    ngrp_candidates: [{ id: 'c1', cycle_id: 'now', student_id: S }],
    ngrp_transition_assignments: [{ candidate_id: 'c1', status: 'revised', sent_at: '2026-10-02T00:00:00Z', submitted_at: '2026-10-03T00:00:00Z', revised_at: '2026-10-04T00:00:00Z', revoked_at: null }],
    ngrp_support_entries: [{ student_id: S, activity: 'town_hall', occurred_on: '2026-09-30', note: 'secret', voided_at: null, recorded_by_profile_id: 'x' }],
  })
  const { cycle } = await cycleForStudent(db, { cohort_id: 'co' })
  assert.equal(cycle.id, 'now')
  assert.deepEqual(keyDates(cycle).map(d => d.key), ['application_open', 'application_deadline', 'interview_window', 'residency_start'], 'a missing date is left out')
  assert.equal(rangeLabel('2026-11-10', '2026-11-20'), 'Nov 10, 2026 to Nov 20, 2026')
  const form = await transitionFormStatus(db, { cycleId: 'now', studentId: S })
  assert.deepEqual(form, { status: 'submitted', sent_at: '2026-10-02T00:00:00Z', submitted_at: '2026-10-04T00:00:00Z', deadline_at: null })
  assert.equal(Object.keys(form).includes('token'), false, 'never the link')
  const pending = fakeDb({ ngrp_candidates: [{ id: 'c', cycle_id: 'x', student_id: S }], ngrp_transition_assignments: [{ candidate_id: 'c', status: 'pending', revoked_at: null }] })
  assert.deepEqual(await transitionFormStatus(pending, { cycleId: 'x', studentId: S }), { status: 'not_sent' }, 'a send the provider never accepted is not Sent')
  const sup = await supportReceived(db, S)
  assert.deepEqual(sup.entries, [{ activity: 'town_hall', occurred_on: '2026-09-30' }], 'activity and date only, never the note')
  assert.equal(formWords('opened').label, 'Started')
  assert.deepEqual(supportSummary([{ activity: 'town_hall', occurred_on: '2026-09-01' }, { activity: 'town_hall', occurred_on: '2026-09-30' }]), [{ activity: 'town_hall', label: 'Town Hall', count: 2, last: '2026-09-30' }])
})

test('documents an alumnus sees carry no uploader, no confirmer, no path, no Keith', async () => {
  const db = fakeDb({
    student_document_types: [{ key: 'resume', label: 'Résumé', required: true, check_kind: 'resume', sort_order: 10, active: true }],
    student_documents: [{ id: 'd1', student_id: S, doc_type: 'resume', current_version_id: 'v1' }],
    student_document_versions: [{ id: 'v1', document_id: 'd1', file_name: 'r.pdf', uploaded_at: '2026-10-01T00:00:00Z', uploaded_via: 'staff', uploaded_by_profile_id: 'staff-1', confirmed_by_profile_id: 'staff-2', sha256: 'a'.repeat(64), storage_path: 'x' }],
    students: [{ id: S, resume_url: 'c/s/resume.pdf' }],
  })
  const d = await alumnusDocuments(db, S)
  const v = d.documents[0].versions[0]
  assert.deepEqual(Object.keys(v).sort(), ['doc_date', 'file_name', 'id', 'pages', 'uploaded_at'])
  const src = read('api/portal/my-residency.js')
  assert.doesNotMatch(src, /resume_reviews|score|readiness|draft_/i, 'the portal endpoint never reads a review')
  assert.match(src, /status === 'Completed'/, 'Completed alumni only')
  assert.match(src, /via: 'portal'/)
  assert.match(src, /o\.studentId !== student\.id/, 'a file opens only for its own student')
  assert.doesNotMatch(src, /body\.student_id/, 'the student is the session\'s, never the request\'s')
})

test('a document request stays open until that type is uploaded after it', async () => {
  const types = [{ key: 'transcript', label: 'Transcript' }, { key: 'bls', label: 'BLS Card' }]
  const db = fakeDb({ notification_log: [
    { student_id: S, notification_type: 'direct_message_sent', sent_at: '2026-10-03T00:00:00Z', metadata: { support_kind: 'document_request', document_type: 'transcript' } },
    { student_id: S, notification_type: 'direct_message_sent', sent_at: '2026-10-02T00:00:00Z', metadata: { support_kind: 'document_request', document_type: 'bls' } },
    { student_id: S, notification_type: 'direct_message_sent', sent_at: '2026-10-02T00:00:00Z', metadata: { support_kind: 'resume_review' } },
  ] })
  const documents = [{ doc_type: 'bls', versions: [{ uploaded_at: '2026-10-04T00:00:00Z' }] }]
  const r = await openRequests(db, { studentId: S, documents, types, now: new Date('2026-10-05T00:00:00Z') })
  assert.deepEqual(r.requests.map(x => x.doc_type), ['transcript'], 'the BLS card answered its request; a résumé review is not a request')
})

test('the staff feed: one population, and a scored résumé leaves it', async () => {
  const now = new Date('2026-10-05T12:00:00Z')
  const tables = {
    student_document_versions: [
      { id: 'v-real', document_id: 'd-real', uploaded_at: '2026-10-04T00:00:00Z', uploaded_via: 'portal' },
      { id: 'v-demo', document_id: 'd-demo', uploaded_at: '2026-10-04T00:00:00Z', uploaded_via: 'portal' },
      { id: 'v-scored', document_id: 'd-scored', uploaded_at: '2026-10-04T00:00:00Z', uploaded_via: 'portal' },
    ],
    student_documents: [
      { id: 'd-real', student_id: 'real', doc_type: 'resume', current_version_id: 'v-real' },
      { id: 'd-demo', student_id: 'demo', doc_type: 'resume', current_version_id: 'v-demo' },
      { id: 'd-scored', student_id: 'scored', doc_type: 'resume', current_version_id: 'v-scored' },
    ],
    students: [
      { id: 'real', first_name: 'Maya', last_name: 'Ortiz', is_demo: false, resume_url: null },
      { id: 'demo', first_name: 'Demo', last_name: 'Person', is_demo: true },
      { id: 'scored', first_name: 'Lena', last_name: 'Okafor', is_demo: false },
    ],
    resume_reviews: [{ document_version_id: 'v-scored' }],
    student_document_types: [{ key: 'resume', label: 'Résumé', required: true, sort_order: 10, active: true }],
  }
  const real = await documentActivity(fakeDb(tables), { demo: false, now })
  assert.deepEqual(real.uploads.map(u => u.student_id), ['real'])
  const demo = await documentActivity(fakeDb(tables), { demo: true, now })
  assert.deepEqual(demo.uploads.map(u => u.student_id), ['demo'])
  assert.ok(real.completions.some(c => c.student_id === 'real'), 'a résumé is the whole required list here, so the file is complete')
})

test('Needs you and the Action Center: Score now opens the alumnus\'s Documents', () => {
  const g = residencyDocsGroup({ uploads: [{ student_id: S, first_name: 'Maya', last_name: 'Ortiz', version_id: 'v1', uploaded_at: '2026-10-04T00:00:00Z' }], completions: [], now: Date.parse('2026-10-05T00:00:00Z') })
  assert.equal(g.rows[0].to, alumnusDocumentsPath(S))
  assert.equal(g.rows[0].to, `/ngrp/profiles?student=${S}&docs=1`)
  assert.ok(GROUP_ORDER.includes('residencyDocs'))
  const items = normalizeHomeQueue({ groups: [g], now: Date.parse('2026-10-05T00:00:00Z') })
  assert.equal(items[0].group, 'residency-docs')
  assert.equal(items[0].chip, 'Score now')
  assert.ok(ACTION_CENTER_GROUPS.some(x => x.key === 'residency-docs'))
  assert.equal(residencyDocsGroup({ uploads: [], completions: [] }), null, 'an empty group is hidden')
})

test('Residency takes Shift Log\'s place for alumni, and the flag is read only after it exists', () => {
  const nav = read('src/portal/PortalNav.jsx')
  assert.match(nav, /\{residency \? \(/)
  assert.ok(portalActionsFor('student', { residency: true }).some(a => a.key === 'residency'))
  assert.ok(!portalActionsFor('student', { residency: true }).some(a => a.key === 'shift-log'))
  assert.ok(portalActionsFor('student').some(a => a.key === 'shift-log'))
  const app = read('src/portal/PortalApp.jsx')
  assert.ok(app.indexOf('const [residencyEligible') < app.indexOf('residency: residencyEligible'), 'declared before the command bar reads it')
  const events = upcomingResidencyEvents([
    { id: 1, event_type: 'town_hall', start_at: '2026-10-20T17:00:00Z' },
    { id: 2, event_type: 'birthday', start_at: '2026-10-21T17:00:00Z' },
    { id: 3, event_type: 'ngrp_deadline', start_at: '2026-09-01T17:00:00Z' },
  ], '2026-10-05')
  assert.deepEqual(events.map(e => e.id), [1], 'residency events from today on only')
})
