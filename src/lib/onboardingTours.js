// WELCOME-TOUR-PORTALS-1: the tour system now serves five surfaces (staff plus
// four portal experiences: student, unit_leader, academic_partner,
// nursing_academic), sharing this one module for step content and
// acknowledgement bookkeeping.
//
// NO SCHEMA MIGRATION: user_profiles.onboarding_tour_version already stores free
// text, and Wave E already grants any authenticated user permission to update
// their own onboarding_tour_* columns. This change repurposes that same column
// as a comma-separated per-experience ledger ("staff:v3,student:v1") instead of
// a single bare version string, so no RLS or migration work is required. A
// pre-ledger row (a bare 'v1' or 'v2', no colon) is read as { staff: thatValue }
// for back-compat - see parseTourAcks.
//
// The completed/dismissed booleans (onboarding_tour_completed / _dismissed) are
// shared, row-level columns, not per-experience. They are still written on
// finish/dismiss (unchanged persistence shape), but they are NO LONGER used to
// decide whether a tour has been acknowledged: a student finishing the Student
// tour must not suppress the staff tour for the same person, and vice versa.
// The ledger token in onboarding_tour_version is the sole acknowledgement source
// - see isTourAcknowledged.
export const TOUR_EXPERIENCES = {
  staff: 'v4', // v2 -> v3: the Aggregate -> "At a Glance" rename and the Student
               // Profiles / CS-Link Access copy correction re-show once.
               // v3 -> v4: the Rotation step now names the three subtabs
               // (Placement Board / Preceptors / Activity) and drops the stale
               // "matching board" phrase.
  // v1 -> v2 (all three portals): the Send Feedback and Messages shortcut
  // launcher steps were added, so the corrected tours appear once.
  student: 'v2',
  unit_leader: 'v2',
  // v2 -> v3: corrected Students / Placement Requests role boundary copy
  // (Placement Requests submits only; tracking lives on Students).
  academic_partner: 'v3',
  // NURSING-ACADEMICS-1: the organization-wide, view-only academics portal
  // (Academic Calendar + Community Benefit).
  nursing_academic: 'v1',
};

// Legacy alias. Nothing outside this module should need it (use TOUR_EXPERIENCES
// or isTourAcknowledged instead), but it is kept so any straggler import does
// not break.
export const TOUR_VERSION = TOUR_EXPERIENCES.staff;

/**
 * Parse the onboarding_tour_version column into a plain { experience: version }
 * map. Back-compat: a bare legacy value (no colon at all, e.g. 'v1' or 'v2')
 * is treated as a staff acknowledgement from before the ledger format existed.
 * Null/empty/unparseable input returns {}.
 */
export function parseTourAcks(versionString) {
  if (!versionString || typeof versionString !== 'string') return {};
  const trimmed = versionString.trim();
  if (!trimmed) return {};

  if (!trimmed.includes(':')) {
    // Pre-ledger row: the whole column was just the staff version.
    return { staff: trimmed };
  }

  const acks = {};
  for (const part of trimmed.split(',')) {
    const piece = part.trim();
    if (!piece) continue;
    const sep = piece.indexOf(':');
    if (sep <= 0) continue;
    const experience = piece.slice(0, sep).trim();
    const version = piece.slice(sep + 1).trim();
    if (experience && version) acks[experience] = version;
  }
  return acks;
}

/** Serialize a { experience: version } map back to "exp:version,exp:version", stable-sorted by key. */
export function serializeTourAcks(map) {
  if (!map) return '';
  return Object.keys(map)
    .filter(experience => map[experience])
    .sort()
    .map(experience => `${experience}:${map[experience]}`)
    .join(',');
}

/**
 * True iff this profile's ledger already has the CURRENT version acknowledged
 * for this experience. A pre-ledger bare 'v2' staff row parses as { staff: 'v2' },
 * which no longer equals TOUR_EXPERIENCES.staff ('v3'), so it correctly fails
 * this check once, that is the intended v3 reset - no separate handling needed.
 */
