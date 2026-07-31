// api/form-received-notification.js
// Called fire-and-forget by the two placement-request submit paths (api/school-form-submit.js and
// api/portal/school-placement-requests.js) after each new student insert. The route name is
// historical; AP-SCHOOL-CANONICALIZATION-1 corrected WHAT it sends: the
// 'placement_request_received' notification - placement-request language to the SUBMITTING
// COORDINATOR plus the internal team, never the student (a coordinator's placement request is not a
// student application; the student has not submitted anything yet).
// No auth token required - both callers are server-side, and the underlying submissions are already
// gated (cohort password / Academic Partner JWT), so this endpoint is only reachable in context.

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
    cohortName,
    studentName,
    studentFirstName,
    studentEmail,
    school,
    programType,
    coordinatorName,
    coordinatorEmail,
  } = req.body || {}

  if (!studentEmail || !school) {
    return res.status(400).json({ error: 'studentEmail and school are required' })
  }

  try {
    const results = await sendNotification('placement_request_received', {
      studentId,
      cohortId,
      cohortName:       cohortName || '',
      studentName:      studentName      || studentEmail,
      studentFirstName: studentFirstName || studentEmail.split('@')[0],
      studentEmail,
      school,
      programType:      programType || '',
      coordinatorName:  coordinatorName || '',
      coordinatorEmail: coordinatorEmail || '',
    })
    return res.status(200).json({ success: true, results })
  } catch (err) {
    console.error('[form-received-notification] error:', err)
    return res.status(500).json({ error: err.message })
  }
}
