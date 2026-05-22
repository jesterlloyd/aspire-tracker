// IMPORTANT: Supabase query builders return thenables, not Promises.
// Do NOT use .catch() on them -- it throws "is not a function".
// Use: const { error } = await supabase.from(...).insert(...)
// Or:  try { await supabase.from(...).insert(...) } catch (err) { ... }
// Regular fetch() and response.json() ARE Promises -- .catch() is fine there.

import { buildSystemPrompt, getRecentCommunications, getSchoolCoordinators, getUnitResponseStats, getUnitResponses, getUnitLeadersForKeith, getUnitCatalogForKeith, getNursingExecutiveLeadership } from '../src/lib/keithKnowledge.js';
import { createClient } from '@supabase/supabase-js';

// Legacy shim kept for safety (actual logic now lives in keithKnowledge.js)
function _buildSystemPrompt_legacy(context, cohortName) {
  const cohort = cohortName || 'the current cohort';
  let liveData = 'LIVE COHORT DATA: Not available.';
  if (context) {
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
      liveData = `LIVE COHORT DATA: Error - ${e.message}`;
    }
  }
  return `You are Keith, the AI assistant for ASPIRE Intelligence at Cedars-Sinai Medical Center, named in honor of Keith Hoshal who created the ASPIRE Program.

ASPIRE (Affiliate Students Pathway from Internship to Residency Experience) places senior nursing students at Cedars-Sinai for their final clinical rotation with a pathway into the New Graduate RN Residency Program (NGRP).

Your users: Jester Lloyd Bautista PhD MSN RN NPD-BC CCRN SCRN (Program Lead) and Krystal Rodriguez DNP RN NPD-BC CNOR (Co-Lead).

PLATFORM NAME AND IDENTITY:
The platform is called ASPIRE Intelligence (formerly ASPIRE Program Tracker). Rebranded May 2026 to reflect its evolution into a longitudinal workforce intelligence platform.

ASPIRE STATUS JOURNEY (9 canonical stages):
Pending Outreach → Form Sent → Form Received → Interview Scheduled → Interviewed → Placed → Active Rotation → Completed → Declined. "Accepted" is retired. Declined can occur at any stage and requires a decline reason. Status automations: Form Received fires on /student-form submit, Interview Scheduled fires on /interview-schedule booking, Interviewed fires on rubric submission, Placed fires on Embed match, Completion fires when status set to Completed.

CS-LINK: Stage 1 for new students is Add Non-Employee. Former students need Assignment Change, Extend End Date, or Reactivate. Cedars employees skip Stage 1. Stage 2 is Add CS-Link for everyone.

PROGRAM EVENTS:
Every major milestone is auto-logged to program_events table. Events include: orientation (manual), form_sent, form_received, interview, placement, rotation_start (first approved shift), rotation_end (hours requirement met), completion, manual_status_update, note. Auto-logged events have created_by = system. Powers the Gantt timeline in Aggregate tab.

SHIFT LOG:
Students log hours at /shift-log using QR code on badge. Shift types: Day, Night, Mid. Default hours shown: 12. Students may log beyond required hours with permission. When required hours met, celebration screen appears with Remind My Coordinator button. The Action Center flags Certificate of Completion when approved_hours >= hours_required.

CERTIFICATE OF COMPLETION:
Email includes: congratulations, post-program survey (https://forms.cloud.microsoft/r/GWAdKLuM8J), preceptor evaluation link to share (https://forms.cloud.microsoft/r/brGDMzFXgy), note to attach Canva-created certificate PDF. Action Center surfaces this automatically.

SCHOOL FORM PASSWORD:
/school-form requires a cohort-specific password set in Edit Cohort modal. No password = form locked entirely. Password changes each cohort cycle. Coordinators must contact Jester to receive current password.

PROFILE COMPLETION:
Each student has a profile completion percentage from 12 checkpoints: photo, GPA, personal email, phone, program type, shift preference, unit preferences, interest statement, resume, interview, placement, CS-Link. Shown as progress bar on student cards and detailed in the side panel.

PROGRAM TIMELINE:
Gantt-style timeline in Aggregate tab shows each student's journey using program_events data. Appears as a collapsible Nightfall strip below main panels.

TODAY'S PRIORITIES STRIP:
Morning briefing in Aggregate tab listing urgent items: interviews pending, CS-Link items, badges needed, placement gaps, shift logs to review, students nearing completion. Appears above On Campus Today.

ANALYTICS FOUNDATION (Phase 1 complete):
Four new Supabase tables: ngrp_outcomes (NGRP application, interview, offer, hire, retention at 6/12/18 months), preceptors (normalized records), cohort_snapshots (periodic state for trend analysis), preceptor_id on students. Views: cohort_conversion_funnel and school_pipeline_yield.

ANALYTICS ROADMAP:
Phase 1 (complete): ngrp_outcomes, preceptors, cohort_snapshots, analytics views.
Phase 2 (next): Cohort analytics dashboard - funnel chart, school performance, score distribution, unit demand.
Phase 3: Cross-cohort trend dashboard + Keith proactive weekly digest.
Phase 4: Predictive models - NGRP hire likelihood, unit demand forecasting, at-risk student detection.

DESIGN SYSTEM:
Primary dark: Nightfall #1D2567. Navbar: deep navy gradient. Tab badges: Aggregate=Nova, Student Profiles=Sage, Interview Room=Dawn, Embed=Marina. FeedbackPanel (Chroma #930045) is bottom-left. Keith orb is bottom-right. All external links open in new tabs.

SHIFT PREFERENCES: Day Shift Preferred, Night Shift Preferred, No Preference.
PROGRAM TYPES: BSN Semester, BSN Trimester, BSN Quarter, Accelerated BSN, LVN to BSN, MECN, ELMN.

FEEDBACK PANEL:
Floating Chroma burgundy button bottom-left allows users to send bug reports, feature ideas, or questions to Jester via mailto. Separate from Keith.

PRECEPTOR WELCOME EMAIL FORMAT when asked:
Subject: ASPIRE Program - Student Preceptor Assignment
Dear [Preceptor First Name],
Thank you so much for agreeing to precept one of our senior nursing students through the ASPIRE Program. Your willingness to teach, mentor, and support our students truly makes a difference in shaping the next generation of nurses at Cedars-Sinai.
Student: [Name] | School: [School] | Program: [Program] | Rotation Dates: [Dates] | Hours Required: [Hours] | Email: [Email] | Phone: [Phone]
[Student] will reach out directly to introduce themselves and coordinate schedules.
Please attach before sending: ASPIRE Brochure and Pre-licensure Student General Guidelines.
Reminders: Preceptor pay - contact Dr. Krystal Rodriguez. Avoid being in charge while precepting. Floating acceptable if comfortable.
Kind regards,
Jester Lloyd Bautista PhD MSN RN NPD-BC CCRN SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964

UNIT LEADER EMAIL FORMAT when asked:
Subject: ASPIRE Program Student Placement - [Student Name] | [Unit Name]
Dear [Unit Leader],
Thank you for your continued support of the ASPIRE Program at Cedars-Sinai. We are pleased to inform you that we have matched the following student to your unit:
Student: [Name] | School: [School] | Program: [Program] | Rotation Dates: [Dates] | Hours: [Hours] | Shift: [Shift]
Please confirm which preceptor will be assigned and reply so we can coordinate next steps.
Kind regards,
Jester Lloyd Bautista PhD MSN RN NPD-BC CCRN SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964

STUDENT FORM EMAIL when asked:
Subject: ASPIRE Program Student Form - Action Required
Dear [First Name],
You have been identified as a potential ASPIRE candidate. Please complete your profile at: https://aspire-tracker.vercel.app/student-form
Kind regards,
Jester Lloyd Bautista PhD MSN RN NPD-BC CCRN SCRN
JesterLloyd.Bautista@cshs.org | 310-248-8964

SCHEDULING LINK EMAIL when asked:
Subject: Schedule Your ASPIRE Interview
Dear [First Name],
Thank you for completing your ASPIRE Student Profile. Please schedule your interview at: https://aspire-tracker.vercel.app/interview-schedule
Kind regards,
Jester Lloyd Bautista PhD MSN RN NPD-BC CCRN SCRN
JesterLloyd.Bautista@cshs.org | 310-248-8964

KEY EXTERNAL LINKS:
Post-program student survey: https://forms.cloud.microsoft/r/GWAdKLuM8J
Preceptor evaluation: https://forms.cloud.microsoft/r/brGDMzFXgy
Pre-program student survey: https://forms.cloud.microsoft/r/6TX6sV76ga
Student form: https://aspire-tracker.vercel.app/student-form
School form: https://aspire-tracker.vercel.app/school-form
Unit form: https://aspire-tracker.vercel.app/unit-form
Interview schedule: https://aspire-tracker.vercel.app/interview-schedule
Shift log: https://aspire-tracker.vercel.app/shift-log

PRIVACY RULES: Never include DOB, last 4 SSN, or sensitive identifiers. Never fabricate student data. Draft emails only, never send automatically.

RESPONSE STYLE: Warm, concise, professional. Under 200 words unless drafting a full email. Always suggest a concrete next action. Use Last Name First Name format for student lists. Only reference students by name if their data appears in the live context above.

${liveData}
Current cohort: ${cohort}`;
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const KEITH_TOOLS = [
  {
    name: 'search_students',
    description: 'Search for students in the active cohort matching optional filters. Returns a lightweight list (name, school, program, status, GPA, top 3 unit preferences). Call this first to identify candidates before calling get_student_detail.',
    input_schema: {
      type: 'object',
      properties: {
        status:       { type: 'string',  description: 'Filter by ASPIRE pipeline status (e.g. "Interviewed", "Placed", "Form Received")' },
        school:       { type: 'string',  description: 'Filter by school name or abbreviation (case-insensitive match)' },
        program_type: { type: 'string',  description: 'Filter by program type (e.g. "Accelerated BSN", "MECN")' },
        min_gpa:      { type: 'number',  description: 'Minimum cumulative GPA' },
        limit:        { type: 'integer', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_student_detail',
    description: 'Get full details for a single student including rubric scores, recommendations, interview notes, unit preferences, placement state, and rotation info. Use AFTER identifying a candidate via search_students.',
    input_schema: {
      type: 'object',
      required: ['student_id'],
      properties: {
        student_id: { type: 'string', description: 'UUID of the student' },
      },
    },
  },
  {
    name: 'get_unit_details',
    description: 'Get details for a clinical unit including specialty, division, current placements, open slots, and which students chose this unit as a 1st/2nd/3rd preference. Use to understand demand for a unit or assess fit.',
    input_schema: {
      type: 'object',
      required: ['unit_name'],
      properties: {
        unit_name: { type: 'string', description: 'Name of the unit (e.g. "4 North", "5 SCCT", "NICU")' },
      },
    },
  },
  {
    name: 'get_cohort_summary',
    description: 'Get high-level summary stats for the active cohort: total students, status breakdown, school breakdown, matched vs unmatched counts, and rotation timeline.',
    input_schema: {
      type: 'object',
      properties: {
        cohort_id: { type: 'string', description: 'UUID of the cohort (defaults to active cohort)' },
      },
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeToolCall(toolName, input, userRole, supabase, activeCohortId) {
  // Sensitive fields never returned to Keith
  const EXCLUDED_FIELDS = ['date_of_birth', 'ssn_last4', 'gender'];

  function stripSensitive(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const copy = { ...obj };
    EXCLUDED_FIELDS.forEach(f => delete copy[f]);
    return copy;
  }

  try {
    switch (toolName) {

      case 'search_students': {
        const limit = Math.min(input.limit || 20, 50);
        let query = supabase
          .from('students')
          .select('id, first_name, last_name, school, program_type, status, cumulative_gpa, unit_preference_1, unit_preference_2, unit_preference_3, headshot_url, avg_composite_score, auto_recommendation')
          .eq('cohort_id', activeCohortId)
          .order('last_name', { ascending: true })
          .limit(limit);
        if (input.status)       query = query.eq('status', input.status);
        if (input.school)       query = query.ilike('school', `%${input.school}%`);
        if (input.program_type) query = query.ilike('program_type', `%${input.program_type}%`);
        if (input.min_gpa)      query = query.gte('cumulative_gpa', input.min_gpa);
        const { data, error } = await query;
        if (error) return { error: `Search failed: ${error.message}` };
        return { students: (data || []).map(stripSensitive), count: (data || []).length };
      }

      case 'get_student_detail': {
        const { data: student, error } = await supabase
          .from('students')
          .select('id, first_name, last_name, school, program_type, status, cumulative_gpa, school_email, personal_email, phone, unit_preference_1, unit_preference_2, unit_preference_3, matched_unit_id, matched_preceptor, shift_assigned, interview_scheduled_date, interview_scheduled_time, interview_assigned_interviewers, avg_composite_score, avg_cj_score, avg_pp_score, avg_ga_score, auto_recommendation, score_flag, score_flag_message, rubric_count, cs_stage1_submitted, cs_link_complete, badge_created, approved_hours, hours_required, flagged_for_second_interview, flag_note, cohort_school_rotation_id, interest_statement, headshot_url, resume_url')
          .eq('id', input.student_id)
          .single();
        if (error || !student) return { error: 'Student not found' };

        // Fetch rubrics
        const { data: rubrics } = await supabase
          .from('interview_rubrics')
          .select('interviewer_name, composite_score, cj_score, pp_score, ga_score, individual_recommendation, summary_comments, suggested_unit, status, interview_date')
          .eq('student_id', input.student_id)
          .order('created_at', { ascending: false });

        // Fetch linked rotation
        let rotation = null;
        if (student.cohort_school_rotation_id) {
          const { data: rot } = await supabase
            .from('cohort_school_rotations')
            .select('school_name, rotation_start_date, rotation_end_date, coordinator_name, coordinator_email')
            .eq('id', student.cohort_school_rotation_id)
            .single();
          rotation = rot || null;
        }

        // Fetch recent communications
        const { data: comms } = await supabase
          .from('notification_log')
          .select('notification_type, recipient_name, subject, status, sent_at')
          .eq('student_id', input.student_id)
          .order('sent_at', { ascending: false })
          .limit(5);

        return {
          student: stripSensitive(student),
          rubrics: rubrics || [],
          rotation,
          recent_communications: comms || [],
        };
      }

      case 'get_unit_details': {
        const { data: unitRows } = await supabase
          .from('units')
          .select('id, unit_name, division, total_slots, slots_remaining, contact_person, contact_email, is_participating, patient_population')
          .ilike('unit_name', `%${input.unit_name}%`)
          .eq('cohort_id', activeCohortId)
          .limit(1);
        const unit = unitRows?.[0];
        if (!unit) return { error: `Unit "${input.unit_name}" not found in this cohort` };

        // Current placements
        const { data: matches } = await supabase
          .from('matches')
          .select('student_id, match_quality, preceptor_assigned, shift_assigned')
          .eq('unit_id', unit.id);
        const placedIds = (matches || []).map(m => m.student_id);

        let placedStudents = [];
        if (placedIds.length > 0) {
          const { data: ps } = await supabase
            .from('students')
            .select('id, first_name, last_name, school, program_type, status')
            .in('id', placedIds);
          placedStudents = (ps || []).map(s => {
            const m = matches.find(mx => mx.student_id === s.id);
            return { ...s, match_quality: m?.match_quality, preceptor: m?.preceptor_assigned, shift: m?.shift_assigned };
          });
        }

        // Students who listed this unit as a preference
        const unitName = unit.unit_name;
        const [pref1, pref2, pref3] = await Promise.all([
          supabase.from('students').select('id, first_name, last_name, school, program_type, status, avg_composite_score, auto_recommendation').eq('cohort_id', activeCohortId).eq('unit_preference_1', unitName),
          supabase.from('students').select('id, first_name, last_name, school, program_type, status, avg_composite_score, auto_recommendation').eq('cohort_id', activeCohortId).eq('unit_preference_2', unitName),
          supabase.from('students').select('id, first_name, last_name, school, program_type, status, avg_composite_score, auto_recommendation').eq('cohort_id', activeCohortId).eq('unit_preference_3', unitName),
        ]);
        const placedSet = new Set(placedIds);

        return {
          unit,
          placements: placedStudents,
          open_slot_count: Math.max(0, unit.total_slots - placedStudents.length),
          interested_students: {
            first_choice:  (pref1.data || []).filter(s => !placedSet.has(s.id)),
            second_choice: (pref2.data || []).filter(s => !placedSet.has(s.id)),
            third_choice:  (pref3.data || []).filter(s => !placedSet.has(s.id)),
          },
        };
      }

      case 'get_cohort_summary': {
        const cohortId = input.cohort_id || activeCohortId;
        const [{ data: cohort }, { data: students }, { data: rotations }] = await Promise.all([
          supabase.from('cohorts').select('id, name, status, start_date, end_date').eq('id', cohortId).single(),
          supabase.from('students').select('id, status, school, program_type, matched_unit_id').eq('cohort_id', cohortId),
          supabase.from('cohort_school_rotations').select('rotation_start_date, rotation_end_date, school_name').eq('cohort_id', cohortId),
        ]);

        const byStatus = {}, bySchool = {}, byProgram = {};
        let matched = 0;
        (students || []).forEach(s => {
          byStatus[s.status]      = (byStatus[s.status]      || 0) + 1;
          bySchool[s.school]      = (bySchool[s.school]      || 0) + 1;
          byProgram[s.program_type] = (byProgram[s.program_type] || 0) + 1;
          if (s.matched_unit_id) matched++;
        });

        const starts = (rotations || []).map(r => r.rotation_start_date).filter(d => d && d !== '1900-01-01').sort();
        const ends   = (rotations || []).map(r => r.rotation_end_date).filter(d => d && d !== '1900-01-01').sort();

        return {
          cohort,
          totals: { total: (students || []).length },
          by_status:  byStatus,
          by_school:  bySchool,
          by_program: byProgram,
          placement: { matched, unmatched: (students || []).length - matched },
          rotation_window: {
            earliest_start: starts[0] || null,
            latest_end:     ends[ends.length - 1] || null,
            school_rotations: rotations || [],
          },
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[keith tool] ${toolName} error:`, err.message);
    return { error: `Tool error: ${err.message}` };
  }
}

function generateResultSummary(toolName, result) {
  if (result?.error) return `Error: ${result.error}`;
  switch (toolName) {
    case 'search_students':   return `Found ${result.count ?? 0} student${result.count !== 1 ? 's' : ''}`;
    case 'get_student_detail':return result.student ? `Loaded ${result.student.first_name} ${result.student.last_name}` : 'Student not found';
    case 'get_unit_details':  return result.unit ? `${result.unit.unit_name}: ${result.open_slot_count} open slot${result.open_slot_count !== 1 ? 's' : ''}, ${(result.interested_students?.first_choice?.length || 0)} 1st-choice students` : 'Unit not found';
    case 'get_cohort_summary':return `Cohort: ${result.totals?.total ?? 0} students, ${result.placement?.matched ?? 0} placed`;
    default:                  return 'Tool completed';
  }
}

// ── Tool-use conversation loop ────────────────────────────────────────────────

async function runToolLoop(initialMessages, systemPrompt, tools, supabase, activeCohortId) {
  const messages = [...initialMessages];
  const allToolCalls = [];
  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const payload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    };
    if (tools && tools.length > 0) payload.tools = tools;

    const response = await callAnthropicWithRetry(payload);
    const content  = response?.content || [];
    const hasTools = content.some(b => b.type === 'tool_use');

    if (!hasTools) {
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { text, toolCalls: allToolCalls };
    }

    // Append the assistant's full content turn (may mix text and tool_use blocks)
    messages.push({ role: 'assistant', content });

    // Execute each tool and collect results
    const toolResults = [];
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      const result  = await executeToolCall(block.name, block.input, null, supabase, activeCohortId);
      const summary = generateResultSummary(block.name, result);
      allToolCalls.push({ tool: block.name, input: block.input, result_summary: summary });

      // Audit log (non-blocking)
      // Audit log -- non-blocking; a logging failure must never crash the user request
      try {
        const { error: auditErr } = await supabase.from('program_events').insert({
          student_id:  null,
          cohort_id:   activeCohortId,
          event_type:  'keith_tool_call',
          event_date:  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()),
          notes:       `Keith called ${block.name}: ${summary}`,
          created_by:  'system',
        })
        if (auditErr) console.warn('[keith audit] insert error:', auditErr.message)
      } catch (auditEx) {
        console.warn('[keith audit] threw:', auditEx.message)
      }

      toolResults.push({
        type:        'tool_result',
        tool_use_id: block.id,
        content:     JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Safety cap hit
  return {
    text: 'I reached my research limit for this request. Here is what I found up to this point. Please ask again if you need more detail.',
    toolCalls: allToolCalls,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Keith is alive',
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { messages, context, cohortName, userProfile, liveData } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Valid messages array required' });
  }

  const anthropicMessages = messages
    .filter(m => m.role && m.text)
    .map(m => ({
      role: m.role === 'keith' ? 'assistant' : 'user',
      content: String(m.text),
    }));

  // ── Pacific-Time helpers ──────────────────────────────────────────────────────
  function getPacificContext() {
    const now = new Date();
    const todayIso  = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
    const todayLong = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long',  year: 'numeric', month: 'long',  day: 'numeric' }).format(now);
    const nowTime   = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(now);
    return { todayIso, todayLong, nowTime };
  }

  function formatTimestampPT(iso) {
    if (!iso) return null;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(iso));
  }

  const { todayIso, todayLong, nowTime } = getPacificContext();
  // ─────────────────────────────────────────────────────────────────────────────

  // Build live context string from the React Query cache snapshot sent by the client
  let liveDataStr = null;
  if (liveData && Array.isArray(liveData.students)) {
    try {
      const today = todayIso; // Pacific-aware; replaces plain new Date().toLocaleDateString('en-CA')

      // Build a student lookup map for joining shift logs
      const studentMap = {};
      liveData.students.forEach(s => { studentMap[s.id] = s; });

      // Status breakdown
      const byStatus = {};
      liveData.students.forEach(s => {
        if (!byStatus[s.status]) byStatus[s.status] = [];
        byStatus[s.status].push(s);
      });
      const statusSummary = Object.entries(byStatus)
        .map(([st, arr]) => `  ${st}: ${arr.length}`)
        .join('\n') || '  No data';

      // On campus today — raw shift log rows joined with students
      const onCampusLines = (liveData.onCampusToday || []).map(log => {
        const s = studentMap[log.student_id];
        const name = s ? `${s.last_name}, ${s.first_name}` : '(unknown)';
        return `- ${name} (${s?.school || '?'}) at ${log.unit_name}, ${log.total_hours}h ${log.shift_type || ''}`;
      }).join('\n') || '(none today)';

      // Key student lists
      const safeList = (arr, max = 50) => {
        if (!arr || arr.length === 0) return '(none)';
        const lines = arr.slice(0, max).map(s => `- ${s.last_name}, ${s.first_name} (${s.school || '?'})`);
        if (arr.length > max) lines.push(`  ...and ${arr.length - max} more`);
        return lines.join('\n');
      };

      const pendingInterview = liveData.students.filter(s =>
        ['Form Received', 'Interview Scheduled'].includes(s.status));
      const placed           = liveData.students.filter(s => s.status === 'Placed');
      const activeRotation   = liveData.students.filter(s => s.status === 'Active Rotation');
      const needsCsLink      = liveData.students.filter(s =>
        ['Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation'].includes(s.status)
        && !s.cs_stage1_submitted);
      const needsBadge       = liveData.students.filter(s => s.status === 'Placed' && !s.badge_created);

      const activeList = activeRotation.slice(0, 50).map(s =>
        `- ${s.last_name}, ${s.first_name} (${s.approved_hours || 0}/${s.hours_required || 0} hrs)`
      ).join('\n') || '(none)';

      // Unit map — full record including contact info
      const unitMap = {};
      (liveData.units || []).forEach(u => { unitMap[u.id] = u; });

      // Match quality lookup by student_id
      const matchesByStudentId = {};
      (liveData.matches || []).forEach(m => {
        const sid = m.student_id || m.student?.id;
        if (sid) matchesByStudentId[sid] = m;
      });

      // Cohort rotation window
      const cohort = liveData.cohort;
      const cohortContext = cohort
        ? `Active Cohort: ${cohort.name}
Rotation Window: ${cohort.start_date || 'TBD'} to ${cohort.end_date || 'TBD'}
Cohort Status: ${cohort.status || 'unknown'}`
        : `Active Cohort ID: ${liveData.activeCohortId || 'none'}`;

      // Detailed placement block — one record per placed student
      const placementLines = placed.slice(0, 50).map(s => {
        const match         = matchesByStudentId[s.id];
        const unit          = unitMap[s.matched_unit_id] || match?.unit || {};
        const completedHrs  = (liveData.shiftLogProgress || {})[s.id] || 0;
        const requiredHrs   = s.hours_required || 90;
        const remainingHrs  = Math.max(0, requiredHrs - completedHrs);
        const quality       = match?.match_quality || '';
        return [
          `- ${s.last_name}, ${s.first_name}`,
          `  School: ${s.school || 'N/A'} | Program: ${s.program_type || 'N/A'} | GPA: ${s.cumulative_gpa || 'N/A'}`,
          `  School Email: ${s.school_email || 'N/A'} | Personal Email: ${s.personal_email || 'N/A'} | Phone: ${s.phone || 'N/A'}`,
          `  Unit: ${unit.unit_name || 'pending'}${unit.division ? ` [${unit.division}]` : ''}`,
          `  Preceptor: ${s.matched_preceptor || 'pending'} | Shift: ${s.shift_assigned || s.shift_availability || 'N/A'}`,
          `  Rotation Dates: ${s.term_dates || 'N/A'}`,
          `  Hours: ${completedHrs.toFixed(1)}/${requiredHrs}h (${remainingHrs.toFixed(1)}h remaining)`,
          unit.contact_person ? `  Unit Leader: ${unit.contact_person} | ${unit.contact_email || 'no email'}` : null,
          quality ? `  Match Quality: ${quality}` : null,
        ].filter(Boolean).join('\n');
      }).join('\n\n') || '(none)';

      // Enriched pending interview list
      const pendingLines = pendingInterview.slice(0, 50).map(s =>
        `- ${s.last_name}, ${s.first_name} | ${s.school || '?'} | GPA: ${s.cumulative_gpa || 'N/A'} | ${s.school_email || 'no email'} | Status: ${s.status}`
      ).join('\n') || '(none)';

      // Build school coordinator roster for Keith awareness
      const coordRoster = (() => {
        try {
          const coords = getSchoolCoordinators()
          const lines = coords.map(({ school, primary, cc, programRoutes }) => {
            let line = `- ${school}: ${primary.name} <${primary.email}> (${primary.title})`
            if (programRoutes) {
              const routes = Object.entries(programRoutes)
              const seen = new Set()
              const routeLines = routes
                .filter(([, r]) => { const key = r.email; if (seen.has(key)) return false; seen.add(key); return true })
                .map(([, r]) => `${r.name} <${r.email}>`)
              line += ` [program-routed: ${routeLines.join(', ')}]`
            }
            if (cc.length) {
              line += ` [CC: ${cc.map(c => `${c.name} <${c.email}>`).join(', ')}]`
            }
            return line
          })
          return `\n\nSCHOOL COORDINATOR ROSTER (${coords.length} affiliated schools):\n${lines.join('\n')}`
        } catch (err) {
          console.warn('[keith] coordinator roster failed (non-fatal):', err.message)
          return ''
        }
      })()

      // ── All server-side DB fetches use a single client with hoisted credentials ──
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

      let commsSection = '';
      let unitResponseSection = '';
      let unitLeaderSection = '';

      if (supabaseUrl && serviceKey) {
        const dbkeith = createClient(supabaseUrl, serviceKey);

        // Recent communications
        try {
          const recentComms = await getRecentCommunications(dbkeith, { limit: 30, sinceDays: 30 });
          if (recentComms.length > 0) {
            commsSection = `\n\nRecent notifications sent (last 30 days, ${recentComms.length} entries):\n` +
              recentComms.slice(0, 30).map(c => {
                const ts = formatTimestampPT(c.sent_at) || 'unknown';
                return `- [${c.notification_type}] to ${c.recipient_name || c.recipient_email} (${c.audience}) | ${c.subject} | ${c.status} | ${ts}`;
              }).join('\n');
          }
        } catch (commsErr) {
          console.warn('[keith] communications fetch failed (non-fatal):', commsErr.message);
        }

        // Unit response stats
        try {
          const activeCohortId = liveData.activeCohortId || liveData.cohort?.id;
          if (activeCohortId) {
            const stats = await getUnitResponseStats(dbkeith, activeCohortId);
            if (stats) {
              // Fetch full response rows for per-unit slot+shift detail
              const allResponses = await getUnitResponses(dbkeith, activeCohortId);
              const hostingRows = allResponses.filter(r => r.response_status === 'submitted_hosting')
                .sort((a, b) => a.unit_name.localeCompare(b.unit_name));
              const hostingLines = hostingRows.map(r => {
                const shift = r.shift_preference ? ` (${r.shift_preference})` : '';
                return `  - ${r.unit_name}: ${r.slots_offered} slot${r.slots_offered === 1 ? '' : 's'}${shift}`;
              }).join('\n') || '  (none)';

              unitResponseSection = `\n\nPLACEMENT CAPACITY (${cohort?.name || 'current cohort'}):
Response rate: ${stats.response_rate}% (${stats.hosting_count + stats.not_hosting_count} of ${stats.total_units} units responded)
Hosting (${stats.hosting_count} units, ${stats.total_slots} slots confirmed):
${hostingLines}
Not hosting (${stats.not_hosting_count} units):
${stats.not_hosting_units.map(u => `  - ${u}`).join('\n') || '  (none)'}
Pending / no response (${stats.pending_count} units):
${stats.pending_units.map(u => `  - ${u}`).join('\n') || '  (none)'}`;
            }
          }
        } catch (unitErr) {
          console.warn('[keith] unit response fetch failed (non-fatal):', unitErr.message);
        }

        // Unit leadership roster — full roster, all roles, not just primary leads
        try {
          const leaders = await getUnitLeadersForKeith(dbkeith);
          if (leaders.length > 0) {
            const byUnit = {};
            leaders.forEach(l => {
              if (!byUnit[l.unit_name]) byUnit[l.unit_name] = [];
              byUnit[l.unit_name].push(l);
            });
            const rosterLines = Object.entries(byUnit).map(([unit, team]) => {
              const primary = team.find(l => l.is_primary_lead);
              const ops     = team.filter(l => !l.is_primary_lead);
              const primaryDisplay = primary
                ? (() => {
                    const addressedAs = primary.preferred_name
                      ? `, addressed as ${primary.preferred_name}`
                      : '';
                    return `${primary.full_name} <${primary.email}> (${primary.role}, primary lead${addressedAs})`;
                  })()
                : '(no primary lead on file)';
              const opsLine = ops.length
                ? `; Operational team: ${ops.map(l => `${l.full_name} <${l.email}> (${l.role_qualifier || l.role})`).join(', ')}`
                : '';
              return `  ${unit}: ${primaryDisplay}${opsLine}`;
            }).join('\n');
            // Nursing executive layer (synchronous — no extra DB call needed)
            const execData = getNursingExecutiveLeadership();
            const execLines = execData.map(exec => {
              const nameStr = exec.preferred_name
                ? `${exec.full_name} (known as ${exec.preferred_name})`
                : exec.full_name;
              const credStr = exec.credentials ? `, ${exec.credentials}` : '';
              const addlStr = exec.additional_title ? ` | also: ${exec.additional_title}` : '';
              const unitsStr = exec.related_units?.length
                ? `; oversees: ${exec.related_units.join(', ')}`
                : '';
              return `  ${nameStr}${credStr}: ${exec.role}${addlStr}${unitsStr}`;
            }).join('\n');
            unitLeaderSection = `\n\nUNIT LEADERSHIP ROSTER (${Object.keys(byUnit).length} units — authoritative, do not invent names outside this list):
${rosterLines}

NURSING EXECUTIVE LEADERSHIP (layer above unit Associate Directors — do not confuse with AD-level contacts):
${execLines}`;
          } else {
            unitLeaderSection = '\n\nUNIT LEADERSHIP ROSTER: No data returned from database.';
          }
        } catch (leaderErr) {
          console.warn('[keith] unit leader fetch failed (non-fatal):', leaderErr.message);
          unitLeaderSection = '\n\nUNIT LEADERSHIP ROSTER: Fetch error — do not fabricate names.';
        }
      }

      liveDataStr = `CURRENT DATE AND TIME (Pacific Time — your operational timezone):
- Today is ${todayLong}.
- Current time is ${nowTime}.
- ISO date for "today": ${todayIso}.
- All timestamps in this context are already formatted in Pacific Time.
- When users say "today", "yesterday", "this week", or "recently", interpret from Pacific Time, not UTC.
- "Today" = ${todayIso}. "Yesterday" = the calendar date before that. Cedars-Sinai operates in Los Angeles.

=== LIVE COHORT DATA (React Query cache snapshot) ===
Today: ${today}

${cohortContext}

Total students in cohort: ${liveData.students.length}

Status breakdown:
${statusSummary}

On campus today (${(liveData.onCampusToday || []).length} shifts):
${onCampusLines}

Pending interview / Form Received (${pendingInterview.length}):
${pendingLines}

Placed — full detail (${placed.length}):
${placementLines}

Active Rotation (${activeRotation.length}):
${activeList}

Needs CS-Link (${needsCsLink.length}):
${safeList(needsCsLink)}

Needs badge (${needsBadge.length}):
${safeList(needsBadge)}
${commsSection}
${coordRoster}
${unitResponseSection}
${unitLeaderSection}
=== END LIVE DATA ===

SCHOOL COORDINATOR AWARENESS:
- liveData includes the full ASPIRE school coordinator roster in the SCHOOL COORDINATOR ROSTER section above.
- When asked "who is the coordinator at [school]?": look up the school, mention the primary contact and their title.
- If programRoutes exists (Cal State LA), mention program-type routing: ABSN students → Alyssa Manlangit, BSN students → Marissa Grafil Ramirez.
- If a CC list exists (WCU campuses), mention who's CC'd on notifications.
- Cross-reference with recentCommunications: "what schools haven't been contacted recently?" = filter communications by audience='school_coordinator' and compare against roster.

UNIT RESPONSE AWARENESS:
- Your context includes a PLACEMENT CAPACITY section with the exact hosting/not-hosting/pending breakdown for the current cohort. Use it. Never say you lack this data if the section is populated.
- Your context includes a UNIT LEADERSHIP ROSTER. For any unit leader question, look up the unit by exact canonical name in that roster and return the listed names verbatim. Never substitute a name from a different unit.
- When a user mentions a unit informally ("the SICU", "8 SE/SW"), translate to canonical first using the translation table in your prompt, then look up.
- If a unit name is not in the roster, say so explicitly rather than guessing.
- When Jester asks for an executive-summary report on unit responses (e.g., "draft a unit response summary for Margo"), generate a well-structured email. Do not send it automatically.

COMMUNICATION AWARENESS:
- liveData above includes recent notifications sent through the ASPIRE notification system (last 30 days).
- Use this to answer: "When was [person] last contacted?", "What did we send to [school]?", "Has [student] received their confirmation email?", "Which schools are we in contact with?"
- Reference notification_type, audience, recipient name, status, and sent_at when citing communications.
- If delivered_at or opened_at is null, the email was sent but no delivery confirmation yet.
- Never invent communications not in the log. If asked "did we send X?" and there's no matching record, say so.

CRITICAL DATA ACCESS RULES:
- The LIVE COHORT DATA above contains full student records including school_email, personal_email, phone, GPA, program type, term dates (rotation dates), unit, preceptor, shift, hours progress, and unit leader contacts.
- When drafting any email (preceptor welcome, unit leader, student scheduling link, etc.), populate EVERY field from the data above. Do NOT use bracket placeholders like [student email] or [start date] when the real value appears in LIVE COHORT DATA.
- If a field is literally null or N/A in the data, state that clearly. Never invent or bracket-substitute it.
- Do NOT tell the user to check the Embed tab, Student Profiles, or any other part of the app when the answer is in this prompt.
- Only say data is unavailable if it genuinely does not appear anywhere in LIVE COHORT DATA.`;
    } catch (e) {
      liveDataStr = `LIVE COHORT DATA: Cache read error (${e.message})`;
    }
  }

  // Determine tool access from userProfile role (matches existing request-body trust pattern)
  const role        = userProfile?.role || '';
  const canUseTools = userProfile?.is_owner || ['admin', 'interviewer'].includes(role);
  const activeCohortId = liveData?.activeCohortId || liveData?.cohort?.id || null;

  // Build system prompt; append tool instructions for tool-enabled users
  const baseSystemPrompt = buildSystemPrompt({ userProfile, context, cohortName, liveDataStr });
  const toolInstruction  = canUseTools ? `

LIVE DATA TOOLS -- USE THESE INSTEAD OF HEDGING:
You have four read-only tools to query live ASPIRE data. Call them whenever a question requires specific student, unit, or cohort information:

- search_students(status?, school?, program_type?, min_gpa?, limit?): find students matching filters. Call this first to identify candidates.
- get_student_detail(student_id): full record including rubric scores, recommendations, preferences, rotation dates, recent communications. Call AFTER identifying a student via search_students.
- get_unit_details(unit_name): unit info, current placements, open slots, students who listed it as 1st/2nd/3rd preference.
- get_cohort_summary(cohort_id?): cohort-wide stats, status breakdown, placement counts, rotation window.

Workflow for placement recommendations: (1) call get_unit_details to see demand and open slots; (2) call search_students(status="Interviewed") to find eligible candidates; (3) call get_student_detail on top candidates to compare rubric scores and rationale; (4) present a grounded recommendation with specific scores.

Never hedge by saying "you should check the Interview Room" when the tools can answer the question directly. Never speculate about scores or recommendations you have not seen in a tool result. If data is missing, say so explicitly.

Be transparent: after forming a recommendation, briefly note which tools you used and what they showed.
`.trim() : '';

  const systemPrompt = baseSystemPrompt + (toolInstruction ? '\n\n' + toolInstruction : '');

  // Tools array: omit entirely for viewer role so Claude never sees them
  const activeTools = canUseTools ? KEITH_TOOLS : [];

  // Set up Supabase service client for tool execution
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const toolsSupabase = (canUseTools && supabaseUrl && serviceKey)
    ? createClient(supabaseUrl, serviceKey)
    : null;

  try {
    const { text, toolCalls } = await runToolLoop(
      anthropicMessages,
      systemPrompt,
      activeTools,
      toolsSupabase,
      activeCohortId
    );
    if (!text) return res.status(502).json({ error: 'Unexpected AI response format' });
    return res.status(200).json({ response: text, tool_calls: toolCalls });
  } catch (err) {
    console.error('[keith] all retries exhausted:', err.details || err.message);
    const errorType = err.details?.errorType;
    let userMessage;
    if (errorType === 'overloaded_error') {
      userMessage = "Keith is briefly unavailable due to high demand on Anthropic's API. Try again in a moment.";
    } else if (errorType === 'rate_limit_error') {
      userMessage = "Keith hit a rate limit. Try again in a moment.";
    } else {
      userMessage = `Keith couldn't reach his model right now (${err.details?.status || 'network error'}). Try again in a moment -- if the issue persists, check Vercel function logs.`;
    }
    return res.status(503).json({ response: userMessage, error: err.details, transient: true });
  }
}

async function callAnthropicWithRetry(payload, options = {}) {
  const { maxRetries = 3, baseDelayMs = 800 } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) return await response.json();

      const errorBody = await response.json().catch(() => ({}));
      const errorType = errorBody?.error?.type;
      const status = response.status;

      const isRetryable =
        status === 429 || status === 500 || status === 502 ||
        status === 503 || status === 529 ||
        errorType === 'overloaded_error' ||
        errorType === 'rate_limit_error' ||
        errorType === 'api_error';

      if (!isRetryable || attempt === maxRetries) {
        lastError = { status, errorType, message: errorBody?.error?.message || `HTTP ${status}`, details: errorBody };
        break;
      }

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(`[keith] Anthropic ${errorType || status} on attempt ${attempt + 1}, retrying in ${Math.round(delay)}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (err) {
      if (attempt === maxRetries) { lastError = { message: err.message }; break; }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(`[keith] network error on attempt ${attempt + 1}, retrying in ${Math.round(delay)}ms:`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const error = new Error(lastError?.message || 'Anthropic API failed after retries');
  error.details = lastError;
  throw error;
}
