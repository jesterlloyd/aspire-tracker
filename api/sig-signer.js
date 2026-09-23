// api/sig-signer.js
//
// SIGNATURES-PHASE2: the signer's endpoint. Public (no account), so every call proves
// itself: the link token (hash-matched, request still live), then, for anything past
// "Confirm it's you", the session issued when the emailed code verified. Throttled with
// the public-surface limiter (S-11). Off unless catalog.signatures is 'owner' or 'on'.
//
// POST { action, token, session?, ... }
//   state          what the page should show next, and everything it needs to show it
//   send_code      email a 6-digit code (10 minutes, 5 attempts)
//   verify_code    { code } -> { session }
//   sample_pdf     -> { pdf_base64 } and records that the sample opened
//   consent        { opened_sample, agreed }
//   document       -> { url } short-lived, to read or download before signing
//   open           records "Opened" (a viewer's view counts as done)
//   finish         { values, adopted } -> signs. The only action that signs.
//   decline        { reason }
//   delegate       { name, email, reason } -> the sender approves before it moves
//   paper_copy     tells the sender
//   copy           -> { url } the signer's copy (sealed once complete)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { createMailer } from '../lib/server/email/mailer.js'
import { appBaseUrl } from '../lib/server/appUrl.js'
import { consumePublicRateLimit, TOO_MANY_REQUESTS } from './lib/publicRateLimit.js'
import { LINK_TOKEN_PATTERN, clientContext } from '../lib/server/signatures/tokens.js'
import {
  EngineError, flagState, loadSettings, resolveLink, linkIsLive, sendCode, verifyCode, requireSession,
  recordSampleOpened, recordConsent, recordOpened, finishSigning, declineSigning, requestDelegation,
  requestPaperCopy, prefillFor, loadBundle, advance, appendEvent, DOC_BUCKET, ORG_ID,
} from '../lib/server/signatures/engine.js'
import { currentTurn, SENDER_ROLE } from '../src/lib/signatures/sigModel.js'
import { flattenDocument } from '../lib/server/signatures/sealing.js'

const LIMITS = [
  { prefix: 'sig-signer-min', windowSeconds: 60, maxPerWindow: 40 },
  { prefix: 'sig-signer-hour', windowSeconds: 3600, maxPerWindow: 400 },
]
const PRE_SESSION = new Set(['state', 'send_code', 'verify_code'])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const db = supabaseAdmin
  if (!(await consumePublicRateLimit(db, req, LIMITS))) return res.status(429).json({ error: TOO_MANY_REQUESTS })
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  const ctx = clientContext(req)
  try {
    if ((await flagState(db)) === 'off') throw new EngineError('off', 'This link is not active.', 404)
    if (!LINK_TOKEN_PATTERN.test(String(body.token || ''))) throw new EngineError('bad_link', 'This link is not valid.', 404)
    const { signer, request } = await resolveLink(db, body.token)
    const settings = await loadSettings(db)
    const action = String(body.action || 'state')
    const live = linkIsLive(request)
    const signedSession = body.action === 'copy' && signer.signed_at
    if (!live.live && action !== 'state' && !signedSession) throw new EngineError('closed', live.reason, 409)
    if (!PRE_SESSION.has(action)) requireSession(signer, body.session)
    const mailer = createMailer()
    const appUrl = appBaseUrl()

    switch (action) {
      case 'state': return res.status(200).json(await stateFor(db, { signer, request, settings, session: body.session, live, ctx }))
      case 'send_code': return res.status(200).json(await sendCode(db, { signer, request, settings, mailer, ctx }))
      case 'verify_code': return res.status(200).json(await verifyCode(db, { signer, request, code: body.code, settings, ctx }))
      case 'sample_pdf': {
        await recordSampleOpened(db, { signer, request, ctx })
        return res.status(200).json({ pdf_base64: (await samplePdf()).toString('base64') })
      }
      case 'consent':
        await recordConsent(db, { signer, request, settings, openedSample: body.opened_sample === true, agreed: body.agreed === true, ctx })
        return res.status(200).json({ ok: true })
      case 'document': {
        const { data, error } = await db.storage.from(DOC_BUCKET).createSignedUrl(request.document_path, 120, body.download ? { download: `${request.title}.pdf` } : undefined)
        if (error || !data?.signedUrl) throw new EngineError('doc_failed', 'The document could not be opened.', 502)
        if (body.download) await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'downloaded', actor: signer.name, ctx, details: { before_signing: !signer.signed_at } })
        return res.status(200).json({ url: data.signedUrl })
      }
      case 'open':
        await recordOpened(db, { signer, request, ctx })
        if (signer.recipient_type === 'viewer') await advance(db, request.id, { appUrl, mailer, settings, ctx })
        return res.status(200).json({ ok: true })
      case 'finish': {
        const out = await finishSigning(db, { signer, request, values: body.values || {}, adopted: body.adopted, ctx, appUrl, mailer, settings })
        return res.status(200).json({ ok: true, completed: !!out.completed, seal_pending: !!out.sealPending })
      }
      case 'decline':
        await declineSigning(db, { signer, request, reason: body.reason, ctx, mailer, appUrl })
        return res.status(200).json({ ok: true })
      case 'delegate':
        await requestDelegation(db, { signer, request, name: body.name, email: body.email, reason: body.reason, ctx, mailer, appUrl })
        return res.status(200).json({ ok: true })
      case 'paper_copy':
        await requestPaperCopy(db, { signer, request, ctx, mailer, appUrl })
        return res.status(200).json({ ok: true })
      case 'copy': {
        const fresh = (await loadBundle(db, request.id)).request
        if (fresh.sealed_path) {
          const { data } = await db.storage.from(DOC_BUCKET).createSignedUrl(fresh.sealed_path, 120, { download: `${fresh.title} (sealed).pdf` })
          return res.status(200).json({ url: data?.signedUrl, sealed: true })
        }
        // Not sealed yet: the document with every value so far, marked as not final.
        const b = await loadBundle(db, request.id)
        const { data: blob } = await db.storage.from(DOC_BUCKET).download(fresh.document_path)
        const doc = await flattenDocument({ documentBytes: Buffer.from(await blob.arrayBuffer()), fields: fresh.fields, values: b.values, signersByRole: Object.fromEntries(b.signers.map(s => [s.role_key, s])) })
        const font = await doc.embedFont(StandardFonts.HelveticaBold)
        for (const p of doc.getPages()) p.drawText('COPY - NOT YET SEALED. The sealed copy is emailed when everyone has signed.', { x: 24, y: 14, size: 7, font, color: rgb(0.6, 0.1, 0.1) })
        return res.status(200).json({ pdf_base64: Buffer.from(await doc.save()).toString('base64'), sealed: false })
      }
      default: throw new EngineError('bad_action', 'Unknown action.', 400)
    }
  } catch (err) {
    if (err instanceof EngineError) return res.status(err.status).json({ error: err.message, code: err.code })
    if (err?.code === 'token_secret_missing') return res.status(503).json({ error: 'Signing is not configured yet.', code: err.code })
    console.error('[sig-signer] unhandled:', err?.message || err)
    return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' })
  }
}

