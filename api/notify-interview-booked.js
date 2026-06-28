import { Resend } from 'resend';
import { aspireEmailShell } from '../lib/server/email/aspireShell.js';

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

  // slot_id is a UUID — invariant to payload formatting differences
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
  const emailBody = `
        <h2 style="color:#1d2567;margin:0 0 12px;font-weight:600;font-size:20px;">New ASPIRE interview booked</h2>
        <p style="margin:0 0 16px;">A student has self-scheduled an ASPIRE interview.</p>
        <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student:</strong></td><td>${studentName}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>School:</strong></td><td>${studentSchool || 'N/A'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Program:</strong></td><td>${studentProgram || 'N/A'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Student Email:</strong></td><td>${studentEmail || 'N/A'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Date:</strong></td><td>${interviewDate}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Time:</strong></td><td>${interviewTime} Pacific Time</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Duration:</strong></td><td>${duration} minutes</td></tr>
          <tr><td style="padding:6px 16px 6px 0;color:#475467;"><strong>Interviewer:</strong></td><td>${interviewerName || 'TBD'}</td></tr>
        </table>
        <div style="background:#FBF5E8;border-left:3px solid #C08A2A;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <strong style="color:#8B5E1A;">Action needed:</strong> Create the Microsoft Teams meeting, send the link to the student at ${studentEmail || 'their school email'}, then mark this booking as Teams invite sent in ASPIRE Intelligence.
        </div>`

  try {
    const { data, error } = await resend.emails.send({
      from: 'ASPIRE Intelligence <noreply@aspire-program.com>',
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
