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
    interviewRubric: `The Interview Room tab manages interviews. The calendar shows scheduled interviews and availability slots. Summary cards track Total, Scheduled, Completed, In Progress, Not Scheduled, Flagged, and Recommended students. The rubric form has 7 sections: Interview Info, Unit Preferences and Rationale, Clinical Judgment, Professional Presence, Goal Alignment, Student Questions, and Overall Recommendation. Scoring uses a 1-5 scale. Auto recommendation uses majority vote of interviewers.`,
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

export function generateStaticResponse(userMessage, cohortName, context) {
  const msg = userMessage.toLowerCase();
  const cohort = cohortName || 'the current cohort';

  const nameList = (students, max = 8) => {
    if (!students || students.length === 0) return null;
    const names = students.slice(0, max).map(s => `${s.last_name}, ${s.first_name}`);
    const extra = students.length > max ? `\n...and ${students.length - max} more` : '';
    return names.join('\n') + extra;
  };

  if (msg.includes('follow-up') || msg.includes('action') || msg.includes('needs attention')) {
    if (context) {
      const items = [];
      if (context.needsStudentForm.length) items.push(`• ${context.needsStudentForm.length} student${context.needsStudentForm.length > 1 ? 's' : ''} need the student form link (Pending Outreach)`);
      if (context.needsSchedulingLink.length) items.push(`• ${context.needsSchedulingLink.length} student${context.needsSchedulingLink.length > 1 ? 's' : ''} need an interview scheduling link (Form Received)`);
      if (context.needsCsLink.length) items.push(`• ${context.needsCsLink.length} student${context.needsCsLink.length > 1 ? 's' : ''} still need CS-Link access started`);
      if (context.needsBadge.length) items.push(`• ${context.needsBadge.length} student${context.needsBadge.length > 1 ? 's' : ''} need a badge created (Placed)`);
      if (context.pendingShiftReviews) items.push(`• ${context.pendingShiftReviews} shift log${context.pendingShiftReviews > 1 ? 's' : ''} pending review`);
      if (items.length === 0) {
        return { text: `Great news! No urgent follow-up items found in ${cohort} right now. Check the Action Center for any minor items.` };
      }
      return {
        text: `Here is what needs attention in ${cohort}:\n\n${items.join('\n')}\n\nOpen the Action Center for one-click email buttons for each of these.`,
        action: { label: 'Open Action Center', type: 'bell' },
      };
    }
    return {
      text: `Open the Action Center (bell icon) to see your full follow-up list with one-click email buttons for: student forms, scheduling links, CS-Link access, unit notifications, and more.`,
      action: { label: 'Open Action Center', type: 'bell' },
    };
  }

  if (msg.includes('summarize') || msg.includes('summary') || msg.includes('overview') || (msg.includes('cohort') && !msg.includes('switch'))) {
    if (context) {
      const statusLines = Object.entries({
        'Pending Outreach':    context.needsStudentForm.length,
        'Form Received':       (context.byStatus['Form Received'] || []).length,
        'Interview Scheduled': (context.byStatus['Interview Scheduled'] || []).length,
        'Interviewed':         context.interviewed.length,
        'Placed':              context.placed.length,
        'Active Rotation':     context.activeRotation.length,
        'Completed':           context.completed.length,
        'Declined':            (context.byStatus['Declined'] || []).length,
      }).filter(([, count]) => count > 0).map(([status, count]) => `• ${status}: ${count}`).join('\n');
      return {
        text: `${cohort} Summary\n\n${context.totalStudents} total students\n${context.totalSlots} unit slots (${context.totalRemaining} remaining)\n\nStatus breakdown:\n${statusLines || '• No students yet'}\n\nOn campus today: ${context.onCampusToday.length} student${context.onCampusToday.length !== 1 ? 's' : ''}`,
        action: { label: 'Go to Aggregate', type: 'tab', tab: 'overview' },
      };
    }
    return {
      text: `Head to the Aggregate tab for a full cohort overview including slot availability, student counts by school, and placement status.`,
      action: { label: 'Go to Aggregate', type: 'tab', tab: 'overview' },
    };
  }

  if (msg.includes('ready for rotation') || msg.includes('rotation ready') || (msg.includes('placed') && !msg.includes('placement'))) {
    if (context) {
      const list = nameList(context.placed);
      return {
        text: context.placed.length === 0
          ? `No students are currently Placed in ${cohort}. Check the Embed tab to start matching.`
          : `${context.placed.length} student${context.placed.length > 1 ? 's are' : ' is'} Placed and ready for rotation:\n\n${list}\n\nBefore rotation starts, confirm CS-Link access, badge creation, and that the preceptor welcome email has been sent.`,
        action: { label: 'Go to Embed', type: 'tab', tab: 'matching' },
      };
    }
    return {
      text: `Students who are ready for rotation have ASPIRE Status of Placed or Active Rotation. Check the Embed tab for matched students and the Action Center for any pending pre-rotation items.`,
      action: { label: 'Go to Embed', type: 'tab', tab: 'matching' },
    };
  }

  if (msg.includes('cs-link') || msg.includes('cslink') || msg.includes('access')) {
    if (context) {
      const list = nameList(context.needsCsLink);
      return {
        text: context.needsCsLink.length === 0
          ? `All students in ${cohort} have CS-Link access started. Check the CS-Link Access tab to confirm completions.`
          : `${context.needsCsLink.length} student${context.needsCsLink.length > 1 ? 's need' : ' needs'} CS-Link access started:\n\n${list}\n\nGo to Student Profiles → CS-Link Access to process these.`,
        action: { label: 'Go to CS-Link Access', type: 'tab', tab: 'profiles' },
      };
    }
    return {
      text: `CS-Link access is a two-stage process. Stage 1 is a Service Center request (Add Non-Employee, Assignment Change, etc.). Stage 2 is adding CS-Link access. The Action Center flags all students from Form Received onwards who haven't had Stage 1 submitted.`,
      action: { label: 'Go to Student Profiles', type: 'tab', tab: 'profiles' },
    };
  }

  if (msg.includes('interview') && (msg.includes('need') || msg.includes('still') || msg.includes('who') || msg.includes('schedule') || msg.includes('rubric'))) {
    if (context) {
      const unscheduled = (context.byStatus['Form Received'] || []).filter(s => !s.interview_scheduled_date);
      const list = nameList(unscheduled);
      return {
        text: unscheduled.length === 0
          ? `All Form Received students in ${cohort} have their interviews scheduled. Check the Interview Room tab for upcoming interviews.`
          : `${unscheduled.length} student${unscheduled.length > 1 ? 's have' : ' has'} submitted their form but not yet scheduled an interview:\n\n${list}\n\nSend them the scheduling link from the Action Center.`,
        action: { label: 'Go to Interview Room', type: 'tab', tab: 'interviews' },
      };
    }
    return {
      text: `Check the Interview Room tab student list for Interview Status per student. The Action Center sends scheduling links with one click.`,
      action: { label: 'Go to Interview Room', type: 'tab', tab: 'interviews' },
    };
  }

  if (msg.includes('on campus') || msg.includes('campus today') || msg.includes('who is here') || msg.includes('today')) {
    if (context) {
      if (context.onCampusToday.length === 0) {
        return {
          text: `No students have logged shifts for today (${context.todayStr}) yet in ${cohort}. They log hours at /shift-log using the QR code on their badge.`,
          action: { label: 'Go to Aggregate', type: 'tab', tab: 'overview' },
        };
      }
      const campusList = context.onCampusToday.map(s => `• ${s.student.last_name}, ${s.student.first_name} – ${s.unit} (${s.shiftType}, ${s.hours} hrs)`).join('\n');
      return {
        text: `${context.onCampusToday.length} student${context.onCampusToday.length !== 1 ? 's are' : ' is'} on campus today:\n\n${campusList}`,
        action: { label: 'Go to Aggregate', type: 'tab', tab: 'overview' },
      };
    }
    return {
      text: `The On Campus Today panel in the Aggregate tab shows students who logged shifts for today using the QR code on their badge.`,
      action: { label: 'Go to Aggregate', type: 'tab', tab: 'overview' },
    };
  }

  if (msg.includes('badge')) {
    if (context && context.needsBadge.length > 0) {
      const list = nameList(context.needsBadge);
      return {
        text: `${context.needsBadge.length} Placed student${context.needsBadge.length > 1 ? 's need' : ' needs'} a badge created:\n\n${list}\n\nCreate their badges in Canva and check the Badge Created box in each student's profile under Placement and Outcomes.`,
        action: { label: 'Go to Student Profiles', type: 'tab', tab: 'profiles' },
      };
    }
    if (context && context.needsBadge.length === 0 && context.placed.length > 0) {
      return { text: `All Placed students in ${cohort} have their badges created. Great job!` };
    }
    return {
      text: `Student badges contain a universal QR code linking to /shift-log. Create them in Canva and mark Badge Created in each student's profile under Placement and Outcomes. The Action Center flags Placed students without badges.`,
      action: { label: 'Go to Student Profiles', type: 'tab', tab: 'profiles' },
    };
  }

  if (msg.includes('nearing') || msg.includes('almost done') || msg.includes('hours')) {
    if (context && context.nearingCompletion.length > 0) {
      const list = context.nearingCompletion.map(s => `• ${s.last_name}, ${s.first_name} – ${s.approved_hours}/${s.hours_required} hrs`).join('\n');
      return {
        text: `${context.nearingCompletion.length} student${context.nearingCompletion.length !== 1 ? 's are' : ' is'} nearing completion (80% or more of required hours):\n\n${list}\n\nStart preparing their post-rotation materials: survey link, certificate, and preceptor end evaluation.`,
        action: { label: 'Go to Student Profiles', type: 'tab', tab: 'profiles' },
      };
    }
  }

  if (msg.includes('unit leader') && (msg.includes('email') || msg.includes('draft') || msg.includes('notify'))) {
    return {
      text: `Here is a unit leader placement notification email template:\n\n---\n\n${ASPIRE_KNOWLEDGE.emailTemplates.unitLeader('[Student Name]', '[School]', '[Unit Name]')}`,
      hasCopy: true,
      action: { label: 'Go to Embed', type: 'tab', tab: 'matching' },
    };
  }

  if (msg.includes('student form') && (msg.includes('email') || msg.includes('draft') || msg.includes('send'))) {
    return {
      text: `Here is the student form outreach email:\n\n---\n\n${ASPIRE_KNOWLEDGE.emailTemplates.studentForm('[Student First Name]')}`,
      hasCopy: true,
    };
  }

  if (msg.includes('scheduling') || msg.includes('interview link') || (msg.includes('schedule') && msg.includes('email'))) {
    return {
      text: `Here is the interview scheduling link email:\n\n---\n\n${ASPIRE_KNOWLEDGE.emailTemplates.schedulingLink('[Student First Name]')}`,
      hasCopy: true,
    };
  }

  if (msg.includes('status') || msg.includes('journey') || msg.includes('workflow')) {
    return { text: ASPIRE_KNOWLEDGE.statusJourney };
  }

  if (msg.includes('aspire') || msg.includes('program') || msg.includes('what is')) {
    return { text: ASPIRE_KNOWLEDGE.program };
  }

  if (msg.includes('ngrp') || msg.includes('residency')) {
    return {
      text: `The NGRP (New Graduate RN Residency Program) is the career pathway ASPIRE leads into. Students who complete their rotation and are recommended after their interview are eligible to apply to the NGRP.\n\nASPIRE is one of three NGRP application pathways. The NGRP Hired field in Student Profiles tracks hiring outcomes for each student.`,
    };
  }

  return {
    text: `I'm Keith, your ASPIRE Program assistant. Try asking me:\n\n• "Who needs follow-up today?"\n• "Summarize this cohort"\n• "Who is on campus today?"\n• "Who still needs an interview?"\n• "Who is missing CS-Link access?"\n• "Draft a unit leader email"\n\nOr ask anything about ASPIRE operations.`,
  };
}

