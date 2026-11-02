// api/keith-residency.js
//
// RESIDENCY-KEITH-1 (Owner, 2026-11-01): Keith chat for the Residency Portal and Residency.
// Reads only the open cohort's applicants, as the workspace shows them to this caller, and writes
// nothing. Haiku or Sonnet, never Opus. Its own file because a Sonnet tool loop outlives the
// default function limit (vercel.json gives it 60 s).
//
//   POST { action: 'chat', cycle_id, chat_model: 'haiku'|'sonnet', messages: [{ role, content }] }
//     -> { ok, answer, model }
//
// Who: the residency workspace's own gate (verifyNgrpCaller): the ASPIRE team and Talent
// Acquisition. Talent Acquisition reads the narrowed roster (lib/server/keith/residencyChat.js).
// Every call is rate limited and logged in keith_requests as intent 'residency_chat'.
import { randomUUID } from 'node:crypto'
import { getServiceDb } from './lib/portalAuth.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { TALENT_ACQUISITION } from '../lib/server/ngrpTalentAcquisition.js'
import { serviceDbForRequest } from '../lib/server/demoScope.js'
import { requestNamesOpus } from '../lib/server/keith/modelRouting.js'
import { consumeRateLimit, WEIGHT_CHAT } from '../lib/server/keith/rateLimit.js'
import { recordKeithUsage, OUTCOMES } from '../lib/server/keith/usageLog.js'
import { chatRouteFor, cleanMessages, residencyRoster, runResidencyChat } from '../lib/server/keith/residencyChat.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTENT = 'residency_chat'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const caller = await verifyNgrpCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  if (body.action !== 'chat') return res.status(400).json({ error: 'invalid_action' })
  // Opus is the Owner's, in the staff app's own chat. Here it is refused, not downgraded.
  if (requestNamesOpus(body)) return res.status(403).json({ error: 'model_not_allowed' })

  const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
  if (!cycleId) return res.status(422).json({ error: 'invalid_cycle' })
  const messages = cleanMessages(body.messages)
  if (!messages.length) return res.status(422).json({ error: 'invalid_messages' })

  const ta = caller.audience === TALENT_ACQUISITION
  const role = ta ? 'talent_acquisition' : (caller.profile?.role || null)
  const profileId = caller.profile?.id || null
  const requestId = `req_${randomUUID().slice(0, 8)}`
  const started = Date.now()
  const meter = getServiceDb()
  const route = chatRouteFor(body.chat_model)

  const rate = await consumeRateLimit(meter, { profileId, weight: WEIGHT_CHAT, requestId })
  if (!rate.allowed) {
    await recordKeithUsage(meter, {
      requestId, profileId, role, intent: INTENT,
      outcome: rate.degraded ? OUTCOMES.ERROR : OUTCOMES.RATE_LIMITED, rateLimited: !rate.degraded,
      durationMs: Date.now() - started,
    })
    return res.status(rate.degraded ? 503 : 429).json({ ok: false, error: rate.degraded ? 'limiter_unavailable' : 'rate_limited' })
  }

  try {
    const db = serviceDbForRequest(getServiceDb(), req)
    const roster = await residencyRoster(db, cycleId, { talentAcquisition: ta })
    if (roster.error) return res.status(404).json({ ok: false, error: 'cycle_not_found' })
    const r = await runResidencyChat({ db, roster, messages, route, talentAcquisition: ta })
    await recordKeithUsage(meter, {
      requestId, profileId, role, intent: INTENT,
      model: r.model || route.model, modelRoute: route.route,
      inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens,
      rounds: r.rounds || 0, outcome: r.ok ? OUTCOMES.COMPLETED : OUTCOMES.ERROR,
      durationMs: Date.now() - started,
    })
    if (!r.ok) {
      console.error('[keith-residency]', requestId, r.reason)
      return res.status(r.reason === 'timeout' ? 504 : 502).json({ ok: false, error: r.reason === 'timeout' ? 'timeout' : 'upstream_error' })
    }
    return res.status(200).json({ ok: true, answer: r.text, model: r.model || route.model })
  } catch (err) {
    console.error('[keith-residency] failed:', requestId, err?.message || err)
    return res.status(500).json({ ok: false, error: 'internal_error' })
  }
}
