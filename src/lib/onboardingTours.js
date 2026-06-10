export const TOUR_VERSION = 'v1';

// ── Step definitions ─────────────────────────────────────────────────────────

const stepWelcome = (firstName) => ({
  target: 'body',
  placement: 'center',
  disableBeacon: true,
  title: `Welcome, ${firstName}!`,
  content: "This is ASPIRE Intelligence, your workspace for the ASPIRE Program. This short tour walks you through the areas you'll use most.",
});

const stepCohortSwitcher = {
  target: '[data-tour="cohort-switcher"]',
  title: 'Cohort Switcher',
  content: 'Switch between active and past ASPIRE cohorts here. Most of the app scopes to the selected cohort.',
};

const stepAggregate = {
  target: '[data-tour="tab-aggregate"]',
  title: 'Start here: Aggregate',
  content: 'This dashboard gives you a real-time overview of the active cohort: placement activity, student requests, on-campus logs, and program status.',
};

const stepStudentProfiles = {
  target: '[data-tour="tab-student-profiles"]',
  title: 'Student Profiles',
  content: 'Review student records before interviews: school, program, interest statement, GPA, and unit preferences. The side panel shows the full profile.',
};

const stepInterviewRubric = {
  target: '[data-tour="tab-interview-rubric"]',
  title: 'Interview Room',
  content: 'View scheduled interviews, open a student session, complete the rubric (Clinical Judgment, Professional Presence, Goal Alignment), and submit your recommendation.',
};

const stepEmbed = {
  target: '[data-tour="tab-embed"]',
  title: 'Rotations: Matching Board',
  content: 'The drag-and-drop board for assigning students to units based on their preferences. Available to Owner, Admin, and Co-Lead roles.',
};

// WS2.3: stepPeopleAccess was removed. Its target [data-tour="people-access"] was the
// standalone header icon, retired in WS2.2a; People & Access now lives only inside the
// UserMenu dropdown (a hidden item — not a reliable tour target) and Settings → Accounts
// & Access. No safe, non-confusing visible target remains, so the privileged tour drops
// this step. TOUR_VERSION is intentionally NOT bumped: a completed privileged user is not
// required to retake the tour for one fewer step (see report). The internal step
// identifier is not referenced elsewhere.

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
  title: 'Global Search',
  content: 'Find any student, school, or unit from anywhere in the app. Results jump directly to the relevant tab.',
};

const stepKeith = {
  target: '[data-tour="keith-orb"]',
  title: 'Keith, your AI assistant',
  content: 'Ask Keith anything about the platform: workflows, recent changes, who handles what, or how to complete a task. Available bottom-right.',
};

const stepFeedback = {
  target: '[data-tour="feedback-button"]',
  title: 'Share Feedback',
  content: 'Found a bug or have a suggestion? Tap here to send it directly to the program leads.',
};

const stepUserMenu = {
  target: '[data-tour="user-profile"]',
  title: 'Your Profile',
  content: 'View your role, manage your profile photo, restart this tour anytime, or sign out.',
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

  if (isPrivileged) {
    return [
      stepWelcome(firstName),
      stepCohortSwitcher,
      stepAggregate,
      stepStudentProfiles,
      stepInterviewRubric,
      stepEmbed,
      stepActionCenter,
      stepSearch,
      stepKeith,
      stepFeedback,
      stepUserMenu,
      stepFinish,
    ];
  }

  if (role === 'interviewer') {
    return [
      stepWelcome(firstName),
      stepCohortSwitcher,
      stepAggregate,
      stepStudentProfiles,
      stepInterviewRubric,
      stepActionCenter,
      stepSearch,
      stepKeith,
      stepFeedback,
      stepUserMenu,
      stepFinish,
    ];
  }

  // Viewer and default
  return [
    stepWelcome(firstName),
    stepCohortSwitcher,
    stepAggregate,
    stepStudentProfiles,
    stepInterviewRubric,
    stepSearch,
    stepKeith,
    stepUserMenu,
    stepFinish,
  ];
}
