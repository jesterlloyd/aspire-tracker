// api/certificate-preceptor-reconcile.js
//
// PRECEPTOR-CERT-1 - the Owner/Admin RELIABILITY BACKSTOP behind immediate
// unlock. The submit-time unlock is the primary path; this pass recovers what
// it missed, idempotently, with nothing to configure:
//
//   (a) completed End-of-Rotation preceptor_progress assignments with a
//       canonical respondent but NO certificate -> issue (the RPC re-verifies
//       every eligibility rule; replays return already_issued).
//   (b) certificates with notified_at IS NULL -> mint a fresh single-use token
//       on the qualifying assignment (the raw token exists only inside the
//       outbound email, exactly like an invitation) and send the
//       certificate-ready email through the same claim-first path, so a
//       concurrent submit-time send can never double-notify.
//
// Retries can never create duplicate certificates (DB uniques + idempotent
// RPC), duplicate numbers (shared locked counter), or duplicate emails
// (notified_at claim). Assignments with respondent_preceptor_id NULL (legacy
// free-text sends) are REPORTED as exceptions, never guessed into a
// certificate.
//
// POST /api/certificate-preceptor-reconcile   Body: { cohort_id }
// Authorization: Bearer <jwt>  (Owner/Admin)

import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { generateToken } from '../lib/server/evaluation/tokens.js';
import { emailBaseUrl } from '../lib/server/appUrl.js';
import { unlockPreceptorCertificate } from '../lib/server/certificates/unlockPreceptorCertificate.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_PATTERN.test(v);
// Download links minted here live long enough to be useful, short enough to
// stay time-bounded - the same posture as survey-token grace.
const RECONCILE_TOKEN_DAYS = 30;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ── Auth: Owner/Admin (same pattern as the admin download) ──
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
    } catch { return res.status(401).json({ error: 'Unauthorized' }); }
    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('role').eq('auth_user_id', user.id).single();
    if (!profile || !['owner', 'admin'].includes(profile.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let body;
    try {
      const raw = req.body;
      body = (raw && typeof raw === 'object') ? raw : JSON.parse(raw);
    } catch { return res.status(400).json({ error: 'Invalid request body' }); }
    const cohortId = body?.cohort_id;
    if (!isUuid(cohortId)) return res.status(400).json({ error: 'cohort_id must be a valid UUID' });

    // ── (a) Completed EOR assessments missing a certificate ──
    const { data: instrument } = await supabaseAdmin
      .from('evaluation_instruments').select('id').eq('slug', 'preceptor_progress').single();
    if (!instrument) return res.status(422).json({ error: 'Instrument not found' });

    const { data: completed, error: qErr } = await supabaseAdmin
      .from('evaluation_assignments')
      .select('id, respondent_preceptor_id')
      .eq('cohort_id', cohortId)
      .eq('instrument_id', instrument.id)
      .eq('respondent_type', 'preceptor')
      .eq('timepoint', 'post_rotation')
      .not('completed_at', 'is', null);
    if (qErr) return res.status(500).json({ error: 'Internal error' });

    const exceptions = [];
    let issued = 0, alreadyIssued = 0, notified = 0;

    const baseUrl = emailBaseUrl(req);

    // Existing certificates for the cohort, so fully-settled rows (issued AND
    // notified) are skipped without minting a token they will never use.
    const { data: existingCerts } = await supabaseAdmin
      .from('preceptor_certificates')
      .select('qualifying_assignment_id, preceptor_id, notified_at')
      .eq('cohort_id', cohortId);
    const settledByAssignment = new Set(
      (existingCerts || []).filter(c => c.notified_at).map(c => c.qualifying_assignment_id));
    const settledByPreceptor = new Set(
      (existingCerts || []).filter(c => c.notified_at).map(c => c.preceptor_id));

    for (const a of completed || []) {
      if (!a.respondent_preceptor_id) {
        exceptions.push({ assignment_id: a.id, reason: 'no_canonical_respondent' });
        continue;
      }
      if (settledByAssignment.has(a.id) || settledByPreceptor.has(a.respondent_preceptor_id)) {
        alreadyIssued += 1;
        continue;
      }
      // Notification link: a fresh single-use token on the qualifying
      // assignment. Minted only when issuance or a notification may still be
      // owed; unused tokens simply expire.
      //
      // generateToken() returns { raw, hash, hashPrefix } - an OBJECT. Treating
      // its return as a raw string (and re-hashing it) threw inside crypto and
      // 500'd the whole run in production. Destructured exactly as the proven
      // send path does (lib/server/evaluation/preceptorSend.js), so the raw
      // token is what goes in the link and the hash is what goes at rest.
      const { raw: rawToken, hash: tokenHash, hashPrefix: tokenHashPrefix } = generateToken();
      const expires = new Date(Date.now() + RECONCILE_TOKEN_DAYS * 24 * 3600 * 1000);
      const { error: tokenErr } = await supabaseAdmin
        .from('evaluation_assignment_tokens')
        .insert({
          assignment_id:     a.id,
          token_hash:        tokenHash,
          token_hash_prefix: tokenHashPrefix,
          expires_at:        expires.toISOString(),
        });
      if (tokenErr) {
        exceptions.push({ assignment_id: a.id, reason: 'token_mint_failed' });
        continue;
      }

      const r = await unlockPreceptorCertificate({
        supabaseAdmin,
        assignmentId: a.id,
        downloadUrl: `${baseUrl}/evaluation/feedback#t=${rawToken}`,
        source: 'reconciliation',
        logPrefix: '[preceptor-cert-reconcile]',
      });
      if (r.status === 'issued') issued += 1;
      else if (r.status === 'already_issued') alreadyIssued += 1;
      else exceptions.push({ assignment_id: a.id, reason: r.reason || r.status });
      if (r.notified) notified += 1;
    }

    // ── Status summary for the console ──
    const { data: certs } = await supabaseAdmin
      .from('preceptor_certificates')
      .select('id, notified_at')
      .eq('cohort_id', cohortId);
    const total = certs?.length || 0;
    const unnotified = (certs || []).filter(c => !c.notified_at).length;

    return res.status(200).json({
      success: true,
      summary: {
        completed_assessments: (completed || []).length,
        newly_issued: issued,
        already_issued: alreadyIssued,
        notifications_sent: notified,
        certificates_total: total,
        certificates_unnotified: unnotified,
        exceptions,
      },
    });
  } catch (e) {
    console.error('[preceptor-cert-reconcile] unexpected:', e?.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
