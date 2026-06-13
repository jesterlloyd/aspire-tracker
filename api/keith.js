// IMPORTANT: Supabase query builders return thenables, not Promises.
// Do NOT use .catch() on them -- it throws "is not a function".
// Use: const { error } = await supabase.from(...).insert(...)
// Or:  try { await supabase.from(...).insert(...) } catch (err) { ... }
// Regular fetch() and response.json() ARE Promises -- .catch() is fine there.

import { buildSystemPrompt, GOVERNED_KNOWLEDGE_MARKER, getRecentCommunications, getUnitResponseStats, getUnitResponses, getUnitLeadersForKeith } from '../src/lib/keithKnowledge.js';
import { retrieveGovernedKnowledge } from '../lib/server/keith/knowledgeRetrieval.js';
import { computeStatusCounts, STATUS_DEFINITIONS } from '../src/lib/derivations/cohortStatus.js';
import { summarizeCsLink } from '../src/lib/derivations/csLink.js';
import { classifyIntent, INTENTS } from '../lib/server/keith/queryIntent.js';
import { answerPersonContactQuery, CONTACTS_ROLE_DENIED } from '../lib/server/keith/contactsLookup.js';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const KEITH_TOTAL_DEADLINE_MS          = 25000;
const KEITH_CONTEXT_TIMEOUT_MS         = 5000;
const KEITH_ANTHROPIC_TIMEOUT_MS       = 18000;
const KEITH_TOOL_LOOP_MIN_REMAINING_MS = 4000;

function makeServiceRoleClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (...args) => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), KEITH_CONTEXT_TIMEOUT_MS);
        return fetch(args[0], { ...args[1], signal: controller.signal })
          .finally(() => clearTimeout(t));
      },
    },
  });
}

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

// ── WS1: server-verified caller identity (replaces client-supplied trust) ─────
// Authorization derives ONLY from the verified Supabase JWT + the user_profiles
// row keyed by auth_user_id. req.body.userProfile is display-only and is NEVER
// trusted for any authorization decision. Reuses the project's standard
// anon-userClient + getUser + supabaseAdmin profile-lookup pattern.
async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { authenticated: false, status: 401, error: 'unauthorized', message: 'Authentication required', reason: 'missing_token' };
  }
  const url     = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  let user;
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user) {
      return { authenticated: false, status: 401, error: 'unauthorized', message: 'Authentication required', reason: 'invalid_token' };
    }
    user = data.user;
  } catch {
    return { authenticated: false, status: 401, error: 'unauthorized', message: 'Authentication required', reason: 'verify_threw' };
  }
  try {
    const admin = makeServiceRoleClient();
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) {
      return { authenticated: false, status: 401, error: 'unauthorized', message: 'Authentication required', reason: 'profile_lookup_failed' };
    }
    if (!profile) {
      return { authenticated: false, status: 403, error: 'forbidden', message: 'Profile not found. Contact the ASPIRE team.', reason: 'no_profile' };
    }
    return { authenticated: true, userId: user.id, role: profile.role || '', isOwner: profile.is_owner === true };
  } catch {
    return { authenticated: false, status: 401, error: 'unauthorized', message: 'Authentication required', reason: 'profile_threw' };
  }
}

// ── WS1: server-authoritative per-tool authorization matrix ───────────────────
// Preserves the prior EFFECTIVE access (owner OR admin OR interviewer → all
// tools; every other role → none) but now derived from server-verified identity
// and structured per-tool. Default deny: unknown tool or unlisted role → denied.
// DEFERRED (Owner decision — see pre-commit report): co-lead/co_lead currently
// have NO Keith tool access. Whether to grant it, and which exact role string the
// live DB uses, is unverified — do NOT add an unverified role string here.
const TOOL_AUTHORIZATION = {
  search_students:    { allowedRoles: ['admin', 'interviewer'], allowOwner: true },
  get_student_detail: { allowedRoles: ['admin', 'interviewer'], allowOwner: true },
  get_unit_details:   { allowedRoles: ['admin', 'interviewer'], allowOwner: true },
  get_cohort_summary: { allowedRoles: ['admin', 'interviewer'], allowOwner: true },
};
function isToolAllowed(toolName, role, isOwner) {
  const policy = TOOL_AUTHORIZATION[toolName];
  if (!policy) return false;                 // unknown tool → deny
  if (isOwner && policy.allowOwner) return true;
  return policy.allowedRoles.includes(role);
}

