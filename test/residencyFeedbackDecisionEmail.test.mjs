// RESIDENCY-PORTAL-2c: the requester is emailed when their preceptor feedback
// request is approved, declined, or withdrawn (Owner-approved wording,
// 2026-09-11), with an optional note to the requester from the drawer.
// Run: node --test test/residencyFeedbackDecisionEmail.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { preceptorFeedbackDecisionEmail, SUPPORT_EMAIL } from '../lib/server/email/preceptorFeedbackDecisionEmail.js'
import { notifyRequesterOfDecision, FEEDBACK_DECISION_FROM } from '../lib/server/ngrpPreceptorFeedbackNotify.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const LINK = 'https://aspireintelligence.app/portal/residency/profiles?candidate=33333333-3333-4333-8333-333333333333'
const base = { requesterFirstName: 'Jenn', alumnusName: 'Maya Lin', link: LINK }

test('approved: the approved wording, a View Feedback button, and the support address', () => {
  const m = preceptorFeedbackDecisionEmail({ ...base, decision: 'approved', note: 'For the 5 SCCT panel.' })
  assert.equal(m.subject, 'Preceptor feedback approved: Maya Lin')
  assert.equal(SUPPORT_EMAIL, 'aspire@cshs.org')
  for (const line of [
    'Hello Jenn,',
    'Your request to view the preceptor feedback for Maya Lin has been approved. You can open it from their profile in the ASPIRE Residency Portal.',
    'Note from the ASPIRE team: For the 5 SCCT panel.',
    'This feedback is shared with you only, for this applicant only. Each time you open it, the ASPIRE team can see that you did. Please keep it within the portal and do not forward or copy it.',
    'Questions? Email us at aspire@cshs.org.',
    'Kind regards,',
  ]) assert.ok(m.text.includes(line), line)
  assert.match(m.html, /View Feedback/)
  assert.ok(m.html.includes(LINK), 'the button opens that alumnus in the portal')
  assert.match(m.html, /<strong>Maya Lin<\/strong>/)
})

test('declined and withdrawn: their approved wording, no button', () => {
  const d = preceptorFeedbackDecisionEmail({ ...base, decision: 'declined' })
  assert.equal(d.subject, 'Preceptor feedback request: Maya Lin')
  assert.ok(d.text.includes('Your request to view the preceptor feedback for Maya Lin was not approved at this time.'))
  assert.ok(d.text.includes('If you would like to talk it through, email us at aspire@cshs.org. You can also submit a new request from their profile in the ASPIRE Residency Portal.'))
  assert.doesNotMatch(d.html, /View Feedback/)
  assert.ok(!d.text.includes('Note from the ASPIRE team'), 'no note line without a note')

  const w = preceptorFeedbackDecisionEmail({ ...base, decision: 'revoked', note: 'Panel concluded.' })
  assert.equal(w.subject, 'Access to preceptor feedback ended: Maya Lin')
  assert.ok(w.text.includes('Your access to the preceptor feedback for Maya Lin has ended, and it is no longer visible to you in the ASPIRE Residency Portal.'))
  assert.ok(w.text.includes('Note from the ASPIRE team: Panel concluded.'))
  assert.ok(w.text.includes('If you need it again, you can submit a new request from their profile.'))
  assert.doesNotMatch(w.html, /View Feedback/)

  assert.equal(preceptorFeedbackDecisionEmail({ ...base, decision: 'pending' }), null, 'never a blank email')
})

test('notes and names are escaped; the feedback itself is never in the email', () => {
  const m = preceptorFeedbackDecisionEmail({ ...base, alumnusName: 'A <b>B</b>', decision: 'approved', note: '<script>x</script>' })
  assert.doesNotMatch(m.html, /<script>|<b>B<\/b>/)
  const src = read('lib/server/email/preceptorFeedbackDecisionEmail.js')
  assert.doesNotMatch(src, /responses|competenc|narrative|readiness_endorsement/)
})

