/**
 * Keith - ASPIRE Program Assistant
 * Phase 1: Static knowledge responses (current)
 * Phase 2: Live Supabase data context (pass cohort data to generateResponse)
 * Phase 3: AI-powered responses via Vercel API route at /api/keith.js
 *   - POST { messages, context } → Anthropic claude-sonnet-4-20250514
 *   - API key stored as ANTHROPIC_API_KEY in Vercel environment (server-side only)
 *   - Never expose API key in VITE_ prefixed variables
 */

export const ASPIRE_KNOWLEDGE = {
  program: `The ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience) is a senior nursing student placement program at Cedars-Sinai Medical Center. It offers students a hands-on bedside clinical rotation, pairs them with experienced preceptors, and provides a pathway into the New Graduate RN Residency Program (NGRP). The program is led by Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN and Krystal Rodriguez, DNP, RN, NPD-BC, CNOR.`,

  statusJourney: `Students move through these ASPIRE statuses in order:
1. Pending Outreach – Added to the system, not yet contacted
2. Form Sent – Student form link sent to the student
3. Form Received – Student submitted their personal information and unit preferences
4. Interview Scheduled – Interview booked on the calendar
5. Interviewed – All rubrics submitted and scored
6. Placed – Matched to a unit and preceptor in the Embed board
7. Active Rotation – Currently completing their clinical hours
8. Completed – Rotation finished, certificate pending
9. Declined – Did not pass interview or withdrew`,

  tabs: {
    aggregate: `The Aggregate tab shows the program overview: Clinical Placement Availability (units by division with slot counts) and Student Placement Requests (students grouped by school). It includes summary cards for Total Slots, Slots Filled, Slots Remaining, Students Requesting, and Gap. It also shows the On Campus Today panel for students who logged shifts today.`,
    studentProfiles: `The Student Profiles tab shows two views: Profiles (student list with side panel detail) and CS-Link Access (bulk access workflow table). The student list shows avatars, names, school, program, contact info, GPA, ASPIRE status, and CS-Link status. The side panel shows full profile with all sections including CS-Link workflow, Clinical Hours, Documents, and Communication History.`,
    interviewRubric: `The Interview Rubric tab manages interviews. The calendar shows scheduled interviews and availability slots. Summary cards track Total, Scheduled, Completed, In Progress, Not Scheduled, Flagged, and Recommended students. The rubric form has 7 sections: Interview Info, Unit Preferences and Rationale, Clinical Judgment, Professional Presence, Goal Alignment, Student Questions, and Overall Recommendation. Scoring uses a 1-5 scale. Auto recommendation uses majority vote of interviewers.`,
    embed: `The Embed tab is the matching board. The Unit Pool shows unit cards with open slot pills. The Student Pool shows unmatched students. Clicking a student highlights compatible units based on their preferences. Clicking an empty slot creates a match. Unit leader email notifications are sent from this tab.`,
  },

  csLinkWorkflow: `CS-Link Access is a two-stage process. Stage 1 is a Service Center request: new students need Add Non-Employee, former students need Assignment Change, Extend End Date, or Reactivate. Cedars employees skip Stage 1. Stage 2 is adding CS-Link access for all students. The Action Center flags students from Form Received onwards who have not yet had Stage 1 submitted.`,

  shiftLog: `Students log clinical hours at /shift-log using a universal QR code on their badge. They enter their school email, verify their identity, then submit a shift: date, hours worked, shift type (Day or Night), unit, preceptor, optional learning highlight, and optional concern. Hours are auto-approved unless flagged for exceptions (over 13 hours, under 2 hours, outside rotation dates, unit mismatch with non-matching preceptor). The On Campus Today panel in Aggregate shows students who logged shifts for today.`,

  actionCenter: `The Action Center (bell icon in the header) shows 12 categories of items needing attention: Send Student Form, Send Interview Scheduling Link, Interview Reminder, Unit Leader Placement Notification, Preceptor Welcome Email, CS-Link Not Started, Orientation Email and Pre-Program Survey, Midpoint Student Check-In, Midpoint Preceptor Evaluation, Post-Program Student Survey, Certificate of Completion, and End Preceptor Evaluation. Each item has a one-click email button that opens a pre-filled mailto draft.`,

  ngrpPathway: `The ASPIRE Program is one pathway into the Cedars-Sinai New Graduate RN Residency Program (NGRP). Students who complete their rotation and pass their interview are eligible to apply to the NGRP. The NGRP Hired field in Student Profiles tracks hiring outcomes.`,

  eligibility: `To qualify for ASPIRE, students must: be in their final semester of an accredited BSN or Master's Entry pre-licensure nursing program affiliated with Cedars-Sinai, have a cumulative GPA of 3.0 or above, commit to at least 90 hours of hands-on bedside rotation, and meet all educational, health, and background standards.`,

  forms: {
    unitForm: `/unit-form – Submitted by unit leaders to indicate participation, slot count, shift preference, and preceptor names.`,
    schoolForm: `/school-form – Submitted by school coordinators with student rosters: name, school email, program, term dates, hours required, graduation date.`,
    studentForm: `/student-form – Submitted by students with personal info, GPA, shift preference, interest statement, and top 3 unit preferences.`,
    shiftLog: `/shift-log – Students log clinical hours after each shift using a universal QR code.`,
    interviewSchedule: `/interview-schedule – Students book their own interview slot from available times set by the ASPIRE team.`,
  },

  emailTemplates: {
    studentForm: (name) => `Subject: ASPIRE Program Student Form – Action Required\n\nDear ${name || '[Student First Name]'},\n\nYou have been identified as a potential candidate for the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai Medical Center.\n\nTo begin the process, please complete your ASPIRE Student Profile:\nhttps://aspire-tracker.vercel.app/student-form\n\nThis form collects your personal information, clinical interests, and unit preferences. It should take approximately 10 to 15 minutes.\n\nIf you have any questions, please don't hesitate to reach out.\n\nWarm regards,\nJester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN\nNursing Professional Development Practitioner\nGeri and Richard Brawerman Nursing Institute\nJesterLloyd.Bautista@cshs.org | 310-248-8964`,

    schedulingLink: (name) => `Subject: Schedule Your ASPIRE Interview\n\nDear ${name || '[Student First Name]'},\n\nThank you for completing your ASPIRE Student Profile. The next step is to schedule your interview with our Nursing Professional Development team.\n\nPlease use the link below to view available times:\nhttps://aspire-tracker.vercel.app/interview-schedule\n\nWhen prompted, enter your school email address to access the scheduling page.\n\nIf you have any questions, please don't hesitate to reach out.\n\nWarm regards,\nJester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN\nNursing Professional Development Practitioner\nGeri and Richard Brawerman Nursing Institute\nJesterLloyd.Bautista@cshs.org | 310-248-8964`,

    interviewReminder: (name, date, time) => `Subject: Reminder: Your ASPIRE Interview is Coming Up\n\nDear ${name || '[Student First Name]'},\n\nThis is a friendly reminder that your ASPIRE interview is scheduled for:\n\nDate: ${date || '[Interview Date]'}\nTime: ${time || '[Interview Time]'} Pacific Time\nFormat: Microsoft Teams\n\nPlease ensure you are in a quiet, professional setting with a stable internet connection.\n\nWe look forward to speaking with you!\n\nWarm regards,\nJester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN\nNursing Professional Development Practitioner\nGeri and Richard Brawerman Nursing Institute\nJesterLloyd.Bautista@cshs.org | 310-248-8964`,

    unitLeader: (studentName, school, unit) => `Subject: ASPIRE Program Student Placement – ${studentName || '[Student Name]'} | ${unit || '[Unit Name]'}\n\nDear [Unit Leader],\n\nThank you for your continued support of the ASPIRE Program at Cedars-Sinai.\n\nWe are pleased to inform you that we have matched the following student to your unit:\n\nStudent: ${studentName || '[Student Name]'}\nSchool: ${school || '[School]'}\nUnit: ${unit || '[Unit Name]'}\n\nPlease confirm with your team which preceptor will be assigned and reply to this email so we can coordinate next steps.\n\nThank you for your support of clinical nursing education at Cedars-Sinai.\n\nWarm regards,\nJester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN\nNursing Professional Development Practitioner\nGeri and Richard Brawerman Nursing Institute\nJesterLloyd.Bautista@cshs.org | 310-248-8964`,
  },
};

