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
import { renderStudioEmail, finishFormButtons } from '../../../src/lib/studio/renderEmail.js'
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
  const { html, text } = renderStudioEmail(design, { brand, signature, formMode: 'marker' })
  if (html.length > STUDIO_HTML_MAX) throw Object.assign(new Error('The design is too large to send.'), { status: 400 })
  return {
    design,
    markerHtml: html,
    text,
    problems: designProblems(design),
    /** After merge and the form engine: draw the styled form buttons around their links. */
    finish: (merged) => finishFormButtons(merged, design),
    /** The plain-text part for one recipient (merge values are not escaped in text). */
    textFor: (mergeCtx) => applyMergeFields(text, mergeCtx),
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
  html = studio.finish(await previewFormButtons(html))
  try {
    const { error } = await createMailer().emails.send({
      from, to: [to], reply_to: to,
      subject: `[Test] ${applyMergeFields(subj, ctx)}`.slice(0, 210),
      html, text: studio.textFor(ctx),
      tags: [{ name: 'type', value: 'studio_test' }],
    })
    if (error) return { status: 502, body: { success: false, error: `The test did not send: ${error.message || 'provider error'}` } }
  } catch (e) {
    return { status: 502, body: { success: false, error: `The test did not send: ${e?.message || 'unknown error'}` } }
  }
  return { status: 200, body: { success: true, test: true, to } }
}
