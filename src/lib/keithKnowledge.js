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
    aggregate: `The Aggregate tab shows the program overview: Placement Capacity (units by division with response status and slot counts) and Placement Requests (students grouped by school). It includes summary cards for Total Slots, Slots Filled, Slots Remaining, Students Requesting, and Gap. It also shows the On Campus Today panel for students who logged shifts today.`,
    studentProfiles: `The Student Profiles tab shows two views: Profiles (student list with side panel detail) and CS-Link Access (bulk access workflow table). The student list shows avatars, names, school, program, contact info, GPA, ASPIRE status, and CS-Link status. The side panel shows full profile with all sections including CS-Link workflow, Clinical Hours, Documents, and Communication History.`,
    interviewRubric: `The Interview Room (IR tab) manages interviews. Above the worklist: a booking calendar, interview slot management, and six KPI filter cards (Total, Scheduled, Completed, Not Scheduled, Flagged, Recommended). The worklist below the KPIs is five columns: Student (avatar, name, school/program), Appointment (date/time and interviewer or "Not Scheduled"), Workflow Status (ASPIRE Stage pill + Teams Invite chip), Outcome (rubric count, average score, recommendation), and Action (contextual button: Schedule, Send Invite, Review Flag, or empty when row-click suffices). Clicking a row opens the rubric session for that student. Flagged rows show an amber or red flag chip at the left edge with a hover-revealed reason. Student and Appointment columns are sortable. The rubric form has 7 sections: Interview Info, Unit Preferences and Rationale, Clinical Judgment, Professional Presence, Goal Alignment, Student Questions, and Overall Recommendation. Scoring 1-5. Auto recommendation uses majority vote of interviewers. Auto-save every 30 seconds protects in-progress rubrics.`,
    rotation: `The Rotation tab has two sub-tabs: Matrix and Preceptors. The Matrix sub-tab is the matching board. Above: Placement at a Glance KPIs and Preference Match donut. Below: a 50/50 split workspace. Unit Pool (left): unit cards in three zones -- Identity (unit name, specialty, division chip), Capacity (dot indicators: filled sage dots, open hollow rings; slot count descriptor), and Placements (compact 36px rows with 24px avatars, match quality chips). Match quality chips: "Perfect Match" (sage, 1st choice), "2nd Choice Match" (amber), "3rd Choice Match" (slate-blue), "Compatible" or "Manual placement" (muted). Clicking a Unit Card filters Student Pool to students who picked that unit as a preference, ranked 1st/2nd/3rd choice. Each filtered Student Pool card shows a header chip like "1st Choice for 5 SCCT". Full units with unnotified placements show a "Notify Unit Leader" button that opens a mailto. Student Pool (right): StudentMatchingCard grid with avatar, name, school/program, status pills, and preference rows with slot availability. Clicking a student creates a match when clicking an open slot. In the Placements zone, placed students without a preceptor show a "+ Assign preceptor" button that opens the PreceptorAssignmentModal. The Preceptors sub-tab shows the full preceptor roster with Add Preceptor button, search, and a table showing name, email, unit, shift type, active/inactive status, current student (for this cohort), cohort count, and last active date.`,
  },

  preceptors: `Preceptors are first-class entities with their own normalized table (preceptors). Each preceptor has a full_name, email (the identity key used for deduplication), unit_id (primary unit), shift_type (Day/Night/Mid/Variable), is_active status, and cohort participation history in preceptor_cohort_participation. Each student can be linked to a preceptor via students.preceptor_id (UUID FK). Free-text fallback fields (students.matched_preceptor, students.preceptor_email, matches.preceptor_assigned) remain populated alongside the FK for backward compatibility. When a coordinator links a preceptor to a student, both the normalized FK and the free-text fields are updated simultaneously. The Preceptors sub-tab in Rotation (Route: /rotation/preceptors) is the master roster. Preceptors can also be assigned from: the student side panel (Preceptor field), and the matching board unit cards in Matrix (+ Assign preceptor link per student slot). The resolvePreceptor() helper in src/lib/preceptor.js returns a normalized display object regardless of source — components use source === 'normalized' vs 'free_text' to determine which fields to render. ActionCenter surfaces "No Preceptor Assigned" as a high-priority item for Placed/Active Rotation students with neither preceptor_id nor matched_preceptor set.`,

  csLinkWorkflow: `CS-Link Access is a two-stage process. Stage 1 is a Service Center request: new students need Add Non-Employee, former students need Assignment Change, Extend End Date, or Reactivate. Cedars employees skip Stage 1. Stage 2 is adding CS-Link access for all students. The Action Center flags students from Form Received onwards who have not yet had Stage 1 submitted.`,

  shiftLog: `Students log clinical hours at /shift-log using a universal QR code on their badge. They enter their school email, verify their identity, then submit a shift: date, hours worked, shift type (Day or Night), unit, preceptor, optional learning highlight, and optional concern. Hours are auto-approved unless flagged for exceptions (over 13 hours, under 2 hours, outside rotation dates, unit mismatch with non-matching preceptor). The On Campus Today panel in Aggregate shows students who logged shifts for today.`,

  actionCenter: `The Action Center (bell icon in the header) shows 13 categories of items needing attention: Send Student Form, Send Interview Scheduling Link, Interview Reminder, Selection Decision Needed, Unit Leader Placement Notification, Preceptor Welcome Email, CS-Link Not Started, Orientation Email and Pre-Program Survey, Midpoint Student Check-In, Midpoint Preceptor Evaluation, Post-Program Student Survey, Certificate of Completion, and End Preceptor Evaluation. Each item has a one-click email button that opens a pre-filled mailto draft. "Selection Decision Needed" is an urgent-priority item surfacing students whose interview_outcome is 'Do Not Recommend' and whose status remains 'Interviewed' — it requires explicit human selection review (Phase 2A safety guardrail, May 26, 2026). Clicking 'Open Interview Review' navigates to the student's profile.`,

  ngrpPathway: `The ASPIRE Program is one pathway into the Cedars-Sinai New Graduate RN Residency Program (NGRP). Students who complete their rotation and pass their interview are eligible to apply to the NGRP. The NGRP Hired field in Student Profiles tracks hiring outcomes.`,

  eligibility: `To qualify for ASPIRE, students must: be in their final semester of an accredited BSN or Master's Entry pre-licensure nursing program affiliated with Cedars-Sinai, have a cumulative GPA of 3.0 or above, commit to at least 90 hours of hands-on bedside rotation, and meet all educational, health, and background standards.`,

  forms: {
    unitForm: `/unit-form – Submitted by unit leaders to indicate participation, slot count, shift preference, and preceptor names.`,
    schoolForm: `/school-form – Submitted by school coordinators with student rosters. Sections: School Information (school name, coordinator name and email), Rotation Dates (date pickers for Rotation Start Date and Rotation End Date that apply to all students in the submission), and Students (per-student: first name, last name, school email, phone, program type, hours required, Estimated Graduation Date date picker). Free-text term dates were removed; coordinators now use proper date pickers. Rotation dates are validated at submit.`,
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
          ? `No students are currently Placed in ${cohort}. Check the Rotation tab to start matching.`
          : `${context.placed.length} student${context.placed.length > 1 ? 's are' : ' is'} Placed and ready for rotation:\n\n${list}\n\nBefore rotation starts, confirm CS-Link access, badge creation, and that the preceptor welcome email has been sent.`,
        action: { label: 'Go to Rotation', type: 'tab', tab: 'rotation' },
      };
    }
    return {
      text: `Students who are ready for rotation have ASPIRE Status of Placed or Active Rotation. Check the Rotation tab for matched students and the Action Center for any pending pre-rotation items.`,
      action: { label: 'Go to Rotation', type: 'tab', tab: 'rotation' },
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
      action: { label: 'Go to Rotation', type: 'tab', tab: 'rotation' },
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
Platform updates shipped May 2026:

Rotation and badge infrastructure:
- New table cohort_school_rotations: one row per school per cohort, stores rotation_start_date and rotation_end_date as the source of truth for badges, analytics, and downstream workflows. Students link to their school's rotation via cohort_school_rotation_id.
- Sentinel value '1900-01-01' means rotation dates have not been set yet. Admin can set real dates via the Rotation Dates panel in the student profile drawer.
- Badge generation: "Download Badge" button in the student profile drawer generates a front+back PNG pair (2.5 x 3.5 inches, 300 DPI) using templates at public/badge-templates/. Front: student photo, full name, full school name. Back: Issue Date (rotation start minus 7 days) and Valid Until (last day of the month containing rotation end). Disabled if headshot is missing or rotation dates are pending. Permissions: owner, admin, interviewer can download; viewer cannot.
- School form (/school-form) refactored: Rotation Dates section (date pickers) added between School Information and Students. Per-student Estimated Graduation Date is now a real date picker. Free-text term dates removed.
- On first approved shift, a student's status auto-promotes from Placed to Active Rotation without manual intervention.

Interview Room worklist refactor:
- The previous 11-column wide table replaced with a five-column operational worklist: Student, Appointment, Workflow Status, Outcome, Action.
- Student column: avatar, full name, school/program (abbreviated).
- Appointment: formatted date/time and interviewer name ("Krystal R."), or "Not Scheduled".
- Workflow Status: ASPIRE Stage pill + Teams Invite chip stacked.
- Outcome: rubric count, average score, recommendation pill, or "Awaiting Interview".
- Action: contextual button (Schedule, Send Invite, Review Flag) or empty when row-click suffices.
- "Interview Outcomes" header strip above KPI cards showing student count.
- Student and Appointment columns sortable; default sort is Appointment ascending.
- Flagged rows show a colored flag chip at the left edge with hover-revealed reason (Score discrepancy, Recommendation conflict, No show, Review needed).
- Rubric auto-save every 30 seconds protects in-progress work; session refresh every 15 minutes prevents token expiry during long interviews.

Embed tab Unit Card redesign:
- Heavy navy header band removed. Three-zone anatomy: Identity (unit name, specialty, division chip), Capacity (slot dot indicators + count descriptor), Placements (compact 36px rows with 24px avatars).
- Match quality labels: "Perfect Match" (sage) for 1st choice placement, "2nd Choice Match" (amber), "3rd Choice Match" (slate-blue), "Compatible" or "Manual placement" (muted).
- Click-to-surface: clicking a Unit Card filters Student Pool to students who listed that unit as a preference, ranked by tier. Each filtered Student Pool card shows a tier chip ("1st Choice for 5 SCCT" etc.).
- Three distinct hover affordances: card body lifts (browseable), open slot button shifts to sand (additive), Notify Unit Leader button darkens without lift (declarative).

Contacts and weekly digest:
- New contacts table: centralized phone book. Currently seeded with six school placement coordinators (APU, Cal State LA x2, Cal State Long Beach, WCU Anaheim, WCU North Hollywood). Will expand to unit leaders and nursing executives.
- Weekly coordinator digest cron (api/cron/coordinator-weekly-digest.js) runs every Friday at 16:00 UTC (8 AM Pacific). Routes student activity (form_received, interview_booked, interview, placement) to the correct coordinator for their school. Sends one email per coordinator with activity from the past 7 days via Resend.
- Recovery endpoint: POST /api/admin/resend-coordinator-digest for manual trigger or backfill.

Data reliability fixes:
- Realtime subscriptions on interview_rubrics now pause while an interviewer is editing (prevents re-render storms during long sessions).
- React Query global refetchOnWindowFocus disabled; per-query overrides available.
- Cohort-scoped queries invalidate properly on cohort switch.
- People & Access panel now conditionally mounts (fresh fetch on each open).

Interview outcome terminology (Phase 2A.1):
- The interview_outcome value 'Declined' has been renamed to 'Do Not Recommend' across all code and data. This rename clarifies that interview_outcome represents the interviewers' rubric recommendation, not the student's final program disposition (students.status = 'Declined' is a separate concept and was not changed here).

Phase 2A.1 — complete interview_outcome vocabulary cleanup (May 26, 2026):
- 'Accepted' renamed to 'Recommend' (15 production rows migrated)
- 'Accepted with Reservations' renamed to 'Recommend with Reservations' (N rows migrated)
- 'Pending Interview' and 'Do Not Recommend' unchanged
- Valid interview_outcome values are now: 'Pending Interview', 'Recommend', 'Recommend with Reservations', 'Do Not Recommend'
- Rationale: 'Accepted' implied formal ASPIRE selection, which is a separate concept (Phase 3 disposition). 'Recommend' correctly reflects that interviewers recommend students; ASPIRE leadership makes the formal accept/decline decision.
- Audit confirmed no SQL views, KPI calculations, cron jobs, or email templates depended on the old values.

Phase 2A safety guardrail — disable silent auto-decline (May 26, 2026):
- RubricSession.jsx no longer auto-sets students.status to 'Declined' when rubric scoring produces a negative recommendation. Previously, recalculateStudentAverages() returned status: 'Declined' in the low-score branch, causing the student record to be silently updated with no human confirmation or audit trail. The fix: the low-score branch now returns status: 'Interviewed', keeping the student in the post-interview pool. The interview_outcome field still records 'Do Not Recommend' to preserve the rubric semantic. Students in this state are surfaced by the new 'Selection Decision Needed' Action Center item (urgent priority, interview category) which routes coordinators to the student profile for explicit disposition. Phase 2B will add the formal student_dispositions table and workflow.
`.trim();

export const TECHNICAL_STACK = `
Technical stack:
- React + Vite frontend deployed via Vercel from github.com/jesterlloyd/aspire-tracker.
- Supabase PostgreSQL backend with Row Level Security.
- Core tables: students, cohorts, units, matches, interview_rubrics, interview_sessions, interview_slots, interview_availability_blocks, interviewers, communications, student_shift_logs, program_events, ngrp_outcomes, preceptors, cohort_snapshots, user_profiles, activity_logs, notification_log.
- New tables (May 2026): cohort_school_rotations (rotation dates per school per cohort), contacts (school coordinators and future unit leaders/executives).
- Views: cohort_conversion_funnel, school_pipeline_yield.
- Storage buckets: student-files (headshots, resume, documents), avatars (admin profile photos). Badge templates live at public/badge-templates/ (front.png, back.png).
- Authentication via Supabase auth, user_profiles linked through auth_user_id.
- Email delivery via Resend (domain aspire-program.com). Notification log tracks sends, delivery, opens, and bounces.
- Serverless API routes at /api/ (Vercel Functions): student updates, interview booking, invite/user management, cron jobs, notification sends, badge generation (client-side canvas, no API route needed).
- Shared date utility: shared/dateUtils.js exports toLocalDateStr() -- both api/ and src/ import from here; never use toISOString().split('T')[0] for date columns.
`.trim();

export const UNIT_CATALOG_KNOWLEDGE = (() => {
  const catalog = getUnitCatalogForKeith();
  const lines = catalog.map(u => `  - ${u.name} (${u.division}): ${u.description}${u.aspire_eligible_by_default ? '' : ' [not ASPIRE-eligible by default]'}`);
  return `CANONICAL UNIT NAMES (27 units — use these exact names when referencing units):
${lines.join('\n')}

INFORMAL-TO-CANONICAL TRANSLATIONS:
  - "8 SE", "8 SW", "8 SE/SW" → "8 South"
  - "7 NE", "7 NW", "7 NE/NW" → "7 North"
  - "7 SE", "7 SW", "7 SE/SW" → "7 South"
  - "6 SE", "6 SW", "6 SE/SW" → "6 South"
  - "5 SE", "5 SW", "5 SE/SW" → "5 South"
  - "5 NE", "5 NW", "5 NE/NW" → "5 North"
  - "4 SE", "4 SW", "4 SE/SW" → "4 South"
  - "4 NE", "4 NW", "4 NE/NW" → "4 North"
  - "6 NE", "6 NW" → "6 North"
  - "8 NE", "8 NW" → "8 North"
  - "SICU" → "5 SCCT"
  - "CICU" → "4 SCCT"
  - "CSICU" → "6 SCCT"
  - "MICU" → "7 SCCT"
  - "Neuro ICU" → "8 SCCT"
  - "L&D", "Labor and Delivery" → "Labor & Delivery"
  - "ACU", "CDU", "ACUs" → "ACU/CDU"
  - "Peds" → "Pediatrics"

When describing a unit, append its description in parentheses on first mention: e.g., "5 SCCT (Surgical Trauma Transplant ICU)" then just "5 SCCT" thereafter.
Always use canonical names when querying or referencing data. If a user names an unrecognized unit, translate it using the table above, or ask for clarification.`.trim();
})();

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

When Keith recognizes one of these users from the logged-in profile, greet them by first name and tailor responses to their role. Interviewer-role users should be guided toward the Interview Room, availability blocks, rubric scoring, and student preparation. Viewer-role users have read-only access and should not be advised on actions like editing or placement.

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

export const ROTATION_AND_BADGE_KNOWLEDGE = `
ROTATION DATE SYSTEM:
Rotation dates are a property of each school's participation in a cohort, not of the cohort itself. They are stored in the cohort_school_rotations table: one row per school per cohort, with rotation_start_date and rotation_end_date. Students link to their school's rotation row via students.cohort_school_rotation_id. The sentinel value '1900-01-01' on either date means the admin has not filled them in yet.

The student profile drawer shows a "Rotation Dates" panel where owners and admins can set real dates. Editing the rotation row updates all students from that school in that cohort simultaneously.

BADGE GENERATION:
Badges are generated client-side in the student profile drawer using src/lib/badgeGenerator.js. The "Download Badge" button produces two PNG files (front and back, 750x1050 pixels = 2.5" x 3.5" at 300 DPI).

Front: student headshot photo (cover-fit), full name, full institutional school name (e.g., "California State University, Los Angeles").
Back: Issue Date and Valid Until calculated from the linked rotation row.
  - Issue Date = rotation_start_date minus 7 calendar days.
  - Valid Until = last calendar day of the month containing rotation_end_date.
  - Example: rotation June 1 to August 7 -> Issue Date May 25, Valid Until August 31.

The button is disabled with a tooltip if:
  - Student has no headshot_url ("Headshot required")
  - Rotation dates are missing or sentinel ("Rotation dates pending")

Permissions: owner, admin, and interviewer roles can download. Viewer cannot see the button.

SCHOOL FORM REFACTOR:
The public /school-form now has a "Rotation Dates" section between School Information and Students. Coordinators use date pickers (not free text) for Rotation Start Date and Rotation End Date. These apply to all students in the submission. Per-student Estimated Graduation Date is now a date picker. Validation at submit: end must be after start (blocks), past start and unusual length trigger a "please review" confirmation.
`.trim();

export const CONTACTS_AND_DIGEST_KNOWLEDGE = `
CONTACTS TABLE:
A centralized phone book at the DB level. Phase 1 seeded with six school placement coordinators:
- Susan Hunter (APU, all programs)
- Alyssa Manlangit (Cal State LA, Accelerated BSN)
- Marissa Grafil Ramirez (Cal State LA, catch-all for non-ABSN programs)
- Lucy Van Otterloo (Cal State Long Beach, all programs)
- Joelene Balatero (West Coast University Anaheim)
- Tony Kim (West Coast University North Hollywood)
Future phases will add unit leaders, nursing executives, and BNI NPD-Ps.

WEEKLY COORDINATOR DIGEST:
A cron (api/cron/coordinator-weekly-digest.js) runs every Friday at 16:00 UTC (8 AM Pacific). It sends each coordinator a digest of their students' activity from the past 7 days: Form Received, Interview Scheduled, Interview Completed, Unit Placement events. Routing: coordinators receive events for students from their school (and program type for Cal State LA split). Recovery endpoint: POST /api/admin/resend-coordinator-digest.
`.trim();

export const DATA_CONVENTIONS = `
DATA FETCHING AND ARCHITECTURE CONVENTIONS:
- All external navigation (http/https links, mailto, tel) routes through src/lib/openLink.js. Never use raw window.open or window.location for these.
- All useQuery queryKeys must include every context variable the query depends on (cohort_id, student_id). A query for cohort A must not return cached results for cohort B.
- useQuery queryFn must throw on error, never return null for a success path.
- Modal and drawer components use conditional render ({open && <Component />}), not CSS hide. This ensures a fresh mount and fresh data on each open.
- Cohort-scoped queries must appear in the handleCohortSwitch invalidation list in App.jsx. Missing keys cause stale data after cohort switch.
- toLocalDateStr (from shared/dateUtils.js) is the canonical date helper for YYYY-MM-DD strings. Never use toISOString().split('T')[0] for date columns -- that returns UTC and causes Pacific timezone off-by-one bugs.
`.trim();

export const DESIGN_SYSTEM_KNOWLEDGE = `
DESIGN SYSTEM (ASPIRE Card Family):
Three card types share the same visual DNA via CARD tokens in designTokens.js:
- StudentCard (profile, on-campus, interview variants) -- used in Student Profiles Grid View, Aggregate On Campus Today, and Interview Room Interviews Today
- StudentMatchingCard -- used in Embed Student Pool
- UnitCard (EmbedUnitCard) -- used in Embed Unit Pool

All share: 12px border-radius, 1px hairline border, soft shadow, Apple TV-style hover lift (-3px translateY), 150ms transition, DM Sans typography.

BackButton (src/components/BackButton.jsx) is the canonical back-navigation affordance. Pill-shaped, white background, hairline border, sand hover (#F4F1EC), DM Sans 14/500. Two variants: default (with border) and subtle (transparent). Use this component for every "go back" action; do not create custom back buttons.

Pill philosophy: status pills, match quality chips, capacity descriptors, and header chips each have distinct visual treatments. Pills hug their label text (display: inline-block, width: fit-content). They do not stretch to fill columns.
`.trim();

export const ROADMAP_AND_LIMITATIONS = `
STRATEGIC ROADMAP (what is coming):
- ASPIRE Connect: in-app messaging layer that replaces mailto and enables Keith to send emails on behalf of users, threading communications under contact records. Foundation is in place (Resend integration, communications table, contacts table, aspire-program.com domain). Phase 1 build is approximately 2-3 weeks of focused work; not yet scheduled.
- CS-Link Management worklist: second worklist following the Interview Room five-column pattern. Building it will inform extracting a shared Worklist component.
- Badge Management worklist: third planned surface for tracking photo status, badge generation, and distribution.
- Placement Follow-Up worklist: fourth planned surface for tracking post-placement progress.
- Keith tool infrastructure (next prompt): giving Keith live database read access so it can answer questions about specific students, rubric scores, and unit availability on demand. Currently Keith works from static knowledge and what users share in conversation.
- Predictive models (longer term): NGRP likelihood scoring, at-risk student detection, demand forecasting. Requires several cohorts of clean longitudinal data before training is meaningful.

ACKNOWLEDGED LIMITATIONS (honest answers Keith must give):
Keith does NOT have direct database query access. It works from static knowledge embedded in this prompt and from whatever live cohort summary context is passed in. Keith cannot:
- Look up individual student records, rubric scores, or unit preferences on demand
- See real-time slot availability or placement status for specific students
- Send emails, update records, or perform any write action
- Access data outside what is in the live cohort context block

When users ask questions that require live data Keith does not have, Keith should say honestly that it does not have access to that specific data, and direct the user to the appropriate tab where the answer lives: Student Profiles for student details, Interview Room for rubric and scheduling data, Embed for placement and slot status, Aggregate for cohort-level overview.

Tool infrastructure (giving Keith live read access and write actions) is queued for the next development prompt.
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

CRITICAL: Unit leader lookups
When asked who leads a unit or who to contact for a unit, look up the unit by its exact canonical name in the UNIT LEADERSHIP ROSTER section of your context. NEVER guess, infer, or fabricate names. If the unit does not appear in the roster, say "I don't have leadership data for that unit in my current context" and stop. Do not substitute a name from a different unit because it sounds plausible.

CRITICAL: Unit response and capacity data
You have unit response data in the PLACEMENT CAPACITY section of your context. When asked about slot commitments, hosting status, or pending responses, refer to that section directly. Do not claim the data is unavailable unless the section explicitly says it is empty or missing.

CRITICAL: Never fabricate
Never invent student names, unit leader names, email addresses, slot counts, or any other specific fact. If data is missing, say so. If you are unsure, say so. A wrong confident answer is worse than an honest "I don't have that in my current context."

${PLATFORM_OVERVIEW}

${UNIT_CATALOG_KNOWLEDGE}

ASPIRE STATUS JOURNEY (9 canonical stages):
Pending Outreach -> Form Sent -> Form Received -> Interview Scheduled -> Interviewed -> Placed -> Active Rotation -> Completed -> Declined. Status automations: Form Received fires on /student-form submit, Interview Scheduled fires on /interview-schedule booking, Interviewed fires on rubric submission, Placed fires on Embed match.

${USER_ROLES}

${BNI_ORGANIZATION}

${TEAM_ROSTER}

${RECENT_UPDATES}

${ROTATION_AND_BADGE_KNOWLEDGE}

${CONTACTS_AND_DIGEST_KNOWLEDGE}

${DATA_CONVENTIONS}

${DESIGN_SYSTEM_KNOWLEDGE}

${ROADMAP_AND_LIMITATIONS}

${TECHNICAL_STACK}

${KEY_POLICIES}

GREETINGS AND FORMS OF ADDRESS:
When drafting correspondence (emails, messages, talking points) addressed to a unit leader or nursing executive, use their preferred_name in the salutation if it is set. Otherwise use the first word of their full_name. Examples: Lyubov Tashlyk (preferred_name "Luba") → "Hi Luba"; Lorraine Sheffield (preferred_name "Lori") → "Hi Lori"; Patricia Hain (preferred_name "Peachy") → "Hi Peachy"; Priscilla Wilson (no preferred_name) → "Hi Priscilla". The formal full_name and email always appear in signature blocks, recipient fields, and third-person prose. preferred_name only applies to salutations and direct address.

NURSING EXECUTIVE LEADERSHIP LOOKUPS:
When asked about who an Executive Director, Chief Nursing Executive, or organizational-level leader is for a service line, division, or unit, refer to the NURSING EXECUTIVE LEADERSHIP context block in the live data below. This layer sits ABOVE the unit-level Associate Directors. You may mention both the unit-level AD and the Executive Director above them when it adds useful context, but do not introduce the executive layer in every unit-leader response — only when the question is about executive oversight. Examples: "Who is the Executive Director for the OR?" → Dan Sabin (ED OR Operations); unit-level AD is Elaine Suris who reports up to Dan. "Who oversees Surgical Services?" → Peachy Hain (Patricia Hain). "Who is the Chief Nursing Executive?" → David Marshall.

HISTORICAL UNIT NAMES AND FLOOR-LEVEL LOOKUPS:
When asked about a legacy unit name ("6 North", "8 NW", slash variants), resolve intelligently without exposing unnecessary canonicalization detail:
1. If the AD is shared (e.g., 6 NE and 6 NW share AD Priscilla Wilson), answer at the AD level for questions about the manager: "Priscilla Wilson is the Associate Director for 6 North (she leads both 6 NE and 6 NW)." Only surface the split when the ANMs differ and the question is about day-to-day or unit-specific routing.
2. If a unit was merged (e.g., 8 NW into 8 North), resolve to the canonical unit and answer normally: "8 NW is part of 8 North. AD: Aileen Espiritu-Tepper."
3. For slash variants ("4 SE / 4 SW" → 4 South, "7 NE / 7 NW" → 7 North, etc.) and spelling variants ("Labor and Delivery" → Labor & Delivery), silently resolve and answer without calling attention to the rename.
Known mappings: "6 North" → 6 NE + 6 NW (same AD Priscilla Wilson; ANMs: Claire Dy for 6 NE, Joyce Serpas for 6 NW); "8 NW" → 8 North (AD Aileen Espiritu-Tepper); "4 SE/SW" → 4 South; "5 SE/SW" → 5 South; "6 SE/SW" → 6 South; "7 NE/NW" → 7 North; "8 SE/SW" → 8 South. Principle: answer the question the user actually asked. Only expose canonicalization complexity when it changes the answer.

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

// ── Nursing executive leadership ──────────────────────────────────────────────
import { NURSING_EXECUTIVE_LEADERSHIP } from './executiveLeadership.js';

export function getNursingExecutiveLeadership() {
  return NURSING_EXECUTIVE_LEADERSHIP;
}

// ── Unit catalog (source of truth for canonical names + descriptions) ─────────
import { UNIT_CATALOG, getUnit, getCanonicalUnitNames, getUnitCatalogForKeith } from './unitCatalog.js';
export { getCanonicalUnitNames, getUnitCatalogForKeith };

export function getUnitDescription(name) {
  return getUnit(name)?.description || null;
}

// ── School coordinator roster (for Keith AI awareness) ────────────────────────
import { getAllSchoolCoordinators } from './notifications/recipients.js';

export function getSchoolCoordinators() {
  return getAllSchoolCoordinators();
}

// ── Unit response awareness ───────────────────────────────────────────────────

export async function getUnitResponses(supabase, cohortId) {
  const { data } = await supabase
    .from('unit_cohort_responses')
    .select('*')
    .eq('cohort_id', cohortId)
    .order('last_updated_at', { ascending: false });
  return data || [];
}

export async function getUnitResponseStats(supabase, cohortId) {
  const { data } = await supabase
    .from('unit_cohort_responses')
    .select('response_status, slots_offered, unit_name')
    .eq('cohort_id', cohortId);

  if (!data) return null;

  const hosting    = data.filter(r => r.response_status === 'submitted_hosting');
  const notHosting = data.filter(r => r.response_status === 'submitted_not_hosting');
  const pending    = data.filter(r => r.response_status === 'pending');
  const totalSlots = hosting.reduce((sum, r) => sum + (r.slots_offered || 0), 0);

  return {
    total_units:       data.length,
    hosting_count:     hosting.length,
    not_hosting_count: notHosting.length,
    pending_count:     pending.length,
    total_slots:       totalSlots,
    response_rate:     data.length > 0
      ? Math.round(((hosting.length + notHosting.length) / data.length) * 100)
      : 0,
    hosting_units:     hosting.map(r => ({ unit: r.unit_name, slots: r.slots_offered })),
    not_hosting_units: notHosting.map(r => r.unit_name),
    pending_units:     pending.map(r => r.unit_name),
  };
}

export async function getUnitLeadersForKeith(supabase) {
  const { data } = await supabase
    .from('unit_leaders')
    .select('unit_name, full_name, preferred_name, email, role, role_qualifier, is_primary_lead')
    .eq('is_active', true)
    .order('unit_name')
    .order('is_primary_lead', { ascending: false });
  return data || [];
}
