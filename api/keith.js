// api/keith.js
import https from 'https';

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function safeList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'None';
  return arr.map(s => `${s.last_name || '?'}, ${s.first_name || '?'}`).join('; ');
}

function buildSystemPrompt(context, cohortName) {
  const cohort = cohortName || 'the current cohort';
  let liveData = 'LIVE COHORT DATA: Not available.';

  if (context) {
    try {
      const statusSummary = Object.entries(context.byStatus || {})
        .map(([s, arr]) => `  ${s}: ${Array.isArray(arr) ? arr.length : 0}`)
        .join('\n');

      const onCampus = Array.isArray(context.onCampusToday) && context.onCampusToday.length > 0
        ? context.onCampusToday.map(s =>
            `${s.student?.last_name || '?'}, ${s.student?.first_name || '?'} – ${s.unit} (${s.shiftType})`
          ).join('; ')
        : 'None today';

      const activeList = Array.isArray(context.activeRotation) && context.activeRotation.length > 0
        ? context.activeRotation.map(s =>
            `${s.last_name}, ${s.first_name} (${s.approved_hours || 0}/${s.hours_required || 0} hrs)`
          ).join('; ')
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
      liveData = `LIVE COHORT DATA: Error – ${e.message}`;
    }
  }

  return `You are Keith, the ASPIRE Program AI assistant at Cedars-Sinai Medical Center, named in honor of Keith Hoshal who created the program.

ASPIRE (Affiliate Students' Pathway from Internship to Residency Experience) places senior nursing students at Cedars-Sinai for their final clinical rotation with a pathway into the New Graduate RN Residency Program (NGRP).

Your users: Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN (Program Lead) and Krystal Rodriguez, DNP, RN, NPD-BC, CNOR (Co-Lead).

ASPIRE STATUS JOURNEY:
Pending Outreach → Form Sent → Form Received → Interview Scheduled → Interviewed → Placed → Active Rotation → Completed → Declined

CS-LINK WORKFLOW:
Stage 1: New students = Add Non-Employee. Former = Assignment Change / Extend End Date / Reactivate. Cedars employees = skip Stage 1.
Stage 2: Add CS-Link for everyone.

PRECEPTOR WELCOME EMAIL FORMAT:
Subject: ASPIRE Program – Student Preceptor Assignment
Dear [Preceptor First Name],
Thank you so much for agreeing to precept one of our senior nursing students through the ASPIRE Program. Your willingness to teach, mentor, and support our students truly makes a difference in shaping the next generation of nurses at Cedars-Sinai.
Student: [Name] | School: [School] | Program: [Program] | Rotation Dates: [Dates] | Hours Required: [Hours] | Email: [Email] | Phone: [Phone]
[Student first name] will reach out to you directly to introduce themselves and coordinate schedules.
Please remember to attach: ASPIRE Brochure and Pre-licensure Student General Guidelines.
Reminders: Preceptor pay (contact Dr. Krystal Rodriguez) | Avoid being in charge while precepting | Floating is acceptable if comfortable.
Kind regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964

PRIVACY RULES – NEVER VIOLATE:
- Never include DOB, last 4 SSN, or sensitive identifiers
- Never fabricate student data not in the live context
- Draft emails only, never send automatically

RESPONSE STYLE:
- Warm, concise, professional
- Under 200 words unless drafting a full email
- Always suggest a concrete next action
- Last Name, First Name format for student lists

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
    console.error('ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { messages, context, cohortName } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Valid messages array required' });
  }

  const systemPrompt = buildSystemPrompt(context, cohortName);

  const anthropicMessages = messages
    .filter(m => m.role && m.text)
    .map(m => ({
      role: m.role === 'keith' ? 'assistant' : 'user',
      content: String(m.text),
    }));

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: anthropicMessages,
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  };

  try {
    const result = await httpsPost(options, requestBody);

    if (result.status !== 200) {
      console.error('Anthropic error:', result.status, JSON.stringify(result.body));
      return res.status(502).json({
        error: 'Anthropic API error',
        status: result.status,
        details: result.body,
      });
    }

    const text = result.body?.content?.[0]?.text;
    if (!text) {
      console.error('Unexpected response:', JSON.stringify(result.body));
      return res.status(502).json({ error: 'Unexpected AI response format' });
    }

    return res.status(200).json({ response: text });

  } catch (err) {
    console.error('Keith error:', err.message);
    return res.status(500).json({ error: 'Failed to reach AI service', message: err.message });
  }
}
