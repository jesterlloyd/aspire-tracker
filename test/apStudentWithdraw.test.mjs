// AP-STUDENT-WITHDRAW-1: an Academic Partner removes, for good, a student it submitted before the
// ASPIRE team reached out. The rule, the guarded delete, the endpoint wiring and the team email.
// Run: node --test test/apStudentWithdraw.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  withdrawBlocker, canWithdraw, refusalText, withdrawConfirm, previewRemoveNote, WITHDRAW_STATUS,
} from '../src/lib/ap/studentWithdraw.js'
import { withdrawStudent, withdrawableIds, previewWithdrawers } from '../lib/server/schoolStudentWithdraw.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ME = '11111111-1111-4111-8111-111111111111'
const SID = '22222222-2222-4222-8222-222222222222'
const COHORT = '33333333-3333-4333-8333-333333333333'

const fresh = (over = {}) => ({
  id: SID, cohort_id: COHORT, school: 'Cal State Long Beach', is_demo: false,
  first_name: 'Ana', last_name: 'Reyes', preferred_first_name: null, school_email: 'ana@csulb.edu', program_type: 'BSN',
  status: WITHDRAW_STATUS, submitted_via: 'academic_partner_portal',
  placement_request_last_submitted_by_profile_id: ME,
  student_form_privacy_ack_at: null, resume_url: '', headshot_url: '', ...over,
})
const none = { callerId: ME, hasPortalLink: false, outreachCount: 0, documentCount: 0 }

// ── The rule ───────────────────────────────────────────────────────────────

test('the submitter may remove a student no one has reached out to', () => {
  assert.equal(withdrawBlocker(fresh(), none), null)
  assert.equal(canWithdraw(fresh(), none), true)
})

test('only the person who submitted the student', () => {
  assert.equal(withdrawBlocker(fresh(), { ...none, callerId: 'someone-else' }), 'not_submitter')
  assert.equal(withdrawBlocker(fresh({ placement_request_last_submitted_by_profile_id: null }), none), 'not_submitter')
  assert.equal(withdrawBlocker(fresh(), { ...none, callerId: null }), 'not_submitter')
})

test('any status past Pending Outreach means the team reached out', () => {
  for (const status of ['Form Sent', 'Form Received', 'Placed', 'Not Proceeding']) {
    assert.equal(withdrawBlocker(fresh({ status }), none), 'reached_out', status)
  }
  assert.equal(withdrawBlocker(fresh(), { ...none, outreachCount: 1 }), 'reached_out')
})

test('anything the student filled in or holds blocks it', () => {
  assert.equal(withdrawBlocker(fresh({ submitted_via: 'student_form' }), none), 'student_filled')
  assert.equal(withdrawBlocker(fresh({ student_form_privacy_ack_at: '2026-11-01T00:00:00Z' }), none), 'student_filled')
  assert.equal(withdrawBlocker(fresh({ resume_url: 'cohort/s/resume.pdf' }), none), 'student_filled')
  assert.equal(withdrawBlocker(fresh({ headshot_url: 'cohort/s/headshot.jpg' }), none), 'student_filled')
  assert.equal(withdrawBlocker(fresh(), { ...none, hasPortalLink: true }), 'student_filled')
  assert.equal(withdrawBlocker(fresh(), { ...none, documentCount: 2 }), 'has_documents')
})

test('every refusal has a sentence, and the confirmation names the student and the cost', () => {
  for (const code of ['not_found', 'not_submitter', 'reached_out', 'student_filled', 'has_documents', 'blocked']) {
    assert.ok(refusalText(code).length > 20, code)
  }
  const c = withdrawConfirm('Ana Reyes')
  assert.match(c.message, /^Remove Ana Reyes from your placement request\?/)
  assert.match(c.message, /cannot be undone/)
  assert.match(c.message, /ASPIRE team will be told/)
  assert.equal(c.confirmLabel, 'Remove student')
})

// ── The guarded delete, against a fake database ───────────────────────────

