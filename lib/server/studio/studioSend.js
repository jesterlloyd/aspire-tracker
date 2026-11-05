// lib/server/studio/studioSend.js
//
// STUDIO-1 (2026-11-05): the Studio half of /api/connect-send-bulk-message. The endpoint imports
// this module ONLY when a request's body_format is 'studio', so an ordinary Outreach send never
// loads it (the same reason lib/server/forms/outreachButtons.js loads the Forms engine lazily).
//
// A Studio body is a design (blocks JSON). It is parsed by the same sanitizer the editor uses and
// rendered ONCE here, with its Catalog form buttons drawn as Outreach form-button markers, so the
// endpoint's existing per-recipient form links, merge, allowlist, log and archive all apply as for
// any Outreach body. The endpoint never trusts HTML from the browser for a Studio send.

import { parseDesign, designProblems } from '../../../src/lib/studio/studioBlocks.js'
import { renderStudioEmail, finishFormButtons, withUnsubscribe } from '../../../src/lib/studio/renderEmail.js'
import { replyToFor } from '../../../src/lib/studio/audienceCatalog.js'
import { loadOptedOut } from './resolveAudience.js'
import { newsSecret, newsToken } from './newsToken.js'
import process from 'node:process'
import { applyMergeFields } from '../../../src/lib/recipientParse.js'
import { escapeHtml } from '../../../src/lib/htmlEscape.js'
import { isValidEmail } from '../../../src/lib/notifications/studentRecipient.js'
import { previewFormButtons } from '../forms/outreachButtons.js'
import { appBaseUrl } from '../appUrl.js'
import { createMailer } from '../email/mailer.js'

export const STUDIO_JSON_MAX = 120000     // the design as posted
export const STUDIO_HTML_MAX = 400000     // the design as rendered

/**
 * Parse and render a posted design. Throws an Error with .status 400 when it is not a design or is
 * too large. Returns { design, markerHtml, text, problems, finish(html), textFor(mergeCtx) }.
 */
export function prepareStudio(raw, { signature, organization }) {
  if (typeof raw !== 'string' || raw.length > STUDIO_JSON_MAX) {
    throw Object.assign(new Error('The design is missing or too large to send.'), { status: 400 })
  }
  let design
  try { design = parseDesign(raw) } catch {
    throw Object.assign(new Error('That is not a Studio design.'), { status: 400 })
  }
  const brand = {
    logoUrl: organization?.document_logo_url || organization?.header_logo_url || `${appBaseUrl()}/Cedars-Sinai.png`,
    title: organization?.header_short_name || 'ASPIRE',
  }
  const { html, text } = renderStudioEmail(design, { brand, signature, formMode: 'marker', unsubscribe: 'marker' })
  if (html.length > STUDIO_HTML_MAX) throw Object.assign(new Error('The design is too large to send.'), { status: 400 })
  return {
    design,
    markerHtml: html,
    text,
    problems: designProblems(design),
    /**
     * After merge and the form engine: draw the styled form buttons around their links, and fill
     * the program-news line with this recipient's Unsubscribe link (or take it out when there is none).
     */
    finish: (merged, unsubscribeUrl = null) => withUnsubscribe(finishFormButtons(merged, design), unsubscribeUrl),
    /** The plain-text part for one recipient (merge values are not escaped in text). */
    textFor: (mergeCtx, unsubscribeUrl = null) => withUnsubscribe(applyMergeFields(text, mergeCtx), unsubscribeUrl),
  }
}

// ── STUDIO-2: the frozen list ─────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MISSING = (e) => e && (['42P01', 'PGRST205', '42703'].includes(e.code) || /does not exist|schema cache/i.test(e.message || ''))

/**
 * The list a Studio send froze before sending (api/studio send_freeze). Returns { send } where send
 * is null before 20261130000000 (Phase 1: the hand-picked list is the allowlist, as before), or
 * { error, status, code } when a send that needs a frozen list does not name a good one. A send is
 * the caller's own, in the caller's population, and not finished.
 */
