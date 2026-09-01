// PHASE2-PORTAL: pure derivation of a student's portal "next steps" checklist
// from their program status plus lightweight progress facts. No I/O; unit
// tested in test/portalNextSteps.test.mjs.
//
// Statuses come from students.status (see the Phase 0A audit, section 7 of
// the schema map): Pending Outreach, Form Sent, Form Received,
// Interview Scheduled, Interviewed, Placed, Active Rotation, Completed,
// Declined, Not Proceeding.

export function deriveNextSteps({ status, hours, evaluations = [], certificate = null }) {
  const approved = hours?.approved ?? 0
  const required = hours?.required ?? null
  const remaining = required != null ? Math.max(0, required - approved) : null

  const pendingEvals = evaluations.filter(e =>
    e.status && !['completed', 'revoked', 'expired'].includes(e.status)
  )

  const steps = []

  switch (status) {
    case 'Pending Outreach':
    case 'Form Sent':
      steps.push({ key: 'intake', label: 'Complete your intake form (link from the ASPIRE team)', done: false })
      break
    case 'Form Received':
      steps.push({ key: 'intake', label: 'Intake form received', done: true })
      steps.push({ key: 'interview', label: 'Watch for your interview scheduling invitation', done: false })
      break
    case 'Interview Scheduled':
      steps.push({ key: 'interview', label: 'Attend your ASPIRE interview', done: false })
      break
    case 'Interviewed':
      steps.push({ key: 'interview', label: 'Interview complete', done: true })
      steps.push({ key: 'placement', label: 'Placement in progress; the ASPIRE team will confirm your unit', done: false })
      break
    case 'Placed':
      steps.push({ key: 'placement', label: 'Unit placement confirmed', done: true })
      steps.push({ key: 'onboarding', label: 'Complete onboarding and clearance requirements with your school', done: false })
      steps.push({ key: 'dates', label: 'Confirm your rotation dates with your preceptor', done: false })
      break
    case 'Active Rotation':
      steps.push({ key: 'log', label: 'Log every shift at aspireintelligence.app/shift-log', done: false })
      if (remaining != null) {
        steps.push({
          key: 'hours',
          label: remaining > 0
            ? `Complete your remaining ${remaining} clinical hours`
            : 'Required clinical hours reached',
          done: remaining === 0,
        })
      }
      if (pendingEvals.length > 0) {
        steps.push({ key: 'evals', label: `Complete ${pendingEvals.length} pending evaluation${pendingEvals.length > 1 ? 's' : ''}`, done: false })
      }
      steps.push({ key: 'support', label: 'Use the support field on any shift log if you need help', done: false, informational: true })
      break
    case 'Completed':
      steps.push({ key: 'rotation', label: 'Rotation complete', done: true })
      if (pendingEvals.length > 0) {
        steps.push({ key: 'evals', label: 'Complete your post-rotation survey to unlock your certificate', done: false })
      }
      if (certificate?.certificate_unlocked_at) {
        steps.push({ key: 'certificate', label: `Certificate ${certificate.certificate_number} issued; use the download link from your certificate email`, done: true })
      } else if (pendingEvals.length === 0) {
        steps.push({ key: 'certificate', label: 'Certificate processing; watch your email', done: false })
      }
      steps.push({ key: 'ngrp', label: 'Apply to the New Graduate RN Residency Program when applications open', done: false })
      break
    case 'Declined':
    case 'Not Proceeding':
      steps.push({ key: 'contact', label: 'Contact the ASPIRE team with any questions about your status', done: false })
      break
    default:
      steps.push({ key: 'contact', label: 'The ASPIRE team will reach out with your next steps', done: false })
  }

  return steps
}