export function isTourAcknowledged(userProfile, experience) {
  const acks = parseTourAcks(userProfile?.onboarding_tour_version);
  return acks[experience] === TOUR_EXPERIENCES[experience];
}

/** The sessionStorage key an experience's snooze ("Remind me next time") is stored under. */
export function tourSnoozeKey(experience) {
  return `onboarding_tour_snoozed:${experience}`;
}

/**
 * Whether this experience's tour was snoozed for the current tab session. Staff
 * also honors the legacy plain 'onboarding_tour_snoozed' key so a snooze written
 * by the pre-ledger build still holds for the rest of that session.
 */
export function isTourSnoozed(experience) {
  try {
    if (sessionStorage.getItem(tourSnoozeKey(experience)) === 'true') return true;
    if (experience === 'staff' && sessionStorage.getItem('onboarding_tour_snoozed') === 'true') return true;
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) - fail open to "not snoozed".
  }
  return false;
}

/**
 * Whether an experience's tour should auto-start for this profile right now.
 * False unless: the profile exists, its tour fields are loaded (completed is
 * not undefined - undefined means the profile/migration data has not arrived
 * yet), it is not already acknowledged at the current version, and it was not
 * snoozed this session.
 */
export function shouldAutoStartTour(userProfile, experience) {
  if (!userProfile) return false;
  if (userProfile.onboarding_tour_completed === undefined) return false;
  if (isTourAcknowledged(userProfile, experience)) return false;
  if (isTourSnoozed(experience)) return false;
  return true;
}

// ── Staff step definitions ───────────────────────────────────────────────────
// TOUR-1 / WELCOME-TOUR-PORTALS-1: copy refreshed against current ASPIRE
// Intelligence terminology (the "At a Glance" rename, the Profiles / CS-Link
// Access toggle, and the WS2.4 user-menu restart removal). All targets reuse
// anchors that already exist live (nav tab-* anchors, header connect / catalog /
// action-center / global-search, keith-orb, feedback-button, user-profile) -
// verified against UnifiedNav.jsx and Header/*.jsx, no anchor changes. Internal
// step identifiers and the tab-embed anchor (Rotation tab) are intentionally
// preserved.

const staffWelcome = (firstName) => ({
  target: 'body',
  placement: 'center',
  disableBeacon: true,
  title: `Welcome, ${firstName}!`,
  content: "This is ASPIRE Intelligence, your workspace for managing ASPIRE cohorts, students, interviews, placements, evaluations, and communication. This short tour walks you through the areas you'll use most.",
});

const staffCohortSwitcher = {
  target: '[data-tour="cohort-switcher"]',
  title: 'Cohort Picker',
  content: 'Switch between active and past ASPIRE cohorts here. Most of the app scopes to the selected cohort.',
};

const staffAggregate = {
  target: '[data-tour="tab-aggregate"]',
  title: 'Start here: At a Glance',
  content: 'A real-time overview of the active cohort: placement activity, student requests, on-campus logs, and program status.',
};

const staffStudentProfiles = {
  target: '[data-tour="tab-student-profiles"]',
  title: 'Student Profiles',
  content: "Browse the cohort as a grid or list, names show a student's preferred first name, with a profile-completion indicator. Open any student to review school, program, GPA, unit preferences, status, and rotation progress in the side panel. The Profiles / CS-Link Access toggle above the list switches between that roster and the CS-Link account-activation workflow for the same students.",
};

