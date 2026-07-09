// api/evaluation-post-rotation-submit.js
//
// Public submission endpoint for the ASPIRE Post-Rotation Evaluation (slug:
// post_rotation_evaluation). Isolated from the Casey-Fink (evaluation-submit.js), preceptor
// (evaluation-preceptor-submit.js), and student experience (evaluation-student-eval-submit.js)
// endpoints, none of which is modified.
//
// The assignment is derived SERVER-SIDE from the token hash - the client never supplies a
// student_id or assignment_id as a trust basis. Payload is validated with the shared content
// module and submitted ONLY through public.submit_post_rotation_evaluation_response, which is the
// final authority. That RPC marks the assignment completed and, on success, issues the Certificate
// of Participation metadata via issue_participation_certificate(). No PDF is generated or attached
// and no email is sent here.
//
// POST /api/evaluation-post-rotation-submit   Body: { token, responses }

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { validateResponses, ALL_ITEMS } from '../lib/server/evaluation/postRotationEvalContent.js';

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

// Reduce the client payload to the canonical, known keys only (drop anything unexpected), trimming
// text answers. Ratings are coerced to integers; the yes/no answer to a strict boolean.
function canonicalizeResponses(responses) {
  const out = {};
  for (const item of ALL_ITEMS) {
    const v = responses[item.key];
    if (item.type === 'rating') {
      if (Number.isInteger(v)) out[item.key] = v;
    } else if (item.type === 'yesno') {
      if (v === true || v === false) out[item.key] = v;
    } else {
      if (typeof v === 'string') out[item.key] = v.trim();
    }
  }
  return out;
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

    // Rate limit - fail closed.
    const ip = extractClientIp(req);
    const key = bucketKey('post_rotation_submit', ip);
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
      return res.status(410).json({ error: 'This evaluation link is no longer valid.' });
    }

    const slug = extractSlug(slugRow);
    if (!slug) {
      return res.status(500).json({ error: 'Internal error' });
    }
    // This endpoint serves ONLY post_rotation_evaluation.
    if (slug !== POST_ROTATION_SLUG) {
      return res.status(422).json({ error: 'This evaluation link is not supported by the current application version.' });
    }

    const canonicalResponses = canonicalizeResponses(responses);

    const { valid } = validateResponses(canonicalResponses);
    if (!valid) {
      return res.status(422).json({ error: 'Invalid response payload.' });
    }

    // State-changing RPC - post-rotation only. The RPC marks the assignment completed and, on
    // success, issues the certificate metadata via issue_participation_certificate().
    const { data: submitResult, error: submitError } = await supabaseAdmin.rpc(
      'submit_post_rotation_evaluation_response',
      { p_token_hash: tokenHash, p_responses: canonicalResponses }
    );
    if (submitError) {
      return res.status(500).json({ error: 'Internal error' });
    }

    if (submitResult.status === 'success') {
      // certificate_number is safe, non-sensitive metadata. No download link is exposed here.
      return res.status(200).json({
        success: true,
        submittedAt: submitResult.submitted_at,
        certificateIssued: submitResult.certificate_status === 'issued' || submitResult.certificate_status === 'already_issued',
        certificateNumber: submitResult.certificate_number || null,
      });
    }
    if (submitResult.status === 'token_invalid' ||
        submitResult.status === 'assignment_state_invalid') {
      return res.status(410).json({ error: 'This evaluation link is no longer valid.' });
    }
    if (submitResult.status === 'assignment_window_closed') {
      return res.status(410).json({ error: 'The window for this evaluation has closed.' });
    }
    if (submitResult.status === 'responses_invalid') {
      return res.status(422).json({ error: 'Invalid response payload.' });
    }

    return res.status(500).json({ error: 'Internal error' });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
