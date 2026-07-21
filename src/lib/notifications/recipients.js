// src/lib/notifications/recipients.js
// Resolves who receives each notification type.
// Server-side only - imported by API routes and the notification library.
//
// NOTE: Keith Hoshal (human advisor) is intentionally NOT in INTERNAL_TEAM_EMAILS.
// Strategic program awareness for advisors flows through Keith (AI) reading notification_log,
// not through direct email notifications.

import { createClient } from '@supabase/supabase-js';

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const INTERNAL_TEAM_EMAILS = {
  owner:   'JesterLloyd.Bautista@cshs.org',
  co_lead: 'Krystal.Rodriguez@cshs.org',
};

// School coordinator routing.
// Structure per entry:
//   primary:       { email, name, title }         ← required; default recipient
//   cc:            [{ email, name, title }]?       ← optional; always included if present
//   programRoutes: { [programType]: { email, name, title } }?  ← overrides primary when matched
//
// Lookup behavior in getCoordinatorsForSchool():
//   1. If programRoutes AND student's program_type matches → route to that coordinator.
//   2. Otherwise → use primary.
//   3. cc is always appended regardless of routing.
const SCHOOL_COORDINATORS = {
  'Cal State LA': {
    // Only two programs at CSULA enter the ASPIRE pipeline; routes use the
    // exact values the /school-form dropdown emits.
    programRoutes: {
      'Accelerated BSN': { email: 'amanlan3@calstatela.edu',           name: 'Alyssa Manlangit',       title: 'ABSN Program Coordinator' },
      'BSN Semester':    { email: 'marissa.ramirez119@calstatela.edu', name: 'Marissa Grafil Ramirez', title: 'BSN Clinical Placement & Contracts' },
    },
    // Fallback if program_type doesn't match (e.g. typo or unexpected value) → Alyssa
    primary: { email: 'amanlan3@calstatela.edu', name: 'Alyssa Manlangit', title: 'ABSN Program Coordinator' },
  },

  'UCLA': {
    primary: { email: 'mcontreras@sonnet.ucla.edu', name: 'Mayra Ontaneda', title: 'Prelicensure Clinical Placements & Health Clearance Coordinator' },
  },

  'Cal State Long Beach': {
    primary: { email: 'Lucy.VanOtterloo@csulb.edu', name: 'Lucy Van Otterloo', title: 'Professor, School of Nursing' },
  },

  'Azusa Pacific University': {
    primary: { email: 'shunter@apu.edu', name: 'Susan Hunter', title: 'Clinical Placement Coordinator, College of Nursing and Health Sciences' },
  },

  'Cal State Northridge': {
    primary: { email: 'rebekah.child@csun.edu', name: 'Rebekah J. Howerton Child', title: 'Associate Professor, Department Chair' },
  },

  'West Coast University Anaheim': {
    primary: { email: 'RYoussef@westcoastuniversity.edu', name: 'Rena Youssef', title: 'Program Assistant' },
    cc: [
      { email: 'jbalatero@westcoastuniversity.edu', name: 'Joelene Balatero', title: 'Manager, Clinical Faculty' },
    ],
  },

  'West Coast University North Hollywood': {
    primary: { email: 'ToKim@westcoastuniversity.edu', name: 'Tony Kim', title: 'Manager, Clinical Faculty' },
    cc: [
      { email: 'sStgeorge@westcoastuniversity.edu', name: 'Silvia St George', title: 'Manager, Clinical Operations' },
    ],
  },
};

// Common school name variants → canonical SCHOOL_COORDINATORS key.
const SCHOOL_ALIASES = {
  'CSULA':                                       'Cal State LA',
  'California State University Los Angeles':     'Cal State LA',
  'California State University, Los Angeles':    'Cal State LA',

  'University of California, Los Angeles':       'UCLA',
  'UCLA School of Nursing':                      'UCLA',

  'CSULB':                                       'Cal State Long Beach',
  'California State University Long Beach':      'Cal State Long Beach',
  'California State University, Long Beach':     'Cal State Long Beach',
  'CSU Long Beach':                              'Cal State Long Beach',

  'APU':                                         'Azusa Pacific University',
  'Azusa Pacific':                               'Azusa Pacific University',

  'CSUN':                                        'Cal State Northridge',
  'California State University Northridge':      'Cal State Northridge',
  'California State University, Northridge':     'Cal State Northridge',

  'WCU Anaheim':                                 'West Coast University Anaheim',
  'West Coast University - Anaheim':             'West Coast University Anaheim',
  'West Coast University (Anaheim)':             'West Coast University Anaheim',
  'West Coast University':                       'West Coast University Anaheim', // legacy fallback

  'WCU North Hollywood':                         'West Coast University North Hollywood',
  'WCU NoHo':                                   'West Coast University North Hollywood',
  'WCU':                                        'West Coast University North Hollywood', // legacy fallback
  'West Coast University - North Hollywood':     'West Coast University North Hollywood',
  'West Coast University (North Hollywood)':     'West Coast University North Hollywood',
};

