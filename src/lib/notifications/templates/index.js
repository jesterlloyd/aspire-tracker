import { formReceived } from './formReceived.js';
import { teamsInviteReminder, teamsInviteReminderEscalation } from './teamsInviteReminder.js';
import { unitFormReceived } from './unitFormReceived.js';
import { interviewReminder } from './interviewReminder.js';

export const templates = {
  form_received:                    formReceived,
  teams_invite_reminder:            teamsInviteReminder,
  teams_invite_reminder_escalation: teamsInviteReminderEscalation,
  unit_form_received:               unitFormReceived,
  interview_reminder:               interviewReminder,
};
