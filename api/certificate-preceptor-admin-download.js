// api/certificate-preceptor-admin-download.js
//
// PRECEPTOR-CERT-1 - Owner/Admin download of the ASPIRE Certificate of
// Appreciation. Authenticated Owner/Admin only. Looks up an existing certificate
// by preceptor_id (+ optional cohort_id) or certificate_id, generates the PDF on
// demand, and streams it. Nothing is stored.
//
// Variants:
//   default              - flattened presentation PDF (what the preceptor gets)
//   ?variant=editable    - the SAME populated document with its AcroForm fields
//                          left editable: the governed internal record, rendered
//                          on demand rather than persisted.
//
// This endpoint NEVER creates a certificate row, assigns a number, or touches
// certificate_sequences.
//
// GET /api/certificate-preceptor-admin-download?preceptor_id=<uuid>[&cohort_id=<uuid>][&variant=editable]
//   or ?certificate_id=<uuid>   (Authorization: Bearer <jwt>)

import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { generatePreceptorCertificate } from '../lib/server/certificates/generatePreceptorCertificate.js';
import { loadPreceptorCertificateDisplayFields } from '../lib/server/certificates/loadPreceptorCertificateDisplayFields.js';

const TEMPLATE_PATH = '/certificates/templates/aspire-certificate-of-preceptor-appreciation.pdf';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_PATTERN.test(v);

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

    // ── Auth: JWT -> Owner/Admin (same pattern as the student admin download) ──
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

    // ── Resolve the certificate ──
    const certificateId = req.query?.certificate_id;
    const preceptorId = req.query?.preceptor_id;
    const cohortId = req.query?.cohort_id;
    const editable = req.query?.variant === 'editable';

    const SELECT = 'id, preceptor_id, cohort_id, qualifying_assignment_id, certificate_number, certificate_unlocked_at';
    let cert = null;
    if (isUuid(certificateId)) {
      const { data } = await supabaseAdmin
        .from('preceptor_certificates').select(SELECT).eq('id', certificateId).maybeSingle();
      cert = data;
    } else if (isUuid(preceptorId)) {
      let q = supabaseAdmin.from('preceptor_certificates').select(SELECT).eq('preceptor_id', preceptorId);
      if (isUuid(cohortId)) q = q.eq('cohort_id', cohortId);
      // Without a cohort filter, serve the most recent recognition.
      const { data } = await q.order('certificate_unlocked_at', { ascending: false }).limit(1);
      cert = data?.[0] || null;
    } else {
      return res.status(400).json({ error: 'preceptor_id or certificate_id is required' });
    }
    if (!cert) return res.status(404).json({ error: 'No certificate found' });

    const { fields, missing } = await loadPreceptorCertificateDisplayFields(supabaseAdmin, cert);
    if (!fields || missing.length > 0) {
      return res.status(409).json({ error: `Certificate data incomplete: ${missing.join(', ')}` });
    }

    const templateBytes = await loadTemplateBytes(req);
    if (!templateBytes) return res.status(500).json({ error: 'Internal error' });

    const pdfBytes = await generatePreceptorCertificate(templateBytes, fields, { flatten: !editable });

    const lastName = safeFilePart(fields.preceptorName.split(/\s+/).slice(-1)[0]);
    const issueYear = new Date(cert.certificate_unlocked_at).getFullYear();
    const suffix = editable ? '_Editable' : '';
    const filename = `ASPIRE_Preceptor_Appreciation_${lastName}_${issueYear}${suffix}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[preceptor-cert-admin-download] unexpected:', e?.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
