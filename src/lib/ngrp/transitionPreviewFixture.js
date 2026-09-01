// src/lib/ngrp/transitionPreviewFixture.js
//
// NGRP-TRANSITION-PREVIEW-1: safe synthetic fixture for the in-app preview of the NGRP
// Transition Form invitation.
//
// PREVIEW EQUALS SENT. It renders lib/server/email/ngrpTransitionEmail.js, the SAME
// builder api/ngrp-transition-send.js sends through. A preview that re-implements the
// copy is a second template that drifts, and the drift is invisible until a student
// receives something nobody reviewed. This is the rule
// src/lib/notifications/previewFixtures.js already states for the automation previews.
//
// SEPARATE FROM THAT REGISTRY on purpose: it is keyed to AUTOMATION_CARDS ids, and the
// Transition Form is not an automation. Nothing schedules it; a person selects alumni
// and sends. Registering it there would imply a cron that does not exist.
//
// NOTHING REAL IS IN HERE. No student, no cohort, no recipient, and above all NO TOKEN.
// The URL is a visibly fake placeholder: a real per-recipient token exists only inside
// the emailed URL and may never round-trip through the browser, so the preview must not
// be able to show one even by accident.

import { buildTransitionEmail } from '../../../lib/server/email/ngrpTransitionEmail.js'

// Obviously-fake and obviously-not-a-token. Anyone screenshotting this preview is
// sharing a placeholder, not a live link.
const SAMPLE_URL = 'https://aspireintelligence.app/ngrp/transition/#sample-preview-not-a-real-link'

const SAMPLE_STUDENT = { first_name: 'Jordan', name: 'Jordan Avery' }
const SAMPLE_CYCLE = { name: 'January 2027' }

// The copy genuinely forks on whether the cohort has a configured close date, so both
// halves are reviewable rather than only the one today's data happens to produce.
const SAMPLE_CLOSE = '2026-11-06T07:59:59.999Z'

export const NGRP_TRANSITION_PREVIEW = {
  recipientType: 'Completed ASPIRE alumnus',
  variants: [
    { key: 'with_close', label: 'Cohort has a close date' },
    { key: 'no_close',   label: 'No close date set' },
  ],
  render: (variant = 'with_close') => buildTransitionEmail({
    student: SAMPLE_STUDENT,
    cycle: SAMPLE_CYCLE,
    url: SAMPLE_URL,
    closeText: variant === 'no_close' ? null : SAMPLE_CLOSE,
  }),
}
