// api/certificate-participation-admin-download.js
//
// ASPIRE-POSTROTATION-CERT-PDF-1 - Owner/Admin download of the ASPIRE Certificate of Participation
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
import { generateParticipationCertificate } from '../lib/server/certificates/generateParticipationCertificate.js';
import { getStudentPreferredFullName } from '../src/lib/studentNameFormatters.js';

const TEMPLATE_PATH = '/certificates/templates/aspire-certificate-of-participation.pdf';
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
      .select('role')
      .eq('auth_user_id', user.id)
      .single();
    if (!profile || !['owner', 'admin'].includes(profile.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // ── Resolve the certificate by certificate_id or student_id ──
    const certificateId = req.query?.certificate_id;
    const studentId = req.query?.student_id;

    let certQuery = supabaseAdmin
      .from('certificates')
      .select('certificate_number, student_id');
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

    const { data: student, error: studentErr } = await supabaseAdmin
      .from('students')
      .select('first_name, last_name, preferred_first_name')
      .eq('id', cert.student_id)
      .single();
    if (studentErr || !student) return res.status(404).json({ error: 'Student not found' });

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
