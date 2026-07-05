// Structural validation module for the ASPIRE Preceptor Student Progress & Readiness
// Feedback survey (slug/form_type: preceptor_progress).
//
// This survey is developmental/readiness feedback, NOT a hiring tool. Endorsement is
// "endorse for consideration" only. The module enforces the section-keyed response shape
// expected by the public.submit_preceptor_evaluation_response RPC (PS-2b-pre) and adds
// field-level checks. The RPC remains the final authority; this module mirrors its
// contract for the API/client layer.
//
// Response payload contract (section-keyed JSONB object):
//   developmental_feedback : object  (required by RPC)
//   readiness_endorsement  : object  (required by RPC)
//   confidential_team_comments : object  (OPTIONAL)
//   attestation            : present and affirmative  (required by RPC; not false/null)
//
// No copyrighted third-party item prose lives here - this is ASPIRE-authored content.

// ── Allowed value sets ────────────────────────────────────────────────────────

// Feedback periods (the TRUE period). Stored in developmental_feedback.context.
// The send flow maps these to existing evaluation_assignments.timepoint values
// (midpoint→midpoint, end_of_rotation→post_rotation, other_interim→custom) because
// the timepoint CHECK constraint does not allow the literal period strings and no
// schema migration is permitted in PS-2b.
export const FEEDBACK_PERIODS = Object.freeze(['midpoint', 'end_of_rotation', 'other_interim']);

export const PERIOD_LABELS = Object.freeze({
  midpoint:       'Midpoint',
  end_of_rotation:'End of Rotation',
  other_interim:  'Other / Interim Check-In',
});

// Bidirectional period ↔ timepoint mapping (no migration; reuses allowed timepoints).
export const PERIOD_TO_TIMEPOINT = Object.freeze({
  midpoint:        'midpoint',
  end_of_rotation: 'post_rotation',
  other_interim:   'custom',
});
export const TIMEPOINT_TO_PERIOD = Object.freeze({
  midpoint:      'midpoint',
  post_rotation: 'end_of_rotation',
  custom:        'other_interim',
});

// Rating scale (Section 2 competency items). Integers 1–5 map to the anchors:
//   1 Not Observed / Unable to Assess
//   2 Needs Close Support
//   3 Developing
//   4 Meeting Expected Student Level
//   5 Exceeding Expected Student Level
export const RATING_SCALE = Object.freeze([
  'Not Observed / Unable to Assess',
  'Needs Close Support',
  'Developing',
  'Meeting Expected Student Level',
  'Exceeding Expected Student Level',
]);

// Section 2 competency item codes (each: { rating 1–5, comment? }).
export const COMPETENCY_ITEMS = Object.freeze([
  'clinical_judgment',
  'patient_centered_care',
  'safety_quality',
  'teamwork_communication_collaboration',
  'professionalism_accountability',
  'advanced_beginner_readiness',
]);

// Section 4 single-select option sets.
export const TRANSITION_READINESS_OPTIONS = Object.freeze([
  'Strongly progressing and demonstrating readiness',
  'Progressing appropriately for student level',
  'Progressing, with continued focused support recommended',
  'Not yet demonstrating expected readiness',
  'Unable to assess',
]);

export const ENDORSEMENT_OPTIONS = Object.freeze([
  'Yes, enthusiastically',
  'Yes',
  'Yes, with focused support or continued development',
  'Not at this time',
  'Unable to assess',
]);

export const SHIFTS_OBSERVED_OPTIONS = Object.freeze([
  '1 shift',
  '2–3 shifts',
  '4–6 shifts',
  '7 or more shifts',
  'Not sure',
]);

// Free-text length bounds (defensive; mirrors casey S4_COMMENT bound style).
const MAX_SHORT = 4000;
const MAX_COMMENT = 2000;