function fakeDb({ student = fresh(), links = [], log = [], docs = [], deleteResult } = {}) {
  const calls = { deletes: [] }
  const db = {
    calls,
    from(table) {
      const q = { table, filters: [], op: 'select' }
      const b = {
        select() { return b },
        eq(col, val) { q.filters.push(['eq', col, val]); return b },
        in(col, vals) { q.filters.push(['in', col, vals]); return b },
        delete() { q.op = 'delete'; return b },
        maybeSingle() { return Promise.resolve(resolve(true)) },
        then(ok, bad) { return Promise.resolve(resolve(false)).then(ok, bad) },
      }
      function resolve(single) {
        if (q.op === 'delete') {
          calls.deletes.push(q.filters)
          if (deleteResult) return deleteResult
          const pass = q.filters.every(([, col, val]) => student && student[col] === val)
          return { data: pass ? [{ id: student.id }] : [], error: null }
        }
        if (table === 'students') return { data: single ? student : [student], error: null }
        if (table === 'cohorts') return { data: { name: 'Spring 2027' }, error: null }
        if (table === 'user_student_links') return { data: links, error: null }
        if (table === 'notification_log') return { data: log, error: null }
        if (table === 'student_document_versions') return { data: docs, error: null }
        if (table === 'user_profiles') return { data: [{ id: ME, full_name: 'Marissa Grafil Ramirez' }], error: null }
        return { data: null, error: null }
      }
      return b
    },
  }
  return db
}
const scopes = [{ school_key: 'Cal State Long Beach', cohort_id: null }]
const actor = { id: ME, name: 'Lucy Van Otterloo', email: 'lucy@csulb.edu' }

test('deletes, conditionally on status and submitter, then emails the team', async () => {
  const db = fakeDb()
  const sent = []
  const r = await withdrawStudent(db, scopes, { studentId: SID, actor, notify: (c) => sent.push(c) })
  assert.deepEqual(r, { ok: true, name: 'Ana Reyes' })
  const where = db.calls.deletes[0].map(f => f[1])
  assert.deepEqual(where, ['id', 'status', 'placement_request_last_submitted_by_profile_id'])
  assert.equal(sent.length, 1)
  assert.equal(sent[0].studentName, 'Ana Reyes')
  assert.equal(sent[0].cohortName, 'Spring 2027')
  assert.equal(sent[0].removedByName, 'Lucy Van Otterloo')
})

test('the confirmation notice is not outreach; any other logged email is', async () => {
  const ok = await withdrawStudent(fakeDb({ log: [{ student_id: SID, notification_type: 'placement_request_received' }] }), scopes, { studentId: SID, actor })
  assert.equal(ok.ok, true)
  const no = await withdrawStudent(fakeDb({ log: [{ student_id: SID, notification_type: 'bulk_message_sent' }] }), scopes, { studentId: SID, actor })
  assert.deepEqual(no, { ok: false, status: 409, error: 'reached_out' })
})

test('refuses without deleting: someone else, a portal account, an out-of-scope school', async () => {
  const other = fakeDb()
  assert.equal((await withdrawStudent(other, scopes, { studentId: SID, actor: { id: 'x' } })).error, 'not_submitter')
  assert.equal(other.calls.deletes.length, 0)
  const linked = fakeDb({ links: [{ student_id: SID }] })
  assert.equal((await withdrawStudent(linked, scopes, { studentId: SID, actor })).error, 'student_filled')
  assert.equal(linked.calls.deletes.length, 0)
  const away = fakeDb({ student: fresh({ school: 'UCLA' }) })
  assert.deepEqual(await withdrawStudent(away, scopes, { studentId: SID, actor }), { ok: false, status: 404, error: 'not_found' })
  assert.equal(away.calls.deletes.length, 0)
})

test('a row other records still point at is refused, never forced, and no email goes', async () => {
  const sent = []
  const db = fakeDb({ deleteResult: { data: null, error: { code: '23503' } } })
  const r = await withdrawStudent(db, scopes, { studentId: SID, actor, notify: (c) => sent.push(c) })
  assert.deepEqual(r, { ok: false, status: 409, error: 'blocked' })
  assert.equal(sent.length, 0)
})

test('a send that lands between the check and the delete wins', async () => {
  const db = fakeDb({ deleteResult: { data: [], error: null } })
  assert.deepEqual(await withdrawStudent(db, scopes, { studentId: SID, actor }), { ok: false, status: 409, error: 'reached_out' })
})

test('a failing email never undoes the delete', async () => {
  const r = await withdrawStudent(fakeDb(), scopes, { studentId: SID, actor, notify: () => { throw new Error('mail down') } })
  assert.equal(r.ok, true)
})

test('the roster offers Remove only for the caller\'s own untouched students', async () => {
  const mine = fresh()
  const theirs = fresh({ id: 'b', placement_request_last_submitted_by_profile_id: 'other' })
  const sent = fresh({ id: 'c', status: 'Form Sent' })
  const ids = await withdrawableIds(fakeDb(), [mine, theirs, sent], ME)
  assert.deepEqual([...ids], [SID])
  assert.equal((await withdrawableIds(fakeDb(), [mine], null)).size, 0)
})

