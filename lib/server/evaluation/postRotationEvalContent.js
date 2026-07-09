// lib/server/evaluation/postRotationEvalContent.js
//
// ASPIRE-POSTROTATION-EVAL-FORM-1 - approved content + validation for the ASPIRE Post-Rotation
// Evaluation (instrument slug: post_rotation_evaluation, timepoint: post_rotation). The student
// is the subject AND respondent. This module is the single source of truth for the question set:
// the token-validate endpoint returns CONTENT to the page, and the submit endpoint validates the
// flat response object with validateResponses(). The submit RPC re-validates structurally as the
// final authority. No questions are invented here; the content is the approved set.

export const RATING_VALUES = Object.freeze([1, 2, 3, 4, 5]);

// Likert scale, ascending. Words carry the anchor; the numeric value is submitted.
const RATING_SCALE = Object.freeze([
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' },
]);

// Structured content the page renders generically. Each item: { key, type, required, label, helper? }.
// type is 'rating' (1-5), 'text' (free response), or 'yesno' (boolean).
export const POST_ROTATION_CONTENT = Object.freeze({
  title: 'ASPIRE Post-Rotation Evaluation',
  intro:
    'Congratulations on completing ASPIRE. Please take a few minutes to reflect on your experience. ' +
    'Your feedback helps us improve ASPIRE for future students and academic partners. After your ' +
    'evaluation is submitted, your Certificate of Participation will become available.',
  ratingScale: RATING_SCALE,
  sections: Object.freeze([
    {
      key: 'section1',
      title: 'Overall ASPIRE Experience',
      items: Object.freeze([
        { key: 'overall_valuable_learning_experience', type: 'rating', required: true, label: 'Overall, ASPIRE was a valuable learning experience.' },
        { key: 'most_valuable_part', type: 'text', required: true, label: 'What was the most valuable part of your ASPIRE experience?' },
      ]),
    },
    {
      key: 'section2',
      title: 'Clinical Growth',
      items: Object.freeze([
        { key: 'confidence_clinical_setting', type: 'rating', required: true, label: 'ASPIRE helped strengthen my confidence in the clinical setting.' },
        { key: 'readiness_transition_to_practice', type: 'rating', required: true, label: 'ASPIRE helped strengthen my readiness for transition to practice.' },
        { key: 'improved_skills_behaviors_learning', type: 'text', required: true, label: 'What clinical skills, professional behaviors, or learning moments improved the most during your rotation?' },
      ]),
    },
    {
      key: 'section3',
      title: 'Unit and Learning Environment',
      items: Object.freeze([
        { key: 'supportive_learning_environment', type: 'rating', required: true, label: 'My unit provided a supportive learning environment.' },
        { key: 'included_as_care_team', type: 'rating', required: true, label: 'I felt included as part of the care team.' },
        { key: 'improve_learning_experience', type: 'text', required: false, label: 'What could have improved your learning experience?' },
      ]),
    },
    {
      key: 'section4',
      title: 'Residency Readiness',
      items: Object.freeze([
        { key: 'increased_interest_cedars_sinai', type: 'rating', required: true, label: 'ASPIRE increased my interest in applying to Cedars-Sinai.' },
        { key: 'understand_new_grad_expectations', type: 'rating', required: true, label: 'ASPIRE helped me better understand expectations for a new graduate RN.' },
        { key: 'support_for_interview_or_transition', type: 'text', required: false, label: 'What additional support would help you prepare for the RN residency interview or transition to practice?' },
      ]),
    },
    {
      key: 'section5',
      title: 'Final Reflection',
      items: Object.freeze([
        { key: 'final_reflection', type: 'text', required: true, label: 'What is one thing you want ASPIRE leaders to know about your experience?' },
        { key: 'may_use_anonymized_comments', type: 'yesno', required: true, label: 'May ASPIRE use anonymized comments from this evaluation for program improvement, reporting, or presentations?', helper: 'Your name and identifying details will not be included if comments are used.' },
      ]),
    },
  ]),
});

// Flattened item list for validation and iteration.
export const ALL_ITEMS = Object.freeze(
  POST_ROTATION_CONTENT.sections.flatMap(s => s.items)
);

const MAX_TEXT_LEN = 4000;

// Validate the flat response object. Mirrors the client and the submit RPC. Returns { valid }.
// Rules: required ratings are integers 1-5; required texts are non-empty after trim; optional
// texts, when present, must be strings; the yes/no answer must be a boolean. Unknown keys are
// ignored (the RPC only persists the canonical set).
export function validateResponses(responses) {
  if (responses === null || typeof responses !== 'object' || Array.isArray(responses)) {
    return { valid: false };
  }
  for (const item of ALL_ITEMS) {
    const v = responses[item.key];
    if (item.type === 'rating') {
      if (!Number.isInteger(v) || v < 1 || v > 5) return { valid: false };
    } else if (item.type === 'yesno') {
      if (v !== true && v !== false) return { valid: false };
    } else { // text
      if (v !== undefined && v !== null && typeof v !== 'string') return { valid: false };
      const s = typeof v === 'string' ? v.trim() : '';
      if (item.required && s === '') return { valid: false };
      if (typeof v === 'string' && v.length > MAX_TEXT_LEN) return { valid: false };
    }
  }
  return { valid: true };
}
