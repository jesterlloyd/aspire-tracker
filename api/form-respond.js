// api/form-respond.js
//
// FORMS-PHASE3: the public endpoint behind /form#t=<token>. The personal link is the whole
// identity check (Owner, 2026-09-23); the token is checked by hash on every call. Rate
// limited like the other public surfaces (S-11).
//
// Actions (POST { token, action, ... }):
//   state   -> the form to answer (with ASPIRE's answers filled in), or done / closed
//   upload  -> { path, token } a signed upload for a File upload question (10 MB)
//   submit  -> { submittedAt, pdf } validates, files the PDF, marks the request done
//   copy    -> { pdf, fileName } the respondent's filed copy again, once submitted

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { createMailer } from '../lib/server/email/mailer.js'
import { appBaseUrl } from '../lib/server/appUrl.js'
import { consumePublicRateLimit, TOO_MANY_REQUESTS } from './lib/publicRateLimit.js'
import { clientContext } from '../lib/server/signatures/tokens.js'
import { FORM_TOKEN_PATTERN } from '../lib/server/forms/tokens.js'
import { FormError, resolveLink, respondentState, respondentCopy, uploadSlot, submit } from '../lib/server/forms/engine.js'

const LIMITS = [
  { prefix: 'form-respond-min', windowSeconds: 60, maxPerWindow: 40 },
  { prefix: 'form-respond-hour', windowSeconds: 3600, maxPerWindow: 400 },
]

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const db = supabaseAdmin
  if (!(await consumePublicRateLimit(db, req, LIMITS))) return res.status(429).json({ error: TOO_MANY_REQUESTS })
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  try {
    if (!FORM_TOKEN_PATTERN.test(String(body.token || ''))) throw new FormError('bad_link', 'This link is not valid.', 404)
    const link = await resolveLink(db, body.token)
    switch (String(body.action || 'state')) {
      case 'state': return res.status(200).json(await respondentState(db, link))
      case 'upload': return res.status(200).json(await uploadSlot(db, link.assignment, { name: body.name, size: body.size }))
      case 'submit': return res.status(200).json(await submit(db, { ...link, answers: body.answers, ctx: clientContext(req) }, { mailer: createMailer(), appUrl: appBaseUrl() }))
      case 'copy': return res.status(200).json(await respondentCopy(db, link))
      default: throw new FormError('invalid', 'Unknown action.')
    }
  } catch (err) {
    if (err instanceof FormError) return res.status(err.status).json({ error: err.message, code: err.code })
    if (err?.code === 'token_secret_missing') return res.status(503).json({ error: 'Forms are not configured yet.', code: err.code })
    console.error('[form-respond] unhandled:', err?.message || err)
    return res.status(500).json({ error: 'Server error' })
  }
}