export const SUGGESTED_PROMPTS = [
  { label: 'Who needs follow-up today?', category: 'action' },
  { label: 'Summarize this cohort.', category: 'summary' },
  { label: 'Who is ready for rotation?', category: 'readiness' },
  { label: 'Who is missing CS-Link access?', category: 'cslink' },
  { label: 'Who still needs an interview?', category: 'interview' },
  { label: 'Who is on campus today?', category: 'campus' },
  { label: 'Draft a unit leader notification email.', category: 'email' },
  { label: 'Draft a student form email.', category: 'email' },
  { label: 'Explain the ASPIRE status journey.', category: 'info' },
  { label: 'How does CS-Link access work?', category: 'info' },
];

export function generateStaticResponse(userMessage, cohortName) {
  const msg = userMessage.toLowerCase();
  const cohort = cohortName || 'the current cohort';

  if (msg.includes('follow-up') || msg.includes('action') || msg.includes('needs attention')) {
    return {
      text: `Here are the most common follow-up actions in the Action Center:\n\n• Students with status Pending Outreach need their student form link sent.\n• Students with Form Received but no scheduled interview need the scheduling link.\n• Placed students with no CS-Link submission started need Service Center action.\n• Placed students whose unit leader has not been notified need the placement email.\n\nOpen the Action Center (bell icon) to see your full list with one-click email buttons.`,
      action: { label: 'Open Action Center', type: 'bell' },
    };
  }

  if (msg.includes('summarize') || msg.includes('summary') || msg.includes('overview') || msg.includes('cohort')) {
    return {
      text: `To get a full summary of ${cohort}, head to the Aggregate tab. You will see:\n\n• Total slots available across all participating units\n• How many slots are filled and remaining\n• Total students requesting placement\n• Students grouped by school with placement status\n• The On Campus Today panel for active rotation students\n\nFor a student-by-student breakdown, the Student Profiles tab with the Needs Attention filter is the best starting point.`,
      action: { label: 'Go to Aggregate', type: 'tab', tab: 'overview' },
    };
  }

  if (msg.includes('ready for rotation') || msg.includes('rotation ready') || msg.includes('placed')) {
    return {
      text: `Students who are ready for rotation have ASPIRE Status of Placed or Active Rotation. They have been matched to a unit in the Embed board and have a preceptor assigned.\n\nBefore rotation starts, confirm:\n✓ CS-Link access is complete\n✓ Badge has been created\n✓ Preceptor welcome email has been sent\n✓ Orientation email with pre-program survey has been sent\n\nCheck the Action Center for any of these that are still pending.`,
      action: { label: 'Go to Embed', type: 'tab', tab: 'matching' },
    };
  }

  if (msg.includes('cs-link') || msg.includes('cslink') || msg.includes('access')) {
    return {
      text: `CS-Link access is a two-stage process:\n\nStage 1 – Service Center Request:\n• New students: Submit Add Non-Employee\n• Former students: Submit Assignment Change, Extend End Date, or Reactivate\n• Current Cedars employees: Skip Stage 1\n\nStage 2 – Add CS-Link Access (everyone)\n\nThe Action Center flags all students from Form Received onwards who haven't had Stage 1 submitted. Go to Student Profiles → CS-Link Access for the bulk tracking table.`,
      action: { label: 'Go to CS-Link Access', type: 'tab', tab: 'profiles' },
    };
  }

  if (msg.includes('interview') || msg.includes('rubric') || msg.includes('scheduled')) {
    return {
      text: `Students who still need an interview have ASPIRE Status of Form Received or Interview Scheduled (but not yet Interviewed).\n\nTo manage interviews:\n• The Interview Rubric tab calendar shows all scheduled and available slots\n• The student list shows Interview Status per student\n• Use the Action Center to send scheduling links to Form Received students in one click\n• The Availability Manager lets you create bookable slots for students to self-schedule`,
      action: { label: 'Go to Interview Rubric', type: 'tab', tab: 'interviews' },
    };
  }

  if (msg.includes('on campus') || msg.includes('campus today') || msg.includes('who is here')) {
    return {
      text: `The On Campus Today panel in the Aggregate tab shows every student who submitted a shift log for today's date with an approved status.\n\nStudents log their shifts at /shift-log using the QR code on their badge. If you do not see a student you expected, they may not have logged their shift yet today, or their shift log may be pending review.\n\nYou can also check the Clinical Hours section in any student's profile to see their full shift history.`,
      action: { label: 'Go to Aggregate', type: 'tab', tab: 'overview' },
    };
  }

  if (msg.includes('unit leader') && (msg.includes('email') || msg.includes('draft') || msg.includes('notify'))) {
    return {
      text: `Here is a unit leader placement notification email template. Fill in the student and unit details before sending:\n\n---\n\n${ASPIRE_KNOWLEDGE.emailTemplates.unitLeader('[Student Name]', '[School]', '[Unit Name]')}`,
      hasCopy: true,
      action: { label: 'Go to Embed', type: 'tab', tab: 'matching' },
    };
  }

  if (msg.includes('student form') && (msg.includes('email') || msg.includes('draft') || msg.includes('send'))) {
    return {
      text: `Here is the student form outreach email template:\n\n---\n\n${ASPIRE_KNOWLEDGE.emailTemplates.studentForm('[Student First Name]')}`,
      hasCopy: true,
    };
  }

  if (msg.includes('scheduling') || msg.includes('interview link') || (msg.includes('schedule') && msg.includes('email'))) {
    return {
      text: `Here is the interview scheduling link email template:\n\n---\n\n${ASPIRE_KNOWLEDGE.emailTemplates.schedulingLink('[Student First Name]')}`,
      hasCopy: true,
    };
  }

  if (msg.includes('status') || msg.includes('journey') || msg.includes('workflow')) {
    return {
      text: `The ASPIRE Status Journey has 9 stages:\n\n1. Pending Outreach – Added, not yet contacted\n2. Form Sent – Form link sent\n3. Form Received – Student submitted their profile\n4. Interview Scheduled – Interview booked\n5. Interviewed – All rubrics complete\n6. Placed – Matched to a unit\n7. Active Rotation – Currently on their rotation\n8. Completed – Rotation finished\n9. Declined – Did not proceed\n\nStatuses update automatically when you take actions in the app. Active Rotation and Completed are set manually.`,
    };
  }

  if (msg.includes('aspire') || msg.includes('program') || msg.includes('what is')) {
    return {
      text: `The ASPIRE Program stands for Affiliate Students' Pathway from Internship to Residency Experience. It is a senior nursing student placement program at Cedars-Sinai Medical Center.\n\nASPIRE offers final-semester students a hands-on bedside clinical rotation, pairs them with experienced preceptors, and provides a clear pathway into the New Graduate RN Residency Program (NGRP).\n\nThe program supports students from 7 affiliated schools across BSN, ABSN, MECN, and ELMN programs. Students must have a 3.0 GPA or above and commit to a minimum of 90 clinical hours.`,
    };
  }

  if (msg.includes('badge')) {
    return {
      text: `Student badges contain a universal QR code that links to /shift-log, where students log their clinical hours. The QR code is the same for all students.\n\nYou create badges in Canva using your existing template. The app tracks badge status (created or not) in the Student Profile under Placement and Outcomes.\n\nThe Action Center flags Placed students whose badge has not been created yet.`,
      action: { label: 'Go to Student Profiles', type: 'tab', tab: 'profiles' },
    };
  }

  if (msg.includes('ngrp') || msg.includes('residency')) {
    return {
      text: `The NGRP (New Graduate RN Residency Program) is the career pathway ASPIRE leads into. Students who complete their rotation and are recommended after their interview are eligible to apply to the NGRP.\n\nASPIRE is one of three NGRP application pathways. The NGRP Hired field in Student Profiles tracks hiring outcomes for each student.`,
    };
  }

  return {
    text: `I'm Keith, your ASPIRE Program assistant. I can help with:\n\n• Summarizing cohort status\n• Identifying students who need follow-up\n• Explaining the ASPIRE workflow and status journey\n• Drafting common ASPIRE emails\n• Explaining the CS-Link access process\n• Answering questions about any tab in the app\n\nTry one of the suggested prompts below, or ask me anything about ASPIRE operations.`,
  };
}
