module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, context, cohortName } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'API key not configured' });
  }

  const systemPrompt = buildSystemPrompt(context, cohortName);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({
          role: m.role === 'keith' ? 'assistant' : 'user',
          content: m.text,
        })),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(502).json({ error: 'AI service error', details: data });
    }

    const text = data.content?.[0]?.text || 'I had trouble generating a response. Please try again.';
    return res.status(200).json({ response: text });

  } catch (err) {
    console.error('Keith handler error:', err.message);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
};

function buildSystemPrompt(context, cohortName) {
  const cohort = cohortName || 'the current cohort';

  let liveData = '';
  if (context) {
    const statusSummary = Object.entries(context.byStatus || {})
      .map(([status, students]) => `  ${status}: ${students.length}`)
      .join('\n');

    const onCampus = (context.onCampusToday || [])
      .map(s => `${s.student?.last_name}, ${s.student?.first_name} at ${s.unit} (${s.shiftType})`)
      .join(', ') || 'None logged today';

    const needsFollowUp = [
      context.needsStudentForm?.length ? `${context.needsStudentForm.length} need student form sent` : null,
      context.needsSchedulingLink?.length ? `${context.needsSchedulingLink.length} need interview scheduling link` : null,
      context.needsCsLink?.length ? `${context.needsCsLink.length} need CS-Link access started` : null,
      context.needsBadge?.length ? `${context.needsBadge.length} need badge created` : null,
      context.pendingShiftReviews ? `${context.pendingShiftReviews} shift logs pending review` : null,
    ].filter(Boolean).join(', ') || 'None';

    liveData = `
LIVE COHORT DATA (${cohort}):
Total students: ${context.totalStudents || 0}
Total unit slots: ${context.totalSlots || 0} (${context.totalRemaining || 0} remaining)
Status breakdown:\n${statusSummary || '  No students yet'}
Action items: ${needsFollowUp}
On campus today: ${onCampus}
Students needing student form: ${(context.needsStudentForm || []).map(s => `${s.last_name}, ${s.first_name}`).join('; ') || 'None'}
Students needing scheduling link: ${(context.needsSchedulingLink || []).map(s => `${s.last_name}, ${s.first_name}`).join('; ') || 'None'}
Students needing CS-Link started: ${(context.needsCsLink || []).map(s => `${s.last_name}, ${s.first_name}`).join('; ') || 'None'}
Students needing badge: ${(context.needsBadge || []).map(s => `${s.last_name}, ${s.first_name}`).join('; ') || 'None'}
Placed students: ${(context.placed || []).map(s => `${s.last_name}, ${s.first_name} → ${s.matched_unit_id || 'unit TBD'}`).join('; ') || 'None'}
Active rotation: ${(context.activeRotation || []).map(s => `${s.last_name}, ${s.first_name} (${s.approved_hours || 0}/${s.hours_required || 0} hrs)`).join('; ') || 'None'}
Completed: ${(context.completed || []).map(s => `${s.last_name}, ${s.first_name}`).join('; ') || 'None'}`;
  } else {
    liveData = 'LIVE COHORT DATA: Not available. Answer from ASPIRE program knowledge only.';
  }

  return `You are Keith, the AI assistant for the ASPIRE Program Tracker at Cedars-Sinai Medical Center. You were named in honor of Keith Hoshal, the creator of the ASPIRE Program.

ASPIRE stands for Affiliate Students' Pathway from Internship to Residency Experience. It places senior nursing students at Cedars-Sinai for their final clinical rotation and provides a pathway into the New Graduate RN Residency Program (NGRP).

Your user is Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN (Program Lead) or Krystal Rodriguez, DNP, RN, NPD-BC, CNOR (Program Co-Lead).

ASPIRE STATUS JOURNEY: Pending Outreach → Form Sent → Form Received → Interview Scheduled → Interviewed → Placed → Active Rotation → Completed → Declined

CS-LINK WORKFLOW: Stage 1 (Service Center): new students need Add Non-Employee, former students need Assignment Change/Extend End Date/Reactivate, Cedars employees skip Stage 1. Stage 2: Add CS-Link access for everyone.

EMAIL SIGNATURE TO USE IN ALL DRAFTED EMAILS:
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964

PRECEPTOR WELCOME EMAIL FORMAT (use this when asked to draft preceptor emails):
- Address preceptor by first name
- Thank them for agreeing to precept
- Include student name, school, program, rotation dates, hours required, student email, student phone
- Note: student will reach out to coordinate schedules
- Remind them to expect: Student Parking Data Form, Pre-licensure Student General Guidelines
- Mention preceptor pay (refer to Dr. Krystal Rodriguez), coverage, and floating
- Warm closing
- Full email signature

PRIVACY RULES - NEVER VIOLATE:
- Never include DOB, last 4 SSN, or sensitive identifiers in any response
- Never fabricate student data not present in the live context
- Draft emails only, never send automatically

RESPONSE STYLE:
- Warm, concise, professional - like a knowledgeable colleague
- Under 200 words unless drafting a full email
- Always suggest a concrete next action
- Use Last Name, First Name format for student lists
- If data is unavailable, say so honestly

${liveData}

Current cohort: ${cohort}`;
}