export async function getKeithContext(supabase, cohortId) {
  if (!supabase || !cohortId) return null;

  try {
    const { data: students } = await supabase
      .from('students')
      .select(`
        id, first_name, last_name, school, program_type, status,
        interview_scheduled_date, interview_outcome, auto_recommendation,
        matched_unit_id, matched_preceptor, cs_stage1_submitted,
        cs_link_complete, badge_created, approved_hours, hours_required,
        avg_composite_score, rubric_count, unit_preference_1,
        unit_preference_2, unit_preference_3
      `)
      .eq('cohort_id', cohortId);

    if (!students) return null;

    const { data: units } = await supabase
      .from('units')
      .select('id, unit_name, division, total_slots, slots_remaining, is_participating')
      .eq('cohort_id', cohortId)
      .eq('is_participating', true);

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const { data: todayShifts } = await supabase
      .from('student_shift_logs')
      .select('student_id, unit_name, shift_type, total_hours, status')
      .eq('cohort_id', cohortId)
      .eq('shift_date', todayStr)
      .eq('status', 'approved');

    const { data: pendingShifts } = await supabase
      .from('student_shift_logs')
      .select('id, student_id')
      .eq('cohort_id', cohortId)
      .eq('status', 'needs_review');

    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s; });

    const byStatus = {};
    students.forEach(s => {
      if (!byStatus[s.status]) byStatus[s.status] = [];
      byStatus[s.status].push(s);
    });

    const needsStudentForm     = byStatus['Pending Outreach'] || [];
    const needsSchedulingLink  = (byStatus['Form Received'] || []).filter(s => !s.interview_scheduled_date);
    const interviewed          = byStatus['Interviewed'] || [];
    const placed               = byStatus['Placed'] || [];
    const activeRotation       = byStatus['Active Rotation'] || [];
    const completed            = byStatus['Completed'] || [];

    const needsCsLink = students.filter(s =>
      ['Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation'].includes(s.status)
      && !s.cs_stage1_submitted
    );
    const needsBadge = students.filter(s => s.status === 'Placed' && !s.badge_created);

    const onCampusToday = (todayShifts || []).map(shift => ({
      student: studentMap[shift.student_id],
      unit: shift.unit_name,
      shiftType: shift.shift_type,
      hours: shift.total_hours,
    })).filter(s => s.student);

    const nearingCompletion = activeRotation.filter(s =>
      s.hours_required && s.approved_hours >= s.hours_required * 0.8
    );

    const totalSlots     = (units || []).reduce((sum, u) => sum + (u.total_slots     || 0), 0);
    const totalRemaining = (units || []).reduce((sum, u) => sum + (u.slots_remaining || 0), 0);
    const fullUnits      = (units || []).filter(u => (u.slots_remaining || 0) === 0);
    const availableUnits = (units || []).filter(u => (u.slots_remaining || 0) > 0);

    return {
      totalStudents: students.length,
      byStatus,
      needsStudentForm,
      needsSchedulingLink,
      interviewed,
      placed,
      activeRotation,
      completed,
      needsCsLink,
      needsBadge,
      onCampusToday,
      nearingCompletion,
      units: units || [],
      totalSlots,
      totalRemaining,
      fullUnits,
      availableUnits,
      pendingShiftReviews: (pendingShifts || []).length,
      studentMap,
      todayStr,
    };
  } catch (err) {
    console.error('Keith context error:', err);
    return null;
  }
}