const staffCatalog = {
  target: '[data-tour="catalog"]',
  title: 'ASPIRE Catalog',
  content: 'Curated resources, guides, forms, and documents for ASPIRE, open it anytime from the header.',
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const staffInterviewRubric = {
  target: '[data-tour="tab-interview-rubric"]',
  title: 'Interviews',
  content: 'Open a scheduled interview to score the ASPIRE rubric, Clinical Judgment, Professional Presence, and Goal Alignment, then submit your recommendation.',
};

// Rotation tab. Internal name + the tab-embed anchor are preserved; user-facing
// copy uses the current "Rotation" label and the RENDERED subtab names from
// RotationTab.jsx: Placement Board (the approved rename - never "matching
// board"), Preceptors, and Activity (canEdit-gated: Owners and Admins).
// The subtabs render only inside /rotation, and the staff tour runs on At a
// Glance without navigating, so revealing them as separate spotlight steps
// would disrupt tour state - all three are described here instead.
const staffEmbed = {
  target: '[data-tour="tab-embed"]',
  title: 'Rotation',
  content: 'Placement and rotation operations, in three subtabs: Placement Board, the click-to-place board for assigning students to units by preference; Preceptors, the preceptor directory; and Activity (Owners and Admins), the history of placements and changes. Owner, Admin, and Co-Lead.',
};

const staffEvaluation = {
  target: '[data-tour="tab-evaluation"]',
  title: 'Evaluation',
  content: 'Manage evaluation workflows, Casey-Fink readiness surveys and related student and preceptor evaluation activity for the cohort.',
};

const staffConnect = {
  target: '[data-tour="connect"]',
  title: 'ASPIRE Connect',
  content: 'Manage contacts, outreach, and survey invitations, compose messages, send invitations, and review sent history.',
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const staffActionCenter = {
  target: '[data-tour="action-center"]',
  title: 'Action Center',
  content: 'Tasks and reminders that need your attention appear here: unsent forms, pending interviews, CS-Link items, badge requests, and more.',
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const staffSearch = {
  target: '[data-tour="global-search"]',
  title: 'Universal Search',
  content: 'Find any student, school, unit, or contact from anywhere in the app. Results jump straight to the relevant area.',
};

const staffKeith = {
  target: '[data-tour="keith-orb"]',
  title: 'Keith, your AI assistant',
  content: "Ask Keith about ASPIRE workflows, rules, and how to complete a task. Keith answers within your role's access, look bottom-right.",
};

const staffFeedback = {
  target: '[data-tour="feedback-button"]',
  title: 'Share Feedback',
  content: 'Found a bug or have a suggestion? Tap here to send it directly to the program leads.',
};

// WELCOME-TOUR-PORTALS-1: WS2.4 removed the user-menu tour restart, so this step
// no longer claims it lives there - restarting now happens from Settings > Tours
// & Help only.
const staffUserMenu = {
  target: '[data-tour="user-profile"]',
  title: 'Your Profile',
  content: "View your role, open Settings, or sign out. Settings holds appearance, help, restarting this tour under Tours & Help, and, for Owners and Admins, account access and the governed Knowledge Center.",
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const staffFinish = {
  target: 'body',
  placement: 'center',
  disableBeacon: true,
  title: "You're all set!",
  content: 'You can restart this tour anytime from Settings > Tours & Help. Welcome to the team.',
};

function getStaffSteps(userProfile) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  const role = userProfile?.role;
  const isPrivileged = userProfile?.is_owner === true || ['admin', 'co-lead', 'co_lead'].includes(role);

  // Sequence logic: Welcome -> Cohort Picker (context) -> main workflow TABS in order ->
  // header/taskbar TOOLS in order -> Finish.
  if (isPrivileged) {
    // Owner / Admin / Co-Lead - full tour incl. Catalog, Rotation, Evaluation, Connect.
    return [
      staffWelcome(firstName),
      staffCohortSwitcher,
      // workflow tabs
      staffAggregate,
      staffStudentProfiles,
      staffInterviewRubric,
      staffEmbed,
      staffEvaluation,
      // header tools
      staffSearch,
      staffConnect,
      staffCatalog,
      staffActionCenter,
      staffUserMenu,
      staffKeith,
      staffFeedback,
      staffFinish,
    ];
  }

  if (role === 'interviewer') {
    // Interviewers get Catalog but NOT Rotation / Evaluation / Connect - those are restricted
    // (overlay-only) or owner/admin-oriented, so the tour does not walk them through those areas.
    return [
      staffWelcome(firstName),
      staffCohortSwitcher,
      // workflow tabs (no Rotation / Evaluation)
      staffAggregate,
      staffStudentProfiles,
      staffInterviewRubric,
      // header tools (no Connect)
      staffSearch,
      staffCatalog,
      staffUserMenu,
      staffKeith,
      staffFeedback,
      staffFinish,
    ];
  }

  // Viewer and default - conservative; Catalog is NOT shown (not visible to viewers).
  return [
    staffWelcome(firstName),
    staffCohortSwitcher,
    // workflow tabs
    staffAggregate,
    staffStudentProfiles,
    staffInterviewRubric,
    staffEvaluation,
    // header tools
    staffSearch,
    staffUserMenu,
    staffKeith,
    staffFinish,
  ];
}

// ── Shared portal utility-launcher steps ─────────────────────────────────────
// WELCOME-TOUR-FOLLOWUP-1: the two floating lower-corner launchers every portal
// renders through PortalUtilityLayer. The Feedback anchor is the SHARED
// feedback-button anchor (SharedFeedbackPanel hardcodes it; exactly one
// instance exists per page). The Messages shortcut anchor is portal-only.
// Both lean on the engine's missing-target skip when a launcher is not
// rendered (Messages unauthorized, or the launchers suppressed on a route).

const portalFeedbackStep = {
  target: '[data-tour="feedback-button"]',
  title: 'Send Feedback',
  content: 'Found a bug or have a suggestion? The feedback button in the lower corner sends it straight to the ASPIRE team, with your current section attached.',
};

const portalMessagesLauncherStep = {
  target: '[data-tour="portal-messages-launcher"]',
  title: 'Messages Shortcut',
  content: 'This floating shortcut opens a quick messages panel from any section, so you can reach the ASPIRE team without leaving what you are doing. Your unread count appears on it too.',
};

// ── Student Portal (Compass) step definitions ────────────────────────────────
// WELCOME-TOUR-PORTALS-1: targets are the portal-nav-* anchors the portal agent
// is adding to PortalNav.jsx/PortalShell.jsx in the same feature. The stage-
// action step and the profile menu are portal-only concepts with no staff
// equivalent.

function getStudentSteps(userProfile) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  return [
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: `Welcome, ${firstName}!`,
      content: 'This is your ASPIRE Compass, your home for tracking your stage progress, messaging the ASPIRE team, and managing your rotation. This short tour walks you through the areas you will use most.',
    },
    {
      target: '[data-tour="portal-nav-home"]',
      title: 'Home',
      content: 'Your Compass home: where you are in the ASPIRE stages, what to do next, and quick access to your profile.',
    },
    {
      target: '[data-tour="portal-nav-messages"]',
      title: 'Messages',
      content: 'Send and receive secure messages with the ASPIRE team here. An unread badge shows when a new message is waiting.',
    },
    {
      // Phone-only: CSS renders this slot only in the bottom bar, and only when
      // the current stage actually offers a quick action. The engine's missing-
      // target skip handles both the desktop case and the no-action case.
      target: '[data-tour="portal-nav-action"]',
      title: 'Quick Action',
      content: 'A stage-aware quick action, such as logging a shift, appears here on your phone when your current stage offers one.',
    },
    portalFeedbackStep,
    portalMessagesLauncherStep,
    {
      target: '[data-tour="portal-profile-menu"]',
      title: 'Your Profile',
      // PROFILE-MENU-AVATARS-1: the student menu now reads My Profile and adds
      // Change Photo; the copy names exactly what the menu offers.
      content: 'Open My Profile, change your photo, restart this tour, or sign out.',
      placement: 'bottom-end',
      spotlightPadding: 6,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: "You're all set!",
      content: 'You can restart this tour anytime from the profile menu. Welcome to ASPIRE.',
    },
  ];
}

// ── Unit Leader Portal step definitions ──────────────────────────────────────
// WELCOME-TOUR-PORTALS-1: purposes below are written from UnitLeaderChrome.jsx's
// SECTIONS list and the section components under src/portal/unit/ (roster +
// nomination workflow in UnitPreceptorsWorkspace, released quantitative-only
// results in UnitEvaluationsWorkspace, unit-placement-requests + unit-capacity
// endpoints in unitLeaderApi.js). On phones, Evaluations / Placement Requests /
// Capacity are relocated into a "More" bottom sheet and their nav buttons are
// CSS-hidden (ptl-nav-desktop-only) rather than removed, so the engine's
// missing/hidden-target skip carries a leader straight past them on a phone
// instead of stalling the tour.

function getUnitLeaderSteps(userProfile) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  return [
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: `Welcome, ${firstName}!`,
      content: 'This is the Unit Leader Portal, your home for your unit\'s ASPIRE students, preceptors, evaluations, placement requests, and clinical capacity. This short tour walks you through each section.',
    },
    {
      target: '[data-tour="portal-nav-home"]',
      title: 'Home',
      content: "Your unit's overview: the current student roster and where things stand at a glance.",
    },
    {
      target: '[data-tour="portal-nav-preceptors"]',
      title: 'Preceptors',
      content: 'The preceptor directory for your unit. Nominate a new preceptor and review nomination history here.',
    },
    {
      target: '[data-tour="portal-nav-messages"]',
      title: 'Messages',
      content: 'Send and receive secure messages with the ASPIRE team here.',
    },
    {
      target: '[data-tour="portal-nav-evaluations"]',
      title: 'Evaluations',
      content: 'Released, unit-scoped evaluation results for the approved instruments, quantitative only, once results exist for your unit.',
    },
    {
      target: '[data-tour="portal-nav-placements"]',
      title: 'Placement Requests',
      content: "Review incoming student placement requests for your unit and record your unit's response.",
    },
    {
      target: '[data-tour="portal-nav-capacity"]',
      title: 'Capacity',
      content: "Submit and update your unit's clinical placement capacity for a cohort.",
    },
    portalFeedbackStep,
    portalMessagesLauncherStep,
    {
      // Rendered only when the leader is assigned more than one unit; a single-
      // unit leader has nothing to switch between, so this step is skipped.
      target: '[data-tour="portal-unit-switcher"]',
      title: 'Switch Units',
      content: "If you lead more than one unit, switch which unit's data this portal shows here, or view all of your assigned units together.",
    },
    {
      target: '[data-tour="portal-profile-menu"]',
      title: 'Your Profile',
      // The Unit Leader menu opens a Profile SECTION (onProfile), it has no
      // inline edit action, so the copy says open, not edit.
      // PROFILE-MENU-AVATARS-1: Change Photo joined the menu.
      content: 'Open your Profile, change your photo, restart this tour, or sign out.',
      placement: 'bottom-end',
      spotlightPadding: 6,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: "You're all set!",
      content: 'You can restart this tour anytime from the profile menu. Welcome to ASPIRE.',
    },
  ];
}

