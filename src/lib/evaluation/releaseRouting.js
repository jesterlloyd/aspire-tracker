// src/lib/evaluation/releaseRouting.js
//
// ASPIRE-CASEYFINK-RELEASE-ROUTING-HOTFIX-1 - single source of truth mapping a Review & Release
// workflow key to its EXACT release endpoint and expected server identity. Each release-capable
// panel imports its own entry and passes expected_instrument_slug to the server, which refuses to
// send if the endpoint's own instrument does not match (pre-send guard). The panel also asserts the
// echoed instrument_slug/timepoint in the success response (post-send tripwire). This makes it
// impossible for one workflow's release button to invoke another workflow's endpoint unnoticed.
//
// Never merge two workflows onto one entry. Keys match SurveyAutomationDashboard WORKFLOWS keys.

export const RELEASE_ROUTES = Object.freeze({
  // REVIEW-RELEASE-1: the pre-rotation administration of the SAME Casey-Fink instrument,
  // at the `baseline` timepoint the schema has always allowed. Its endpoint guards on the
  // slug like every other, and its timepoint is what separates it from the post-rotation
  // release below: (slug, timepoint) is the workflow identity, and the server echoes both.
  caseyFinkPreRotation: Object.freeze({
    endpoint: '/api/evaluation-release-casey-fink-pre-rotation-survey',
    instrumentSlug: 'casey_fink_readiness_2024',
    timepoint: 'baseline',
    surveyRoute: '/evaluation/readiness',
    notificationType: 'casey_fink_pre_rotation_request_sent',
    workflowTitle: 'Casey-Fink Readiness for Practice, Pre-Rotation',
  }),
  preceptor: Object.freeze({
    endpoint: '/api/evaluation-release-preceptor-survey',
    instrumentSlug: 'preceptor_progress',
    workflowTitle: "Preceptor's Assessment of Student Readiness",
  }),
  student: Object.freeze({
    endpoint: '/api/evaluation-release-student-eval-survey',
    instrumentSlug: 'student_preceptor_eval',
    timepoint: 'post_rotation',
    surveyRoute: '/evaluation/experience',
    notificationType: 'student_preceptor_eval_request_sent',
    workflowTitle: "Student's Feedback on Unit and Preceptor",
  }),
  postRotation: Object.freeze({
    endpoint: '/api/evaluation-release-post-rotation-survey',
    instrumentSlug: 'post_rotation_evaluation',
    timepoint: 'post_rotation',
    surveyRoute: '/evaluation/post-rotation',
    notificationType: 'post_rotation_evaluation_request_sent',
    workflowTitle: "Student's Feedback on ASPIRE",
  }),
  caseyFinkPostRotation: Object.freeze({
    endpoint: '/api/evaluation-release-casey-fink-post-rotation-survey',
    instrumentSlug: 'casey_fink_readiness_2024',
    timepoint: 'post_rotation',
    surveyRoute: '/evaluation/readiness',
    notificationType: 'casey_fink_post_rotation_request_sent',
    workflowTitle: 'Casey-Fink Readiness for Practice, Post-Rotation',
  }),
})
