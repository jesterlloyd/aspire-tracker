import { formReceived } from './formReceived.js';
import { teamsInviteReminder, teamsInviteReminderEscalation } from './teamsInviteReminder.js';
import { unitFormReceived } from './unitFormReceived.js';
import { interviewReminder } from './interviewReminder.js';
import { midpointCheckin } from './midpointCheckin.js';
import { clockoutReminder } from './clockoutReminder.js';
import { unitLeaderAlert } from './unitLeaderAlert.js';

export const templates = {
  form_received:                    formReceived,
  teams_invite_reminder:            teamsInviteReminder,
  teams_invite_reminder_escalation: teamsInviteReminderEscalation,
  unit_form_received:               unitFormReceived,
  interview_reminder:               interviewReminder,
  midpoint_checkin:                 midpointCheckin,
  clockout_reminder:                clockoutReminder,
  unit_leader_alert:                unitLeaderAlert,
};
