// WELCOME-TOUR-REFRESH-RESET: bumped v1 → v2 to re-show the refreshed, role-aware tour
// (adds ASPIRE Catalog; interviewers skip Rotation/Evaluation/Connect) once to everyone.
export const TOUR_VERSION = 'v2';

// ── Step definitions ─────────────────────────────────────────────────────────
// TOUR-1: copy refreshed to current ASPIRE Intelligence terminology and the
// Evaluation + ASPIRE Connect areas added. All targets reuse anchors that already
// exist live (nav tab-* anchors, header connect / action-center / global-search,
// keith-orb, feedback-button, user-profile) - no anchor changes. Internal step
// identifiers and the tab-embed anchor (Rotation tab) are intentionally preserved.

const stepWelcome = (firstName) => ({
  target: 'body',
  placement: 'center',
  disableBeacon: true,
  title: `Welcome, ${firstName}!`,
  content: "This is ASPIRE Intelligence, your workspace for managing ASPIRE cohorts, students, interviews, placements, evaluations, and communication. This short tour walks you through the areas you'll use most.",
});

const stepCohortSwitcher = {
  target: '[data-tour="cohort-switcher"]',
  title: 'Cohort Picker',
  content: 'Switch between active and past ASPIRE cohorts here. Most of the app scopes to the selected cohort.',
};

const stepAggregate = {
  target: '[data-tour="tab-aggregate"]',
  title: 'Start here: Aggregate',
  content: 'A real-time overview of the active cohort: placement activity, student requests, on-campus logs, and program status.',
};

const stepStudentProfiles = {
  target: '[data-tour="tab-student-profiles"]',
  title: 'Student Profiles',
  content: 'Browse the cohort as a grid or list, names show a student’s preferred first name, with a profile-completion indicator. Open any student to review school, program, GPA, unit preferences, status, and rotation progress in the side panel.',
};

const stepCatalog = {
  target: '[data-tour="catalog"]',
  title: 'ASPIRE Catalog',
  content: 'Curated resources, guides, forms, and documents for ASPIRE, open it anytime from the header.',
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const stepInterviewRubric = {
  target: '[data-tour="tab-interview-rubric"]',
  title: 'Interviews',
  content: 'Open a scheduled interview to score the ASPIRE rubric, Clinical Judgment, Professional Presence, and Goal Alignment, then submit your recommendation.',
};

// Rotation tab. Internal name + the tab-embed anchor are preserved; user-facing
// copy uses the current "Rotation" label.
const stepEmbed = {
  target: '[data-tour="tab-embed"]',
  title: 'Rotation',
  content: 'The matching board for placing students into units by preference. Unit availability, placement capacity, and matches live here. Owner, Admin, and Co-Lead.',
};

const stepEvaluation = {
  target: '[data-tour="tab-evaluation"]',
  title: 'Evaluation',
  content: 'Manage evaluation workflows, Casey-Fink readiness surveys and related student and preceptor evaluation activity for the cohort.',
};

const stepConnect = {
  target: '[data-tour="connect"]',
  title: 'ASPIRE Connect',
  content: 'Manage contacts, outreach, and survey invitations, compose messages, send invitations, and review sent history.',
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const stepActionCenter = {
  target: '[data-tour="action-center"]',
  title: 'Action Center',
  content: 'Tasks and reminders that need your attention appear here: unsent forms, pending interviews, CS-Link items, badge requests, and more.',
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const stepSearch = {
  target: '[data-tour="global-search"]',
  title: 'Universal Search',
  content: 'Find any student, school, unit, or contact from anywhere in the app. Results jump straight to the relevant area.',
};

const stepKeith = {
  target: '[data-tour="keith-orb"]',
  title: 'Keith, your AI assistant',
  content: 'Ask Keith about ASPIRE workflows, rules, and how to complete a task. Keith answers within your role’s access, look bottom-right.',
};

const stepFeedback = {
  target: '[data-tour="feedback-button"]',
  title: 'Share Feedback',
  content: 'Found a bug or have a suggestion? Tap here to send it directly to the program leads.',
};

const stepUserMenu = {
  target: '[data-tour="user-profile"]',
  title: 'Your Profile',
  content: 'View your role, open Settings, update your photo, restart this tour, or sign out. Settings holds appearance and help, and, for Owners and Admins, account access and the governed Knowledge Center.',
  placement: 'bottom-end',
  spotlightPadding: 6,
  disableBeacon: true,
};

const stepFinish = {
  target: 'body',
  placement: 'center',
  disableBeacon: true,
  title: "You're all set!",
  content: 'You can restart this tour anytime from your user menu. Welcome to the team.',
};

// ── Role-based step sets ──────────────────────────────────────────────────────

export function getTourSteps(userProfile) {
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  const role = userProfile?.role;
  const isPrivileged = userProfile?.is_owner === true || ['admin', 'co-lead', 'co_lead'].includes(role);

  // Sequence logic: Welcome → Cohort Picker (context) → main workflow TABS in order →
  // header/taskbar TOOLS in order → Finish.
  if (isPrivileged) {
    // Owner / Admin / Co-Lead - full tour incl. Catalog, Rotation, Evaluation, Connect.
    return [
      stepWelcome(firstName),
      stepCohortSwitcher,
      // workflow tabs
      stepAggregate,
      stepStudentProfiles,
      stepInterviewRubric,
      stepEmbed,
      stepEvaluation,
      // header tools
      stepSearch,
      stepConnect,
      stepCatalog,
      stepActionCenter,
      stepUserMenu,
      stepKeith,
      stepFeedback,
      stepFinish,
    ];
  }

  if (role === 'interviewer') {
    // Interviewers get Catalog but NOT Rotation / Evaluation / Connect - those are restricted
    // (overlay-only) or owner/admin-oriented, so the tour does not walk them through those areas.
    return [
      stepWelcome(firstName),
      stepCohortSwitcher,
      // workflow tabs (no Rotation / Evaluation)
      stepAggregate,
      stepStudentProfiles,
      stepInterviewRubric,
      // header tools (no Connect)
      stepSearch,
      stepCatalog,
      stepUserMenu,
      stepKeith,
      stepFeedback,
      stepFinish,
    ];
  }

  // Viewer and default - conservative; Catalog is NOT shown (not visible to viewers).
  return [
    stepWelcome(firstName),
    stepCohortSwitcher,
    // workflow tabs
    stepAggregate,
    stepStudentProfiles,
    stepInterviewRubric,
    stepEvaluation,
    // header tools
    stepSearch,
    stepUserMenu,
    stepKeith,
    stepFinish,
  ];
}
