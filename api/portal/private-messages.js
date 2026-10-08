// api/portal/private-messages.js
//
// TA-MESSAGES-1 (Owner, 2026-10-07): PRIVATE conversations between Talent Acquisition and one unit
// leader or one alumnus, started by either side. "It should only be between the portal user and
// who they send a message to." The ASPIRE team never sees them (the database enforces it).
//
//   GET  ?kind=unit_leader|student|talent_acquisition&q=   the picker's list for this caller
//   POST { to_kind, to_profile_id, subject, body }   start one (the browser's request helper
//   refuses delivery-routing names like recipient_profile_id, and these are verified here anyway)
//
// Nothing about the recipient is trusted from the client: the profile id is re-resolved through
// the same predicates the picker uses (lib/server/messages/privateRecipients.js), and the RPC
// re-verifies both parties' active access. Before 20261114000000 is applied every call answers
// 409 not_enabled.
import { createMailer } from '../../lib/server/email/mailer.js'
import { verifyPortalMessagesCaller, getServiceDb } from '../lib/messagesAuth.js'
import { methodGuard, readJsonBody, mapRpcError, rateLimitResponse, logApiError } from '../lib/messagesApi.js'
import { validateBody, validateSubject, isUuid } from '../../lib/server/messages/validation.js'
import { consumeNewConversation, consumeMessage } from '../../lib/server/messages/rateLimitUtil.js'
import { startPrivateThread } from '../../lib/server/messages/conversationService.js'
import { listPrivateRecipients, resolvePrivateRecipient, privateRecipientKinds, isAlumnusCaller } from '../../lib/server/messages/privateRecipients.js'
import { isPrivateMessagingCapable } from '../lib/taMessagingCapability.js'
import { populationDb } from '../../lib/server/demoScope.js'

const PRIVATE_ACTORS = new Set(['talent_acquisition', 'unit_leader', 'student'])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private')
  if (!methodGuard(req, res, ['GET', 'POST'])) return

  const caller = await verifyPortalMessagesCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  if (!PRIVATE_ACTORS.has(caller.actorKind)) return res.status(403).json({ error: 'private_messages_not_available' })

  const db = getServiceDb()
  if (!(await isPrivateMessagingCapable(db))) return res.status(409).json({ error: 'not_enabled' })
  // A student may message Talent Acquisition only as an alumnus (Completed).
  if (caller.actorKind === 'student') {
    try {
      if (!(await isAlumnusCaller(db, caller.studentIds || []))) return res.status(403).json({ error: 'alumni_only' })
    } catch (err) {
      logApiError('portal/private-messages', 'alumnus_check_failed', err)
      return res.status(500).json({ error: 'internal_error' })
    }
  }
  const pop = populationDb(getServiceDb(), req)

  if (req.method === 'GET') {
    const kind = String(req.query?.kind || '')
    if (!privateRecipientKinds(caller.actorKind).includes(kind)) return res.status(422).json({ error: 'invalid_kind' })
    try {
      const recipients = await listPrivateRecipients(db, pop, {
        actorKind: caller.actorKind, selfProfileId: caller.profile.id, kind, query: req.query?.q,
      })
      return res.status(200).json({ kinds: privateRecipientKinds(caller.actorKind), recipients })
    } catch (err) {
      logApiError('portal/private-messages', 'list_failed', err)
      return res.status(500).json({ error: 'internal_error' })
    }
  }

  const parsed = readJsonBody(req)
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })
  const allowed = new Set(['to_kind', 'to_profile_id', 'subject', 'body'])
  for (const k of Object.keys(parsed.body || {})) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }
  const kind = parsed.body.to_kind
  const recipientId = parsed.body.to_profile_id
  if (!privateRecipientKinds(caller.actorKind).includes(kind)) return res.status(422).json({ error: 'invalid_recipient_kind' })
  if (!isUuid(recipientId)) return res.status(422).json({ error: 'invalid_recipient' })
  const subject = validateSubject(parsed.body.subject)
  if (!subject.ok) return res.status(422).json({ error: subject.error })
  const body = validateBody(parsed.body.body)
  if (!body.ok) return res.status(422).json({ error: body.error })

  let counterpart
  try {
    counterpart = await resolvePrivateRecipient(db, pop, {
      actorKind: caller.actorKind, selfProfileId: caller.profile.id, kind, profileId: recipientId,
    })
  } catch (err) {
    logApiError('portal/private-messages', 'resolve_failed', err)
    return res.status(500).json({ error: 'internal_error' })
  }
  // Not messageable and nonexistent are indistinguishable.
  if (!counterpart) return res.status(404).json({ error: 'not_found' })

  const rateConv = await consumeNewConversation(db, caller.profile.id)
  if (!rateConv.allowed) return rateLimitResponse(res, rateConv)
  const rateMsg = await consumeMessage(db, caller.profile.id)
  if (!rateMsg.allowed) return rateLimitResponse(res, rateMsg)

  try {
    const out = await startPrivateThread(
      { db, resend: createMailer() },
      { profile: caller.profile, actorKind: caller.actorKind, counterpart, subject: subject.value, body: body.value },
    )
    if (out.rpcError) {
      const mapped = mapRpcError(out.rpcError)
      logApiError('portal/private-messages', mapped.error, out.rpcError)
      return res.status(mapped.status).json({ error: mapped.error })
    }
    if (!out.ok) return res.status(409).json({ error: 'conflict', reason: out.reason })
    return res.status(201).json({
      conversation_id: out.result.conversation_id,
      message_id: out.result.message_id,
      created_at: out.result.created_at,
      thread_kind: 'private',
      recipient_name: counterpart.fullName,
    })
  } catch (err) {
    logApiError('portal/private-messages', 'threw', err)
    return res.status(500).json({ error: 'internal_error' })
  }
}