// ── Knowledge exports for the API route ──────────────────────────────────────

export const PLATFORM_OVERVIEW = `
ASPIRE Intelligence is the workforce intelligence platform for the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai Medical Center, run out of the Geri and Richard Brawerman Nursing Institute.

ASPIRE places senior pre-licensure nursing students from affiliated schools (Cal State LA, APU, West Coast University, Cal State Long Beach, and others) into 90-hour bedside preceptorships across Cedars-Sinai units. Eligible students with a cumulative GPA of 3.0 or above complete the rotation and then apply early to the New Graduate RN Residency Program (NGRP) prior to RN licensure.

The platform supports four main workflows organized as tabs:
- Aggregate (A): Cohort-level dashboard and stats.
- Student Profiles (SP): Individual student records, placement, outcomes, communications.
- Interview Room (IR): Scoring, scheduling, interviewer management.
- Embed (E): Drag-and-drop matching board for student-to-unit placement.

The program is led by Jester Lloyd Bautista (Owner, NPD Practitioner) and co-led by Krystal Rodriguez (Admin).
`.trim();

export const USER_ROLES = `
User roles and permissions:
- Owner: full access, only one (Jester). Cannot be demoted.
- Admin: full access including People & Access and cohort management.
- Co-Lead: operational access, can perform placements, cannot manage users.
- Interviewer: limited to Aggregate, Student Profiles (limited view), and Interview Room. No Embed or People & Access.
- Viewer: read-only.

Interviewers can conduct interviews by default. Owner, Admin, and Co-Lead can also conduct interviews if the toggle is enabled in People & Access.
`.trim();