// ── Wiring ────────────────────────────────────────────────────────────────

test('the endpoint treats withdraw as a write, so a staff preview cannot remove anyone', () => {
  const src = read('api/portal/school-student-records.js')
  assert.match(src, /const WRITES = new Set\(\[[^\]]*'withdraw'[^\]]*\]\)/)
  assert.match(src, /if \(WRITES\.has\(action\) && auth\.staffPreview\) return res\.status\(403\)/)
  assert.match(src, /withdrawStudent\(db, scopes, \{ studentId: body\.student_id, actor, notify: notifyWithdrawn \}\)/)
})

test('the roster never sends the columns it reads to decide, only the boolean', () => {
  const src = read('api/portal/school-students.js')
  assert.match(src, /can_withdraw: withdrawable\.has\(s\.id\)/)
  assert.match(src, /staffPreview \? new Set\(\)/)
  const entry = src.slice(src.indexOf('const entry = {'), src.indexOf(';(bySchool['))
  for (const col of ['placement_request_last_submitted_by_profile_id', 'submitted_via', 'student_form_privacy_ack_at', 'resume_url']) {
    assert.ok(!entry.includes(col), `${col} must not reach the response`)
  }
})

test('the screens confirm before removing, and the drawer offers it only when allowed', () => {
  const ap = read('src/portal/AcademicPartnerPortal.jsx')
  assert.match(ap, /confirmDialog\(words\.message, \{ confirmLabel: words\.confirmLabel, danger: true \}\)/)
  assert.match(ap, /\{s\.can_withdraw && \(/)
  assert.match(ap, /onRemove=\{openStudent\.can_withdraw \?/)
  const drawer = read('src/portal/ap/SchoolStudentDrawer.jsx')
  assert.match(drawer, /\{onRemove && !state\.readOnly && \(/)
})

test('the team email is a registered, archived, team-only notice', async () => {
  const { templates } = await import('../src/lib/notifications/templates/index.js')
  assert.equal(typeof templates.placement_request_withdrawn.internal_team, 'function')
  assert.equal(templates.placement_request_withdrawn.school_coordinator, undefined)
  const { resolveRecipients } = await import('../src/lib/notifications/recipients.js')
  const to = await resolveRecipients('placement_request_withdrawn', {})
  assert.ok(to.length >= 1 && to.every(r => r.audience === 'internal_team'))
  const mail = templates.placement_request_withdrawn.internal_team({ studentName: 'Ana <b>', school: 'CSULB', removedByName: 'Lucy' })
  assert.match(mail.subject, /^ASPIRE Placement Request Withdrawn: /)
  assert.ok(!mail.html.includes('Ana <b>'), 'names are escaped')
  assert.match(read('api/lib/archiveClassification.js'), /'placement_request_withdrawn'/)
})

// ── AP-STUDENT-WITHDRAW-2: the Owner/Admin preview sees where Remove is ───

test('a preview learns who could remove each student, and only where that person could', async () => {
  const mine = fresh()
  const sent = fresh({ id: 'c', status: 'Form Sent' })
  const by = await previewWithdrawers(fakeDb(), [mine, sent])
  assert.deepEqual([...by.entries()], [[SID, 'Marissa Grafil Ramirez']])
  assert.match(previewRemoveNote('Marissa Grafil Ramirez'), /^Only Marissa Grafil Ramirez can remove this student\. This is a staff preview/)
})

test('the preview Remove is inactive and never calls the delete', () => {
  const api = read('api/portal/school-students.js')
  assert.match(api, /const withdrawable = staffPreview \? new Set\(\)/, 'a preview can never remove')
  assert.match(api, /withdraw_preview_by: previewBy\.get\(s\.id\) \|\| null/)
  const ap = read('src/portal/AcademicPartnerPortal.jsx')
  const block = ap.slice(ap.indexOf('{!s.can_withdraw && s.withdraw_preview_by && ('), ap.indexOf('</Tooltip>'))
  assert.match(block, /aria-disabled="true"/)
  assert.ok(!block.includes('removeStudent'), 'the preview button must not reach removeStudent')
  const drawer = read('src/portal/ap/SchoolStudentDrawer.jsx')
  assert.match(drawer, /\{!onRemove && removePreviewBy && \(/)
  assert.match(drawer, /apr-remove-btn" disabled>Remove Student<\/button>/)
})
