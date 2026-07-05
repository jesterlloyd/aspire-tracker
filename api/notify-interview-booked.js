import { Resend } from 'resend';
import { aspireEmailShell } from '../lib/server/email/aspireShell.js';
import { renderEmailHeading, renderEmailDetailsCard, renderEmailNote } from '../lib/server/email/emailPrimitives.js';

// In-memory deduplication (per Vercel function instance, 60-second window)
// Defense-in-depth against accidental retries or future regressions.
const recentSends = new Map();
const DEDUP_WINDOW_MS = 60 * 1000;

function shouldSkipDuplicate(key) {
  const now = Date.now();
  for (const [k, ts] of recentSends.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) recentSends.delete(k);
  }
  if (recentSends.has(key)) return true;
  recentSends.set(key, now);
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.RESEND_API_KEY) {
    console.error('[notify-interview-booked] RESEND_API_KEY not set')
    return res.status(500).json({ error: 'Email service not configured' })
  }

  const {
    slotId,
    studentName,
    studentSchool,
    studentProgram,
    studentEmail,
    interviewDate,
    interviewTime,
    duration,
    interviewerName,
    interviewerEmail,
    ownerEmail = 'JesterLloyd.Bautista@cshs.org',
  } = req.body || {}

  if (!studentName || !interviewDate || !interviewTime) {
    return res.status(400).json({ error: 'Missing required booking fields' })
  }

  // slot_id is a UUID - invariant to payload formatting differences
  const dedupeKey = slotId || `${studentEmail || 'unknown'}-${interviewDate}-${interviewTime}`
  if (shouldSkipDuplicate(dedupeKey)) {
    console.log('[notify-interview-booked] duplicate within 60s window, skipping:', dedupeKey)
    return res.status(200).json({ success: true, skipped: true, reason: 'duplicate' })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const recipients = [...new Set([ownerEmail, interviewerEmail].filter(Boolean))]

  console.log('[notify-interview-booked] sending to:', recipients)

  // EMAIL-BRAND-REFRESH Phase 2B-7: rendered in the shared ASPIRE system shell (internal/admin notice;
  // no signature, no handwritten image). Operational details + action box preserved.
  const preheader = `${studentName} self-scheduled an ASPIRE interview for ${interviewDate}.`
  // EMAIL-NOTIF-MODERNIZE-2A: bespoke heading/details-table/action-box replaced with the shared
  // server primitives (escape-safe, consistent ASPIRE styling). Copy + recipients + subject unchanged.
  const emailBody =
    renderEmailHeading({ level: 2, text: 'New ASPIRE interview booked' })
    + '<p style="margin:0 0 16px;">A student has self-scheduled an ASPIRE interview.</p>'
    + renderEmailDetailsCard({ rows: [
        { label: 'Student',       value: studentName },
        { label: 'School',        value: studentSchool || 'N/A' },
        { label: 'Program',       value: studentProgram || 'N/A' },
        { label: 'Student Email', value: studentEmail || 'N/A' },
        { label: 'Date',          value: interviewDate },
        { label: 'Time',          value: `${interviewTime} Pacific Time` },
        { label: 'Duration',      value: `${duration} minutes` },
        { label: 'Interviewer',   value: interviewerName || 'TBD' },
      ] })
    + renderEmailNote({
        title: 'Action needed',
        body: `Create the Microsoft Teams meeting, send the link to the student at ${studentEmail || 'their school email'}, then mark this booking as Teams invite sent in ASPIRE Intelligence.`,
        tone: 'warning',
      })

  try {
    const { data, error } = await resend.emails.send({
      from: 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>',
      reply_to: 'JesterLloyd.Bautista@cshs.org',
      to: recipients,
      subject: `New ASPIRE interview: ${studentName}, ${interviewDate} at ${interviewTime}`,
      html: aspireEmailShell({ body: emailBody, preheader }),
    })

    if (error) {
      console.error('[notify-interview-booked] Resend error:', JSON.stringify(error))
      return res.status(500).json({ error: error.message || 'Email send failed', resendError: error })
    }

    console.log('[notify-interview-booked] sent successfully:', data?.id)
    return res.status(200).json({ success: true, emailId: data?.id })
  } catch (err) {
    console.error('[notify-interview-booked] threw:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
