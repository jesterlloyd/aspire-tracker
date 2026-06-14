// api/evaluation-preceptor-token-validate.js
//
// Public token-validate endpoint for the ASPIRE Preceptor Student Progress & Readiness
// Feedback survey (slug: preceptor_progress). Isolated from the Casey-Fink/student
// validate endpoint (evaluation-token-validate.js), which is NOT modified.
//
// Uses the shared, instrument-agnostic RPC validate_and_open_evaluation_assignment to
// perform the token/assignment/instrument checks and the idempotent sent→opened
// transition. This endpoint additionally requires the resolved instrument slug to be
// 'preceptor_progress' and loads the authorized survey content from private Storage.
//
// POST /api/evaluation-preceptor-token-validate   Body: { token }

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import {
  SCHEMA,
  RATING_SCALE,
  COMPETENCY_ITEMS,
  FEEDBACK_PERIODS,
  PERIOD_LABELS,
  TIMEPOINT_TO_PERIOD,
} from '../lib/server/evaluation/preceptor_progress_validation.js';

const PRECEPTOR_SLUG = 'preceptor_progress';

// Defensive extraction from the embedded PostgREST relationship shape.
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
    const key = bucketKey('preceptor_eval_validate', ip);
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
      return res.status(410).json({ error: 'This feedback link is no longer valid.' });
    }

    const prefetchedSlug = extractInstrumentField(slugRow, 'slug');
    if (!prefetchedSlug) {
      return res.status(500).json({ error: 'Internal error' });
    }
    // This endpoint serves ONLY preceptor_progress. Any other instrument is rejected.
    if (prefetchedSlug !== PRECEPTOR_SLUG) {
      return res.status(422).json({ error: 'This feedback link is not supported by the current application version.' });
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
      return res.status(410).json({ error: 'The window for this feedback request has closed.' });
    }
    if (rpcResult.status === 'invalid') {
      return res.status(410).json({ error: 'This feedback link is no longer valid.' });
    }
    if (rpcResult.status !== 'valid') {
      return res.status(500).json({ error: 'Internal error' });
    }

    // Defensive consistency check.
    if (rpcResult.instrument_slug !== PRECEPTOR_SLUG) {
      return res.status(500).json({ error: 'Internal error' });
    }

    // Fetch display context (subject student + respondent preceptor + unit) via service role.
    // Minimal fields needed to auto-populate Section 1.
    const { data: ctxRow } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select(`
        evaluation_assignments!inner (
          timepoint,
          respondent_name,
          students!inner ( first_name, last_name ),
          preceptors:respondent_preceptor_id ( full_name, unit_name )
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
    const preceptor = asmt?.preceptors
      ? (Array.isArray(asmt.preceptors) ? asmt.preceptors[0] : asmt.preceptors)
      : null;

    const studentName = student
      ? `${student.first_name || ''} ${student.last_name || ''}`.trim()
      : (rpcResult.first_name || '');
    const preceptorName = (asmt?.respondent_name || preceptor?.full_name || '').trim();
    const rotationUnit = (preceptor?.unit_name || '').trim();
    const periodValue = TIMEPOINT_TO_PERIOD[asmt?.timepoint] || 'other_interim';

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
      instrumentSlug:        PRECEPTOR_SLUG,
      instrumentDisplayName: rpcResult.instrument_display_name || SCHEMA.displayName,
      studentName,
      preceptorName,
      rotationUnit,
      periodValue,
      periodLabel:           PERIOD_LABELS[periodValue],
      ratingScale:           RATING_SCALE,
      competencyItems:       COMPETENCY_ITEMS,
      feedbackPeriods:       FEEDBACK_PERIODS,
      periodLabels:          PERIOD_LABELS,
      content,
    });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
