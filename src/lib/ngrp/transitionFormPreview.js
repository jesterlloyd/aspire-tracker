// src/lib/ngrp/transitionFormPreview.js
//
// TRANSITION-FORM-PREVIEW-1: the sample "load" response that lets staff see the NGRP
// Transition Form itself, not only the email that links to it. It has the exact shape
// api/ngrp-transition.js returns for a real link, so NgrpTransitionFormPage renders it
// with no second layout to keep in step.
//
// The cohort's own configuration is live (its name, close date, active hiring units and
// application checklist): that is what decides how the form reads. Everything about the
// person is synthetic, matching the email preview's Jordan Avery, and there is no token.

import { effectiveFormClose } from '../../../lib/server/ngrpTransition.js'
import { formReadinessChecklist } from '../../../lib/server/ngrpEligibility.js'

const SAMPLE = {
  studentName: 'Jordan',
  studentFullName: 'Jordan Avery',
  school: 'Sample University',
  program: 'BSN',
  aspireCohort: 'Summer 2026',
  email: 'jordan.avery@example.com',
}

export function transitionFormPreview({ cycle = null, units = [] } = {}) {
  const activeUnits = (units || [])
    .filter(u => u && u.unit_name && u.is_active !== false)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map(u => u.unit_name)
  return {
    state: 'form',
    studentName: SAMPLE.studentName,
    studentFullName: SAMPLE.studentFullName,
    school: SAMPLE.school,
    program: SAMPLE.program,
    aspireCohort: SAMPLE.aspireCohort,
    suggestedEmail: SAMPLE.email,
    cycleName: cycle?.name || '',
    closeAt: cycle ? effectiveFormClose(cycle, null) : null,
    units: activeUnits,
    checklist: formReadinessChecklist(cycle?.application_checklist),
    // The prefill a first open gets (api/ngrp-transition.js `load`, no draft yet).
    base: {
      identity: { preferred_email: SAMPLE.email },
      education: { school: SAMPLE.school, program: SAMPLE.program },
      aspire: { aspire_cohort: SAMPLE.aspireCohort },
    },
    baseKind: 'none',
    status: 'sent',
    revisionCount: 0,
    submittedAt: null,
    revisedAt: null,
  }
}
