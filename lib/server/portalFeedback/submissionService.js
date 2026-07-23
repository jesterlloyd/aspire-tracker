import { randomUUID } from 'node:crypto';
import { claimAndSendPortalFeedbackDeliveryById } from './deliveryService.js';

function mapSubmitError(error) {
  const code = error?.code || '';
  if (code === 'PF409') return { status: 409, error: 'request_id_payload_conflict' };
  if (code === 'PF429') return { status: 429, error: 'rate_limited' };
  return { status: 500, error: 'persistence_failed' };
}

export async function submitPortalFeedback(deps, { reporterContext, payload, payloadFingerprint }) {
  const { data, error } = await deps.db.rpc('submit_portal_feedback_report', {
    p_reporter_context: {
      reporter_profile_id: reporterContext.profileId,
      reporter_display_name: reporterContext.displayName || null,
      reporter_email: reporterContext.email || null,
      portal_role: reporterContext.portalRole,
      portal_type: reporterContext.portalType,
    },
    p_payload: payload,
    p_payload_fingerprint: payloadFingerprint,
  });

  if (error) return { ok: false, ...mapSubmitError(error), retryAfterSeconds: error?.code === 'PF429' ? 3600 : null };

  const result = data || {};
  let send = { attempted: false, outcome: 'pending' };
  if (result.delivery_id && result.replayed !== true && deps.resend) {
    try {
      const sent = await claimAndSendPortalFeedbackDeliveryById(deps.db, deps.resend, result.delivery_id, {
        worker: `portal-feedback-api:${randomUUID()}`,
      });
      send = sent ? { attempted: true, outcome: sent.deliveryStatus } : { attempted: false, outcome: 'already_claimed' };
    } catch {
      send = { attempted: true, outcome: 'retry_pending' };
    }
  }

  return {
    ok: true,
    status: result.created === true ? 201 : 200,
    result,
    send,
  };
}
