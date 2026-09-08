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
//
// WELCOME-TOUR-MASTHEAD-1 (2026-09-08): every experience gains the masthead step,
// and each tour picks up the surfaces shipped since its last bump. Every version
// moves, so every signed-in person sees their tour once more.
export const TOUR_EXPERIENCES = {
  staff: 'v5', // v2 -> v3: the Aggregate -> "At a Glance" rename and the Student
               // Profiles / CS-Link Access copy correction re-show once.
               // v3 -> v4: the Rotation step now names the three subtabs
               // (Placement Board / Preceptors / Activity) and drops the stale
               // "matching board" phrase.
               // v4 -> v5: the masthead step, the Messages dock, Keith's slash
               // commands, and the profile menu's portal switcher.
  // v1 -> v2 (all three portals): the Send Feedback and Messages shortcut
  // launcher steps were added, so the corrected tours appear once.
  // v2 -> v3: the masthead step, plus the Shift Log tab (student) and the
  // header scope controls retarget (unit leader).
  student: 'v3',
  unit_leader: 'v3',
  // v2 -> v3: corrected Students / Placement Requests role boundary copy
  // (Placement Requests submits only; tracking lives on Students).
  // v3 -> v4: the masthead step.
  academic_partner: 'v4',
  // v1 -> v2: renamed the portal and At A Glance section, then added the
  // read-only Contacts directory.
  // v2 -> v3: the masthead step, plus the Messages tab and the two utility
  // launchers this portal gained in NA-PORTAL-UTILITIES-1.
  nursing_academic: 'v3',
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

// ── The masthead, shared by every experience ─────────────────────────────────
// WELCOME-TOUR-MASTHEAD-1: staff At a Glance (TodayMasthead) and all four portal
// homes (GreetingMasthead) render the SAME card, so they get the same step from
// one definition rather than five near-copies that drift.
//
// The target is the card, not the temperature button inside it. The button only
// renders once weather has resolved AND more than one city pack is installed,
// and the engine skips a step whose target is missing, so anchoring on the
// button would quietly drop the step for anyone whose weather was still in
// flight. The card is present the moment the page is.
//
// Claims are limited to what every host renders: the greeting, the clock and
// date, the weather, the 14-day event chips (MASTHEAD_WINDOW_DAYS in
// src/lib/mastheadEvents.js), and the scenery. Open Calendar is deliberately not
// named - the Academic Partner and Nursing Academics mastheads pass no calendar
// handler. The city choice is localStorage, keyed per user, so "on this device"
// is the honest scope (see src/lib/mastheadCityPreference.js).

const mastheadStep = {
  target: '[data-tour="masthead"]',
  title: 'Your Masthead',
  content: 'The card at the top greets you, keeps a live clock and date, and shows the weather where you are. Anything on the calendar in the next two weeks appears as a chip along its bottom edge. The scenery behind it follows the time of day and the weather, and tapping the temperature lets you choose which city it shows. Your choice is remembered on this device.',
};

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

// SCOPE-PICKER-1: the Cohort and Experience pills merged into one Scope control, so
// this step retargets and now describes both dimensions.
//
// ONE VERSION FOR EVERY ROLE, deliberately. Residency access is a capability
// (canAccessNgrp), not a role, so it does not line up exactly with the privileged /
// interviewer / viewer split these tours use. Copy that promised a Residency switch to
// everyone in the privileged tour would be wrong for a privileged user without the
// capability. The conditional phrasing below is true for every reader.
const staffScopeSwitcher = {
  target: '[data-tour="scope-switcher"]',
  title: 'Scope',
  content: 'Almost everything in ASPIRE is scoped to one cohort, and this is where you set it. If your access includes the Residency experience, you also switch between Internship and Residency here.',
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
  // KEITH-SLASH-PALETTE-1: typing "/" in the composer opens a caret-anchored
  // list of the skills Keith can run (src/lib/slashPalette.js), so the copy
  // names it rather than leaving the affordance undiscoverable.
  content: "Ask Keith about ASPIRE workflows, rules, and how to complete a task, and type a slash in the composer to see the tasks Keith can run for you. Keith answers within your role's access, look bottom-right.",
};

// MESSAGES-DOCK-1: the lower-right Messages dock. Authorization is Owner and
// Admin only (canUseMessages in MainMessagesLauncher.jsx), which does NOT match
// this tour's privileged set exactly - a Co-Lead is privileged here but sees no
// launcher. The step stays in the privileged array and the engine's
// missing-target skip carries a Co-Lead past it, the same rule the portal
// launcher steps rely on.
const staffMessagesDock = {
  target: '[data-tour="main-messages-launcher"]',
  title: 'Messages',
  content: 'The round button above Keith opens a docked Messages panel over whatever you are working on: the same inbox, threads, and New message action as ASPIRE Connect, without leaving the page. Your unread count sits on the button.',
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
  // PORTAL-SWITCHER-1: the Portals group in this menu is Owner/Admin only
  // (src/lib/portalLinks.js drives it), so the sentence names that audience.
  content: "View your role, open Settings, or sign out. Settings holds appearance, help, restarting this tour under Tours & Help, and, for Owners and Admins, account access and the governed Knowledge Center. Owners and Admins can also open any of the four portals straight from this menu.",
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

  // Sequence logic: Welcome -> Scope (context) -> main workflow TABS in order ->
  // header/taskbar TOOLS in order -> Finish.
  if (isPrivileged) {
    // Owner / Admin / Co-Lead - full tour incl. Catalog, Rotation, Evaluation, Connect.
    return [
      staffWelcome(firstName),
      staffScopeSwitcher,
      // workflow tabs
      staffAggregate,
      // The masthead sits at the top of At a Glance, which is where the tour is
      // already standing, so it follows that tab's step rather than opening the run.
      mastheadStep,
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
      // lower-right dock: Messages, then Keith, then Feedback
      staffMessagesDock,
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
      staffScopeSwitcher,
      // workflow tabs (no Rotation / Evaluation)
      staffAggregate,
      mastheadStep,
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
    staffScopeSwitcher,
    // workflow tabs
    staffAggregate,
    mastheadStep,
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
// is adding to PortalNav.jsx/PortalShell.jsx in the same feature. The student
// placement destination and the profile menu are portal-only concepts with no
// staff equivalent.

function getStudentSteps(userProfile) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  return [
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: `Welcome, ${firstName}!`,
      // STUDENT-PHONE-1: most students open this on a phone, where the section
      // nav is the fixed bar along the bottom rather than a row of tabs. The
      // anchors are the same buttons either way, so the tour spotlights them in
      // place; the welcome says where to look.
      content: 'This is your ASPIRE Compass, your home for tracking your stage progress, messaging the ASPIRE team, logging your shifts, and managing your rotation. This short tour walks you through the areas you will use most. On a phone, those sections live in the bar along the bottom of the screen.',
    },
    {
      target: '[data-tour="portal-nav-home"]',
      title: 'Home',
      content: 'Your Compass home: where you are in the ASPIRE stages, what to do next, your Rotation Activity calendar, and quick access to your profile.',
    },
    mastheadStep,
    {
      target: '[data-tour="portal-nav-messages"]',
      title: 'Messages',
      content: 'Send and receive secure messages with the ASPIRE team here. An unread badge shows when a new message is waiting.',
    },
    {
      target: '[data-tour="portal-nav-placement"]',
      title: 'My Placement',
      content: 'Review your placement progress, ASPIRE status, surveys, badge and certificates, and support options here.',
    },
    {
      // STUDENT-SHIFT-TAB-1: shift logging moved INSIDE the portal, with the
      // session as identity. The tab itself is check in / check out / log a past
      // shift; editing, withdrawing and corrections live in the shift history
      // panel, which opens from Home's Rotation Activity and from My Placement
      // (see src/portal/ShiftLogHistoryDrawer.jsx), so the copy sends you there
      // rather than promising it on this tab.
      target: '[data-tour="portal-nav-shiftlog"]',
      title: 'Shift Log',
      content: 'Check in at the start of a shift, check out at the end, and log a past shift, without leaving the portal or typing your school email. Logging opens once you are Placed and in an Active Rotation. To edit, withdraw, or request a correction on a shift you already logged, open your shift history from Home or My Placement.',
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
      content: "Your unit's overview: who is on campus right now, the current student roster, the rotation calendar, and where things stand at a glance.",
    },
    mastheadStep,
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
      // WELCOME-TOUR-MASTHEAD-1 correction: this step used to target
      // [data-tour="portal-unit-switcher"], the anchor on UnitSwitcher in
      // UnitLeaderChrome.jsx. That component is exported but no longer rendered
      // anywhere: the unit picker moved into the shared portal header controls,
      // where it now sits beside a Cohort picker. The anchor therefore never
      // existed in the DOM and the engine skipped this step for every unit
      // leader. It retargets to the shared header-controls wrapper, which is the
      // same anchor the Academic Partner tour already uses, and the copy covers
      // both controls. The wrapper carries `:empty { display: none }`, so a
      // leader with one unit and one cohort still skips it.
      target: '[data-tour="portal-scope-selector"]',
      title: 'Units and Cohort',
      content: "The controls in the header decide what this portal shows you. If you lead more than one unit, Viewing switches between them or shows all of your assigned units together. Cohort narrows the section you are on to a single cohort.",
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
    // The portal opens on Students, and AcademicPartnerPortal.jsx renders the
    // masthead at the top of that page, so the card is there from the first step.
    mastheadStep,
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
// NURSING-ACADEMICS-1: three sections, view-only, so the tour is short.
//
// NA-PORTAL-UTILITIES-1 changed that: the portal gained a Messages tab and both
// utility launchers, each behind its own fail-closed server capability
// (na_messaging / na_feedback in PortalApp.jsx). Unlike the Academic Partner
// case, nothing here needs a new context key: when a capability is off, the nav
// button and the launcher are simply not in the DOM, and the engine's
// missing-target skip walks past them, exactly as the Student and Unit Leader
// launcher steps already rely on. So they go in the array and stay honest either
// way.

function getNursingAcademicSteps(userProfile) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  return [
    {
      target: 'body',
      placement: 'center',
      disableBeacon: true,
      title: `Welcome, ${firstName}!`,
      content: 'This is the Nursing Education & Leadership Portal, your organization-wide view of ASPIRE. This short tour walks you through its sections.',
    },
    {
      target: '[data-tour="portal-nav-calendar"]',
      title: 'At A Glance',
      content: 'See fiscal-year impact totals and school rotation windows across every cohort, color-coded by school.',
    },
    mastheadStep,
    {
      target: '[data-tour="portal-nav-community-benefit"]',
      title: 'Community Benefit',
      content: 'Fiscal-year ASPIRE student activity and the estimated nursing community benefit, with a privacy-safe aggregate CSV export for fiscal reporting.',
    },
    {
      target: '[data-tour="portal-nav-contacts"]',
      title: 'Contacts',
      content: 'Search and view active ASPIRE contacts. This directory is read-only: it lists who to reach, and does not send outreach.',
    },
    {
      target: '[data-tour="portal-nav-messages"]',
      title: 'Messages',
      content: 'Send and receive secure messages with the ASPIRE team here. An unread badge shows when a new message is waiting.',
    },
    portalFeedbackStep,
    portalMessagesLauncherStep,
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
