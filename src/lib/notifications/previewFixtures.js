// src/lib/notifications/previewFixtures.js
//
// AUTOMATIONS-EMAIL-PREVIEW-1 - synthetic fixtures for the in-app "Preview email" drawer on the
// ASPIRE Connect > Automations cards. Pure + client-safe: imports ONLY the existing template
// builders (each pure, shell-based) and renders them with FAKE data. No DB, no API, no tokens,
// no real recipient/cohort/coordinator data. This is the single source of truth for what each
// automation preview shows; each entry maps to an AUTOMATION_CARDS card id and exposes render().
//
// The builders here are the SAME ones the crons send through (preview-equals-sent):
//   Teams      -> teamsInviteReminder.interviewer / teamsInviteReminderEscalation.interviewer
//   Interview  -> buildInterviewReminderEmail  (interviewReminder.student)
//   Midpoint   -> buildMidpointCheckinEmail    (midpointCheckin.student)
//   Coordinator-> buildCoordinatorWeeklyDigestEmail
//   Clock-Out  -> buildClockoutReminderEmail   (clockoutReminder.student; the HTML the LIVE send uses)

import { teamsInviteReminder, teamsInviteReminderEscalation } from './templates/teamsInviteReminder.js';
import { buildInterviewReminderEmail } from './templates/interviewReminder.js';
import { buildMidpointCheckinEmail } from './templates/midpointCheckin.js';
import { buildBirthdayGreetingEmail } from './templates/birthdayGreeting.js';
import { buildEvaluationReminderEmail } from '../../../lib/server/evaluation/reminderEmailTemplates.js';
import { CERTIFICATE_KINDS } from '../evaluation/reminderSchedule.js';
import { buildCoordinatorWeeklyDigestEmail } from './templates/coordinatorWeeklyDigest.js';
import { buildClockoutReminderEmail } from './templates/clockoutReminder.js';

// ── Safe synthetic data (never real) ─────────────────────────────────────────
const MOCK = {
  studentName:   'Jordan Avery',
  firstName:     'Jordan',
  studentEmail:  'jordan.avery@example.edu',
  school:        'Riverside School of Nursing',
  unit:          '5 West Telemetry',
  interviewer:   'Taylor Brooks',
  interviewDate: 'Tuesday, March 4, 2026',
  interviewTime: '10:00 AM',
  durationMins:  30,
  hoursUntil:    18,
  approvedHours: 60,
  requiredHours: 120,
  coordinator:   'Dr. Morgan Lee',
  cohortName:    'Spring 2026',
  // Digest window (full ISO with PT offset so the rendered range is stable, not off-by-one).
  windowStart:   '2026-02-27T00:00:00-08:00',
  windowEnd:     '2026-03-05T00:00:00-08:00',
};

// Teams reminder context (interviewer audience).
const teamsCtx = {
  studentName:         MOCK.studentName,
  hoursUntilInterview: MOCK.hoursUntil,
  interviewerName:     MOCK.interviewer,
  studentSchool:       MOCK.school,
  interviewDate:       MOCK.interviewDate,
  interviewTime:       MOCK.interviewTime,
  duration:            MOCK.durationMins,
  studentEmail:        MOCK.studentEmail,
};

// Synthetic weekly-digest transitions (1-2 fake items per bucket).
const digestTransitions = {
  form_received:    [{ line: 'Jordan Avery submitted the ASPIRE application' }],
  interview_booked: [{ line: 'Jordan Avery scheduled an interview for Mar 4' },
                     { line: 'Sam Rivera scheduled an interview for Mar 5' }],
  interview:        [{ line: 'Sam Rivera completed their interview' }],
  placement:        [{ line: 'Jordan Avery matched to 5 West Telemetry' }],
  rotation:         [{ line: 'Alex Chen began active rotation on 4 North' }],
};

