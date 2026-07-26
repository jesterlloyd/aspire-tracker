/* global process */

import { Resend } from 'resend';
import { verifyPortalUnitLeaderCaller } from '../lib/unitLeaderScope.js';
import { verifyPortalStudentCaller, getServiceDb } from '../lib/messagesAuth.js';
import { verifyPortalCaller, hasActiveRoleGrant } from '../lib/portalAuth.js';
import { readPortalFeedbackJsonBody, safePortalFeedbackLog } from '../lib/portalFeedbackApi.js';
import { validatePortalFeedbackPayload } from '../../lib/server/portalFeedback/validation.js';
import { submitPortalFeedback } from '../../lib/server/portalFeedback/submissionService.js';

function reporterContextFromUnitLeader(auth) {
  return {
    profileId: auth.profile.id,
    displayName: auth.profile.full_name || null,
    email: auth.profile.email || null,
    portalRole: 'unit_leader',
    portalType: 'unit_leader',
  };
}

function reporterContextFromStudent(auth) {
  return {
    profileId: auth.profile.id,
    displayName: auth.profile.full_name || null,
    email: auth.profile.email || null,
    portalRole: 'student',
    portalType: 'student',
  };
}

function reporterContextFromAcademicPartner(auth) {
  return {
    profileId: auth.profile.id,
    displayName: auth.profile.full_name || null,
    email: auth.profile.email || null,
    portalRole: 'academic_partner',
    portalType: 'academic_partner',
  };
}

async function verifyPortalFeedbackCaller(req) {
  const asStudent = await verifyPortalStudentCaller(req);
  if (asStudent.ok) {
    let db;
    try { db = getServiceDb(); } catch { return { ok: false, status: 500, reason: 'server_misconfigured' }; }
    return { ...asStudent, db, actorKind: 'student', scopes: [] };
  }
  if (asStudent.reason !== 'no_active_student_grant') return asStudent;

  const asUnitLeader = await verifyPortalUnitLeaderCaller(req);
  if (asUnitLeader.ok) {
    if (!Array.isArray(asUnitLeader.scopes) || asUnitLeader.scopes.length === 0) {
      return { ok: false, status: 403, reason: 'unit_leader_active_scope_required' };
    }
    return { ...asUnitLeader, actorKind: 'unit_leader' };
  }

  // Academic Partner: feedback is authorized by an ACTIVE academic_partner grant alone. An AP
  // holds neither a student nor a unit-leader grant, so this is the final branch. Feedback carries
  // no roster data, so no further scope is required. The DB CHECK and the RPC already accept
  // 'academic_partner'; this wires the endpoint auth to match.
  const asPartner = await verifyPortalCaller(req);
  if (asPartner.authenticated) {
    let db;
    try { db = getServiceDb(); } catch { return { ok: false, status: 500, reason: 'server_misconfigured' }; }
    if (await hasActiveRoleGrant(db, asPartner.profile.id, 'academic_partner')) {
      return { ok: true, profile: asPartner.profile, db, actorKind: 'academic_partner', scopes: [] };
    }
  }
  return asUnitLeader;
}

export function createPortalFeedbackSubmitHandler({
  verifyCaller = verifyPortalFeedbackCaller,
  submit = submitPortalFeedback,
  makeResend = () => new Resend(process.env.RESEND_API_KEY),
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const auth = await verifyCaller(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.reason || 'unauthorized' });

    const parsed = readPortalFeedbackJsonBody(req);
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

    const validated = validatePortalFeedbackPayload(parsed.body);
    if (!validated.ok) {
      return res.status(422).json({
        error: validated.error,
        fields: validated.fields || undefined,
      });
    }

    try {
      const out = await submit(
        { db: auth.db, resend: makeResend() },
        {
          reporterContext: auth.actorKind === 'student'
            ? reporterContextFromStudent(auth)
            : auth.actorKind === 'academic_partner'
              ? reporterContextFromAcademicPartner(auth)
              : reporterContextFromUnitLeader(auth),
          payload: validated.value,
          payloadFingerprint: validated.payloadFingerprint,
        },
      );

      if (!out.ok) {
        if (out.status === 429) {
          res.setHeader('Retry-After', String(out.retryAfterSeconds || 3600));
        }
        return res.status(out.status).json({ error: out.error });
      }

      return res.status(out.status).json({
        submission_id: out.result.submission_id,
        created_at: out.result.created_at,
        replayed: out.result.replayed === true,
        notification_status: out.send?.outcome === 'sent' ? 'sent' : 'pending',
        confirmation: 'Your report was received by the ASPIRE Team.',
      });
    } catch (err) {
      safePortalFeedbackLog('portal/feedback-submit', 'internal_failure', err);
      return res.status(500).json({ error: 'internal_failure' });
    }
  };
}

export default createPortalFeedbackSubmitHandler();
