// api/certificate-preceptor-download.js
//
// PRECEPTOR-CERT-1 - PUBLIC, token-authorized download of the ASPIRE Certificate of
// Appreciation for the PRECEPTOR who completed the End-of-Rotation readiness
// assessment. The assignment is derived entirely from the raw evaluation token
// hash; the client never supplies a preceptor_id or certificate_id. Generates the
// flattened PDF on demand and streams it - nothing is stored.
//
// Authorization (all required):
//   - token hashes to an evaluation_assignment_tokens row
//   - its assignment is a COMPLETED preceptor_progress post_rotation assignment
//     with respondent_type = 'preceptor'
//   - a preceptor_certificates row exists whose qualifying assignment is that
//     assignment OR whose (preceptor, cohort) matches the assignment's
//     snapshotted respondent (a second completed assessment attaches to the
//     existing certificate)
// The token's used_at may be set (submission consumes it) - that does NOT block
// download, mirroring the student certificate contract.
//
// This endpoint NEVER creates a certificate row, assigns a number, or touches
// certificate_sequences. Assessment answers are never read - the display
// resolver touches no response data.
//
// POST /api/certificate-preceptor-download   Body: { token }

import { Buffer } from 'node:buffer';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { generatePreceptorCertificate } from '../lib/server/certificates/generatePreceptorCertificate.js';
import { loadPreceptorCertificateDisplayFields } from '../lib/server/certificates/loadPreceptorCertificateDisplayFields.js';

const TEMPLATE_PATH = '/certificates/templates/aspire-certificate-of-preceptor-appreciation.pdf';

function firstOf(v) { return Array.isArray(v) ? v[0] : v; }

// Restrict a filename to a safe, predictable set of characters (same contract
// as the student certificate endpoint - compound/punctuated surnames included).
function safeFilePart(v) {
  return String(v || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || '-';
}

async function loadTemplateBytes(req) {
  const res = await fetch(`${emailBaseUrl(req)}${TEMPLATE_PATH}`);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
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
    const token = body?.token;
    if (!token || typeof token !== 'string' || !isWellFormedRawToken(token)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Rate limit - fail closed (shared bucket with the student cert download).
    const ip = extractClientIp(req);
    const key = bucketKey('certificate_download', ip);
    const { data: allowed, error: rlError } = await supabaseAdmin.rpc(
      'consume_evaluation_rate_limit',
      { p_bucket_key: key, p_window_seconds: 60, p_max_per_window: 20 }
    );
    if (rlError || allowed !== true) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const tokenHash = hashToken(token);

    // Resolve the assignment + instrument from the token hash (service-role read).
    const { data: tokenRow, error: lookupErr } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select(`
        assignment_id,
        evaluation_assignments!inner (
          id, cohort_id, respondent_type, respondent_preceptor_id, timepoint, completed_at,
          evaluation_instruments!inner ( slug )
        )
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupErr) return res.status(500).json({ error: 'Internal error' });
    if (!tokenRow) return res.status(410).json({ error: 'This certificate link is no longer valid.' });

    const assignment = firstOf(tokenRow.evaluation_assignments);
    const instrument = firstOf(assignment?.evaluation_instruments);
    if (!assignment || !instrument) return res.status(500).json({ error: 'Internal error' });

    if (instrument.slug !== 'preceptor_progress' ||
        assignment.respondent_type !== 'preceptor' ||
        assignment.timepoint !== 'post_rotation') {
      return res.status(422).json({ error: 'This certificate link is not supported.' });
    }
    if (!assignment.completed_at) {
      return res.status(409).json({ error: 'The certificate is available after the assessment is submitted.' });
    }

    // The certificate: by qualifying assignment first, then by the snapshotted
    // (preceptor, cohort) identity - never by anything the client sent.
    let { data: cert } = await supabaseAdmin
      .from('preceptor_certificates')
      .select('id, preceptor_id, cohort_id, qualifying_assignment_id, certificate_number, certificate_unlocked_at')
      .eq('qualifying_assignment_id', assignment.id)
      .maybeSingle();
    if (!cert && assignment.respondent_preceptor_id) {
      const alt = await supabaseAdmin
        .from('preceptor_certificates')
        .select('id, preceptor_id, cohort_id, qualifying_assignment_id, certificate_number, certificate_unlocked_at')
        .eq('preceptor_id', assignment.respondent_preceptor_id)
        .eq('cohort_id', assignment.cohort_id)
        .maybeSingle();
      cert = alt.data;
    }
    if (!cert) {
      return res.status(404).json({ error: 'No certificate is available for this assessment yet.' });
    }

    // Resolve display fields; fail safe on any missing required value.
    const { fields, missing } = await loadPreceptorCertificateDisplayFields(supabaseAdmin, cert);
    if (!fields || missing.length > 0) {
      console.error('[preceptor-cert-download] display_fields_missing:', {
        certificate_id: cert.id, missing,
      });
      return res.status(409).json({
        error: 'The certificate is not ready yet. The ASPIRE team has been notified.',
      });
    }

    const templateBytes = await loadTemplateBytes(req);
    if (!templateBytes) return res.status(500).json({ error: 'Internal error' });

    const pdfBytes = await generatePreceptorCertificate(templateBytes, fields, { flatten: true });

    const lastName = safeFilePart(fields.preceptorName.split(/\s+/).slice(-1)[0]);
    const issueYear = new Date(cert.certificate_unlocked_at).getFullYear();
    const filename = `ASPIRE_Preceptor_Appreciation_${lastName}_${issueYear}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[preceptor-cert-download] unexpected:', e?.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
