// lib/server/forms/outreachButtons.js
//
// OUTREACH-FORM-BUTTON-1 (2026-09-24): an ASPIRE Connect > Outreach email can carry a button
// that opens a Catalog form. The editor stores the FORM on the button marker
//   <div data-aspire-block="button" data-label="..." data-url="" data-form="<form id>"
//        data-form-title="..." data-due="YYYY-MM-DD" data-reminders="every_3_days"></div>
// and, because every form link is personal, the send path puts each recipient's OWN link in
// data-url here, per recipient, before the body is rendered (renderContentBlocks then treats
// it like any other button). The form's own attributes are removed so they never reach the
// email. A preview gets the bare form address instead, and creates nothing.

import { formsForOutreach, outreachLink, settleOutreachLinks } from './engine.js'
import { appBaseUrl } from '../appUrl.js'
import { demoScopeFromRequest } from '../demoScope.js'

// The send endpoints import this module and nothing else of the forms engine.
export { settleOutreachLinks as settleFormButtons }
export const isDemoSend = (req) => demoScopeFromRequest(req) === true

const BUTTON_TAG = /<div\b[^>]*\bdata-aspire-block=(["'])button\1[^>]*>/gi
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i').exec(tag)
  return m ? m[2] : ''
}
const FORM_ATTRS = ['data-form', 'data-form-title', 'data-due', 'data-reminders']
const decode = (v) => String(v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** The form buttons in a body, in order: [{ formId, dueAt, reminders }]. */
export function formButtons(html) {
  const out = []
  for (const m of String(html || '').matchAll(BUTTON_TAG)) {
    const formId = attr(m[0], 'data-form')
    if (formId) out.push({ formId, dueAt: attr(m[0], 'data-due') || null, reminders: decode(attr(m[0], 'data-reminders')) || null })
  }
  return out
}
export const hasFormButtons = (html) => formButtons(html).length > 0

/** Rewrite each form button's tag with `urlFor(button)`, dropping the form's own attributes. */
async function rewrite(html, urlFor) {
  const tags = [...String(html || '').matchAll(BUTTON_TAG)]
  let out = '', at = 0
  for (const m of tags) {
    const formId = attr(m[0], 'data-form')
    out += html.slice(at, m.index)
    at = m.index + m[0].length
    if (!formId) { out += m[0]; continue }
    const url = await urlFor({ formId, dueAt: attr(m[0], 'data-due') || null, reminders: decode(attr(m[0], 'data-reminders')) || null })
    let tag = m[0]
    for (const a of FORM_ATTRS) tag = tag.replace(new RegExp(`\\s${a}=(["']).*?\\1`, 'i'), '')
    tag = /\sdata-url=/i.test(tag) ? tag.replace(/\sdata-url=(["']).*?\1/i, ` data-url="${url}"`) : tag.replace(/>$/, ` data-url="${url}">`)
    out += tag
  }
  return out + html.slice(at)
}

/** Check every form button before anything is sent. Returns the forms by id; throws FormError. */
export async function prepareFormButtons(db, html) {
  const ids = [...new Set(formButtons(html).map(b => b.formId))]
  return ids.length ? formsForOutreach(db, ids) : new Map()
}

/** A preview: the form's address with no link in it, and nothing created. */
export function previewFormButtons(html, appUrl = appBaseUrl()) {
  return rewrite(html, () => `${appUrl}/form`)
}

/**
 * One recipient's body, each form button pointing at their own link.
 * person: { name, email, studentId?, contactId?, schoolName? }. Returns { html, created }.
 */
export async function personalizeFormButtons(db, html, { forms, person, batchId, subject, appUrl = appBaseUrl(), sender, isDemo = false }) {
  const created = []
  const byForm = new Map()   // one link per form per email, even if the button repeats
  const out = await rewrite(html, async (b) => {
    if (!byForm.has(b.formId)) {
      const r = await outreachLink(db, forms.get(b.formId), { person, dueAt: b.dueAt, reminderRule: b.reminders, batchId, subject }, { appUrl, sender, isDemo })
      if (r.created) created.push(r.assignmentId)
      byForm.set(b.formId, r.url)
    }
    return byForm.get(b.formId)
  })
  return { html: out, created }
}
