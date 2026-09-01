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

// The copy genuinely forks on whether the cohort has a configured close date, so both
// halves are reviewable rather than only the one today's data happens to produce.
const SAMPLE_CLOSE = '2026-11-06T07:59:59.999Z'

// The cohort name shown when no residency cohort is in scope. Deliberately generic: a
// specific sample name ("January 2027") went stale the moment a cohort was renamed, and
// read as though the template hard-coded it. The template has always interpolated
// cycle.name; only this fixture ever froze one.
const FALLBACK_CYCLE_NAME = 'the upcoming residency cohort'

// Build a preview entry for a REAL residency cohort. The cohort name is the one piece of
// live data here, and it is not sensitive - it is already on screen behind the drawer.
// Everything that identifies a person stays synthetic, and the URL stays a visible fake.
export function transitionPreviewFor(cycleName) {
  const name = String(cycleName || '').trim() || FALLBACK_CYCLE_NAME
  return {
    recipientType: 'Completed ASPIRE alum',
    variants: [
      { key: 'with_close', label: 'Cohort has a close date' },
      { key: 'no_close',   label: 'No close date set' },
    ],
    render: (variant = 'with_close') => buildTransitionEmail({
      student: SAMPLE_STUDENT,
      cycle: { name },
      url: SAMPLE_URL,
      closeText: variant === 'no_close' ? null : SAMPLE_CLOSE,
    }),
  }
}

// Cohort-less default, for any caller without one in scope.
export const NGRP_TRANSITION_PREVIEW = transitionPreviewFor(null)