export async function loadStudioSend(db, { id, profileId, isDemo }) {
  if (!id) {
    const { error } = await db.from('studio_sends').select('id').limit(1)
    if (error && MISSING(error)) return { send: null }
    if (error) throw error
    return { status: 400, code: 'review_required', error: 'Review the list again before sending.' }
  }
  if (!UUID.test(String(id))) return { status: 400, code: 'review_required', error: 'That send is not one this server reviewed.' }
  const { data, error } = await db.from('studio_sends').select('id, recipients, reply_route, status, created_by, is_demo').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data || data.created_by !== profileId || data.is_demo !== isDemo) {
    return { status: 404, code: 'review_required', error: 'That reviewed list is not here. Review the list again.' }
  }
  if (data.status !== 'frozen') return { status: 409, code: 'already_sent', error: 'That list has already been sent.' }
  const frozen = new Map()
  const indexOf = new Map()
  ;(Array.isArray(data.recipients) ? data.recipients : []).forEach((r, i) => {
    if (r?.normEmail && !frozen.has(r.normEmail)) { frozen.set(r.normEmail, r); indexOf.set(r.normEmail, i) }
  })
  return { send: { id: data.id, frozen, indexOf, replyRoute: data.reply_route } }
}

/** Where replies go for this send: the residency inboxes, or the sender. */
export const studioReplyTo = (send, senderEmail, fallback) => replyToFor(send?.replyRoute, senderEmail, fallback)

/** Take opted-out addresses out of the cleared list. Returns { cleared, skipped }. */
export async function dropOptedOut(db, cleared) {
  const optedOut = await loadOptedOut(db, cleared.map(c => c.normEmail))
  if (!optedOut.size) return { cleared, skipped: [] }
  return {
    cleared: cleared.filter(c => !optedOut.has(c.normEmail)),
    skipped: cleared.filter(c => optedOut.has(c.normEmail)).map(c => ({ index: c.index, source: c.source, email: c.rawEmail, reason: 'opted_out' })),
  }
}

/** One recipient's Unsubscribe link and the List-Unsubscribe headers, or null without a secret. */
export function unsubscribeFor(send, normEmail, env = process.env) {
  const secret = newsSecret(env)
  const index = send?.indexOf?.get(normEmail)
  const token = send && Number.isInteger(index) ? newsToken(secret, send.id, index, normEmail) : ''
  if (!token) return null
  const base = appBaseUrl()
  return {
    url: `${base}/news#t=${token}`,
    headers: {
      'List-Unsubscribe': `<${base}/api/program-news?t=${encodeURIComponent(token)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}

/**
 * "Send me a test": the caller's OWN address only (the server decides it, never the request), form
 * buttons carry the bare form address so no personal link is created, and nothing is logged or
 * archived. Returns { status, body } for the endpoint to answer with.
 */
export async function sendStudioTest(studio, { subject, profile, displayName, from }) {
  const to = String(profile?.email || '').trim()
  if (!isValidEmail(to)) return { status: 400, body: { success: false, error: 'Your account has no email address to send a test to.' } }
  const subj = String(subject || studio.design.subject || '').trim()
  if (!subj) return { status: 400, body: { success: false, error: 'Add a subject line first.' } }
  const first = String(displayName || profile?.full_name || '').trim().split(/\s+/)[0] || 'there'
  const ctx = { firstName: first, school: 'your school' }
  let html = applyMergeFields(studio.markerHtml, { firstName: escapeHtml(ctx.firstName), school: escapeHtml(ctx.school) })
  // The program-news line is shown as it will be sent; its link opens the page without a token.
  const unsub = `${appBaseUrl()}/news`
  html = studio.finish(await previewFormButtons(html), unsub)
  try {
    const { error } = await createMailer().emails.send({
      from, to: [to], reply_to: to,
      subject: `[Test] ${applyMergeFields(subj, ctx)}`.slice(0, 210),
      html, text: studio.textFor(ctx, unsub),
      tags: [{ name: 'type', value: 'studio_test' }],
    })
    if (error) return { status: 502, body: { success: false, error: `The test did not send: ${error.message || 'provider error'}` } }
  } catch (e) {
    return { status: 502, body: { success: false, error: `The test did not send: ${e?.message || 'unknown error'}` } }
  }
  return { status: 200, body: { success: true, test: true, to } }
}
