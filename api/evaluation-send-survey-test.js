// api/evaluation-send-survey-test.js
//
// ASPIRE-EVAL-TEST-MODE-1: send the authenticated Owner/Admin a TEST link to a survey.
//
// THIS IS NOT A RELEASE. It creates no evaluation_assignments row, mints no token, and
// writes no evaluation_responses row. It sends one email, to the caller's own address,
// containing a link to the in-app test renderer. Nothing downstream can observe it:
//   - no assignment means the release queue is unchanged and no student's slot is taken
//   - no token means nothing can be submitted against a real instrument
//   - no response row means live analytics, exports, the school portal, and the student
//     portal are all untouched
//   - the certificate gate reads evaluation_assignments and evaluation_instruments, so
//     with no assignment it cannot fire
//
// WHY NO TEST ASSIGNMENT. evaluation_assignments.student_id is NOT NULL REFERENCES
// students(id), so a test row would have to borrow a REAL student's identity, and
// uq_assignment (instrument_id, student_id, cohort_id, timepoint) means it would then
// occupy that student's real assignment slot and hide a genuinely due survey from the
// operator. A Casey-Fink test submission would also issue a real, sequence-consuming,
// once-per-student-forever certificate. Storing test data was therefore rejected in
// favour of a design where there is nothing to exclude because nothing is written.
//
// RECIPIENT. Resolved server side from the caller's own authenticated profile. The body
// carries a workflow key and nothing else; there is no recipient field to inject, and an
// unexpected field is a 400.

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { appUrl } from '../lib/server/appUrl.js'
import { aspireEmailShell } from '../lib/server/email/aspireShell.js'
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { archiveSentMessage } from './lib/messageArchive.js'

const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const REPLY_TO = 'aspire@cshs.org'

// Mirrors src/lib/evaluation/surveyCatalog.js. Kept as a small server-side allowlist so a
// caller cannot name an arbitrary key, and so the email can label the workflow.
const WORKFLOWS = {
  preceptor: 'Preceptor Student Readiness Assessment',
  student: 'Student Feedback: Preceptor and Unit',
  caseyFinkPostRotation: 'Casey-Fink Readiness for Practice, Post-Rotation',
  postRotation: 'ASPIRE Post-Rotation Evaluation',
}

function getServiceDb() {
  return createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Active Owner or Admin, resolved from the bearer session. Never from the body. */
async function verifyOwnerAdmin(req) {
  const authHeader = req.headers['authorization'] || ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return { ok: false, status: 401, reason: 'unauthorized' }

  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } } })

  let user
  try {
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { ok: false, status: 401, reason: 'unauthorized' }
    user = data.user
  } catch {
    return { ok: false, status: 401, reason: 'unauthorized' }
  }

  const db = getServiceDb()
  const { data: profile, error: pErr } = await db
    .from('user_profiles')
    .select('id, full_name, email, role, is_owner, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (pErr || !profile) return { ok: false, status: 403, reason: 'forbidden' }
  if (profile.is_active === false) return { ok: false, status: 403, reason: 'forbidden' }
  if (!(profile.is_owner === true || profile.role === 'owner' || profile.role === 'admin')) {
    return { ok: false, status: 403, reason: 'forbidden' }
  }
  // The auth email is authoritative; the profile copy is only a fallback label.
  const email = (user.email || profile.email || '').trim()
  if (!email) return { ok: false, status: 400, reason: 'no_recipient_email' }
  return { ok: true, db, profile, email }
}

function testEmail({ name, workflowTitle, testUrl }) {
  const body = `
<p style="margin:0 0 16px;font-size:16px;">Hello ${name || 'there'},</p>
<p style="margin:0 0 16px;">This is a <strong>TEST</strong> of the ASPIRE survey experience for
<strong>${workflowTitle}</strong>. It was sent because you requested it from Evaluation, Review and Release.</p>
<p style="margin:0 0 16px;padding:12px 14px;background:#fef3c7;border-radius:9px;font-size:13px;color:#92400e;">
This is not a real survey invitation. Nothing you enter is saved, no response is recorded, no
certificate is issued, and no student or preceptor received anything.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
  <tr><td style="border-radius:9px;background:#1d2567;">
    <a href="${testUrl}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9px;font-family:'DM Sans',Helvetica,Arial,sans-serif;">Open the test survey</a>
  </td></tr>
</table>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">You will need to be signed in to ASPIRE Intelligence to open it.</p>
`
  return {
    subject: `[TEST] ASPIRE survey preview: ${workflowTitle}`,
    html: aspireEmailShell({ body, preheader: `TEST only. Nothing is recorded. ${workflowTitle}` }),
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyOwnerAdmin(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  // Strict allowlist: there is deliberately no recipient field to inject.
  for (const k of Object.keys(body)) {
    if (k !== 'workflow_key') return res.status(400).json({ error: 'unexpected_field', field: k })
  }
  const workflowKey = body.workflow_key
  const workflowTitle = WORKFLOWS[workflowKey]
  if (!workflowTitle) return res.status(400).json({ error: 'invalid_workflow_key' })

  const testUrl = appUrl(`/evaluation/test/${encodeURIComponent(workflowKey)}`)

  if (!process.env.RESEND_API_KEY) {
    // The in-app "Open test now" path still works without mail configured, so report
    // the failure honestly rather than pretending an email went out.
    return res.status(200).json({ success: true, email_sent: false, test_url: testUrl })
  }

  let sentSubject = null
  let sentHtml = null
  const emailSent = await (async () => {
    try {
      const { subject, html } = testEmail({
        name: (auth.profile.full_name || '').split(/\s+/)[0] || '',
        workflowTitle,
        testUrl,
      })
      sentSubject = subject
      sentHtml = html
      const resend = new Resend(process.env.RESEND_API_KEY)
      const { error } = await resend.emails.send({
        from: FROM, to: auth.email, replyTo: REPLY_TO, subject, html,
      })
      return !error
    } catch {
      return false
    }
  })()

  // Audit the test as a test. notification_log is the existing audit surface; this row
  // carries a distinct notification_type so it can never be mistaken for a release, and
  // no assignment_id because no assignment exists.
  let notificationLogId = null
  try {
    const { data: logRow } = await auth.db.from('notification_log').insert({
      notification_type: 'evaluation_survey_test_sent',
      audience: 'staff',
      recipient_email: auth.email,
      recipient_name: auth.profile.full_name || null,
      recipient_role: 'Owner/Admin',
      subject: sentSubject || `[TEST] ASPIRE survey preview: ${workflowTitle}`,
      status: emailSent ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      metadata: {
        workflow_key: workflowKey,
        test_mode: true,
        released: false,
        sent_by_user_id: auth.profile.id,
      },
    }).select('id').single()
    notificationLogId = logRow?.id || null
  } catch {
    // An audit failure must not imply a release happened; the send is already done.
    console.warn('[evaluation-send-survey-test] audit write failed')
  }

  if (emailSent && notificationLogId && sentHtml) {
    await archiveSentMessage({
      db: supabaseAdmin,
      notificationLogId,
      contentKind: 'secure_link_email',
      html: sentHtml,
      bodyFormat: 'html',
      source: 'evaluation_send_survey_test',
      templateKey: 'evaluation_survey_test_sent',
      templateVersion: 1,
    })
  }

  // The test URL is returned so the UI can offer "Open test now" without waiting for mail.
  // It is not a credential: it carries no token and is useless without a signed-in session.
  return res.status(200).json({ success: true, email_sent: emailSent, test_url: testUrl })
}