// ── WS1: grounding / source-precedence / unsupported-claim guardrails ─────────
const GROUNDING_GUARDRAILS = `
=== GROUNDING & SOURCE RULES (AUTHORITATIVE) ===

INTERIM SOURCE PRECEDENCE — when sources disagree, trust in this order:
1. Live operational database (your tools / the LIVE COHORT DATA block) — AUTHORITATIVE for any current student, placement, school, unit, preceptor, dates, hours, status, or contact.
2. General program guidance (the background knowledge in this prompt) — usable ONLY to explain how the program works in general terms. It is NOT a source of current operational facts and must NEVER override live data.
3. Your own wording — you compose language; you NEVER invent operational facts.

GROUNDING REQUIREMENTS
When the request involves a specific student, placement, unit, preceptor, school, rotation dates, or required hours you MUST:
1. Identify the specific live record. If you cannot identify the exact record (e.g. an ambiguous first name matching multiple students), ask the user to clarify before drafting.
2. Verify the relevant live fields (use your tools if available); do not draft from memory or assumption.
3. Begin placement-specific communication drafts with a compact verification block:
   Using these assignment details:
   - Student: <name>
   - School: <school>
   - Cohort: <cohort>
   - Unit: <unit>
   - Preceptor: <preceptor>
   - Shift type: <shift type>
   - Rotation dates: <start> to <end>
   - Required hours: <hours>
   Include only fields relevant to the draft; mark any unavailable field as "Unavailable" rather than omitting it silently.
4. If fields conflict across sources, STOP and surface the conflict with the competing values; do not pick a best guess; ask the user to resolve it.
5. Never silently substitute data from another student, school, unit, preceptor, or placement. If a record's data is missing, say so explicitly.

UNSUPPORTED CLAIMS — do NOT state any of the following unless verified via a live tool or the live data block:
- that an attachment is included or available
- that a policy applies, or a restriction is in effect, for a specific situation
- that a recipient email exists
- that a preceptor or unit leader has agreed to anything
- that an assignment is confirmed
- that a school or program is associated with a specific student
- that a rotation date or required-hours value is correct for a specific student
For attachments, distinguish: attached to this request / available in a verified record / recommended for the user to attach / unavailable.

MISSING DATA — mark the field "Unavailable", do not invent it, do not imply it exists elsewhere, and do not claim a draft is "ready to send" when required recipient information is missing.

The background program knowledge that follows is GENERAL GUIDANCE ONLY, subordinate to live data per the precedence above.
`.trim();

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
          .select('id, first_name, last_name, school, program_type, status, cumulative_gpa, school_email, personal_email, phone, unit_preference_1, unit_preference_2, unit_preference_3, matched_unit_id, matched_preceptor, preceptor_id, shift_assigned, interview_scheduled_date, interview_scheduled_time, interview_assigned_interviewers, avg_composite_score, avg_cj_score, avg_pp_score, avg_ga_score, auto_recommendation, score_flag, score_flag_message, rubric_count, cs_stage1_submitted, cs_link_complete, badge_created, approved_hours, hours_required, flagged_for_second_interview, flag_note, cohort_school_rotation_id, interest_statement, headshot_url, resume_url')
          .eq('id', input.student_id)
          .single();
        if (error || !student) return { error: 'Student not found' };

        // Resolve preceptor via FK when free-text field is empty
        let resolvedStudent = student;
        if ((!student.matched_preceptor || !student.matched_preceptor.trim()) && student.preceptor_id) {
          const { data: pRec } = await supabase
            .from('preceptors')
            .select('full_name, email')
            .eq('id', student.preceptor_id)
            .single();
          if (pRec?.full_name) {
            resolvedStudent = {
              ...student,
              matched_preceptor: pRec.full_name,
              ...(pRec.email && !student.preceptor_email ? { preceptor_email: pRec.email } : {}),
            };
          }
        }

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
          student: stripSensitive(resolvedStudent),
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