// ── Academic Partner Portal step definitions ─────────────────────────────────
// WELCOME-TOUR-PORTALS-1: Messages is a fail-closed SERVER capability
// (context.apMessagesEnabled), not a responsive/DOM concern, so it is left out
// of the step array entirely rather than added and skipped when the capability
// is off. The scope selector (school/cohort pickers) is a DOM-availability
// case like the Unit Leader switcher, so it stays in the array and relies on
// the engine's missing-target skip.

function getAcademicPartnerSteps(userProfile, apMessagesEnabled) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  const steps = [
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: `Welcome, ${firstName}!`,
      content: "This is the Academic Partner Portal, your home for your school's ASPIRE students and placement requests. This short tour walks you through each section.",
    },
    {
      target: '[data-tour="portal-nav-students"]',
      title: 'Students',
      // WELCOME-TOUR-FOLLOWUP-2: the tracking side of the boundary. Submitted
      // requests and each student's placement progress are managed HERE, not
      // on the Placement Requests tab.
      content: "The roster of your school's students in ASPIRE. Your submitted requests and each student's placement progress are managed and tracked here.",
    },
    {
      target: '[data-tour="portal-nav-placement-requests"]',
      title: 'Placement Requests',
      // WELCOME-TOUR-FOLLOWUP-2: the submission side of the boundary. This tab
      // is exclusively for submitting NEW requests; no tracking claim here.
      content: 'Submit new placement requests for your students here. This tab is just for sending a new request; everything you have submitted is tracked on the Students tab.',
    },
  ];

  if (apMessagesEnabled === true) {
    steps.push({
      target: '[data-tour="portal-nav-messages"]',
      title: 'Messages',
      content: 'Send and receive secure messages with the ASPIRE team here.',
    });
  }

  // Feedback is server-authorized for every Academic Partner; the Messages
  // shortcut launcher exists only under the same fail-closed capability that
  // gates the Messages tab above.
  steps.push(portalFeedbackStep);
  if (apMessagesEnabled === true) steps.push(portalMessagesLauncherStep);

  steps.push(
    {
      // Rendered only when the partner has more than one school or cohort to
      // choose from; otherwise there is nothing to pick, and this is skipped.
      target: '[data-tour="portal-scope-selector"]',
      title: 'School and Cohort',
      content: 'If you work with more than one school or cohort, choose which one this portal shows here.',
    },
    {
      target: '[data-tour="portal-profile-menu"]',
      title: 'Your Profile',
      // The Academic Partner menu carries no profile page (no onProfile /
      // onEditProfile is wired): change your photo, the public-site link, the
      // tour restart, and sign out. The copy matches exactly those actions
      // (PROFILE-MENU-AVATARS-1 added Change Photo).
      content: 'Change your photo, visit the ASPIRE public site, restart this tour, or sign out.',
      placement: 'bottom-end',
      spotlightPadding: 6,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: "You're all set!",
      content: 'You can restart this tour anytime from the profile menu. Welcome to ASPIRE.',
    },
  );

  return steps;
}