async function stateFor(db, { signer, request, settings, session, live }) {
  const hasSession = !!session && (() => { try { requireSession(signer, session); return true } catch { return false } })()
  const base = {
    request: { title: request.title, sender_name: request.sender_name, envelope_code: request.envelope_code, expires_at: request.expires_at, status: request.status },
    signer: { name: signer.name, email_masked: signer.code_sent_to || null, recipient_type: signer.recipient_type, role_key: signer.role_key, color: signer.color },
  }
  if (!live.live) return { ...base, step: signer.signed_at ? 'done' : 'closed', message: live.reason }
  if (signer.declined_at) return { ...base, step: 'closed', message: 'You declined this request. The sender was told.' }
  if (!hasSession) return { ...base, step: 'code' }
  const { data: disclosure } = await db.from('sig_disclosures').select('version, title, body').eq('org_id', ORG_ID).eq('version', settings.current_disclosure_version).maybeSingle()
  if (!signer.consented_at) return { ...base, step: 'consent', disclosure, sample_opened: !!signer.sample_pdf_opened_at }
  const b = await loadBundle(db, request.id)
  const turn = currentTurn(b.signers, request.signing_order)
  const others = b.signers.filter(s => s.recipient_type !== 'cc' && s.status !== 'replaced').sort((x, y) => x.order_index - y.order_index)
  const after = others.filter(s => s.order_index > signer.order_index && !s.signed_at)
  // Values the signer may see: the sender's, and anything a signer before them already signed.
  const visible = {}
  for (const row of b.valueRows) {
    const owner = row.signer_id ? b.signers.find(s => s.id === row.signer_id) : null
    if (!row.signer_id || (owner && owner.signed_at) || row.signer_id === signer.id) visible[row.field_id] = row.value
  }
  const mineRoles = new Set([signer.role_key])
  return {
    ...base,
    step: signer.signed_at ? 'done' : turn.some(t => t.id === signer.id) ? 'sign' : 'waiting',
    signed_at: signer.signed_at, time_zone: settings.time_zone,
    next_signer: after[0]?.name || null,
    document: { page_sizes: request.page_sizes, fields: request.fields.map(f => ({ ...f, mine: mineRoles.has(f.role), sender: f.role === SENDER_ROLE })) },
    values: visible,
    prefill: await prefillFor(db, signer),
    others: others.filter(s => s.id !== signer.id).map(s => ({ name: s.name, role_key: s.role_key, color: s.color, order_index: s.order_index })),
  }
}

let SAMPLE = null
async function samplePdf() {
  if (SAMPLE) return SAMPLE
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  page.drawText('ASPIRE Intelligence', { x: 72, y: 700, size: 12, font: bold, color: rgb(0.11, 0.15, 0.4) })
  page.drawText('Sample PDF', { x: 72, y: 660, size: 26, font: bold })
  page.drawText('If you can read this page, your device can open the PDF documents you will sign.', { x: 72, y: 620, size: 12, font })
  page.drawText('Close this tab and return to the signing page to continue.', { x: 72, y: 600, size: 12, font })
  SAMPLE = Buffer.from(await doc.save())
  return SAMPLE
}
