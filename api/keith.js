import { buildSystemPrompt, getRecentCommunications, getSchoolCoordinators } from '../src/lib/keithKnowledge.js';
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

      // Fetch recent communications from notification_log (server-side, service role)
      // Build school coordinator roster for Keith awareness
      const coordRoster = (() => {
        try {
          const coords = getSchoolCoordinators()
          const lines = coords.map(({ school, primary, cc, programRoutes }) => {
            let line = `- ${school}: ${primary.name} <${primary.email}> (${primary.title})`
            if (programRoutes) {
              const routes = Object.entries(programRoutes)
              // Deduplicate by email to keep the output compact
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

      let commsSection = ''
      try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (supabaseUrl && serviceKey) {
          const dbkeith = createClient(supabaseUrl, serviceKey)
          const recentComms = await getRecentCommunications(dbkeith, { limit: 30, sinceDays: 30 })
          if (recentComms.length > 0) {
            commsSection = `\n\nRecent notifications sent (last 30 days, ${recentComms.length} entries):\n` +
              recentComms.slice(0, 30).map(c => {
                const ts = formatTimestampPT(c.sent_at) || 'unknown'
                return `- [${c.notification_type}] to ${c.recipient_name || c.recipient_email} (${c.audience}) | ${c.subject} | ${c.status} | ${ts}`
              }).join('\n')
          }
        }
      } catch (commsErr) {
        console.warn('[keith] communications fetch failed (non-fatal):', commsErr.message)
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
=== END LIVE DATA ===

SCHOOL COORDINATOR AWARENESS:
- liveData includes the full ASPIRE school coordinator roster in the SCHOOL COORDINATOR ROSTER section above.
- When asked "who is the coordinator at [school]?": look up the school, mention the primary contact and their title.
- If programRoutes exists (Cal State LA), mention program-type routing: ABSN students → Alyssa Manlangit, BSN students → Marissa Grafil Ramirez.
- If a CC list exists (WCU campuses), mention who's CC'd on notifications.
- Cross-reference with recentCommunications: "what schools haven't been contacted recently?" = filter communications by audience='school_coordinator' and compare against roster.

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

  const requestBody = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: buildSystemPrompt({ userProfile, context, cohortName, liveDataStr }),
    messages: anthropicMessages,
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: requestBody,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', response.status, JSON.stringify(data));
      return res.status(502).json({ error: 'Anthropic API error', details: data });
    }

    const text = data?.content?.[0]?.text;
    if (!text) return res.status(502).json({ error: 'Unexpected AI response format' });
    return res.status(200).json({ response: text });

  } catch (err) {
    console.error('Keith error:', err.message);
    return res.status(500).json({ error: 'Failed to reach AI service', message: err.message });
  }
}
