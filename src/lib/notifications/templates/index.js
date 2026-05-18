import { formReceived } from './formReceived.js';
import { teamsInviteReminder, teamsInviteReminderEscalation } from './teamsInviteReminder.js';

export const templates = {
  form_received:                    formReceived,
  teams_invite_reminder:            teamsInviteReminder,
  teams_invite_reminder_escalation: teamsInviteReminderEscalation,
};
