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
  preceptor: Object.freeze({
    endpoint: '/api/evaluation-release-preceptor-survey',
    instrumentSlug: 'preceptor_progress',
    workflowTitle: 'Preceptor Student Readiness Assessment',
  }),
  student: Object.freeze({
    endpoint: '/api/evaluation-release-student-eval-survey',
    instrumentSlug: 'student_preceptor_eval',
    timepoint: 'post_rotation',
    surveyRoute: '/evaluation/experience',
    notificationType: 'student_preceptor_eval_request_sent',
    workflowTitle: 'Student Feedback: Preceptor & Unit',
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
