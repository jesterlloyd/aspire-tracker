import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken, hashPrefixOf } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { SCHEMA } from '../lib/server/evaluation/casey_fink_2024_validation.js';

const TIMEPOINT_LABELS = {
  baseline:               'Baseline',
  early_rotation_baseline:'Baseline',
  mid_rotation:           'Mid-Rotation Check-In',
  post_rotation:          'Post-Rotation',
};

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

// Defensively extracts items_content_ref from the same embedded response shape.
// Returns the non-empty string, or null for any absent/missing/empty value.
// Never throws. Never logs the row.
function extractItemsContentRef(row) {
  try {
    if (!row || typeof row !== 'object') return null;
    const asmt = row.evaluation_assignments;
    const assignment = Array.isArray(asmt) ? asmt[0] : asmt;
    if (!assignment || typeof assignment !== 'object') return null;
    const inst = assignment.evaluation_instruments;
    const instrument = Array.isArray(inst) ? inst[0] : inst;
    if (!instrument || typeof instrument !== 'object') return null;
    const ref = instrument.items_content_ref;
    if (typeof ref !== 'string' || ref.trim() === '') return null;
    return ref;
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

    // Rate limit - fail closed: continue only when allowed === true
    const ip = extractClientIp(req);
    const key = bucketKey('eval_validate', ip);
    const { data: allowed, error: rlError } = await supabaseAdmin.rpc(
      'consume_evaluation_rate_limit',
      { p_bucket_key: key, p_window_seconds: 60, p_max_per_window: 20 }
    );
    if (rlError || allowed !== true) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const tokenHash = hashToken(token);

    // Service-role slug lookup BEFORE any state-changing RPC call
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

    const prefetchedSlug = extractInstrumentSlug(slugRow);
    if (!prefetchedSlug) {
      return res.status(500).json({ error: 'Internal error' });
    }

    // Slug allowlist check - BEFORE any state-changing RPC call
    if (!allowedInstrumentSlugs().includes(prefetchedSlug)) {
      return res.status(422).json({ error: 'This survey link is not supported by the current application version.' });
    }

    // items_content_ref must be set for the valid render path; missing = not configured for live use
    const prefetchedContentRef = extractItemsContentRef(slugRow);
    if (!prefetchedContentRef) {
      return res.status(500).json({ error: 'Internal error' });
    }

    // State-changing RPC: transitions assignment from sent → opened (idempotent)
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
      return res.status(410).json({ error: 'The response window for this survey has closed.' });
    }

    if (rpcResult.status === 'invalid') {
      return res.status(410).json({ error: 'This survey link is no longer valid.' });
    }

    if (rpcResult.status === 'valid') {
      // Defensive consistency check: RPC-returned slug must match the pre-fetched slug
      if (rpcResult.instrument_slug !== prefetchedSlug) {
        return res.status(500).json({ error: 'Internal error' });
      }

      // Load authorized instrument content from private Storage
      const { data: contentBlob, error: storageError } = await supabaseAdmin.storage
        .from('evaluation-instrument-content')
        .download(prefetchedContentRef);

      if (storageError || !contentBlob) {
        return res.status(500).json({ error: 'Internal error' });
      }

      let content;
      try {
        const contentText = await contentBlob.text();
        content = JSON.parse(contentText);
      } catch {
        return res.status(500).json({ error: 'Internal error' });
      }

      return res.status(200).json({
        firstName:             rpcResult.first_name,
        instrumentSlug:        rpcResult.instrument_slug,
        instrumentDisplayName: rpcResult.instrument_display_name,
        timepointLabel:        TIMEPOINT_LABELS[rpcResult.timepoint] || rpcResult.timepoint,
        sections:              SCHEMA.sections,
        requiredItemCodes:     SCHEMA.requiredItemCodes,
        optionalItemCodes:     SCHEMA.optionalItemCodes,
        content,
      });
    }

    return res.status(500).json({ error: 'Internal error' });

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