// ── Registry keyed by AUTOMATION_CARDS card id ───────────────────────────────
// Each entry: { recipientType, variants?: [{ key, label }], render(variantKey) -> { subject, html } }
export const AUTOMATION_PREVIEW_FIXTURES = {
  teams_invite_reminders: {
    recipientType: 'Interviewer',
    variants: [
      { key: 'first',      label: 'First reminder' },
      { key: 'escalation', label: 'Escalation' },
    ],
    render: (variant = 'first') =>
      (variant === 'escalation'
        ? teamsInviteReminderEscalation.interviewer(teamsCtx)
        : teamsInviteReminder.interviewer(teamsCtx)),
  },

  interview_reminders: {
    recipientType: 'Student',
    render: () => buildInterviewReminderEmail({
      firstName:     MOCK.firstName,
      interviewDate: MOCK.interviewDate,
      interviewTime: MOCK.interviewTime,
      cohortName:    MOCK.cohortName,
    }),
  },

  midpoint_checkin: {
    recipientType: 'Student',
    render: () => buildMidpointCheckinEmail({
      firstName:     MOCK.firstName,
      approvedHours: MOCK.approvedHours,
      hoursRequired: MOCK.requiredHours,
      unitName:      MOCK.unit,
    }),
  },

  coordinator_weekly_digest: {
    recipientType: 'Coordinator',
    render: () => buildCoordinatorWeeklyDigestEmail({
      coordinatorFirstName: MOCK.coordinator,
      schoolDisplayName:    MOCK.school,
      windowStart:          MOCK.windowStart,
      windowEnd:            MOCK.windowEnd,
      transitions:          digestTransitions,
    }),
  },

  clockout_reminders: {
    recipientType: 'Student',
    render: () => buildClockoutReminderEmail({ firstName: MOCK.firstName }),
  },

  // STUDENT-BIRTHDAY-GREETING-1. The real template, so the preview is the email.
  // firstName is the ONLY input the birthday template takes, which is also why
  // there is nothing here that could leak a date of birth, an age, or a student
  // id: the send path does not pass them either.
  student_birthday_greetings: {
    recipientType: 'Student',
    render: () => buildBirthdayGreetingEmail({ firstName: MOCK.firstName }),
  },

  // EVALUATION-REMINDERS-1. One variant per survey workflow, because the copy
  // genuinely differs per workflow - and because the preview is where an Owner
  // can see for themselves which reminders mention a certificate. Only the two
  // that actually gate one (Casey-Fink post-rotation, preceptor end-of-rotation)
  // pass a certificateKind. The sample URL is an obvious placeholder: a preview
  // must never mint a real token.
  evaluation_reminders: {
    recipientType: 'Student or Preceptor',
    variants: [
      { key: 'casey_fink_readiness',     label: 'Casey-Fink (certificate)' },
      { key: 'post_rotation_evaluation', label: 'Post-Rotation Evaluation' },
      { key: 'student_preceptor_eval',   label: 'Preceptor & Unit Feedback' },
      { key: 'preceptor_progress',       label: 'Preceptor (certificate)' },
    ],
    render: (variant = 'casey_fink_readiness') => buildEvaluationReminderEmail({
      workflowKey: variant,
      reminderNumber: variant === 'preceptor_progress' ? 3 : 1,
      recipientName: variant === 'preceptor_progress' ? 'Dana Whitfield' : MOCK.firstName,
      studentName: variant === 'preceptor_progress' ? `${MOCK.firstName} Rivera` : null,
      surveyUrl: 'https://aspireintelligence.app/evaluation/example#t=SAMPLE-PREVIEW-LINK',
      expiresAtHuman: 'September 12, 2026',
      certificateKind:
        variant === 'casey_fink_readiness' ? CERTIFICATE_KINDS.STUDENT_COMPLETION
        : variant === 'preceptor_progress' ? CERTIFICATE_KINDS.PRECEPTOR_APPRECIATION
        : null,
    }),
  },
};

// Convenience accessor used by the card UI.
export function getPreviewFixture(cardId) {
  return AUTOMATION_PREVIEW_FIXTURES[cardId] || null;
}
