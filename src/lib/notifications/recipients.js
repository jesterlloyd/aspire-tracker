// src/lib/notifications/recipients.js
// Resolves who receives each notification type.
//
// NOTE: Keith Hoshal (human advisor) is intentionally NOT in INTERNAL_TEAM_EMAILS.
// Strategic program awareness for advisors flows through Keith (AI) reading notification_log,
// not through direct email notifications.

const INTERNAL_TEAM_EMAILS = {
  owner:   'JesterLloyd.Bautista@cshs.org',
  co_lead: 'Krystal.Rodriguez@cshs.org',
};

// School → coordinator mapping. Inline intentionally; a future migration will introduce
// a school_coordinators table for proper data management.
const SCHOOL_COORDINATORS = {
  'Cal State LA':                               { email: 'alyssa.manlangit@calstatela.edu', name: 'Alyssa Manlangit' },
  'California State University Los Angeles':    { email: 'alyssa.manlangit@calstatela.edu', name: 'Alyssa Manlangit' },
  'CSULA':                                      { email: 'alyssa.manlangit@calstatela.edu', name: 'Alyssa Manlangit' },
  'APU':                                        { email: 'shunter@apu.edu',                 name: 'Susan Hunter' },
  'Azusa Pacific University':                   { email: 'shunter@apu.edu',                 name: 'Susan Hunter' },
  'West Coast University':                      { email: 'tkim@westcoastuniversity.edu',     name: 'Tony Kim' },
  'WCU':                                        { email: 'tkim@westcoastuniversity.edu',     name: 'Tony Kim' },
};

export async function resolveRecipients(type, context) {
  switch (type) {
    case 'form_received':
      return resolveFormReceived(context);
    default:
      console.warn(`[notifications/recipients] no resolver for type: ${type}`);
      return [];
  }
}

function resolveFormReceived(context) {
  const recipients = [];

  // 1. Student confirmation
  if (context.studentEmail) {
    recipients.push({
      email:    context.studentEmail,
      role:     'student',
      name:     context.studentName || null,
      audience: 'student',
    });
  }

  // 2. Internal team (owner + co-lead) — operational awareness
  for (const [role, email] of Object.entries(INTERNAL_TEAM_EMAILS)) {
    recipients.push({ email, role, audience: 'internal_team' });
  }

  // 3. School coordinator — pipeline visibility
  if (context.school) {
    const coord = SCHOOL_COORDINATORS[context.school];
    if (coord) {
      recipients.push({
        email:    coord.email,
        role:     'school_coordinator',
        name:     coord.name,
        audience: 'school_coordinator',
      });
    } else {
      console.warn(`[notifications/recipients] no coordinator mapped for school: "${context.school}"`);
    }
  }

  return recipients;
}