function resolveSchoolKey(rawSchool) {
  if (!rawSchool) return null;
  if (SCHOOL_COORDINATORS[rawSchool]) return rawSchool;
  return SCHOOL_ALIASES[rawSchool] || null;
}

function getCoordinatorsForSchool(rawSchool, programType) {
  const schoolKey = resolveSchoolKey(rawSchool);
  if (!schoolKey) return { primary: null, cc: [], schoolKey: null };

  const entry = SCHOOL_COORDINATORS[schoolKey];
  let primary = entry.primary;

  if (entry.programRoutes && programType) {
    const route = entry.programRoutes[programType];
    if (route) primary = route;
  }

  return { primary, cc: entry.cc || [], schoolKey };
}

// Exported for Keith (AI) and admin views.
export function getAllSchoolCoordinators() {
  return Object.entries(SCHOOL_COORDINATORS).map(([school, entry]) => ({
    school,
    primary:       entry.primary,
    cc:            entry.cc || [],
    programRoutes: entry.programRoutes || null,
  }));
}

export async function resolveRecipients(type, context) {
  switch (type) {
    case 'form_received':
      return resolveFormReceived(context);
    case 'teams_invite_reminder':
    case 'teams_invite_reminder_escalation':
      return resolveTeamsInviteReminder(context);
    case 'unit_form_received':
      return resolveUnitFormReceived(context);
    case 'interview_reminder':
      return resolveInterviewReminder(context);
    case 'midpoint_checkin':
      return resolveMidpointCheckin(context);
    case 'clockout_reminder':
      return resolveClockoutReminder(context);
    case 'unit_leader_alert':
      return resolveUnitLeaderAlert(context);
    default:
      console.warn(`[notifications/recipients] no resolver for type: ${type}`);
      return [];
  }
}

/**
 * UL-PORTAL: the Unit Leader alert recipient.
 *
 * There is exactly ONE, and it is passed in already resolved. The caller
 * (lib/server/notifications/unitLeaderAlerts.js) derives it from an ACTIVE
 * unit_leader role grant plus an ACTIVE user_unit_scopes row, and has already
 * checked the account is active and that the preference allows email. That work
 * cannot be repeated here, because this module has no database access.
 *
 * This resolver therefore only VALIDATES the shape it was handed, and refuses
 * anything that is not a resolved recipient. It never expands a unit into people,
 * never reads a name list, and never falls back to a default address, so a bug
 * upstream results in no email rather than mail to the wrong person.
 */
function resolveUnitLeaderAlert(context) {
  const r = context.recipient;
  if (!r || !r.email) {
    console.warn('[notifications/recipients] unit_leader_alert: no resolved recipient');
    return [];
  }
  if (r.audience !== 'unit_leader') {
    console.warn('[notifications/recipients] unit_leader_alert: unexpected audience');
    return [];
  }
  return [{
    email: r.email,
    name: r.name || '',
    role: 'Unit Leader',
    audience: 'unit_leader',
  }];
}

function resolveInterviewReminder(context) {
  if (!context.studentEmail) {
    console.warn('[notifications/recipients] interview_reminder: no studentEmail in context');
    return [];
  }
  return [{
    email:    context.studentEmail,
    role:     'student',
    name:     context.firstName || null,
    audience: 'student',
  }];
}

function resolveMidpointCheckin(context) {
  if (!context.studentEmail) {
    console.warn('[notifications/recipients] midpoint_checkin: no studentEmail in context');
    return [];
  }
  return [{
    email:    context.studentEmail,
    role:     'student',
    name:     context.firstName || null,
    audience: 'student',
  }];
}

