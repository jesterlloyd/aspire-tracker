import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken, hashPrefixOf } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { validateResponses } from '../lib/server/evaluation/casey_fink_2024_validation.js';

function allowedInstrumentSlugs() {
  const slugs = ['casey_fink_readiness_2024'];
  if (process.env.EVALUATION_QA_MODE === '1') {
    slugs.push('qa_test_instrument');
  }
  return slugs;
}

// Defensively extracts the instrument slug from either expected PostgREST
// embedded-relationship response shape (single-object or singleton-array at each level).
// Returns the non-empty slug string, or null for any absent/malformed/empty shape.
// Never throws. Never logs the row.
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

    if (
      responses === null ||
      responses === undefined ||
      typeof responses !== 'object' ||
      Array.isArray(responses)
    ) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Rate limit — fail closed: continue only when allowed === true
    const ip = extractClientIp(req);
    const key = bucketKey('eval_submit', ip);
    const { data: allowed, error: rlError } = await supabaseAdmin.rpc(
      'consume_evaluation_rate_limit',
      { p_bucket_key: key, p_window_seconds: 60, p_max_per_window: 5 }
    );
    if (rlError || allowed !== true) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const tokenHash = hashToken(token);

    // Service-role slug lookup BEFORE any state-changing RPC call
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

    // Slug allowlist check — BEFORE any state-changing RPC call
    if (!allowedInstrumentSlugs().includes(slug)) {
      return res.status(422).json({ error: 'This survey link is not supported by the current application version.' });
    }

    // Response validation — errors array is never logged or returned to the client
    const { valid } = validateResponses(responses);
    if (!valid) {
      return res.status(422).json({ error: 'Invalid response payload.' });
    }

    // State-changing RPC: inserts response row, marks assignment completed, consumes token
    const { data: submitResult, error: submitError } = await supabaseAdmin.rpc(
      'submit_evaluation_response',
      { p_token_hash: tokenHash, p_responses: responses }
    );

    if (submitError) {
      return res.status(500).json({ error: 'Internal error' });
    }

    if (submitResult.status === 'success') {
      return res.status(200).json({ success: true, submittedAt: submitResult.submitted_at });
    }

    if (
      submitResult.status === 'token_invalid' ||
      submitResult.status === 'assignment_state_invalid'
    ) {
      return res.status(410).json({ error: 'This survey link is no longer valid.' });
    }

    if (submitResult.status === 'assignment_window_closed') {
      return res.status(410).json({ error: 'The response window for this survey has closed.' });
    }

    return res.status(500).json({ error: 'Internal error' });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