async function runToolLoop(initialMessages, systemPrompt, tools, supabase, activeCohortId, timeRemaining, auth, requestId) {
  const messages = [...initialMessages];
  const allToolCalls = [];
  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (timeRemaining && timeRemaining() < KEITH_TOOL_LOOP_MIN_REMAINING_MS) {
      return {
        text: allToolCalls.length > 0
          ? "I ran out of time before completing all research steps. Here's what I found so far — please ask again for more detail."
          : "I ran out of time before responding. Please try again.",
        toolCalls: allToolCalls,
      };
    }

    const payload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    };
    if (tools && tools.length > 0) payload.tools = tools;

    const response = await callAnthropicWithRetry(payload, { timeRemaining });
    // [keith-tokens]: PII-free token instrumentation from the model usage block.
    const usage = response?.usage || {};
    console.log('[keith-tokens]', {
      request_id: requestId,
      round,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
    });
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

      // WS1: defense-in-depth recheck at execution time. Even though the model
      // only sees allowed tools, never trust it to stay within them. Deny →
      // return an is_error tool_result (no record existence disclosed).
      const allowed = !!auth && isToolAllowed(block.name, auth.role, auth.isOwner);
      if (!allowed) {
        console.log('[keith] tool denied', { tool: block.name, role: auth?.role, is_owner: auth?.isOwner === true, request_id: requestId });
        allToolCalls.push({ tool: block.name, input: undefined, result_summary: 'access denied' });
        try {
          await supabase.from('program_events').insert({
            student_id:  null,
            cohort_id:   activeCohortId,
            event_type:  'keith_tool_call',
            event_date:  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()),
            notes:       `Keith tool DENIED ${block.name} | role=${auth?.role || 'none'} owner=${auth?.isOwner === true} authorized=false req=${requestId}`,
            created_by:  'system',
          })
        } catch (auditEx) { console.warn('[keith audit] threw:', auditEx.message) }
        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          is_error:    true,
          content:     'Access denied. This information is not available for your role. Continue with general program guidance only.',
        });
        continue;
      }

      const result  = await executeToolCall(block.name, block.input, auth.role, supabase, activeCohortId);
      const summary = generateResultSummary(block.name, result);
      allToolCalls.push({ tool: block.name, input: block.input, result_summary: summary });

      // Audit log -- non-blocking; a logging failure must never crash the user
      // request. PII-free: record tool name + server-verified role/owner +
      // authorized flag + request id only (never names/emails/summary text).
      try {
        const { error: auditErr } = await supabase.from('program_events').insert({
          student_id:  null,
          cohort_id:   activeCohortId,
          event_type:  'keith_tool_call',
          event_date:  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()),
          notes:       `Keith called ${block.name} | role=${auth?.role || 'none'} owner=${auth?.isOwner === true} authorized=true req=${requestId}`,
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

  // WS1: verify the caller server-side. ALL authorization below derives from this
  // result — never from req.body. Assistant-level access is preserved (any
  // authenticated user with a profile may chat); tools are gated per-role below.
  const requestId = `req_${randomUUID().slice(0, 8)}`;
  const auth = await verifyCaller(req);
  if (!auth.authenticated) {
    console.log('[keith] auth rejected', { reason: auth.reason, request_id: requestId });
    return res.status(auth.status).json({ error: auth.error, message: auth.message });
  }

  const deadline = Date.now() + KEITH_TOTAL_DEADLINE_MS;
  const timeRemaining = () => deadline - Date.now();

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

  // KLD-1.1: deterministic query-intent classification BEFORE context assembly. Intent
  // gates which live sources the model is shown, so it cannot infer from a source it
  // must not use. The user's text is used only for classification and is NEVER logged.
  const lastUserText = [...anthropicMessages].reverse().find(m => m.role === 'user')?.content || '';
  const intent = classifyIntent(lastUserText);
  const isPersonContactRole = intent === INTENTS.PERSON_CONTACT_ROLE;
  const allowRoster = intent === INTENTS.EMAIL_DRAFTING; // unit-leadership roster: drafting only
  console.log('[keith-intent]', { request_id: requestId, intent }); // PII-free: label only

  // CONTACTS-1b/1d: person/contact/role questions are answered deterministically from
  // ASPIRE Connect Contacts, BEFORE any prompt/context assembly, governed retrieval, or
  // model call. This structurally guarantees that no adjacent person-bearing source
  // (cohort/student data, unit leadership roster, communications) and no tool is ever
  // involved for these queries — they short-circuit here.
  // CONTACTS-1d: role gate aligned with confirmed ASPIRE Connect UI access — Owner,
  // Admin, and Interviewer may use Contacts lookup; Viewer and all other/unknown roles
  // remain denied (pending separate Owner confirmation of their UI Contacts access).
  if (isPersonContactRole) {
    const normalizedRole = String(auth.role || '').toLowerCase();
    const contactsAllowed = auth.isOwner === true || ['owner', 'admin', 'interviewer'].includes(normalizedRole);
    if (!contactsAllowed) {
      // Do NOT look up or confirm whether a record exists for an unauthorized role.
      console.log('[keith-contacts]', { request_id: requestId, intent, role_gate: 'fail' });
      return res.status(200).json({ response: CONTACTS_ROLE_DENIED, tool_calls: [] });
    }
    const { response, resultCount, error } = await answerPersonContactQuery(makeServiceRoleClient(), lastUserText);
    // [keith-contacts]: PII-free — no query text, names, emails, or contact content.
    console.log('[keith-contacts]', { request_id: requestId, intent, role_gate: 'pass', result_count: resultCount ?? 0, ...(error ? { error } : {}) });
    return res.status(200).json({ response, tool_calls: [] });
  }

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
  if (isPersonContactRole) {
    // KLD-1.1: for person/contact/role questions, withhold ALL person-bearing live
    // sources (cohort/student data, unit leadership roster, communications). The model
    // is shown only date/time and an explicit redirect, so it cannot name a person,
    // suggest an adjacent leader, or claim a person does not exist / is not in context.
    liveDataStr = `CURRENT DATE AND TIME (Pacific Time): Today is ${todayLong}; current time ${nowTime}.

CONTACT/ROLE QUESTION — SOURCES WITHHELD BY DESIGN:
Live person, contact, and role sources (cohort/student data, unit leadership roster, communications logs) are intentionally NOT loaded for this question, and live ASPIRE Connect Contacts access is not yet available to you.
Respond ONLY with: live ASPIRE Connect Contacts access is not yet available, so you cannot verify current contact or role records, and the user should verify the person or role in ASPIRE Connect Contacts.
Do NOT name any person. Do NOT suggest an adjacent unit leader or alternative contact. Do NOT say the person does not exist, is not in your context, or is absent from cohort/roster/communications.`;
  } else if (liveData && Array.isArray(liveData.students)) {
    try {
      const today = todayIso; // Pacific-aware; replaces plain new Date().toLocaleDateString('en-CA')

      // Build a student lookup map for joining shift logs
      const studentMap = {};
      liveData.students.forEach(s => { studentMap[s.id] = s; });

      // KLD-1: canonical status + CS-Link summaries from the shared derivation modules
      // (the exact logic the Student Profiles KPI strip and CS-Link Access table use),
      // so Keith's live answers match the UI instead of a divergent local derivation.
      const statusCounts  = computeStatusCounts(liveData.students);
      const csLinkSummary = summarizeCsLink(liveData.students);

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
      // KLD-1: the legacy single-boolean "Needs CS-Link" derivation is retired in favor
      // of the canonical five-category csLinkSummary computed above.
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

      // Preceptor FK fallback — fires only when cached matched_preceptor is empty
      // but students.preceptor_id is set (data-consistency gap between FK and free-text field).
      // Queries the preceptors table directly using the service role client.
      // Skipped entirely when all placed students already have matched_preceptor populated.
      let preceptorFallbackMap = {};
      const studentsNeedingPreceptorLookup = placed
        .filter(s => (!s.matched_preceptor || !s.matched_preceptor.trim()) && s.preceptor_id);
      if (studentsNeedingPreceptorLookup.length > 0) {
        console.log('[keith] preceptor FK fallback fired for', studentsNeedingPreceptorLookup.length, 'students');
        const preceptorIds = [...new Set(studentsNeedingPreceptorLookup.map(s => s.preceptor_id))];
        try {
          const dbFallback = makeServiceRoleClient();
          const { data: preceptorRecords, error: preceptorLookupError } = await dbFallback
            .from('preceptors')
            .select('id, full_name')
            .in('id', preceptorIds);
          if (preceptorLookupError) {
            console.error('[keith] preceptor fallback lookup failed:', preceptorLookupError.message);
          } else if (preceptorRecords) {
            preceptorFallbackMap = preceptorRecords.reduce((acc, p) => {
              acc[p.id] = p.full_name;
              return acc;
            }, {});
          }
        } catch (err) {
          console.error('[keith] preceptor fallback lookup threw:', err.message);
        }
      }

      // Detailed placement block — one record per placed student
      const placementLines = placed.slice(0, 50).map(s => {
        const match         = matchesByStudentId[s.id];
        const unit          = unitMap[s.matched_unit_id] || match?.unit || {};
        const completedHrs  = (liveData.shiftLogProgress || {})[s.id] || 0;
        const requiredHrs   = s.hours_required || 90;
        const remainingHrs  = Math.max(0, requiredHrs - completedHrs);
        const quality       = match?.match_quality || '';
        // Resolve preceptor: free-text (matched_preceptor) → FK lookup → 'pending'
        const preceptorName = (s.matched_preceptor && s.matched_preceptor.trim())
          ? s.matched_preceptor
          : (s.preceptor_id && preceptorFallbackMap[s.preceptor_id]) || 'pending';
        return [
          `- ${s.last_name}, ${s.first_name}`,
          `  School: ${s.school || 'N/A'} | Program: ${s.program_type || 'N/A'} | GPA: ${s.cumulative_gpa || 'N/A'}`,
          `  School Email: ${s.school_email || 'N/A'} | Personal Email: ${s.personal_email || 'N/A'} | Phone: ${s.phone || 'N/A'}`,
          `  Unit: ${unit.unit_name || 'pending'}${unit.division ? ` [${unit.division}]` : ''}`,
          `  Preceptor: ${preceptorName} | Shift: ${s.shift_assigned || s.shift_availability || 'N/A'}`,
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

      // KT-5: the static SCHOOL COORDINATOR ROSTER (a hard-coded directory) is no
      // longer injected. Current people/contact information is governed by ASPIRE
      // Connect Contacts (live contact retrieval is a future phase).

      // ── All server-side DB fetches use a single client with hoisted credentials ──
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

      let commsSection = '';
      let unitResponseSection = '';
      let unitLeaderSection = '';

      if (supabaseUrl && serviceKey) {
        const dbkeith = makeServiceRoleClient();
        const ctxCohortId = liveData.activeCohortId || liveData.cohort?.id;

        // All four context fetches run in parallel; individual failures get unavailable placeholders
        const [commsResult, statsResult, responsesResult, leadersResult] = await Promise.allSettled([
          getRecentCommunications(dbkeith, { limit: 30, sinceDays: 30 }),
          ctxCohortId ? getUnitResponseStats(dbkeith, ctxCohortId) : Promise.resolve(null),
          ctxCohortId ? getUnitResponses(dbkeith, ctxCohortId) : Promise.resolve([]),
          // KLD-1.1: the unit-leadership roster (person-bearing) is fetched ONLY for
          // email drafting; other intents never receive it as a people directory.
          allowRoster ? getUnitLeadersForKeith(dbkeith) : Promise.resolve([]),
        ]);

        // Recent communications
        if (commsResult.status === 'fulfilled' && commsResult.value?.length > 0) {
          const recentComms = commsResult.value;
          commsSection = `\n\nRecent notifications sent (last 30 days, ${recentComms.length} entries):\n` +
            recentComms.slice(0, 30).map(c => {
              const ts = formatTimestampPT(c.sent_at) || 'unknown';
              return `- [${c.notification_type}] to ${c.recipient_name || c.recipient_email} (${c.audience}) | ${c.subject} | ${c.status} | ${ts}`;
            }).join('\n');
        } else if (commsResult.status === 'rejected') {
          console.warn('[keith] communications fetch failed (non-fatal):', commsResult.reason?.message);
          commsSection = '\n\nCOMMUNICATIONS: Fetch error — data unavailable for this response';
        }

        // Unit response stats + responses
        const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
        const allResponses = responsesResult.status === 'fulfilled' ? responsesResult.value : null;
        if (statsResult.status === 'rejected' || responsesResult.status === 'rejected') {
          const errMsg = statsResult.status === 'rejected'
            ? statsResult.reason?.message : responsesResult.reason?.message;
          console.warn('[keith] unit response fetch failed (non-fatal):', errMsg);
          unitResponseSection = '\n\nPLACEMENT CAPACITY: Fetch error — data unavailable for this response';
        } else if (stats && ctxCohortId) {
          const hostingRows = (allResponses || []).filter(r => r.response_status === 'submitted_hosting')
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

        // Unit leadership roster — full roster, all roles, not just primary leads.
        // KLD-1.1: only assembled for email_drafting intent (allowRoster); for every
        // other intent unitLeaderSection stays empty so the roster never enters context.
        if (allowRoster && leadersResult.status === 'fulfilled') {
          const leaders = leadersResult.value;
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
            // KT-5: the static NURSING EXECUTIVE LEADERSHIP layer (hard-coded names)
            // is no longer injected. The live UNIT LEADERSHIP ROSTER below is genuine
            // live data and is retained; executive/contact lookups belong to ASPIRE
            // Connect Contacts (a future retrieval phase).
            unitLeaderSection = `\n\nUNIT LEADERSHIP ROSTER (${Object.keys(byUnit).length} units — authoritative, do not invent names outside this list):
${rosterLines}`;
          } else {
            unitLeaderSection = '\n\nUNIT LEADERSHIP ROSTER: No data returned from database.';
          }
        } else if (allowRoster) {
          console.warn('[keith] unit leader fetch failed (non-fatal):', leadersResult.reason?.message);
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

COHORT STATUS (canonical, per Student Profiles live data — use these exact status names and never merge buckets):
Total students: ${statusCounts.total}
Not Proceeding: ${statusCounts.notProceeding} (${STATUS_DEFINITIONS['Not Proceeding']})
Placed: ${statusCounts.placed} (${STATUS_DEFINITIONS['Placed']})
Active Rotation: ${statusCounts.activeRotation} (${STATUS_DEFINITIONS['Active Rotation']})
Completed: ${statusCounts.completed} (${STATUS_DEFINITIONS['Completed']})
Interviewed: ${statusCounts.interviewed} · Awaiting Interview: ${statusCounts.awaitingInterview} · Needs Outreach: ${statusCounts.needsOutreach}
Placed does NOT mean rotating. When summarizing the cohort, state the total, then Not Proceeding, then Placed and Active Rotation with their definitions; never describe Placed students as rotating.

On Campus Now (${(liveData.onCampusToday || []).length} shifts):
${onCampusLines}

Pending interview / Form Received (${pendingInterview.length}):
${pendingLines}

Placed — full detail (${placed.length}):
${placementLines}

Active Rotation (${activeRotation.length}):
${activeList}

CS-LINK ACCESS (canonical five categories, per Student Profiles → CS-Link Access live data — report ONLY these categories, never a "Needs CS-Link" count):
${csLinkSummary.map(c => `  ${c.label}: ${c.count}`).join('\n')}

Needs badge (${needsBadge.length}):
${safeList(needsBadge)}
${commsSection}
${unitResponseSection}
${unitLeaderSection}
=== END LIVE DATA ===

UNIT RESPONSE AWARENESS:
- Your context includes a PLACEMENT CAPACITY section with the exact hosting/not-hosting/pending breakdown for the current cohort. Use it. Never say you lack this data if the section is populated.
- Your context may include a UNIT LEADERSHIP ROSTER. It is reference data for drafting correspondence to a known unit's leadership only. Do NOT answer standalone "who is", "who leads", "who holds role Y", or "who to contact" questions from it, and never infer a person or role (such as an NPD-P) from it. For current person/role/contact questions, say that live ASPIRE Connect Contacts access is not yet available and direct the user to ASPIRE Connect Contacts (never say a person does not exist or is not in your context).
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
- Do NOT tell the user to check a specific app workspace when the answer is already available in this prompt or governed Knowledge Center context.
- Only say data is unavailable if it genuinely does not appear anywhere in LIVE COHORT DATA.`;
    } catch (e) {
      liveDataStr = `LIVE COHORT DATA: Cache read error (${e.message})`;
    }
  }

  // WS1: tool access derives from the SERVER-VERIFIED identity only (never req.body).
  // Per-tool filtering means the model only ever sees tools this caller may use.
  // KLD-1.1: for person/contact/role questions, expose NO tools — the data tools query
  // adjacent person-bearing sources (students, units), which must not be used to infer
  // a contact or role. This makes source discipline structural, not instruction-only.
  const activeTools = isPersonContactRole
    ? []
    : KEITH_TOOLS.filter(t => isToolAllowed(t.name, auth.role, auth.isOwner));
  const canUseTools = activeTools.length > 0;
  const activeCohortId = liveData?.activeCohortId || liveData?.cohort?.id || null;

  // Build the system prompt from a SERVER-VERIFIED profile so the in-prompt role
  // reflects the true role (client-supplied role/is_owner are ignored for this).
  const verifiedProfile = { ...(userProfile || {}), role: auth.role, is_owner: auth.isOwner };
  let baseSystemPrompt = buildSystemPrompt({ userProfile: verifiedProfile, context, cohortName, liveDataStr });

  // KT-4: retrieve governed (Active) Knowledge Center entries for this question and
  // inject them as the authoritative source of truth ABOVE the legacy reference. The
  // retrieval is resilient (any failure yields a zero-coverage note so Keith still
  // answers from legacy fallback). The user's question is used only for lexical
  // scoring and is NEVER logged. (lastUserText was computed at intent classification.)
  const governed = await retrieveGovernedKnowledge(makeServiceRoleClient(), lastUserText);
  // KT-5: inject the governed block at the explicit GOVERNED_KNOWLEDGE_MARKER slot in
  // the scaffolding prompt (no legacy block remains). If the marker is somehow absent,
  // prepend safely so the governed block is never dropped.
  if (baseSystemPrompt.includes(GOVERNED_KNOWLEDGE_MARKER)) {
    baseSystemPrompt = baseSystemPrompt.replace(GOVERNED_KNOWLEDGE_MARKER, governed.block);
  } else {
    baseSystemPrompt = governed.block + '\n\n' + baseSystemPrompt;
  }
  // [keith-retrieval]: PII-free instrumentation. Records governed coverage + derived
  // entry metadata only — never the raw question, names, or message content.
  console.log('[keith-retrieval]', {
    request_id: requestId,
    governed_coverage: governed.governedCovered,
    matched: governed.matchedCount,
    slugs: governed.slugs,
    scores: governed.scores,
    block_chars: governed.blockChars,
    ...(governed.error ? { retrieval_error: governed.error } : {}),
  });

  const toolInstruction  = canUseTools ? `

LIVE DATA TOOLS -- USE THESE INSTEAD OF HEDGING:
You have four read-only tools to query live ASPIRE data. Call them whenever a question requires specific student, unit, or cohort information:

- search_students(status?, school?, program_type?, min_gpa?, limit?): find students matching filters. Call this first to identify candidates.
- get_student_detail(student_id): full record including rubric scores, recommendations, preferences, rotation dates, recent communications. Call AFTER identifying a student via search_students.
- get_unit_details(unit_name): unit info, current placements, open slots, students who listed it as 1st/2nd/3rd preference.
- get_cohort_summary(cohort_id?): cohort-wide stats, status breakdown, placement counts, rotation window.

Workflow for placement recommendations: (1) call get_unit_details to see demand and open slots; (2) call search_students(status="Interviewed") to find eligible candidates; (3) call get_student_detail on top candidates to compare rubric scores and rationale; (4) present a grounded recommendation with specific scores.

Never hedge by saying "you should check the Interviews workspace" when the tools can answer the question directly. Never speculate about scores or recommendations you have not seen in a tool result. If data is missing, say so explicitly.

Be transparent: after forming a recommendation, briefly note which tools you used and what they showed.
`.trim() : '';

  // WS1: grounding/source-precedence/unsupported-claim guardrails apply to ALL
  // callers (with or without tools). activeTools was computed above from the
  // server-verified identity.
  const systemPrompt =
    baseSystemPrompt +
    '\n\n' + GROUNDING_GUARDRAILS +
    (toolInstruction ? '\n\n' + toolInstruction : '');

  // Set up Supabase service client for tool execution
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const toolsSupabase = (canUseTools && supabaseUrl && serviceKey)
    ? makeServiceRoleClient()
    : null;

  if (timeRemaining() <= 0) {
    return res.status(503).json({
      response: "Keith couldn't reach his model right now (request deadline exceeded). Try again in a moment.",
      transient: true,
    });
  }

  try {
    const { text, toolCalls } = await runToolLoop(
      anthropicMessages,
      systemPrompt,
      activeTools,
      toolsSupabase,
      activeCohortId,
      timeRemaining,
      auth,
      requestId
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
  const { maxRetries = 1, baseDelayMs = 800, timeRemaining } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Before a retry (not first attempt), check deadline
    if (attempt > 0 && timeRemaining && timeRemaining() <= KEITH_ANTHROPIC_TIMEOUT_MS + 1000) {
      console.warn('[keith] skipping retry — insufficient time remaining');
      break;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), KEITH_ANTHROPIC_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

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
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.warn(`[keith] Anthropic call timed out on attempt ${attempt + 1}`);
        if (attempt === maxRetries || (timeRemaining && timeRemaining() <= KEITH_ANTHROPIC_TIMEOUT_MS + 1000)) {
          lastError = { message: 'Anthropic call timed out', errorType: 'timeout' };
          break;
        }
        const delay = baseDelayMs + Math.random() * 200;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
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
