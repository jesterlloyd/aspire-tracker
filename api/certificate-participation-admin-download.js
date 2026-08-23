// api/certificate-participation-admin-download.js
//
// ASPIRE-POSTROTATION-CERT-PDF-1 - Owner/Admin download of the ASPIRE Certificate of Completion
// from the Student Profile. Authenticated Owner/Admin only. Looks up an existing certificate by
// student_id or certificate_id, verifies it belongs to the student, generates the PDF on demand,
// and streams it. Nothing is stored.
//
// This endpoint NEVER creates a certificate row, assigns a number, or touches
// certificate_sequences. The number is read from the certificates table and drawn verbatim.
//
// GET /api/certificate-participation-admin-download?student_id=<uuid>
//   or ?certificate_id=<uuid>   (Authorization: Bearer <jwt>)

import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { generateCompletionCertificate } from '../lib/server/certificates/generateCompletionCertificate.js';
import { loadCertificateDisplayFields } from '../lib/server/certificates/loadCertificateDisplayFields.js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';

const TEMPLATE_PATH = '/certificates/templates/aspire-certificate-of-completion.pdf';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_PATTERN.test(v); }

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
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Auth: JWT -> Owner/Admin ──
    const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    if (!bearer) return res.status(401).json({ error: 'Unauthorized' });

    const userClient = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${bearer}` } } },
    );

    let user;
    try {
      const { data: { user: u }, error } = await userClient.auth.getUser();
      if (error || !u) return res.status(401).json({ error: 'Unauthorized' });
      user = u;
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, is_active')
      .eq('auth_user_id', user.id)
      .single();
    // S-05: a deactivated account keeps a valid access token until it expires.
    // Refuse it before any work is performed, so deactivation ends access at once.
    if (profile && profile.is_active === false) {
      return res.status(403).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
    }
    if (!profile || !['owner', 'admin'].includes(profile.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // ── Resolve the certificate by certificate_id or student_id ──
    const certificateId = req.query?.certificate_id;
    const studentId = req.query?.student_id;

    let certQuery = supabaseAdmin
      .from('certificates')
      .select('certificate_number, certificate_unlocked_at, student_id, evaluation_assignment_id');
    if (isUuid(certificateId)) {
      certQuery = certQuery.eq('id', certificateId);
    } else if (isUuid(studentId)) {
      certQuery = certQuery.eq('student_id', studentId);
    } else {
      return res.status(400).json({ error: 'A valid student_id or certificate_id is required' });
    }

    const { data: cert, error: certErr } = await certQuery.maybeSingle();
    if (certErr) return res.status(500).json({ error: 'Internal error' });
    if (!cert || !cert.certificate_number) {
      return res.status(404).json({ error: 'No certificate found for this student' });
    }
    // If both were supplied, the certificate must belong to the named student.
    if (isUuid(studentId) && cert.student_id !== studentId) {
      return res.status(404).json({ error: 'No certificate found for this student' });
    }

    // Canonical display fields (name, unit, rotation window, approved-hours snapshot,
    // issued date) via the ONE shared resolver.
    const fields = await loadCertificateDisplayFields(supabaseAdmin, cert);
    if (!fields) return res.status(404).json({ error: 'Student not found' });

    const templateBytes = await loadTemplateBytes(req);
    if (!templateBytes) return res.status(500).json({ error: 'Internal error' });

    const pdfBytes = await generateCompletionCertificate({ templateBytes, ...fields });

    const filename = `ASPIRE-Certificate-of-Completion-${safeFilePart(fields.lastName)}-${safeFilePart(cert.certificate_number)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(pdfBytes));

  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}
