// ASPIRE-STUDENT-HOME: pure, null-safe derivations for the Student Portal
// desktop progress surfaces (hero current-stage, the Next Steps timeline, and
// the Clinical Hours summary). No React, no I/O, so the portal and the tests
// share one source. Every value is derived ONLY from reliable ASPIRE status
// data; nothing here invents a stage or promises that an upcoming step occurs.
//
// students.status lifecycle (see src/lib/constants.js ASPIRE_STATUSES and
// src/lib/portalNextSteps.js): Pending Outreach, Form Sent, Form Received,
// Interview Scheduled, Interviewed, Placed, Active Rotation, Completed,
// Declined, Not Proceeding.

// Ordered rank of each lifecycle status. Terminal/off-ramp statuses are absent
// on purpose (they never map onto the linear progress ladder).
const STATUS_RANK = {
  'Pending Outreach': 0,
  'Form Sent': 0,
  'Form Received': 1,
  'Interview Scheduled': 2,
  'Interviewed': 3,
  'Placed': 4,
  'Active Rotation': 5,
  'Completed': 6,
}

const TERMINAL_STATUSES = new Set(['Declined', 'Not Proceeding'])

// ── Hero current-stage ───────────────────────────────────────────────────────
// A compact { current, next } pair for the desktop hero, derived ONLY from a
// recognized status. Returns null for unknown or off-ramp statuses so the hero
// never shows an invented stage. "next" copy never guarantees an outcome.
const STAGE_BY_STATUS = {
  'Pending Outreach': { current: 'Getting started', next: 'Complete your ASPIRE intake form when you receive it' },
  'Form Sent':        { current: 'Getting started', next: 'Complete your ASPIRE intake form when you receive it' },
  'Form Received':    { current: 'Application received', next: 'Watch for your interview scheduling invitation' },
  'Interview Scheduled': { current: 'Interview scheduled', next: 'Attend your ASPIRE interview' },
  'Interviewed':      { current: 'Interview completed', next: 'The ASPIRE team is finalizing placements' },
  'Placed':           { current: 'Placement confirmed', next: 'Complete onboarding and confirm your rotation dates' },
  'Active Rotation':  { current: 'Rotation in progress', next: 'Log every shift and complete your clinical hours' },
  'Completed':        { current: 'Rotation completed', next: 'Watch your email for your certificate' },
}

export function deriveHeroStage(status) {
  const stage = STAGE_BY_STATUS[status]
  return stage ? { current: stage.current, next: stage.next } : null
}

// ── Next Steps timeline ──────────────────────────────────────────────────────
// The ASPIRE lifecycle milestones. Each carries the rank a status must reach for
// the milestone to be COMPLETE; the certificate milestone completes on the real
// certificate-unlock signal instead. State is one of 'complete' | 'current' |
// 'upcoming', with a plain-text stateLabel for screen readers.
const MILESTONES = [
  { key: 'application',          label: 'Application received', minRank: 1 },
  { key: 'interview_scheduling', label: 'Interview scheduling', minRank: 2 },
  { key: 'interview_completed',  label: 'Interview completed',  minRank: 3 },
  { key: 'placement',            label: 'Placement confirmed',  minRank: 4 },
  { key: 'rotation_started',     label: 'Rotation started',     minRank: 5 },
  { key: 'rotation_completed',   label: 'Rotation completed',   minRank: 6 },
  { key: 'certificate',          label: 'Certificate available', cert: true },
]

const STATE_LABEL = { complete: 'Complete', current: 'Current', upcoming: 'Upcoming' }

// Returns { terminal, steps: [{ key, label, state, stateLabel }] }.
// Off-ramp statuses return a single, neutral contact step (terminal: true) and
// never render the progression ladder. Unknown statuses collapse to the same
// safe single step so nothing unsupported is shown.
export function derivePortalTimeline({ status, certificateUnlocked = false } = {}) {
  if (TERMINAL_STATUSES.has(status)) {
    return {
      terminal: true,
      steps: [{ key: 'status', label: 'Contact the ASPIRE team about your status', state: 'current', stateLabel: STATE_LABEL.current }],
    }
  }
  const rank = STATUS_RANK[status]
  if (rank == null) {
    return {
      terminal: true,
      steps: [{ key: 'status', label: 'The ASPIRE team will reach out with your next steps', state: 'current', stateLabel: STATE_LABEL.current }],
    }
  }

  const completed = MILESTONES.map(m => (m.cert ? !!certificateUnlocked : rank >= m.minRank))
  const currentIndex = completed.indexOf(false) // first not-yet-complete milestone

  const steps = MILESTONES.map((m, i) => {
    let state
    if (completed[i]) state = 'complete'
    else if (i === currentIndex) state = 'current'
    else state = 'upcoming'
    return { key: m.key, label: m.label, state, stateLabel: STATE_LABEL[state] }
  })
  return { terminal: false, steps }
}

// ── Clinical hours ───────────────────────────────────────────────────────────
// A progress bar is meaningful ONLY when required and completed hours are both
// finite numbers and required is greater than zero. Required hours are never
// inferred from unrelated fields. Returns { reliable, required, completed,
// remaining, pending, pct }; when not reliable, reliable is false and the card
// shows a compact empty state instead of a misleading bar.
export function deriveClinicalHours({ required, approved, pending } = {}) {
  const req = required == null ? NaN : Number(required)
  const done = approved == null ? NaN : Number(approved)
  const pend = Number(pending)
  const reliable = Number.isFinite(req) && req > 0 && Number.isFinite(done)
  if (!reliable) {
    return { reliable: false, required: null, completed: null, remaining: null, pending: null, pct: null }
  }
  const completed = Math.max(0, done)
  const remaining = Math.max(0, req - completed)
  const pct = Math.min(100, Math.max(0, Math.round((completed / req) * 100)))
  return {
    reliable: true,
    required: req,
    completed,
    remaining,
    pending: Number.isFinite(pend) && pend > 0 ? pend : 0,
    pct,
  }
}
