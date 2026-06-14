// api/evaluation-preceptor-submit.js
//
// Public submission endpoint for the ASPIRE Preceptor Student Progress & Readiness
// Feedback survey (slug: preceptor_progress). Isolated from the Casey-Fink/student
// submit endpoint (evaluation-submit.js), which is NOT modified.
//
// Validates the section-keyed payload with the preceptor_progress validation module and
// submits ONLY through public.submit_preceptor_evaluation_response (PS-2b-pre). It never
// calls public.submit_evaluation_response (Casey-Fink). The RPC is the final authority.
//
// POST /api/evaluation-preceptor-submit   Body: { token, responses }

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { validateResponses } from '../lib/server/evaluation/preceptor_progress_validation.js';

const PRECEPTOR_SLUG = 'preceptor_progress';

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
    const key = bucketKey('preceptor_eval_submit', ip);
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
      return res.status(410).json({ error: 'This feedback link is no longer valid.' });
    }

    const slug = extractInstrumentSlug(slugRow);
    if (!slug) {
      return res.status(500).json({ error: 'Internal error' });
    }
    // This endpoint serves ONLY preceptor_progress.
    if (slug !== PRECEPTOR_SLUG) {
      return res.status(422).json({ error: 'This feedback link is not supported by the current application version.' });
    }

    // Payload validation — errors are never logged or returned to the client.
    const { valid } = validateResponses(responses);
    if (!valid) {
      return res.status(422).json({ error: 'Invalid response payload.' });
    }

    // State-changing RPC — preceptor-only. Never submit_evaluation_response.
    const { data: submitResult, error: submitError } = await supabaseAdmin.rpc(
      'submit_preceptor_evaluation_response',
      { p_token_hash: tokenHash, p_responses: responses }
    );
    if (submitError) {
      return res.status(500).json({ error: 'Internal error' });
    }

    if (submitResult.status === 'success') {
      return res.status(200).json({ success: true, submittedAt: submitResult.submitted_at });
    }
    if (submitResult.status === 'token_invalid' ||
        submitResult.status === 'assignment_state_invalid') {
      return res.status(410).json({ error: 'This feedback link is no longer valid.' });
    }
    if (submitResult.status === 'assignment_window_closed') {
      return res.status(410).json({ error: 'The window for this feedback request has closed.' });
    }
    if (submitResult.status === 'responses_invalid') {
      return res.status(422).json({ error: 'Invalid response payload.' });
    }

    return res.status(500).json({ error: 'Internal error' });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
