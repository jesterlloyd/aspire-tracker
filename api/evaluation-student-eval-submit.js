// api/evaluation-student-eval-submit.js
//
// Public submission endpoint for the ASPIRE Student Evaluation of Preceptor/Unit Experience
// survey (slug: student_preceptor_eval). Isolated from the Casey-Fink/student
// (evaluation-submit.js) and preceptor (evaluation-preceptor-submit.js) endpoints, neither
// of which is modified.
//
// Validates the section-keyed payload with the student_preceptor_eval validation module and
// submits ONLY through public.submit_student_preceptor_evaluation_response (SR-2-pre). It
// never calls submit_evaluation_response (Casey-Fink) or submit_preceptor_evaluation_response
// (preceptor). The RPC is the final authority.
//
// POST /api/evaluation-student-eval-submit   Body: { token, responses }

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { validateResponses } from '../lib/server/evaluation/student_preceptor_eval_validation.js';

const STUDENT_SLUG = 'student_preceptor_eval';

function extractInstrumentSlug(row) {
  try {
    if (!row || typeof row !== 'object') return null;
    const asmt = row.evaluation_assignments;
    const assignment = Array.isArray(asmt) ? asmt[0] : asmt;
    if (!assignment || typeof assignment !== 'object') return null;
    const inst = assignment.evaluation_instruments;
    const instrument = Array.isArray(inst) ? inst[0] : inst;
    if (!instrument || typeof instrument !== 'object') return null;
    const slug = instrument.slug;
    if (typeof slug !== 'string' || slug.trim() === '') return null;
    return slug;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let body;
    try {
      const raw = req.body;
      body = (raw && typeof raw === 'object') ? raw : JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { token, responses } = body;

    if (!token || typeof token !== 'string' || !isWellFormedRawToken(token)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    if (responses === null || responses === undefined ||
        typeof responses !== 'object' || Array.isArray(responses)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Rate limit — fail closed.
    const ip = extractClientIp(req);
    const key = bucketKey('student_eval_submit', ip);
    const { data: allowed, error: rlError } = await supabaseAdmin.rpc(
      'consume_evaluation_rate_limit',
      { p_bucket_key: key, p_window_seconds: 60, p_max_per_window: 5 }
    );
    if (rlError || allowed !== true) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const tokenHash = hashToken(token);

    // Service-role slug lookup BEFORE any state-changing RPC call.
    const { data: slugRow, error: lookupError } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select('evaluation_assignments!inner(evaluation_instruments!inner(slug))')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: 'Internal error' });
    }
    if (slugRow === null) {
      return res.status(410).json({ error: 'This survey link is no longer valid.' });
    }

    const slug = extractInstrumentSlug(slugRow);
    if (!slug) {
      return res.status(500).json({ error: 'Internal error' });
    }
    // This endpoint serves ONLY student_preceptor_eval.
    if (slug !== STUDENT_SLUG) {
      return res.status(422).json({ error: 'This survey link is not supported by the current application version.' });
    }

    // Canonicalize evaluated_target SERVER-SIDE — never trust the client-provided value.
    // Same source of truth as the token-validate endpoint: the student's own record
    // (students.preceptor_id → preceptors, free-text fallback). This is stored only inside
    // the response JSON; it is never written to respondent_preceptor_id.
    const { data: ctxRow, error: ctxError } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select(`
        evaluation_assignments!inner (
          students!inner (
            matched_preceptor, preceptor_id,
            preceptors:preceptor_id ( id, full_name, unit_name )
          )
        )
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle();

    // An actual query error must NOT silently submit an empty evaluated_target. (A simple
    // no-rows / null preceptor result is fine — that legitimately yields blank context.)
    if (ctxError) {
      return res.status(500).json({ error: 'Internal error' });
    }

    const ctxAsmt = ctxRow?.evaluation_assignments
      ? (Array.isArray(ctxRow.evaluation_assignments) ? ctxRow.evaluation_assignments[0] : ctxRow.evaluation_assignments)
      : null;
    const ctxStudent = ctxAsmt?.students
      ? (Array.isArray(ctxAsmt.students) ? ctxAsmt.students[0] : ctxAsmt.students)
      : null;
    const ctxPreceptor = ctxStudent?.preceptors
      ? (Array.isArray(ctxStudent.preceptors) ? ctxStudent.preceptors[0] : ctxStudent.preceptors)
      : null;

    const canonicalEvaluatedTarget = {
      preceptor_name: (ctxPreceptor?.full_name || ctxStudent?.matched_preceptor || '').trim(),
      preceptor_id:   ctxPreceptor?.id || null,
      unit:           (ctxPreceptor?.unit_name || '').trim(),
    };

    // Overwrite any client-supplied evaluated_target with the server-resolved canonical
    // value before validation and submission.
    const canonicalResponses = { ...responses, evaluated_target: canonicalEvaluatedTarget };

    // Payload validation runs on the canonical responses (errors are never logged/returned).
    const { valid } = validateResponses(canonicalResponses);
    if (!valid) {
      return res.status(422).json({ error: 'Invalid response payload.' });
    }

    // State-changing RPC — student survey only. Never submit_evaluation_response or
    // submit_preceptor_evaluation_response. Submits the canonical (server-trusted) payload.
    const { data: submitResult, error: submitError } = await supabaseAdmin.rpc(
      'submit_student_preceptor_evaluation_response',
      { p_token_hash: tokenHash, p_responses: canonicalResponses }
    );
    if (submitError) {
      return res.status(500).json({ error: 'Internal error' });
    }

    if (submitResult.status === 'success') {
      return res.status(200).json({ success: true, submittedAt: submitResult.submitted_at });
    }
    if (submitResult.status === 'token_invalid' ||
        submitResult.status === 'assignment_state_invalid') {
      return res.status(410).json({ error: 'This survey link is no longer valid.' });
    }
    if (submitResult.status === 'assignment_window_closed') {
      return res.status(410).json({ error: 'The window for this survey has closed.' });
    }
    if (submitResult.status === 'responses_invalid') {
      return res.status(422).json({ error: 'Invalid response payload.' });
    }

    return res.status(500).json({ error: 'Internal error' });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
