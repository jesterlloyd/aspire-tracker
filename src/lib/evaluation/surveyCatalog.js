// src/lib/evaluation/surveyCatalog.js
//
// ASPIRE-EVAL-PREVIEW-1: the single descriptive catalog of evaluation workflows.
// REVIEW-RELEASE-1 (Owner brief, 2026-09-19): six workflows, in the order the rail shows
// them, under the names the Owner chose. The names themselves live in surveyNames.js
// (SURVEY-NAMES-1, 2026-09-20): the catalog composes its labels and titles from that one
// map, so the rail, the respondent pages and the emails cannot disagree. The `was` field
// that carried each old label for one release cycle came out in the same pass.
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
// routing, and no authorization. Detection still lives in each workflow's detector and
// release routing still lives in releaseRouting.js, deliberately untouched: this pass
// adds a way to SEE the surveys, and moving live release behavior into a new module
// would put a working production path at risk for no benefit.
//
// The question text is NOT here. Three of the surveys keep their prose in the private
// evaluation-instrument-content Storage bucket, and Casey-Fink is third-party
// copyrighted (permission confirmed by the Owner on 2026-09-19 to cover a pre-rotation
// administration as well), so its item text must never be copied into the repo.
// Preview resolves content at read time from the same source the live survey renders
// from. See surveyPreviewSource.js.

import { surveyName, surveyTitle, surveyLabel } from './surveyNames.js'

const CASEY_FINK = 'casey_fink_readiness_2024'
const FEEDBACK = 'student_preceptor_eval'

/**
 * One entry per registered workflow, in display order.
 *
 * key            the internal workflow key used by selection, routing, and the queue
 * label          the compact navigator label the operator sees (the Owner's new name)
 * title          the full survey title
 * slug           evaluation_instruments.slug. Two workflows may share a slug when they
 *                administer the SAME instrument at different timepoints (the pre- and
 *                post-rotation Casey-Fink); identity is (slug, timepoint).
 * formType       evaluation_responses.form_type written on submit
 * timepoint      the assignment timepoint
 * recipient      who receives the invitation
 * to             the recipient in the rail's lower-case form ("to student")
 * evaluatedTarget who or what is being rated
 * trigger        the release condition, in operator language
 * gate           what a release unlocks, in operator language (the warm chip)
 * status         'active' | 'paused'
 * version        instrument version where one is defined, else null
 * contentSource  'storage' (private bucket, fetched by slug) | 'inline' (in code)
 * certificateGate whether completing this survey issues a certificate
 * group          'survey' (workflows 1 to 5) | 'unitLeader' (workflow 6)
 */
