// src/lib/evaluation/surveyCatalog.js
//
// ASPIRE-EVAL-PREVIEW-1: the single descriptive catalog of evaluation workflows.
//
// WHY THIS EXISTS. Workflow identity was previously spread across four hand-synced
// places: the module-local WORKFLOWS array in SurveyAutomationDashboard, WORKFLOW_KEYS
// in workflowSelection, RELEASE_ROUTES in releaseRouting, and an if-chain in
// evaluationPreviewFixtures. Two of those carry comments telling the reader to keep
// them in step with a third. Preview needs the same facts again, so rather than add a
// fifth copy this module becomes the one descriptive source and the dashboard imports
// it.
//
// SCOPE. This catalog is DESCRIPTIVE ONLY. It holds no eligibility logic, no release
// routing, and no authorization. Detection still lives in each panel's detector and
// release routing still lives in releaseRouting.js, deliberately untouched: this pass
// adds a way to SEE the surveys, and moving live release behavior into a new module
// would put a working production path at risk for no benefit.
//
// The question text is NOT here. Three of the four surveys keep their prose in the
// private evaluation-instrument-content Storage bucket, and Casey-Fink is third-party
// copyrighted with permission still pending, so its item text must never be copied
// into the repo. Preview resolves content at read time from the same source the live
// survey renders from. See surveyPreviewSource.js.

/**
 * One entry per registered workflow, in display order.
 *
 * key            the internal workflow key used by selection, routing, and panels
 * label          the compact navigator label the operator sees
 * title          the full survey title
 * slug           evaluation_instruments.slug, and the identity that decides whether
 *                two workflows are actually the same survey
 * formType       evaluation_responses.form_type written on submit
 * timepoint      the assignment timepoint
 * recipient      who receives the invitation
 * evaluatedTarget who or what is being rated
 * trigger        the release condition, in operator language
 * status         'active' | 'paused'
 * version        instrument version where one is defined, else null
 * contentSource  'storage' (private bucket, fetched by slug) | 'inline' (in code)
 * certificateGate whether completing this survey issues a certificate
 */
export const SURVEY_CATALOG = Object.freeze([
  Object.freeze({
    key: 'preceptor',
    label: 'Preceptor Readiness',
    title: 'Preceptor Student Readiness Assessment',
    slug: 'preceptor_progress',
    formType: 'preceptor_progress',
    timepoint: 'midpoint or post_rotation',
    recipient: 'Preceptor',
    evaluatedTarget: 'The student',
    trigger: 'Approved hours reach half of required (midpoint) or all of required (end of rotation).',
    status: 'active',
    version: null,
    contentSource: 'storage',
    certificateGate: false,
  }),
  Object.freeze({
    key: 'student',
    label: 'Student Feedback',
    title: 'Student Feedback: Preceptor and Unit',
    slug: 'student_preceptor_eval',
    formType: 'student_preceptor_eval',
    timepoint: 'post_rotation',
    recipient: 'Student',
    evaluatedTarget: 'The preceptor and the unit',
    trigger: 'Approved hours reach required hours. Single post-rotation trigger, no midpoint.',
    status: 'active',
    version: null,
    contentSource: 'storage',
    certificateGate: false,
  }),
  Object.freeze({
    key: 'caseyFinkPostRotation',
    label: 'Casey-Fink Post-Rotation',
    title: 'Casey-Fink Readiness for Practice, Post-Rotation',
    slug: 'casey_fink_readiness_2024',
    formType: 'casey_fink_readiness_2024',
    timepoint: 'post_rotation',
    recipient: 'Student',
    evaluatedTarget: 'The student, self-reported readiness',
    trigger: 'Approved hours reach required hours and no certificate has been issued.',
    status: 'active',
    version: '2024-revised',
    contentSource: 'storage',
    certificateGate: true,
  }),
  Object.freeze({
    key: 'postRotation',
    label: 'ASPIRE Rotation Feedback',
    title: 'ASPIRE Post-Rotation Evaluation',
    slug: 'post_rotation_evaluation',
    formType: 'post_rotation_evaluation',
    timepoint: 'post_rotation',
    recipient: 'Student',
    evaluatedTarget: 'The ASPIRE program itself',
    trigger: 'Release is paused. This workflow no longer gates the certificate.',
    status: 'paused',
    version: '2026.1',
    contentSource: 'inline',
    certificateGate: false,
  }),
])

/** The catalog entry for a workflow key, or null. */
export function surveyByKey(key) {
  return SURVEY_CATALOG.find(s => s.key === key) || null
}

/**
 * Workflows that are literally THE SAME SURVEY as this one, meaning they share an
 * instrument slug. Two workflows sharing a slug would be one definition released by
 * two different triggers.
 *
 * As registered today this always returns an empty array: all four slugs are distinct.
 * The function exists so the Preview drawer reports the real relationship rather than
 * asserting a hardcoded "these are different", and so a future workflow that genuinely
 * reuses an instrument is detected instead of silently misdescribed.
 */
export function sameSurveyAs(key) {
  const self = surveyByKey(key)
  if (!self) return []
  return SURVEY_CATALOG.filter(s => s.key !== self.key && s.slug === self.slug)
}

/**
 * Workflows that are EASILY CONFUSED with this one: a different survey that goes to the
 * same recipient at the same timepoint.
 *
 * This is the honest answer to "do Student Feedback and ASPIRE Rotation Feedback use the
 * same survey?" They do not, but they are both sent to a Student after the rotation, which
 * is exactly why they look like duplicates in the queue. Naming that relationship is more
 * useful than only reporting the absence of a shared slug.
 */
export function similarAudienceTo(key) {
  const self = surveyByKey(key)
  if (!self) return []
  return SURVEY_CATALOG.filter(s =>
    s.key !== self.key &&
    s.slug !== self.slug &&
    s.recipient === self.recipient &&
    s.timepoint === self.timepoint)
}

/**
 * The relationship a Preview should state, as a plain sentence plus the entries it refers
 * to. Kept here rather than in the component so the wording is testable.
 */
export function relationshipFor(key) {
  const shared = sameSurveyAs(key)
  if (shared.length > 0) {
    return {
      kind: 'shared_survey',
      note: `Uses the same survey as ${shared.map(s => s.label).join(', ')}. Same questions, different release workflow.`,
      others: shared,
    }
  }
  const similar = similarAudienceTo(key)
  if (similar.length > 0) {
    return {
      kind: 'similar_audience',
      note: `A different survey from ${similar.map(s => s.label).join(', ')}, though both go to the ` +
        `${(surveyByKey(key)?.recipient || '').toLowerCase()} after the rotation. Different questions, ` +
        `stored separately.`,
      others: similar,
    }
  }
  return { kind: 'unique', note: 'This survey is not shared with any other workflow.', others: [] }
}
