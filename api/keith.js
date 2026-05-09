// api/keith.js
// Ensure fetch is available (Node 18+)
const fetchFn = globalThis.fetch || require('node-fetch');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY environment variable is not set');
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  let body = req.body;
  if (!body) {
    return res.status(400).json({ error: 'Request body is missing' });
  }

  const { messages, context, cohortName } = body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const systemPrompt = buildSystemPrompt(context, cohortName);

  const anthropicMessages = messages
    .filter(m => m.role && m.text)
    .map(m => ({
      role: m.role === 'keith' ? 'assistant' : 'user',
      content: String(m.text),
    }));

  if (anthropicMessages.length === 0) {
    return res.status(400).json({ error: 'No valid messages provided' });
  }

  try {
    const response = await fetchFn('https://api.anthropic.com/v1/messages', {
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
        messages: anthropicMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API returned error:', JSON.stringify(data));
      return res.status(502).json({
        error: 'Anthropic API error',
        status: response.status,
        details: data,
      });
    }

    const text = data?.content?.[0]?.text;
    if (!text) {
      console.error('Unexpected Anthropic response shape:', JSON.stringify(data));
      return res.status(502).json({ error: 'Unexpected response from AI service' });
    }

    return res.status(200).json({ response: text });

  } catch (err) {
    console.error('Keith fetch error:', err.message, err.stack);
    return res.status(500).json({
      error: 'Failed to reach AI service',
      message: err.message,
    });
  }
};

function buildSystemPrompt(context, cohortName) {
  const cohort = cohortName || 'the current cohort';

  let liveData = 'LIVE COHORT DATA: Not available. Answer from ASPIRE program knowledge only.';

  if (context) {
    try {
      const statusSummary = Object.entries(context.byStatus || {})
        .map(([status, students]) => `  ${status}: ${Array.isArray(students) ? students.length : 0}`)
        .join('\n');

      const onCampus = Array.isArray(context.onCampusToday) && context.onCampusToday.length > 0
        ? context.onCampusToday.map(s => `${s.student?.last_name || '?'}, ${s.student?.first_name || '?'} at ${s.unit} (${s.shiftType})`).join(', ')
        : 'None logged today';

      const safeList = (arr) => Array.isArray(arr) && arr.length > 0
        ? arr.map(s => `${s.last_name || '?'}, ${s.first_name || '?'}`).join('; ')
        : 'None';

      liveData = `LIVE COHORT DATA (${cohort}):
Total students: ${context.totalStudents || 0}
Total unit slots: ${context.totalSlots || 0} (${context.totalRemaining || 0} remaining)
Status breakdown:
${statusSummary || '  No students yet'}
On campus today: ${onCampus}
Needs student form: ${safeList(context.needsStudentForm)}
Needs scheduling link: ${safeList(context.needsSchedulingLink)}
Needs CS-Link started: ${safeList(context.needsCsLink)}
Needs badge: ${safeList(context.needsBadge)}
Placed: ${safeList(context.placed)}
Active rotation: ${Array.isArray(context.activeRotation) && context.activeRotation.length > 0
  ? context.activeRotation.map(s => `${s.last_name}, ${s.first_name} (${s.approved_hours || 0}/${s.hours_required || 0} hrs)`).join('; ')
  : 'None'}
Completed: ${safeList(context.completed)}
Pending shift reviews: ${context.pendingShiftReviews || 0}`;
    } catch (e) {
      console.error('Error building live data section:', e.message);
      liveData = `LIVE COHORT DATA: Error processing context - ${e.message}`;
    }
  }

  return `You are Keith, the AI assistant for the ASPIRE Program Tracker at Cedars-Sinai Medical Center, named in honor of Keith Hoshal who created the ASPIRE Program.

ASPIRE (Affiliate Students' Pathway from Internship to Residency Experience) places senior nursing students at Cedars-Sinai for their final clinical rotation with a pathway into the New Graduate RN Residency Program (NGRP).

Your users are Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN (Program Lead) and Krystal Rodriguez, DNP, RN, NPD-BC, CNOR (Co-Lead).

ASPIRE STATUS JOURNEY:
Pending Outreach → Form Sent → Form Received → Interview Scheduled → Interviewed → Placed → Active Rotation → Completed → Declined

CS-LINK WORKFLOW:
Stage 1 (Service Center): New students = Add Non-Employee. Former students = Assignment Change, Extend End Date, or Reactivate. Cedars employees = skip Stage 1.
Stage 2: Add CS-Link access for everyone.

PRECEPTOR WELCOME EMAIL TEMPLATE:
Subject: ASPIRE Program – Student Preceptor Assignment
Dear [Preceptor First Name],
Thank you so much for agreeing to precept one of our senior nursing students through the ASPIRE Program. Your willingness to teach, mentor, and support our students truly makes a difference in shaping the next generation of nurses at Cedars-Sinai.
[Student details: name, school, program, rotation dates, hours, email, phone]
[Student] will reach out to you directly to introduce themselves and coordinate schedules.
Please remember to attach before sending: ASPIRE Brochure and Pre-licensure Student General Guidelines.
Reminders: Preceptor pay (contact Dr. Krystal Rodriguez), avoid being in charge while precepting, floating is acceptable if comfortable and appropriate.
Kind regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964

PRIVACY RULES - NEVER VIOLATE:
- Never include DOB, last 4 SSN, or sensitive identifiers
- Never fabricate student data not in the live context
- Draft emails only, never send automatically
- Identify students by first and last name only

RESPONSE STYLE:
- Warm, concise, professional
- Under 200 words unless drafting a full email
- Suggest a concrete next action when relevant
- Use Last Name, First Name format for student lists
- If asked about a specific student, use only their data from the live context

${liveData}

Current cohort: ${cohort}`;
}
