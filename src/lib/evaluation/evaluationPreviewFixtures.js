// src/lib/evaluation/evaluationPreviewFixtures.js
//
// EVALUATION-RELEASE-PREVIEW-1 - SAFE SYNTHETIC preview fixtures for the two Evaluation > Review &
// Release survey workflows, mirroring the ASPIRE Connect > Automations preview pattern
// (src/lib/notifications/previewFixtures.js). Each fixture matches the shape consumed by the shared
// AutomationEmailPreviewDrawer: { recipientType, variants?, render(variantKey) => { subject, html } }.
//
// Client-side render ONLY. It calls the SAME server email builders the release flow sends, with mock
// data - no network, no DB, no tokens. The builders are pure string templates (their shell/primitives
// already run client-side via the Automations preview), so importing them here changes nothing about
// the shipped templates and keeps a single source of truth.
//
// TOKEN SAFETY: the survey URL is a hardcoded MOCK ending in `#t=preview-token`. No token is
// generated, hashed, parsed, or logged; nothing real is exposed.

import { buildPreceptorInvitationEmail, formatExpiresAt } from '../../../lib/server/evaluation/preceptorEmailTemplates.js';
import { buildStudentEvalInvitationEmail } from '../../../lib/server/evaluation/studentEvalEmailTemplates.js';
import { buildPostRotationInvitationEmail } from '../../../lib/server/evaluation/postRotationEmailTemplates.js';
import { buildCaseyFinkPostRotationInvitationEmail } from '../../../lib/server/evaluation/caseyFinkPostRotationEmailTemplates.js';
import { appUrl } from '../appUrl.js';

// Obvious, non-live preview URLs. `#t=preview-token` makes clear this is not a real tokenized link.
const PRECEPTOR_PREVIEW_URL     = `${appUrl('/evaluation/feedback')}#t=preview-token`;
const STUDENT_PREVIEW_URL       = `${appUrl('/evaluation/preceptor-unit')}#t=preview-token`;
const POST_ROTATION_PREVIEW_URL = `${appUrl('/evaluation/post-rotation')}#t=preview-token`;
const CASEY_FINK_PREVIEW_URL    = `${appUrl('/evaluation/readiness')}#t=preview-token`;

// Reasonable future expiry (~2 weeks out), formatted with the builders' own helper.
function previewExpiresAtHuman() {
  return formatExpiresAt(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString());
}

// Mock people, per the EVALUATION-RELEASE-PREVIEW-1 spec.
const MOCK = {
  preceptorFullName: 'Samuel Berman',
  preceptorFirstName: 'Samuel',
  studentFullName: 'Jayde De Leon',
  studentFirstName: 'Jayde',
};

// workflowKey → drawer fixture. 'preceptor' and 'student' match SurveyAutomationDashboard WORKFLOWS.
export function getEvaluationPreviewFixture(workflowKey) {
  if (workflowKey === 'preceptor') {
    return {
      recipientType: 'Preceptor',
      // The shipped preceptor email has three period variants; default to Midpoint per the spec.
      variants: [
        { key: 'midpoint',        label: 'Midpoint' },
        { key: 'end_of_rotation', label: 'End of Rotation' },
        { key: 'other_interim',   label: 'Other / Interim' },
      ],
      render: (period = 'midpoint') => buildPreceptorInvitationEmail({
        period,
        studentName: MOCK.studentFullName,
        preceptorFirstName: MOCK.preceptorFirstName,
        expiresAtHuman: previewExpiresAtHuman(),
        surveyUrl: PRECEPTOR_PREVIEW_URL,
      }),
    };
  }

  if (workflowKey === 'student') {
    return {
      recipientType: 'Student',
      render: () => buildStudentEvalInvitationEmail({
        studentFirstName: MOCK.studentFirstName,
        expiresAtHuman: previewExpiresAtHuman(),
        surveyUrl: STUDENT_PREVIEW_URL,
      }),
    };
  }

  if (workflowKey === 'postRotation') {
    // ASPIRE Post-Rotation Evaluation email: NON-GATING experience feedback, focused only on
    // rotation/unit/preceptor feedback. Subject "Share Your ASPIRE Rotation Feedback", button
    // "Share Feedback".
    return {
      recipientType: 'Student',
      render: () => buildPostRotationInvitationEmail({
        studentFirstName: MOCK.studentFirstName,
        expiresAtHuman: previewExpiresAtHuman(),
        surveyUrl: POST_ROTATION_PREVIEW_URL,
      }),
    };
  }

  if (workflowKey === 'caseyFinkPostRotation') {
    // Casey-Fink post-rotation release email. This is the certificate-gating survey; the copy
    // tells the student that completing it unlocks the Certificate of Completion.
    return {
      recipientType: 'Student',
      render: () => buildCaseyFinkPostRotationInvitationEmail({
        studentFirstName: MOCK.studentFirstName,
        expiresAtHuman: previewExpiresAtHuman(),
        surveyUrl: CASEY_FINK_PREVIEW_URL,
      }),
    };
  }

  return null;
}
