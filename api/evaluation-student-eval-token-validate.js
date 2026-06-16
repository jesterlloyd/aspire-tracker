// api/evaluation-student-eval-token-validate.js
//
// Public token-validate endpoint for the ASPIRE Student Evaluation of Preceptor/Unit
// Experience survey (slug: student_preceptor_eval). Isolated from the Casey-Fink/student
// (evaluation-token-validate.js) and preceptor (evaluation-preceptor-token-validate.js)
// endpoints, neither of which is modified.
//
// Uses the shared, instrument-agnostic RPC validate_and_open_evaluation_assignment for the
// token/assignment/instrument checks + idempotent sent→opened transition. Additionally
// requires the resolved slug to be 'student_preceptor_eval' and loads the authorized survey
// content from private Storage.
//
// evaluated_target (the preceptor/unit the STUDENT evaluates) is resolved server-side from
// the student's own record (students.preceptor_id → preceptors, free-text fallback) for
// READ-ONLY display. It is context only — it is never the respondent identity.
//
// POST /api/evaluation-student-eval-token-validate   Body: { token }

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { SCHEMA, RATING_VALUES, OVERALL_RATING_VALUES } from '../lib/server/evaluation/student_preceptor_eval_validation.js';

const STUDENT_SLUG = 'student_preceptor_eval';

function extractInstrumentField(row, field) {
  try {
    if (!row || typeof row !== 'object') return null;
    const asmt = row.evaluation_assignments;
    const assignment = Array.isArray(asmt) ? asmt[0] : asmt;
    if (!assignment || typeof assignment !== 'object') return null;
    const inst = assignment.evaluation_instruments;
    const instrument = Array.isArray(inst) ? inst[0] : inst;
    if (!instrument || typeof instrument !== 'object') return null;
    const val = instrument[field];
    if (typeof val !== 'string' || val.trim() === '') return null;
    return val;
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

    const { token } = body;
    if (!token || typeof token !== 'string' || !isWellFormedRawToken(token)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Rate limit — fail closed.
    const ip = extractClientIp(req);
    const key = bucketKey('student_eval_validate', ip);
    const { data: allowed, error: rlError } = await supabaseAdmin.rpc(
      'consume_evaluation_rate_limit',
      { p_bucket_key: key, p_window_seconds: 60, p_max_per_window: 20 }
    );
    if (rlError || allowed !== true) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const tokenHash = hashToken(token);

    // Service-role slug lookup BEFORE any state-changing RPC call.
    const { data: slugRow, error: lookupError } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select('evaluation_assignments!inner(evaluation_instruments!inner(slug, items_content_ref))')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: 'Internal error' });
    }
    if (slugRow === null) {
      return res.status(410).json({ error: 'This survey link is no longer valid.' });
    }

    const prefetchedSlug = extractInstrumentField(slugRow, 'slug');
    if (!prefetchedSlug) {
      return res.status(500).json({ error: 'Internal error' });
    }
    // This endpoint serves ONLY student_preceptor_eval. Any other instrument is rejected.
    if (prefetchedSlug !== STUDENT_SLUG) {
      return res.status(422).json({ error: 'This survey link is not supported by the current application version.' });
    }

    const prefetchedContentRef = extractInstrumentField(slugRow, 'items_content_ref');
    if (!prefetchedContentRef) {
      return res.status(500).json({ error: 'Internal error' });
    }

    // State-changing RPC: idempotent sent→opened (shared, instrument-agnostic).
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      'validate_and_open_evaluation_assignment',
      { p_token_hash: tokenHash }
    );
    if (rpcError) {
      return res.status(500).json({ error: 'Internal error' });
    }

    if (rpcResult.status === 'completed') {
      return res.status(200).json({ completed: true });
    }
    if (rpcResult.status === 'window_closed') {
      return res.status(410).json({ error: 'The window for this survey has closed.' });
    }
    if (rpcResult.status === 'invalid') {
      return res.status(410).json({ error: 'This survey link is no longer valid.' });
    }
    if (rpcResult.status !== 'valid') {
      return res.status(500).json({ error: 'Internal error' });
    }
    if (rpcResult.instrument_slug !== STUDENT_SLUG) {
      return res.status(500).json({ error: 'Internal error' });
    }

    // Resolve display context: the student (subject+respondent) and the evaluated_target
    // (their preceptor/unit). evaluated_target comes from the STUDENT's own record
    // (students.preceptor_id → preceptors, free-text fallback) — NOT from respondent_*.
    const { data: ctxRow } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select(`
        evaluation_assignments!inner (
          students!inner (
            first_name, last_name, matched_preceptor, preceptor_id,
            preceptors:preceptor_id ( id, full_name, unit_name )
          )
        )
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle();

    const asmt = ctxRow?.evaluation_assignments
      ? (Array.isArray(ctxRow.evaluation_assignments) ? ctxRow.evaluation_assignments[0] : ctxRow.evaluation_assignments)
      : null;
    const student = asmt?.students
      ? (Array.isArray(asmt.students) ? asmt.students[0] : asmt.students)
      : null;
    const preceptor = student?.preceptors
      ? (Array.isArray(student.preceptors) ? student.preceptors[0] : student.preceptors)
      : null;

    const studentName = student
      ? `${student.first_name || ''} ${student.last_name || ''}`.trim()
      : (rpcResult.first_name || '');

    // evaluated_target — read-only context, echoed back into the response JSON at submit.
    const evaluatedTarget = {
      preceptor_name: (preceptor?.full_name || student?.matched_preceptor || '').trim(),
      preceptor_id:   preceptor?.id || null,
      unit:           (preceptor?.unit_name || '').trim(),
    };

    // Load authorized survey content from private Storage.
    const { data: contentBlob, error: storageError } = await supabaseAdmin.storage
      .from('evaluation-instrument-content')
      .download(prefetchedContentRef);
    if (storageError || !contentBlob) {
      return res.status(500).json({ error: 'Internal error' });
    }

    let content;
    try {
      content = JSON.parse(await contentBlob.text());
    } catch {
      return res.status(500).json({ error: 'Internal error' });
    }

    return res.status(200).json({
      instrumentSlug:        STUDENT_SLUG,
      instrumentDisplayName: rpcResult.instrument_display_name || SCHEMA.displayName,
      studentName,
      evaluatedTarget,
      ratingValues:          RATING_VALUES,
      overallRatingValues:   OVERALL_RATING_VALUES,
      sectionKeys:           SCHEMA.sectionKeys,
      content,
    });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
