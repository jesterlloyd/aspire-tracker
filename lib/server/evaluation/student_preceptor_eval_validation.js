// Structural validation module for the ASPIRE Student Evaluation of Preceptor/Unit
// Experience survey (slug/form_type: student_preceptor_eval).
//
// The student is BOTH the subject and the respondent. The preceptor/unit being evaluated
// is the evaluated_target ONLY — carried in the response JSON, never as respondent identity.
//
// This module mirrors the section-keyed shape enforced by the RPC
// public.submit_student_preceptor_evaluation_response (SR-2-pre) and adds field-level
// checks (rating scale, required items). The RPC remains the final structural authority.
//
// Response payload contract:
//   evaluated_target     : object (preceptor_name, preceptor_id, unit — display context)
//   preceptor_support    : object (4 Likert items + optional comment)
//   learning_environment : object (4 Likert items + optional comment)
//   psychological_safety : object (4 Likert items)
//   overall_experience   : object (2 Likert items + overall_rating 1–5)
//   narrative            : object (strengths, suggestions, open_comment — optional strings)
//   attestation          : object (attestation_confirmed === true)

// Likert scale values (mirrors student_preceptor_eval.json ratingScale): 5..1 or 'na'.
export const RATING_VALUES = Object.freeze([1, 2, 3, 4, 5, 'na']);
// overall_rating uses its own 5..1 scale (no 'na').
export const OVERALL_RATING_VALUES = Object.freeze([1, 2, 3, 4, 5]);

// Required Likert items per domain (keys match student_preceptor_eval.json).
export const DOMAIN_ITEMS = Object.freeze({
  preceptor_support: Object.freeze([
    'approachable_available', 'clear_explanations', 'useful_feedback', 'skill_development',
  ]),
  learning_environment: Object.freeze([
    'included_in_care', 'welcoming_unit', 'practice_opportunities', 'workflow_supported_learning',
  ]),
  psychological_safety: Object.freeze([
    'comfortable_questions', 'comfortable_speaking_up', 'comfortable_raising_concerns', 'treated_with_respect',
  ]),
});

// overall_experience: two Likert items + a separate overall_rating.
export const OVERALL_LIKERT_ITEMS = Object.freeze(['valuable_experience', 'would_recommend']);

// Optional free-text comment keys allowed inside specific domains.
const DOMAIN_COMMENT_KEYS = Object.freeze({
  preceptor_support:    'preceptor_support_comment',
  learning_environment: 'learning_environment_comment',
});

const NARRATIVE_FIELDS = Object.freeze(['strengths', 'suggestions', 'open_comment']);

const MAX_COMMENT = 4000;

export const SCHEMA = Object.freeze({
  slug: 'student_preceptor_eval',
  formType: 'student_preceptor_eval',
  displayName: 'Student Feedback: Preceptor & Unit',
  sectionKeys: Object.freeze([
    'evaluated_target',
    'preceptor_support',
    'learning_environment',
    'psychological_safety',
    'overall_experience',
    'narrative',
    'attestation',
  ]),
  ratingValues: RATING_VALUES,
  overallRatingValues: OVERALL_RATING_VALUES,
  domainItems: DOMAIN_ITEMS,
  overallLikertItems: OVERALL_LIKERT_ITEMS,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isRating(v) {
  return (Number.isInteger(v) && v >= 1 && v <= 5) || v === 'na';
}
function isOverallRating(v) {
  return Number.isInteger(v) && v >= 1 && v <= 5;
}
function isOptionalString(v, max = MAX_COMMENT) {
  return v == null || v === '' || (typeof v === 'string' && v.length <= max);
}

// ── Validation ──────────────────────────────────────────────────────────────

export function validateResponses(responses) {
  const errors = [];

  if (!isPlainObject(responses)) {
    return { valid: false, errors: ['responses must be a plain object'] };
  }

  // ── evaluated_target (object; context only — preceptor/unit being evaluated) ──
  const et = responses.evaluated_target;
  if (!isPlainObject(et)) {
    errors.push('evaluated_target must be an object');
  } else {
    for (const k of ['preceptor_name', 'preceptor_id', 'unit']) {
      if (!isOptionalString(et[k])) errors.push(`evaluated_target.${k} must be a string`);
    }
  }

  // ── Likert domains: each required item must be a valid rating; comment optional ──
  for (const [domain, items] of Object.entries(DOMAIN_ITEMS)) {
    const obj = responses[domain];
    if (!isPlainObject(obj)) {
      errors.push(`${domain} must be an object`);
      continue;
    }
    for (const item of items) {
      if (!isRating(obj[item])) {
        errors.push(`${domain}.${item} must be 1–5 or "na"`);
      }
    }
    const commentKey = DOMAIN_COMMENT_KEYS[domain];
    if (commentKey && !isOptionalString(obj[commentKey])) {
      errors.push(`${domain}.${commentKey} must be a string`);
    }
  }

  // ── overall_experience: 2 Likert items + overall_rating (1–5, no 'na') ──
  const oe = responses.overall_experience;
  if (!isPlainObject(oe)) {
    errors.push('overall_experience must be an object');
  } else {
    for (const item of OVERALL_LIKERT_ITEMS) {
      if (!isRating(oe[item])) errors.push(`overall_experience.${item} must be 1–5 or "na"`);
    }
    if (!isOverallRating(oe.overall_rating)) {
      errors.push('overall_experience.overall_rating must be an integer 1–5');
    }
  }

  // ── narrative (object; text fields optional strings) ──
  const narr = responses.narrative;
  if (!isPlainObject(narr)) {
    errors.push('narrative must be an object');
  } else {
    for (const f of NARRATIVE_FIELDS) {
      if (!isOptionalString(narr[f])) errors.push(`narrative.${f} must be a string`);
    }
  }

  // ── attestation (object; attestation_confirmed must be boolean true) ──
  const att = responses.attestation;
  if (!isPlainObject(att) || att.attestation_confirmed !== true) {
    errors.push('attestation.attestation_confirmed must be true');
  }

  // ── No unexpected top-level keys ──
  const allowedTop = new Set(SCHEMA.sectionKeys);
  for (const key of Object.keys(responses)) {
    if (!allowedTop.has(key)) errors.push(`unexpected response key ${key}`);
  }

  return { valid: errors.length === 0, errors };
}