export const SURVEY_CATALOG = Object.freeze([
  Object.freeze({
    key: 'caseyFinkPreRotation',
    label: surveyLabel(CASEY_FINK, 'baseline'),
    title: surveyTitle(CASEY_FINK, 'baseline'),
    slug: 'casey_fink_readiness_2024',
    formType: 'casey_fink_readiness_2024',
    timepoint: 'baseline',
    recipient: 'Student',
    to: 'student',
    evaluatedTarget: 'The student, self-reported readiness, before the rotation',
    trigger: 'ASPIRE status is Interviewed, Placed, or Active Rotation',
    gate: 'Baseline for the Post-Rotation comparison',
    status: 'active',
    version: '2024-revised',
    contentSource: 'storage',
    certificateGate: false,
    group: 'survey',
  }),
  Object.freeze({
    key: 'preceptor',
    label: surveyName('preceptor_progress'),
    title: surveyName('preceptor_progress'),
    slug: 'preceptor_progress',
    formType: 'preceptor_progress',
    timepoint: 'midpoint or post_rotation',
    recipient: 'Preceptor',
    to: 'preceptor',
    evaluatedTarget: 'The student',
    trigger: 'Midpoint at 50% of required hours; End of Rotation at 100%',
    gate: 'End of Rotation unlocks the Certificate of Appreciation',
    status: 'active',
    version: null,
    contentSource: 'storage',
    certificateGate: false,
    group: 'survey',
  }),
  Object.freeze({
    key: 'student',
    label: surveyName(FEEDBACK),
    title: surveyName(FEEDBACK),
    slug: 'student_preceptor_eval',
    formType: 'student_preceptor_eval',
    timepoint: 'post_rotation',
    recipient: 'Student',
    to: 'student',
    evaluatedTarget: 'The preceptor and the unit',
    trigger: '100% of required hours',
    gate: 'Prerequisite for the Post-Rotation Casey-Fink and the Unit Leader release',
    status: 'active',
    version: null,
    contentSource: 'storage',
    certificateGate: false,
    group: 'survey',
  }),
  Object.freeze({
    key: 'caseyFinkPostRotation',
    label: surveyLabel(CASEY_FINK, 'post_rotation'),
    title: surveyTitle(CASEY_FINK, 'post_rotation'),
    slug: 'casey_fink_readiness_2024',
    formType: 'casey_fink_readiness_2024',
    timepoint: 'post_rotation',
    recipient: 'Student',
    to: 'student',
    evaluatedTarget: 'The student, self-reported readiness',
    trigger: `${surveyName(FEEDBACK)} submitted`,
    gate: 'Unlocks the Certificate of Completion',
    status: 'active',
    version: '2024-revised',
    contentSource: 'storage',
    certificateGate: true,
    group: 'survey',
  }),
  Object.freeze({
    key: 'postRotation',
    label: surveyName('post_rotation_evaluation'),
    title: surveyName('post_rotation_evaluation'),
    slug: 'post_rotation_evaluation',
    formType: 'post_rotation_evaluation',
    timepoint: 'post_rotation',
    recipient: 'Student',
    to: 'student',
    evaluatedTarget: 'The ASPIRE program itself',
    trigger: 'Post-Rotation Casey-Fink submitted, and the required activities recorded',
    gate: 'No certificate gate',
    status: 'active',
    version: '2026.1',
    contentSource: 'inline',
    certificateGate: false,
    group: 'survey',
  }),
  Object.freeze({
    key: 'unitLeaderRelease',
    label: `Release ${surveyName(FEEDBACK)} to Unit Leaders`,
    title: `Release ${surveyName(FEEDBACK)} to Unit Leaders`,
    // Not a survey: it releases already-submitted responses to the Unit Leader portal.
    // It has no instrument of its own, no email, and no timepoint; the rows it releases
    // belong to the two instruments named here.
    slug: null,
    formType: null,
    timepoint: null,
    recipient: 'Unit leader',
    to: 'unit leader',
    evaluatedTarget: 'A unit and its preceptor, as the student rated them',
    trigger: `${surveyName(FEEDBACK)} submitted, 7 days after the rotation ends`,
    gate: 'No certificate gate',
    status: 'active',
    version: null,
    contentSource: null,
    certificateGate: false,
    group: 'unitLeader',
  }),
])

/** The five survey workflows, in display order. */
export const SURVEY_WORKFLOWS = Object.freeze(SURVEY_CATALOG.filter(s => s.group === 'survey'))

/** The catalog entry for a workflow key, or null. */
export function surveyByKey(key) {
  return SURVEY_CATALOG.find(s => s.key === key) || null
}

/**
 * Workflows that are literally THE SAME SURVEY as this one, meaning they share an
 * instrument slug AND a timepoint. Two such entries would be one definition released by
 * two different triggers, which is a registration mistake.
 *
 * As registered today this always returns an empty array: every (slug, timepoint) pair
 * is distinct. The function exists so the Preview drawer reports the real relationship
 * rather than asserting a hardcoded "these are different".
 */
export function sameSurveyAs(key) {
  const self = surveyByKey(key)
  if (!self || !self.slug) return []
  return SURVEY_CATALOG.filter(s =>
    s.key !== self.key && s.slug === self.slug && s.timepoint === self.timepoint)
}

/**
 * Workflows that administer the SAME INSTRUMENT as this one at a DIFFERENT timepoint.
 * This is the pre- and post-rotation Casey-Fink: same questions on purpose, so the two
 * answers can be compared, released at different moments for different reasons.
 */
export function sharesInstrumentWith(key) {
  const self = surveyByKey(key)
  if (!self || !self.slug) return []
  return SURVEY_CATALOG.filter(s =>
    s.key !== self.key && s.slug === self.slug && s.timepoint !== self.timepoint)
}

/**
 * Workflows that are EASILY CONFUSED with this one: a different survey that goes to the
 * same recipient at the same timepoint.
 *
 * This is the honest answer to "do Student's Feedback on Unit and Preceptor and Student's
 * Feedback on ASPIRE use the same survey?" They do not, but they are both sent to a Student after the rotation, which
 * is exactly why they look like duplicates in the queue. Naming that relationship is more
 * useful than only reporting the absence of a shared slug.
 */
export function similarAudienceTo(key) {
  const self = surveyByKey(key)
  if (!self || !self.slug) return []
  return SURVEY_CATALOG.filter(s =>
    s.key !== self.key &&
    s.slug &&
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
  const instrument = sharesInstrumentWith(key)
  if (instrument.length > 0) {
    return {
      kind: 'shared_instrument',
      note: `The same questions as ${instrument.map(s => s.label).join(', ')}, asked at a different point in the rotation so the two answers can be compared.`,
      others: instrument,
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