export const RECENT_UPDATES = `
Recent platform updates (as of May 2026):

Data and infrastructure:
- Unified StudentAvatar component renders uploaded photos when available, falls back to Nightfall initials. Used everywhere students appear.
- Owner avatar upload wired up: user_profiles.avatar_url updates via update_my_avatar RPC and displays in the navbar.
- RLS recursion bug on user_profiles fixed: replaced recursive owner-check policies with is_current_user_owner() security definer function.
- Dylan Cline status corrected from "Placed" to the correct status; all 3 program events (form_received, interview, placement) confirmed in the database.

Embed tab (matching board):
- Unified dark toolbar across Unit Pool and Student Pool with a centered divider.
- View Status Legend info icon relocated to the light subheader next to the student count to prevent clipping.
- Two-zone student cards with name/school/pills on the left and Top 3 Unit Choices on the right.
- Choice color system: muted emerald (1st), gold (2nd), periwinkle (3rd). Navy headers, subtle accent borders.
- Notify Unit Leader and per-slot envelope buttons now correctly mark matches as notified in Supabase and open mailto in a new tab.

Interview Center (Interview Room tab):
- Month-view calendar with fixed 88px cell heights so cells never expand.
- Max 2 visible event pills per cell with a clickable overflow popover.
- Compact time-first pill labels with status or interviewer initials.
- Interviewer legend moved into the controls row as a rounded pill next to Focus Table View.
- Loading, error, and empty states added with a Refresh button.

People & Access drawer (formerly User Management):
- Renamed to People & Access.
- Filter chips replace the search box: All Users, Active, Interviewers, Inactive, Owners/Admins.
- Users sorted by role hierarchy (Owner, Admin, Co-Lead, Interviewer, Viewer), inactive at bottom.
- Owner account protected: cannot be demoted or deactivated.
- Interview Calendar Color picker uses single labeled swatches (Navy, Emerald, Teal, Gold, Plum, Rose, Slate, Forest, Burgundy, Sienna).

Gantt chart (Aggregate tab):
- Program timeline now correctly loads from program_events with explicit loading and empty states.
`.trim();

