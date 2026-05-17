import { Resend } from 'resend';

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

  const resend = new Resend(process.env.RESEND_API_KEY)
  const recipients = [...new Set([ownerEmail, interviewerEmail].filter(Boolean))]

  console.log('[notify-interview-booked] sending to:', recipients)

  try {
    const { data, error } = await resend.emails.send({
      from: 'ASPIRE Intelligence <onboarding@resend.dev>',
      to: recipients,
      subject: `New ASPIRE Interview: ${studentName} — ${interviewDate} at ${interviewTime}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; color: #0E1428;">
          <h2 style="color: #1D2567; margin-bottom: 16px; font-weight: 600;">New ASPIRE Interview Booked</h2>
          <p style="margin: 0 0 16px; font-size: 14px;">A student has self-scheduled an ASPIRE interview.</p>
          <table style="border-collapse: collapse; margin: 16px 0; font-size: 14px;">
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>Student:</strong></td><td>${studentName}</td></tr>
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>School:</strong></td><td>${studentSchool || 'N/A'}</td></tr>
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>Program:</strong></td><td>${studentProgram || 'N/A'}</td></tr>
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>Student Email:</strong></td><td>${studentEmail || 'N/A'}</td></tr>
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>Date:</strong></td><td>${interviewDate}</td></tr>
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>Time:</strong></td><td>${interviewTime} Pacific Time</td></tr>
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>Duration:</strong></td><td>${duration} minutes</td></tr>
            <tr><td style="padding: 6px 16px 6px 0; color: #475467;"><strong>Interviewer:</strong></td><td>${interviewerName || 'TBD'}</td></tr>
          </table>
          <div style="background: #FBF5E8; border-left: 3px solid #C08A2A; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <strong style="color: #8B5E1A;">Action needed:</strong> Create the Microsoft Teams meeting and send the link to the student at ${studentEmail || 'their school email'}.
          </div>
          <p style="margin: 16px 0 8px; font-size: 13px; color: #475467;">
            Once you've sent the Teams invite, open ASPIRE Intelligence and mark this booking as "Teams invite sent" in the Day Manager.
          </p>
          <p style="margin-top: 24px; font-size: 12px; color: #98A2B3; border-top: 1px solid #E5E7EB; padding-top: 12px;">
            This is an automated notification from ASPIRE Intelligence · Brawerman Nursing Institute · Cedars-Sinai Medical Center
          </p>
        </div>
      `,
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
