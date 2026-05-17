// api/notify-interview-booked.js
// Server-side notification when a student books an interview slot.
//
// EMAIL SERVICE NOT YET CONFIGURED — this endpoint logs the notification and
// returns 200 so the booking flow completes. Wire a real email service here:
//   - Resend: npm install resend  → import { Resend } from 'resend'
//   - Postmark, SendGrid, or Supabase Edge Functions w/ SMTP
//
// Recipients: interviewer + Jester (owner) so coverage is built in regardless
// of which interviewer is assigned.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    studentName,
    studentSchool,
    studentProgram,
    studentEmail,
    interviewDate,
    interviewTime,
    duration,
    interviewerName,
    interviewerEmail,
    ownerEmail,
  } = req.body || {}

  const recipients = [interviewerEmail, ownerEmail].filter(Boolean)

  // Log the notification intent — useful for debugging before email is wired
  console.log('[notify-interview-booked] New booking notification')
  console.log('  Student:', studentName, '|', studentSchool, '|', studentProgram)
  console.log('  Date/Time:', interviewDate, 'at', interviewTime, '(', duration, 'min )')
  console.log('  Interviewer:', interviewerName, '|', interviewerEmail)
  console.log('  Recipients:', recipients)
  console.log('  Student email:', studentEmail)

  // ── Wire email service here ───────────────────────────────────────────────
  // Example with Resend (install first: npm install resend):
  //
  // const { Resend } = await import('resend')
  // const resend = new Resend(process.env.RESEND_API_KEY)
  // await resend.emails.send({
  //   from: 'ASPIRE Intelligence <noreply@aspire-tracker.vercel.app>',
  //   to: recipients,
  //   subject: `New ASPIRE Interview: ${studentName} — ${interviewDate} at ${interviewTime}`,
  //   html: `
  //     <p>A student has self-scheduled an ASPIRE interview.</p>
  //     <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">
  //       <tr><td style="padding:4px 12px 4px 0"><strong>Student:</strong></td><td>${studentName}</td></tr>
  //       <tr><td style="padding:4px 12px 4px 0"><strong>School:</strong></td><td>${studentSchool}</td></tr>
  //       <tr><td style="padding:4px 12px 4px 0"><strong>Program:</strong></td><td>${studentProgram}</td></tr>
  //       <tr><td style="padding:4px 12px 4px 0"><strong>Student Email:</strong></td><td>${studentEmail}</td></tr>
  //       <tr><td style="padding:4px 12px 4px 0"><strong>Date:</strong></td><td>${interviewDate}</td></tr>
  //       <tr><td style="padding:4px 12px 4px 0"><strong>Time:</strong></td><td>${interviewTime} Pacific Time</td></tr>
  //       <tr><td style="padding:4px 12px 4px 0"><strong>Duration:</strong></td><td>${duration} minutes</td></tr>
  //       <tr><td style="padding:4px 12px 4px 0"><strong>Interviewer:</strong></td><td>${interviewerName}</td></tr>
  //     </table>
  //     <p style="margin-top:16px">
  //       <strong>Action needed:</strong> Create the Microsoft Teams meeting and send
  //       the invite to ${studentEmail}. Then mark the booking as "Teams invite sent"
  //       in the Day Manager.
  //     </p>
  //   `,
  // })
  // ─────────────────────────────────────────────────────────────────────────

  return res.status(200).json({ success: true, recipients, note: 'Email service not yet configured — logged to console' })
}
