// src/lib/ngrp/reflectionPreviewFixture.js
//
// RESIDENCY-REFLECTION-1: safe synthetic fixture for the in-app preview of the
// bi-weekly reflection email. ONE fixture, rendered in two places: the
// Automations card (through previewFixtures.js) and Residency > Support >
// During residency, next to the Start button. The Transition Form keeps its
// preview the same way.
//
// PREVIEW EQUALS SENT. It renders lib/server/email/ngrpReflectionEmail.js, the
// SAME builder the Start button and the Friday cron send through. A preview
// that re-implements the copy is a second template that drifts.
//
// NOTHING REAL IS IN HERE. No resident, no run, and above all NO TOKEN: the URL
// is a visibly fake placeholder, because a real per-recipient token exists only
// inside the emailed URL and may never round-trip through the browser.

import { buildReflectionEmail } from '../../../lib/server/email/ngrpReflectionEmail.js'
import { PERIOD_COUNT, buildSchedule } from './ngrpReflectionForm.js'

const SAMPLE_URL = 'https://aspireintelligence.app/ngrp/reflection/#sample-preview-not-a-real-link'
const SAMPLE_STUDENT = { first_name: 'Jordan', preferred_first_name: 'Jordan' }
// A fixed start day, so the dates in the preview never move under the reader.
// Friday 2026-09-18 puts period 1 due Sunday October 4 and period 2 opening
// Monday October 5, which is the schedule the tests pin as the worked example.
const SAMPLE_SCHEDULE = buildSchedule({ startedOn: '2026-09-18' })
const SAMPLE_RUN = { period_count: PERIOD_COUNT }

// The copy genuinely forks on whether this is the first period (which explains
// the About you section) or a later one (which names its opening Monday), so
// both halves are reviewable rather than only the one today's send produces.
export const NGRP_REFLECTION_PREVIEW = {
  recipientType: 'Resident (hired ASPIRE alum)',
  variants: [
    { key: 'first', label: 'Period 1 (sent by Start)' },
    { key: 'later', label: 'Period 2 of 5 (sent by the Friday cron)' },
  ],
  render: (variant = 'first') => buildReflectionEmail({
    student: SAMPLE_STUDENT,
    run: SAMPLE_RUN,
    period: SAMPLE_SCHEDULE[variant === 'later' ? 1 : 0],
    url: SAMPLE_URL,
  }),
}
