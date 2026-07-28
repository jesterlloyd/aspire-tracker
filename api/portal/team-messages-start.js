// api/portal/team-messages-start.js
//
// Role-aware GENERAL portal-to-ASPIRE Team thread creation.
//
// Accepted callers:
//   - active Student portal user
//   - active Unit Leader with at least one active unit scope
//   - active Academic Partner with at least one active school scope (fail-closed: see below)
//
// The browser supplies only request_id and body. It never sends a student id,
// unit key, role, profile id, destination, category, or subject. The server
// derives identity, actor kind, subject, category, routing, and delivery.
//
// Academic Partner thread creation is fail-closed: the DB start RPC does not admit the
// academic_partner actor shape until the Owner SQL gate is applied, so this handler refuses AP writes
// with 503 (never attempting the RPC) while AP_MESSAGING_ENABLED is false.

/* global process */
import { Resend } from 'resend';
import { verifyPortalMessagesCaller, getServiceDb } from '../lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from '../lib/messagesApi.js';
import { validateBody, isUuid } from '../../lib/server/messages/validation.js';
import { startGeneralTeamConversationForPortal } from '../../lib/server/messages/conversationService.js';
import { resolveApMessagingCapability } from '../lib/apMessagingCapability.js';

const ALLOWED_FIELDS = new Set(['request_id', 'body']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyPortalMessagesCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });
  if (caller.actorKind === 'unit_leader' && (!caller.unitKeys || caller.unitKeys.length === 0)) {
    return res.status(403).json({ error: 'no_active_unit_scope' });
  }
  if (caller.actorKind === 'academic_partner') {
    if (!caller.schoolKeys || caller.schoolKeys.length === 0) {
      return res.status(403).json({ error: 'no_active_school_scope' });
    }
    // Fail closed on the server capability gate (env flag AND applied DB migration). This never
    // attempts the RPC while disabled; the RPC also independently re-authorizes when enabled.
    const apCapable = await resolveApMessagingCapability(getServiceDb());
    if (!apCapable) {
      return res.status(503).json({ error: 'messaging_not_enabled', reason: 'ap_messaging_capability_unavailable' });
    }
  }

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  for (const key of Object.keys(parsed.body || {})) {
    if (!ALLOWED_FIELDS.has(key)) return res.status(400).json({ error: 'unexpected_field', field: key });
  }

  const requestId = parsed.body.request_id;
  if (!isUuid(requestId)) return res.status(422).json({ error: 'invalid_request_id' });

  const body = validateBody(parsed.body.body);
  if (!body.ok) return res.status(422).json({ error: body.error });

  try {
    const out = await startGeneralTeamConversationForPortal(
      { db: getServiceDb(), resend: new Resend(process.env.RESEND_API_KEY) },
      {
        profile: caller.profile,
        actorKind: caller.actorKind,
        requestId,
        body: body.value,
      },
    );

    if (out.rpcError) {
      const mapped = mapRpcError(out.rpcError);
      logApiError('portal/team-messages-start', mapped.error, out.rpcError);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    if (!out.ok) return res.status(409).json({ error: 'conflict', reason: out.reason });

    return res.status(out.result.idempotent_replay === true ? 200 : 201).json({
      conversation_id: out.result.conversation_id,
      message_id: out.result.message_id,
      created_at: out.result.created_at,
      status: 'Open',
      thread_kind: 'team_general',
      idempotent_replay: out.result.idempotent_replay === true,
      confirmation: 'Your message was sent to the ASPIRE Team.',
    });
  } catch (err) {
    logApiError('portal/team-messages-start', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