export const SCHEMA = Object.freeze({
  slug: 'preceptor_progress',
  formType: 'preceptor_progress',
  displayName: 'Preceptor Student Readiness Assessment',
  sectionKeys: Object.freeze([
    'developmental_feedback',
    'readiness_endorsement',
    'confidential_team_comments',
    'attestation',
  ]),
  feedbackPeriods: FEEDBACK_PERIODS,
  ratingScale: RATING_SCALE,
  competencyItems: COMPETENCY_ITEMS,
  // Field-level required set enforced by this module (RPC enforces the coarse shape).
  requiredFields: Object.freeze({
    developmental_feedback: Object.freeze([
      'context.feedback_period',
      'competency.<each item>.rating',
      'narrative.strengths_observed',
      'narrative.areas_for_development',
    ]),
    readiness_endorsement: Object.freeze([
      'transition_readiness',
      'unit_endorsement_consideration',
      'endorsement_explanation',
      'cedars_consideration_recommendation',
    ]),
    attestation: Object.freeze(['attestation_confirmed (must be true)']),
  }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v, max = MAX_SHORT) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function isOptionalString(v, max = MAX_SHORT) {
  return v == null || v === '' || (typeof v === 'string' && v.length <= max);
}

// Attestation is affirmative when it is boolean true, the string 'true', or an object
// whose attestation_confirmed is true. Mirrors the RPC's "present and not false/null"
// gate with a stricter affirmative requirement on the client/API layer.
function isAffirmativeAttestation(att) {
  if (att === true) return true;
  if (att === 'true') return true;
  if (isPlainObject(att) && att.attestation_confirmed === true) return true;
  return false;
}

// ── Validation ──────────────────────────────────────────────────────────────

export function validateResponses(responses) {
  const errors = [];

  if (!isPlainObject(responses)) {
    return { valid: false, errors: ['responses must be a plain object'] };
  }

  // ── developmental_feedback (object, required) ──
  const df = responses.developmental_feedback;
  if (!isPlainObject(df)) {
    errors.push('developmental_feedback must be an object');
  } else {
    // context.feedback_period required + allowed
    const ctx = df.context;
    if (!isPlainObject(ctx)) {
      errors.push('developmental_feedback.context must be an object');
    } else {
      if (!FEEDBACK_PERIODS.includes(ctx.feedback_period)) {
        errors.push('developmental_feedback.context.feedback_period is required and must be a valid period');
      }
      if (ctx.shifts_observed != null && ctx.shifts_observed !== '' &&
          !SHIFTS_OBSERVED_OPTIONS.includes(ctx.shifts_observed)) {
        errors.push('developmental_feedback.context.shifts_observed must be a valid option');
      }
    }

    // competency ratings (each item: rating 1–5 required; comment optional)
    const comp = df.competency;
    if (!isPlainObject(comp)) {
      errors.push('developmental_feedback.competency must be an object');
    } else {
      for (const code of COMPETENCY_ITEMS) {
        const item = comp[code];
        if (!isPlainObject(item)) {
          errors.push(`developmental_feedback.competency.${code} must be an object`);
          continue;
        }
        if (!Number.isInteger(item.rating) || item.rating < 1 || item.rating > 5) {
          errors.push(`developmental_feedback.competency.${code}.rating must be an integer 1–5`);
        }
        if (!isOptionalString(item.comment, MAX_COMMENT)) {
          errors.push(`developmental_feedback.competency.${code}.comment must be a string ≤ ${MAX_COMMENT} chars`);
        }
      }
    }

    // narrative (strengths + areas required; support plan optional)
    const narr = df.narrative;
    if (!isPlainObject(narr)) {
      errors.push('developmental_feedback.narrative must be an object');
    } else {
      if (!isNonEmptyString(narr.strengths_observed)) {
        errors.push('developmental_feedback.narrative.strengths_observed is required');
      }
      if (!isNonEmptyString(narr.areas_for_development)) {
        errors.push('developmental_feedback.narrative.areas_for_development is required');
      }
      if (!isOptionalString(narr.suggested_support_plan)) {
        errors.push('developmental_feedback.narrative.suggested_support_plan must be a string');
      }
    }
  }

  // ── readiness_endorsement (object, required) ──
  const re = responses.readiness_endorsement;
  if (!isPlainObject(re)) {
    errors.push('readiness_endorsement must be an object');
  } else {
    if (!TRANSITION_READINESS_OPTIONS.includes(re.transition_readiness)) {
      errors.push('readiness_endorsement.transition_readiness is required and must be a valid option');
    }
    if (!ENDORSEMENT_OPTIONS.includes(re.unit_endorsement_consideration)) {
      errors.push('readiness_endorsement.unit_endorsement_consideration is required and must be a valid option');
    }
    if (!ENDORSEMENT_OPTIONS.includes(re.cedars_consideration_recommendation)) {
      errors.push('readiness_endorsement.cedars_consideration_recommendation is required and must be a valid option');
    }
    if (!isNonEmptyString(re.endorsement_explanation)) {
      errors.push('readiness_endorsement.endorsement_explanation is required');
    }
    if (!isOptionalString(re.best_fit_environment)) {
      errors.push('readiness_endorsement.best_fit_environment must be a string');
    }
  }

  // ── confidential_team_comments (object, OPTIONAL) ──
  const ctc = responses.confidential_team_comments;
  if (ctc != null) {
    if (!isPlainObject(ctc)) {
      errors.push('confidential_team_comments must be an object when present');
    } else if (!isOptionalString(ctc.confidential_comments)) {
      errors.push('confidential_team_comments.confidential_comments must be a string');
    }
  }

  // ── attestation (present + affirmative, required) ──
  if (!('attestation' in responses) || !isAffirmativeAttestation(responses.attestation)) {
    errors.push('attestation must be present and affirmatively confirmed');
  }

  // ── No unexpected top-level keys ──
  const allowedTop = new Set(SCHEMA.sectionKeys);
  for (const key of Object.keys(responses)) {
    if (!allowedTop.has(key)) {
      errors.push(`unexpected response key ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
