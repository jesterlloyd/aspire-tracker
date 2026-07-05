// api/form-received-notification.js
// Called fire-and-forget from SchoolFormPage.jsx after student insert.
// No auth token required - the school form is already password-protected at
// the cohort level, so this endpoint is only reachable in that context.

import { sendNotification } from '../src/lib/notifications/index.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    studentId,
    cohortId,
    studentName,
    studentFirstName,
    studentEmail,
    school,
    programType,
    cumulativeGpa,
  } = req.body || {}

  if (!studentEmail || !school) {
    return res.status(400).json({ error: 'studentEmail and school are required' })
  }

  try {
    const results = await sendNotification('form_received', {
      studentId,
      cohortId,
      studentName:      studentName      || studentEmail,
      studentFirstName: studentFirstName || studentEmail.split('@')[0],
      studentEmail,
      school,
      programType,
      cumulativeGpa,
    })
    return res.status(200).json({ success: true, results })
  } catch (err) {
    console.error('[form-received-notification] error:', err)
    return res.status(500).json({ error: err.message })
  }
}