// ── Nursing Academics Portal step definitions ────────────────────────────────
// NURSING-ACADEMICS-1: two sections, view-only, no messaging/feedback
// launchers (those capabilities are intentionally not enabled for this role),
// so the tour is short: the two nav destinations and the profile menu.

function getNursingAcademicSteps(userProfile) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  return [
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: `Welcome, ${firstName}!`,
      content: 'This is the Nursing Academics Portal, your organization-wide view of ASPIRE. This short tour walks you through its two sections.',
    },
    {
      target: '[data-tour="portal-nav-calendar"]',
      title: 'Academic Calendar',
      content: 'School rotation windows across every cohort, color-coded by school, with month navigation and filters for fiscal year, cohort, school, and program.',
    },
    {
      target: '[data-tour="portal-nav-community-benefit"]',
      title: 'Community Benefit',
      content: 'Fiscal-year ASPIRE student activity and the estimated nursing community benefit, with a privacy-safe aggregate CSV export for fiscal reporting.',
    },
    {
      target: '[data-tour="portal-profile-menu"]',
      title: 'Your Profile',
      content: 'Change your photo, visit the ASPIRE public site, restart this tour, or sign out.',
      placement: 'bottom-end',
      spotlightPadding: 6,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: "You're all set!",
      content: 'You can restart this tour anytime from the profile menu. Welcome to ASPIRE.',
    },
  ];
}

/**
 * The step array for one tour experience. `context` carries whatever that
 * experience's step set needs beyond the profile itself:
 *   - userProfile: the signed-in user's profile row (drives the first-name
 *     greeting for every experience).
 *   - apMessagesEnabled: Academic Partner Messages server capability, fail-
 *     closed (defaults to false). Ignored by every other experience.
 */
export function getTourSteps(experience, context = {}) {
  const { userProfile, apMessagesEnabled = false } = context;
  switch (experience) {
    case 'student':
      return getStudentSteps(userProfile);
    case 'unit_leader':
      return getUnitLeaderSteps(userProfile);
    case 'academic_partner':
      return getAcademicPartnerSteps(userProfile, apMessagesEnabled);
    case 'nursing_academic':
      return getNursingAcademicSteps(userProfile);
    case 'staff':
    default:
      return getStaffSteps(userProfile);
  }
}