export const TECHNICAL_STACK = `
Technical stack:
- React + Vite frontend deployed via Vercel from github.com/jesterlloyd/aspire-tracker.
- Supabase PostgreSQL backend with Row Level Security.
- Tables: students, cohorts, units, matches, interview_rubrics, interview_sessions, interview_slots, interview_availability_blocks, interviewers, communications, student_shift_logs, program_events, ngrp_outcomes, preceptors, cohort_snapshots, user_profiles, activity_logs.
- Views: cohort_conversion_funnel, school_pipeline_yield.
- Storage buckets: student-files (headshots, documents), avatars (admin profile photos).
- Authentication via Supabase auth, user_profiles linked through auth_user_id.
`.trim();

export const KEY_POLICIES = `
Key program policies:
- ASPIRE is strictly pre-licensure (BSN, ABSN, LVN-to-BSN, MECN, ELMN). RN-to-BSN programs are excluded.
- Minimum cumulative GPA: 3.0 on a 4.0 scale.
- 90-hour rotation requirement.
- ASPIRE-to-NGRP conversion is the key outcome metric.
- The Graduate Nurse Trainee (GNT) role is being restructured as the Nurse Interim Permittee (NIP). Reference cautiously as this is pending.
- Never use em dashes in program communications. Use commas, colons, semicolons, or parentheses instead.
- Never fabricate student data. Only reference students by name when their data appears in live context.
`.trim();

