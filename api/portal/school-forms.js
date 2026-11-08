// api/portal/school-forms.js
//
// AP-SCHOOL-FORMS-1 (Owner, 2026-11-08): an Academic Partner's own forms, sent to its own
// students. POST { action, ... } with the staff form actions' shapes (api/form-staff.js), plus:
//
//   status    -> { enabled, schools, readOnly }
//   list      -> { forms } the caller's schools' forms (staff preview: every school's)
//   students  -> { students } who a form can go to: id, name, cohort, status, hasEmail (no addresses)
//   create    -> { form } { school_key, title, description }
//   send      -> { created, sent, failed, skipped } { send: { formId, studentIds, dueAt, reminderRule, subject, message } }
//
// Authorization is the roster's (api/lib/schoolScope.js). lib/server/forms/schoolForms.js proves
// every form and response the request touches belongs to the caller's schools before the staff
// action switch runs it. An Owner/Admin preview reads every school's forms and writes nothing.
import { verifyPortalAcademicPartnerCaller } from '../lib/schoolScope.js'
import { populationOf } from '../../lib/server/demoScope.js'
import { FormError } from '../../lib/server/forms/engine.js'
import { schoolFormAction } from '../../lib/server/forms/schoolForms.js'
import { act } from '../form-staff.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await verifyPortalAcademicPartnerCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  try {
    const out = await schoolFormAction(auth.db, body, {
      scopes: auth.scopes, staffPreview: Boolean(auth.staffPreview), profile: auth.profile, isDemo: populationOf(req), act,
    })
    return res.status(200).json(out)
  } catch (err) {
    if (err instanceof FormError) return res.status(err.status).json({ error: err.message, code: err.code })
    if (err?.code === 'token_secret_missing') return res.status(503).json({ error: 'Form links are not configured yet.', code: err.code })
    console.error('[school-forms] unhandled:', err?.message || err)
    return res.status(500).json({ error: 'Server error' })
  }
}