// A fake db for the notifier: one request, one requester, one alumnus.
function fakeDb({ profile = { full_name: 'Jenn Recruiter', email: 'jenn@cshs.org', is_active: true }, request = true } = {}) {
  const rows = {
    ngrp_preceptor_feedback_requests: request ? { id: 'r1', candidate_id: '33333333-3333-4333-8333-333333333333', student_id: 's1', requester_profile_id: 'p1' } : null,
    user_profiles: profile,
    students: { first_name: 'Maya', last_name: 'Lin', preferred_first_name: '' },
  }
  return { from: t => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: rows[t], error: null }) }) }) }) }
}

test('the notifier sends once, to the requester, from the NGRP sender, replies to the team inbox', async () => {
  const sent = []
  const res = await notifyRequesterOfDecision(fakeDb(), { requestId: 'r1', decision: 'approved', note: null },
    { send: async m => { sent.push(m); return { data: { id: 'e1' }, error: null } } })
  assert.deepEqual(res, { emailed: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'jenn@cshs.org')
  assert.equal(sent[0].from, FEEDBACK_DECISION_FROM)
  assert.equal(sent[0].reply_to, 'aspire@cshs.org')
  assert.equal(sent[0].subject, 'Preceptor feedback approved: Maya Lin')
  assert.match(sent[0].html, /portal\/residency\/profiles\?candidate=33333333-3333-4333-8333-333333333333/)
})

test('the notifier never throws and never sends to an inactive or email-less requester', async () => {
  const never = async () => { throw new Error('should not send') }
  assert.equal((await notifyRequesterOfDecision(fakeDb({ profile: { full_name: 'X', email: '', is_active: true } }), { requestId: 'r1', decision: 'approved' }, { send: never })).emailed, false)
  assert.equal((await notifyRequesterOfDecision(fakeDb({ profile: { full_name: 'X', email: 'x@cshs.org', is_active: false } }), { requestId: 'r1', decision: 'declined' }, { send: never })).emailed, false)
  assert.equal((await notifyRequesterOfDecision(fakeDb({ request: false }), { requestId: 'r1', decision: 'approved' }, { send: never })).emailed, false)
  const failed = await notifyRequesterOfDecision(fakeDb(), { requestId: 'r1', decision: 'revoked' }, { send: async () => ({ error: new Error('down') }) })
  assert.deepEqual(failed, { emailed: false, reason: 'send_failed' })
  const threw = await notifyRequesterOfDecision(fakeDb(), { requestId: 'r1', decision: 'revoked' }, { send: never })
  assert.equal(threw.emailed, false)
})

test('wiring: email after a saved decision, the note travels with it, the toast says whether it went', () => {
  const api = read('api/ngrp-preceptor-feedback.js')
  const decide = api.slice(api.indexOf("if (action === 'decide')"), api.indexOf('// ── view'))
  const rpcAt = decide.indexOf("db.rpc('ngrp_pf_decide_tx'")
  const mailAt = decide.indexOf('notifyRequesterOfDecision(db, { requestId, decision: data.status, note: note.note })')
  assert.ok(rpcAt > 0 && mailAt > rpcAt, 'emailed only after the decision is saved')
  assert.ok(decide.indexOf('if (!data?.ok)') < mailAt, 'never for a refused decision')
  assert.match(decide, /emailed: mail\.emailed/)
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /placeholder="Note to the requester \(optional\)"/)
  assert.match(drawer, /actions\.decideFeedback\?\.\(req, decision, \(decisionNotes\[req\.id\] \|\| ''\)\.trim\(\) \|\| null\)/)
  assert.match(drawer, /\{req\.decisionNote && <p style=\{feedbackMuted\}>Note from the ASPIRE team: \{req\.decisionNote\}<\/p>\}/)
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /runFeedback\('decide', \{ request_id: req\.id, decision, expected_status: req\.status, note \}\)/)
  assert.match(tab, /res\.emailed\s+\? 'They have been emailed\.'/)
})