export const TEAM_ROSTER = `
Current ASPIRE Intelligence team members and their roles:

Owner:
- Jester Lloyd Bautista, NPD Practitioner (JesterLloyd.Bautista@cshs.org)

Admin:
- Krystal Rodriguez (Krystal.Rodriguez@cshs.org)

Interviewers:
- Arturo Gomez (arthur.gomez@cshs.org)
- Jennifer Gidaya (jennifermarie.gidaya@cshs.org)
- Keith Hoshal (keith.hoshal@cshs.org)
- Millicent De Jesus (millicent.dejesus@cshs.org)
- Robert Viana (Robert.Viana@cshs.org), joining May 2026
- Rebecca Ely (Rebecca.Ely@cshs.org), joining May 2026
- Anupa Roshan (Anupa.Roshan@cshs.org), joining May 2026
- Jodi Traver (Jodi.Traver@cshs.org), joining May 2026

Viewer:
- Michael Balot (Michael.Balot@cshs.org), joining May 2026

When Keith recognizes one of these users from the logged-in profile, greet them by first name and tailor responses to their role. Interviewer-role users should be guided toward the Interview Center, availability blocks, rubric scoring, and student preparation. Viewer-role users have read-only access and should not be advised on actions like editing or placement.

The Summer 2026 ASPIRE cohort is preparing for student interviews in the coming two weeks. New interviewers may need orientation on creating availability blocks and using the interview rubric.
`.trim();

export const BNI_ORGANIZATION = `
The Geri and Richard Brawerman Nursing Institute (BNI) at Cedars-Sinai Medical Center is a centralized group of educators that operates separately from unit-based educators (NPD-Practitioners and Clinical Nurse Specialists assigned to individual units like NICU, ICU, etc.).

BNI is structured into three branches:
- Nursing Education (where ASPIRE and all NPD-Practitioner programs sit)
- Nursing Research
- Nursing Innovation

Leadership and Administration:
- Executive Director: Margo B. Minissian, PhD, ACNP-BC, NEA-BC, FAHA, FAAN. Also holds the Simms/Mann Family Foundation Endowed Chair in Nurse Education, Innovation and Research, and is Assistant Professor of Cardiology. Contact: Margo.Minissian@cshs.org, 310-384-0126.
- Lead Administrative Assistant: Belle Velasquez. Contact: Belle.Velasquez@cshs.org, 323-574-2190.

Project / Program Coordinators (support the NPD-Practitioners):
- Michael Balot (Michael.Balot@cshs.org, 310-422-6599): supports Nursing Academics, Patient Education, and the Nursing Research Council.
- Andrew Gordon, BSN, MSHS (AndrewCharles.Gordon@cshs.org, 323-369-1665): supports the New Graduate RN Residency Program, CPR Program, Nursing Professional Governance, Clinical Partner Program, and Professional Development Fair.

Nursing Professional Development Practitioners (NPD-Ps) and their programs:

1. Jodi Traver, PhD, RN, PHN, NE-BC, NPD-BC (Jodi.Traver@cshs.org, 858-283-9683)
   - Patient Education Chair
   - Nursing Academics (Post-licensure)
   - Nursing Continuing Education

2. Anupa Roshan, DNP, MSN, RN, CCRN, NPD-BC (Anupa.Roshan@cshs.org, 310-699-3256)
   - CPR Program
   - Nurses Improving Care for Healthsystem Elders (NICHE) Program

3. Robert Viana, MSN, RN, NPD-BC, Caritas Coach (Robert.Viana@cshs.org, 323-449-0699)
   - Practice Transition Accreditation Program (PTAP) Director
   - Co-oversees the New Graduate RN Residency Program with Jennifer Gidaya

4. Jennifer Marie Gidaya, MSN, RN, MEDSURG-BC, Caritas Coach (JenniferMarie.Gidaya@cshs.org, 310-800-0679)
   - New Graduate RN Residency Program Site Coordinator

5. Kathleen Burgner, MSN/MBA, RNC-MNN (Kathleen.Burgner@cshs.org, 310-739-1987)
   - NPD-P lead for the Professional Development Committee (PDC)
   - Spearheads the No Harm in Our Care Committee

6. Terrance Lark, MSN, RN, CGRN (Terrance.Lark@cshs.org, 323-301-5544)
   - Clinical Partner Program lead
   - Works with Kathleen on assigning HealthStream courses to staff across the organization

7. Krystal Sophia Rodriguez, DNP, RN, NPD-BC, CNOR (Krystal.Rodriguez@cshs.org, 909-618-6150)
   - Preceptor Program lead
   - Advisor to the Preceptor Committee
   - Charge Nurse Program lead
   - Member of the Nursing Research Council
   - NPD-P lead for "Falls" under the No Harm in Our Care Committee
   - Co-lead for the ASPIRE Program

8. Millicent G. De Jesus, PhD, RN, NPD-BC (Millicent.DeJesus@cshs.org, 310-717-8904)
   - NPD-P lead for the Transition to Practice (TTP) Committee
   - Spearheads the Learning Needs Assessment Survey
   - Member of the Nursing Research Council

9. Arturo Gomez, MSN, MBA, RN, PMHNP-BC, NPD-BC, CCRN (Arthur.Gomez@cshs.org, 424-610-1183)
   - Nursing Academics (Pre-licensure) lead

10. Rebecca Ely, DNP, RN, NPD-BC (Rebecca.Ely@cshs.org, 323-541-3323)
    - Nursing Professional Governance (NPG) Lead
    - Mentorship Program Lead
    - Caritas Coach
    - NPD-P lead for "HAI (CAUTI / CLABSI)" under the No Harm in Our Care Committee

11. Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN (JesterLloyd.Bautista@cshs.org, 424-386-5004)
    - ASPIRE Program lead
    - Preceptor Program co-lead
    - Assists Kathleen with Professional Development rollouts
    - NPD-P lead for "HAPI" under the No Harm in Our Care Committee
    - Part of Nursing Academics (Pre-licensure) alongside Arturo, Jodi, and Michael

12. Keith Hoshal, MSN, RN, NPD-BC, OCN (Keith.Hoshal@cshs.org, 310-435-3935)
    - Title: Project Associate Prdm, per diem, advisor role
    - Previously ran the ASPIRE Program when it was called the Graduate Nurse Trainee Transition to Practice (GNT-TTP) Program, before Jester renamed and restructured it as ASPIRE

Key cross-program collaborations:
- ASPIRE: Jester (lead) and Krystal (co-lead)
- Preceptor Program: Krystal (lead) and Jester (co-lead)
- New Grad RN Residency: Robert (oversees) and Jennifer (site coordinator)
- Nursing Academics Pre-licensure: Arturo (lead), Jester, Jodi, and Michael
- No Harm in Our Care Committee: Kathleen (chair), Krystal (Falls), Jester (HAPI), Rebecca (HAI - CAUTI / CLABSI)
- HealthStream coordination: Kathleen and Terrance
- Nursing Research Council: Krystal, Millicent, Michael
`.trim();

