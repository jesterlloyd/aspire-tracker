// api/certificate-participation-download.js
//
// ASPIRE-POSTROTATION-CERT-PDF-1 - PUBLIC, token-authorized download of the ASPIRE Certificate of
// Participation for the STUDENT who completed the post-rotation evaluation. The assignment is
// derived entirely from the raw evaluation token hash; the client never supplies a student_id or
// certificate_id. Generates the PDF on demand and streams it - nothing is stored.
//
// Authorization (all required):
//   - token hashes to an evaluation_assignment_tokens row
//   - its assignment is a completed (completed_at IS NOT NULL) student post_rotation gating
//     assignment: instrument slug casey_fink_readiness_2024 (the current certificate gate) or
//     post_rotation_evaluation (compatibility fallback), respondent_type student, timepoint post_rotation
//   - a certificates row exists for that student
// The token's used_at may be set (submission consumes it) - that does NOT block download.
//
// This endpoint NEVER creates a certificate row, assigns a number, or touches
// certificate_sequences. The number is read from the certificates table and drawn verbatim.
//
// POST /api/certificate-participation-download   Body: { token }

import { Buffer } from 'node:buffer';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js';
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { generateParticipationCertificate } from '../lib/server/certificates/generateParticipationCertificate.js';
import { getStudentPreferredFullName } from '../src/lib/studentNameFormatters.js';

// Gating instruments whose completed post_rotation token authorizes a certificate download.
// casey_fink_readiness_2024 is the current gate; post_rotation_evaluation is a compatibility
// fallback (no certificates are issued from it, but a token is accepted if a certificate exists).
const GATING_SLUGS = new Set(['casey_fink_readiness_2024', 'post_rotation_evaluation']);
const TEMPLATE_PATH = '/certificates/templates/aspire-certificate-of-participation.pdf';

function firstOf(v) { return Array.isArray(v) ? v[0] : v; }

// Restrict a filename to a safe, predictable set of characters.
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

    // Rate limit - fail closed.
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

    // Resolve the assignment + student + instrument from the token hash (service-role read).
    const { data: tokenRow, error: lookupErr } = await supabaseAdmin
      .from('evaluation_assignment_tokens')
      .select(`
        assignment_id,
        evaluation_assignments!inner (
          id, student_id, respondent_type, timepoint, completed_at,
          evaluation_instruments!inner ( slug ),
          students!inner ( first_name, last_name, preferred_first_name )
        )
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupErr) return res.status(500).json({ error: 'Internal error' });
    if (!tokenRow) return res.status(410).json({ error: 'This certificate link is no longer valid.' });

    const assignment = firstOf(tokenRow.evaluation_assignments);
    const instrument = firstOf(assignment?.evaluation_instruments);
    const student = firstOf(assignment?.students);

    if (!assignment || !instrument || !student) return res.status(500).json({ error: 'Internal error' });
    if (!GATING_SLUGS.has(instrument.slug) ||
        assignment.respondent_type !== 'student' ||
        assignment.timepoint !== 'post_rotation') {
      return res.status(422).json({ error: 'This certificate link is not supported.' });
    }
    if (!assignment.completed_at) {
      return res.status(409).json({ error: 'The certificate is available after the survey is submitted.' });
    }

    // The certificate must already exist (issued by the Casey-Fink post-rotation submit). We never
    // create it here. Look up by student so either gating token resolves the same certificate.
    const { data: cert, error: certErr } = await supabaseAdmin
      .from('certificates')
      .select('certificate_number')
      .eq('student_id', assignment.student_id)
      .maybeSingle();
    if (certErr) return res.status(500).json({ error: 'Internal error' });
    if (!cert || !cert.certificate_number) {
      return res.status(409).json({ error: 'The certificate is not available yet.' });
    }

    const templateBytes = await loadTemplateBytes(req);
    if (!templateBytes) return res.status(500).json({ error: 'Internal error' });

    const studentName = getStudentPreferredFullName(student);
    const pdfBytes = await generateParticipationCertificate({
      templateBytes,
      studentName,
      certificateNumber: cert.certificate_number,
    });

    const filename = `ASPIRE-Certificate-of-Participation-${safeFilePart(student.last_name)}-${safeFilePart(cert.certificate_number)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(pdfBytes));

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
