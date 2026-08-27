import { placementRequestReceived } from './placementRequestReceived.js';
import { formReceived } from './formReceived.js';
import { teamsInviteReminder, teamsInviteReminderEscalation } from './teamsInviteReminder.js';
import { unitFormReceived } from './unitFormReceived.js';
import { interviewReminder } from './interviewReminder.js';
import { midpointCheckin } from './midpointCheckin.js';
import { clockoutReminder } from './clockoutReminder.js';
import { unitLeaderAlert } from './unitLeaderAlert.js';
import { birthdayGreeting } from './birthdayGreeting.js';
import { accessRetirement } from './accessRetirement.js';

export const templates = {
  // AP-SCHOOL-CANONICALIZATION-1: 'form_received' (application language) is RETIRED FOR SENDING -
  // a coordinator placement request is not a student application; both submit paths now send
  // placement_request_received. form_received stays registered ONLY so the notification-log archive
  // can keep reconstructing historical previews; it can never send again (its recipient resolver
  // was removed, so resolveRecipients returns no recipients for it).
  placement_request_received:       placementRequestReceived,
  form_received:                    formReceived,
  teams_invite_reminder:            teamsInviteReminder,
  teams_invite_reminder_escalation: teamsInviteReminderEscalation,
  unit_form_received:               unitFormReceived,
  interview_reminder:               interviewReminder,
  midpoint_checkin:                 midpointCheckin,
  clockout_reminder:                clockoutReminder,
  unit_leader_alert:                unitLeaderAlert,
  birthday_greeting:                birthdayGreeting,
  cohort_access_retirement:         accessRetirement,
};
