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
import { effectiveFormClose } from '../../../lib/server/ngrpTransition.js'
import { portalAccessEnd } from '../../../lib/server/ngrpPortalAccess.js'

// Obviously-fake and obviously-not-a-token. Anyone screenshotting this preview is
// sharing a placeholder, not a live link.
const SAMPLE_URL = 'https://aspireintelligence.app/ngrp/transition/#sample-preview-not-a-real-link'

const SAMPLE_STUDENT = { first_name: 'Jordan', name: 'Jordan Avery' }

// TRANSITION-PORTAL-1: the portal half. The sign-in address and the activation link are
// visible fakes too; the access end is the send's own rule over the cohort's start date.
const SAMPLE_SIGN_IN = 'jordan.avery@example.com'
const SAMPLE_ACTIVATION = 'https://aspireintelligence.app/auth/activate#sample-preview-not-a-real-link'
const SAMPLE_PORTAL_URL = 'https://aspireintelligence.app/portal/residency?form=1'

// The copy genuinely forks on whether the cohort has a configured close date, so both
// halves are reviewable rather than only the one today's data happens to produce.
const SAMPLE_CLOSE = '2026-11-06T07:59:59.999Z'

// The cohort name shown when no residency cohort is in scope. Deliberately generic: a
// specific sample name ("January 2027") went stale the moment a cohort was renamed, and
// read as though the template hard-coded it. The template has always interpolated
// cycle.name; only this fixture ever froze one.
const FALLBACK_CYCLE_NAME = 'the upcoming residency cohort'

// Build a preview entry for a REAL residency cohort. The cohort name and its close date
// are the live data here, and neither is sensitive - both are already on screen behind
// the drawer. Everything that identifies a person stays synthetic, and the URL stays a
// visible fake.
//
// PREVIEW-CLOSE-DATE-1 (Owner, 2026-10-29): the close date is the one a send without a
// per-send date uses, Pacific end of day on the cohort's application deadline
// (effectiveFormClose, the send's own rule). The sample date read as the real deadline and
// disagreed with the form. It is used only when the cohort has no deadline yet, so the
// "has a close date" half stays reviewable.
// TRANSITION-DEADLINE-1: the cohort's Transition Form deadline, not its application deadline.
export function transitionPreviewFor(cycleName, formDeadline = null, { applicationOpenDate = null, residencyStartDate = null } = {}) {
  const name = String(cycleName || '').trim() || FALLBACK_CYCLE_NAME
  const close = effectiveFormClose({ transition_form_deadline: formDeadline }, null) || SAMPLE_CLOSE
  const cycle = { name, application_open_date: applicationOpenDate }
  const accessEndsAt = portalAccessEnd({ residency_start_date: residencyStartDate })
  const portal = activation => (accessEndsAt
    ? { signInUrl: SAMPLE_PORTAL_URL, signInEmail: SAMPLE_SIGN_IN, accessEndsAt, activationLink: activation ? SAMPLE_ACTIVATION : null }
    : null)
  return {
    recipientType: 'Completed ASPIRE alum',
    variants: [
      { key: 'with_close', label: 'First portal sign-in' },
      { key: 'has_account', label: 'Already has a portal password' },
      { key: 'no_close',   label: 'No close date set' },
    ],
    render: (variant = 'with_close') => buildTransitionEmail({
      student: SAMPLE_STUDENT,
      cycle,
      url: SAMPLE_URL,
      closeText: variant === 'no_close' ? null : close,
      portal: portal(variant !== 'has_account'),
    }),
  }
}

// Cohort-less default, for any caller without one in scope.
export const NGRP_TRANSITION_PREVIEW = transitionPreviewFor(null)