/**
 * Builds the full system prompt for Keith, merging platform knowledge,
 * live cohort context, and the logged-in user's identity.
 */
export function buildSystemPrompt({ userProfile, context, cohortName, liveDataStr } = {}) {
  const cohort = cohortName || 'the current cohort';

  // ── User context ──────────────────────────────────────────────────────
  const firstName = userProfile?.full_name?.split(' ')[0] || null;
  const role      = userProfile?.role || 'user';
  const isPrivileged = userProfile?.is_owner === true || role === 'admin';

  const userContext = userProfile ? `
The user currently logged in is ${userProfile.full_name} (role: ${role}, email: ${userProfile.email}).
Greet them by their first name (${firstName}) when it feels natural, especially at the start of a conversation.
${isPrivileged
    ? 'They have full access including strategic, operational, and user management details. Provide complete answers.'
    : role === 'co-lead'
      ? 'They are a Co-Lead and can perform placements and manage students but cannot manage users or cohorts.'
      : role === 'interviewer'
        ? 'They are an Interviewer. Focus responses on interview scheduling, rubric scoring, and student preparation. Do not discuss matching decisions, unit placement, or user management.'
        : 'They have limited access. Keep responses focused on what they can act on.'}
`.trim() : 'No user context available. Respond generically.';

  // ── Live cohort data ──────────────────────────────────────────────────
  const safeList = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return 'None';
    return arr.map(s => `${s.last_name || '?'}, ${s.first_name || '?'}`).join('; ');
  };

  let liveData = liveDataStr || 'LIVE COHORT DATA: Not available.';
  if (!liveDataStr && context) {
    try {
      const statusSummary = Object.entries(context.byStatus || {})
        .map(([s, arr]) => `  ${s}: ${Array.isArray(arr) ? arr.length : 0}`)
        .join('\n');
      const onCampus = Array.isArray(context.onCampusToday) && context.onCampusToday.length > 0
        ? context.onCampusToday.map(s => `${s.student?.last_name}, ${s.student?.first_name} at ${s.unit} (${s.shiftType})`).join('; ')
        : 'None today';
      const activeList = Array.isArray(context.activeRotation) && context.activeRotation.length > 0
        ? context.activeRotation.map(s => `${s.last_name}, ${s.first_name} (${s.approved_hours || 0}/${s.hours_required || 0} hrs)`).join('; ')
        : 'None';
      liveData = `LIVE COHORT DATA (${cohort}):
Total students: ${context.totalStudents || 0}
Unit slots: ${context.totalSlots || 0} total, ${context.totalRemaining || 0} remaining
Status breakdown:
${statusSummary || '  No data'}
On campus today: ${onCampus}
Needs student form: ${safeList(context.needsStudentForm)}
Needs scheduling link: ${safeList(context.needsSchedulingLink)}
Needs CS-Link started: ${safeList(context.needsCsLink)}
Needs badge created: ${safeList(context.needsBadge)}
Placed: ${safeList(context.placed)}
Active rotation: ${activeList}
Completed: ${safeList(context.completed)}
Pending shift log reviews: ${context.pendingShiftReviews || 0}`;
    } catch (e) {
      liveData = `LIVE COHORT DATA: Error composing context (${e.message})`;
    }
  }

  return `
You are Keith, the AI assistant for ASPIRE Intelligence at Cedars-Sinai, named in honor of Keith Hoshal who created the ASPIRE Program. You are warm, direct, professional, and grounded. Use natural prose. Never use em dashes; use commas, colons, semicolons, or parentheses instead.

${PLATFORM_OVERVIEW}

ASPIRE STATUS JOURNEY (9 canonical stages):
Pending Outreach -> Form Sent -> Form Received -> Interview Scheduled -> Interviewed -> Placed -> Active Rotation -> Completed -> Declined. Status automations: Form Received fires on /student-form submit, Interview Scheduled fires on /interview-schedule booking, Interviewed fires on rubric submission, Placed fires on Embed match.

${USER_ROLES}

${BNI_ORGANIZATION}

${TEAM_ROSTER}

${RECENT_UPDATES}

${TECHNICAL_STACK}

${KEY_POLICIES}

CS-LINK: Stage 1 for new students is Add Non-Employee. Former students need Assignment Change, Extend End Date, or Reactivate. Cedars employees skip Stage 1. Stage 2 is Add CS-Link for everyone.

SHIFT LOG: Students log hours at /shift-log using the QR code on their badge. Shift types: Day, Night, Mid. Hours auto-approved unless flagged. Certificate of Completion surfaces in the Action Center when approved_hours >= hours_required.

RESPONSE STYLE: Be concise and practical, under 200 words unless drafting a full email. Always suggest a concrete next action. Use Last Name, First Name format for student lists. Never fabricate student data. Only reference students by name when their data appears in the live context below.

${userContext}

${liveData}
Current cohort: ${cohort}
`.trim();
}

// ── Communication history (reads from notification_log) ───────────────────────

export async function getRecentCommunications(supabase, options = {}) {
  const { limit = 50, sinceDays = 30 } = options;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - sinceDays);

  const { data, error } = await supabase
    .from('notification_log')
    .select('id, notification_type, audience, recipient_email, recipient_role, recipient_name, student_id, cohort_id, subject, status, sent_at, delivered_at, opened_at, metadata')
    .gte('sent_at', sinceDate.toISOString())
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[keithKnowledge] failed to load communications:', error);
    return [];
  }
  return data || [];
}

export async function getStudentCommunications(supabase, studentId) {
  if (!studentId) return [];

  const { data, error } = await supabase
    .from('notification_log')
    .select('notification_type, audience, recipient_email, recipient_role, subject, status, sent_at, delivered_at, opened_at')
    .eq('student_id', studentId)
    .order('sent_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('[keithKnowledge] failed to load student communications:', error);
    return [];
  }
  return data || [];
}

// ── School coordinator roster (for Keith AI awareness) ────────────────────────
import { getAllSchoolCoordinators } from './notifications/recipients.js';

export function getSchoolCoordinators() {
  return getAllSchoolCoordinators();
}