// CLOCKOUT-NUDGE-LIVE-1: the cron resolves personal_email->school_email and passes the chosen
// address as context.studentEmail; this returns that single student recipient.
function resolveClockoutReminder(context) {
  if (!context.studentEmail) {
    console.warn('[notifications/recipients] clockout_reminder: no studentEmail in context');
    return [];
  }
  return [{
    email:    context.studentEmail,
    role:     'student',
    name:     context.firstName || null,
    audience: 'student',
  }];
}

function resolveTeamsInviteReminder(context) {
  const recipients = [];

  // Primary recipient: the interviewer who needs to act
  if (context.interviewerEmail) {
    recipients.push({
      email:    context.interviewerEmail,
      role:     'interviewer',
      name:     context.interviewerName,
      audience: 'interviewer',
    });
  }

  // Owner is always CC'd so nothing slips through unnoticed
  const ownerEmail = INTERNAL_TEAM_EMAILS.owner;
  if (ownerEmail) {
    recipients.push({
      email:    ownerEmail,
      role:     'owner',
      audience: 'internal_team',
    });
  }

  return recipients;
}

async function resolveUnitFormReceived(context) {
  const { submitterEmail, submitterName, unitName } = context;
  const recipients = [];

  if (!submitterEmail) {
    console.warn('[notifications/recipients] unit_form_received: no submitterEmail');
    return recipients;
  }

  // Query unit_leaders for CC routing (service role for server-side access)
  let ccList = [];
  try {
    const db = getDb();
    if (db && unitName) {
      const { data: leaders } = await db
        .from('unit_leaders')
        .select('full_name, preferred_name, email, role, is_primary_lead')
        .eq('unit_name', unitName)
        .eq('is_active', true)
        .order('is_primary_lead', { ascending: false });

      if (leaders && leaders.length > 0) {
        const primaryLead = leaders.find(l => l.is_primary_lead) || null;
        const submitterIsPrimary = primaryLead &&
          primaryLead.email.toLowerCase() === submitterEmail.toLowerCase().trim();

        let ccLeaders = [];
        if (submitterIsPrimary) {
          ccLeaders = leaders.filter(l =>
            ['Assistant Nurse Manager', 'NPD Practitioner', 'Clinical Nurse Specialist'].includes(l.role)
          );
        } else if (primaryLead) {
          ccLeaders = [primaryLead];
        }

        ccList = ccLeaders
          .filter(l => l.email.toLowerCase() !== submitterEmail.toLowerCase().trim())
          .map(l => ({ name: l.full_name, preferred_name: l.preferred_name || null, email: l.email }));
      }
    }
  } catch (err) {
    console.warn('[notifications/recipients] unit_leaders lookup failed (non-fatal):', err.message);
  }

  // Submitter confirmation email (with CC to unit team)
  // preferred_name comes from context if the submitter was identified as a known leader
  recipients.push({
    email:          submitterEmail,
    role:           'submitter',
    name:           submitterName || null,
    preferred_name: context.submitterPreferredName || null,
    audience:       'submitter',
    cc:             ccList.length > 0 ? ccList : undefined,
  });

  // Internal team alert (Jester + Co-Lead)
  for (const [role, email] of Object.entries(INTERNAL_TEAM_EMAILS)) {
    recipients.push({ email, role, audience: 'internal_team' });
  }

  return recipients;
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

  // 2. Internal team (owner + co-lead) - operational awareness
  for (const [role, email] of Object.entries(INTERNAL_TEAM_EMAILS)) {
    recipients.push({ email, role, audience: 'internal_team' });
  }

  // 3. School coordinator - pipeline visibility, with program-aware routing and CC support
  if (context.school) {
    const { primary, cc, schoolKey } = getCoordinatorsForSchool(context.school, context.programType);

    if (primary) {
      recipients.push({
        email:     primary.email,
        role:      'school_coordinator',
        name:      primary.name,
        title:     primary.title,
        audience:  'school_coordinator',
        schoolKey,
        isPrimary: true,
      });

      for (const ccPerson of cc) {
        recipients.push({
          email:     ccPerson.email,
          role:      'school_coordinator_cc',
          name:      ccPerson.name,
          title:     ccPerson.title,
          audience:  'school_coordinator',
          schoolKey,
          isPrimary: false,
        });
      }
    } else {
      console.warn(`[notifications/recipients] no coordinator mapped for school: "${context.school}"`);
    }
  }

  return recipients;
}
