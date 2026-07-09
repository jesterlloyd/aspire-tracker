// api/evaluation-post-rotation-token-validate.js
//
// Public token-validate endpoint for the ASPIRE Post-Rotation Evaluation (slug:
// post_rotation_evaluation). Isolated from the Casey-Fink (evaluation-token-validate.js),
// preceptor (evaluation-preceptor-token-validate.js), and student experience
// (evaluation-student-eval-token-validate.js) endpoints, none of which is modified.
//
// Uses the shared, instrument-agnostic RPC validate_and_open_evaluation_assignment for the
// token/assignment/instrument checks + idempotent sent->opened transition, then additionally
// requires the resolved slug to be post_rotation_evaluation. The approved question content is
// served from code (postRotationEvalContent), not Storage, and no token is ever stored.
//
// POST /api/evaluation-post-rotation-token-validate   Body: { token }

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { POST_ROTATION_CONTENT } from '../lib/server/evaluation/postRotationEvalContent.js';

const POST_ROTATION_SLUG = 'post_rotation_evaluation';

function extractSlug(row) {
  try {
    const asmt = row?.evaluation_assignments;
    const assignment = Array.isArray(asmt) ? asmt[0] : asmt;
    const inst = assignment?.evaluation_instruments;
    const instrument = Array.isArray(inst) ? inst[0] : inst;
    const slug = instrument?.slug;
    return (typeof slug === 'string' && slug.trim() !== '') ? slug : null;
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

    // Rate limit - fail closed.
    const ip = extractClientIp(req);
    const key = bucketKey('post_rotation_validate', ip);
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
      .select('evaluation_assignments!inner(evaluation_instruments!inner(slug))')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: 'Internal error' });
    }
    if (slugRow === null) {
      return res.status(410).json({ error: 'This evaluation link is no longer valid.' });
    }

    const prefetchedSlug = extractSlug(slugRow);
    if (!prefetchedSlug) {
      return res.status(500).json({ error: 'Internal error' });
    }
    // This endpoint serves ONLY post_rotation_evaluation. Any other instrument is rejected.
    if (prefetchedSlug !== POST_ROTATION_SLUG) {
      return res.status(422).json({ error: 'This evaluation link is not supported by the current application version.' });
    }

    // State-changing RPC: idempotent sent->opened (shared, instrument-agnostic).
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
      return res.status(410).json({ error: 'The window for this evaluation has closed.' });
    }
    if (rpcResult.status === 'invalid') {
      return res.status(410).json({ error: 'This evaluation link is no longer valid.' });
    }
    if (rpcResult.status !== 'valid') {
      return res.status(500).json({ error: 'Internal error' });
    }
    // Defense in depth: the shared RPC is instrument-agnostic, so re-check the slug it resolved.
    if (rpcResult.instrument_slug !== POST_ROTATION_SLUG) {
      return res.status(500).json({ error: 'Internal error' });
    }

    // Safe, minimal student-facing metadata + the approved question content (from code).
    return res.status(200).json({
      instrumentSlug: POST_ROTATION_SLUG,
      studentName: (rpcResult.first_name || '').trim(),
      content: POST_ROTATION_CONTENT,
    });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
