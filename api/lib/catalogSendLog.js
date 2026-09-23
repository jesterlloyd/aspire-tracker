// api/lib/catalogSendLog.js
//
// CATALOG-REVAMP-1 (Phase 1). The Catalog's send log. A Catalog send IS an Outreach bulk
// send (api/connect-send-bulk-message.js, attachments by catalog slug); when the request
// names a catalog_resource_id, that endpoint calls recordCatalogSend once the batch is
// done, with what actually happened to each recipient. So the log records sends, not
// intentions: a recipient the allowlist refused is 'skipped' with its reason, one the
// provider refused is 'failed', and only 'sent' rows appear on a record.
//
// Best-effort by contract, like the message archive: the emails have already gone, so a
// logging problem never changes the response's delivery result. It returns
// { status: 'logged' | 'not_enabled' | 'error', ... } and never throws. 'not_enabled' is
// the migration not being applied yet (42P01 / 42703).

import { resolveOperativeSchoolName } from '../../src/lib/schoolIdentity.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isCatalogResourceId = (v) => typeof v === 'string' && UUID.test(v)

const notEnabled = (err) => err && (err.code === '42P01' || err.code === '42703')
const operative = (name) => {
  const raw = String(name || '').trim()
  if (!raw) return null
  return resolveOperativeSchoolName(raw)?.displayName || raw
}
const cleanLabels = (v) => (Array.isArray(v) ? v : [])
  .filter(x => typeof x === 'string').map(x => x.trim().slice(0, 120)).filter(Boolean).slice(0, 20)

/**
 * @param {object} a
 * @param {object} a.db             service-role client
 * @param {string} a.resourceId     catalog_resources.id
 * @param {string} a.batchId        the Outreach batch_id
 * @param {string} a.subject
 * @param {string[]} a.audienceLabels  the tokens the sender picked
 * @param {Array}  a.recipients     the request's recipients, in request order
 * @param {Array}  a.sent           [{ index, source, email, recipient_id, notification_log_id, resend_message_id }]
 * @param {Array}  a.skipped        [{ index, source, email, reason }]
 * @param {Array}  a.failed         [{ index, source, email, reason }]
 * @param {string} a.sentBy         user_profiles.id
 * @param {boolean} a.isDemo
 */
export async function recordCatalogSend(a) {
  try {
    const { db } = a
    if (!isCatalogResourceId(a.resourceId)) return { status: 'error', reason: 'invalid_resource_id' }

    const { data: resource, error: rErr } = await db
      .from('catalog_resources').select('id, version').eq('id', a.resourceId).maybeSingle()
    if (notEnabled(rErr)) {
      // The version column is new: read the row without it before deciding.
      const { data: r2, error: r2Err } = await db.from('catalog_resources').select('id').eq('id', a.resourceId).maybeSingle()
      if (r2Err || !r2) return { status: 'error', reason: 'resource_not_found' }
      return { status: 'not_enabled' }
    }
    if (rErr || !resource) return { status: 'error', reason: 'resource_not_found' }

    // School names come from the database rows, never from the browser's labels.
    const all = [...(a.sent || []).map(x => ({ ...x, status: 'sent' })),
                 ...(a.skipped || []).map(x => ({ ...x, status: 'skipped' })),
                 ...(a.failed || []).map(x => ({ ...x, status: 'failed' }))]
    const reqAt = (i) => (Array.isArray(a.recipients) ? a.recipients[i] : null) || {}
    const studentIds = [...new Set(all.map(x => reqAt(x.index)).filter(r => r.source === 'student' && UUID.test(r.studentId || '')).map(r => r.studentId))]
    const contactIds = [...new Set(all.map(x => reqAt(x.index)).filter(r => r.source === 'contact' && UUID.test(r.contactId || '')).map(r => r.contactId))]
    const schoolOfStudent = new Map()
    const schoolOfContact = new Map()
    if (studentIds.length) {
      const { data } = await db.from('students').select('id, school').in('id', studentIds)
      for (const s of data || []) schoolOfStudent.set(s.id, operative(s.school))
    }
    if (contactIds.length) {
      const { data } = await db.from('contacts').select('id, school_name').in('id', contactIds)
      for (const c of data || []) schoolOfContact.set(c.id, operative(c.school_name))
    }

    const { data: send, error: sErr } = await db.from('catalog_sends').insert({
      resource_id: resource.id,
      resource_version: resource.version || 1,
      channel: 'outreach_email',
      batch_id: a.batchId,
      subject: String(a.subject || '').slice(0, 200) || null,
      audience_labels: cleanLabels(a.audienceLabels),
      sent_count: (a.sent || []).length,
      failed_count: (a.failed || []).length,
      skipped_count: (a.skipped || []).length,
      is_demo: a.isDemo === true,
      sent_by: a.sentBy || null,
    }).select('id').single()
    if (notEnabled(sErr)) return { status: 'not_enabled' }
    if (sErr || !send) return { status: 'error', reason: sErr?.message || 'insert_failed' }

    const rows = all.map(x => {
      const r = reqAt(x.index)
      const studentId = r.source === 'student' && UUID.test(r.studentId || '') ? r.studentId : null
      const contactId = r.source === 'contact' && UUID.test(r.contactId || '') ? r.contactId : null
      return {
        send_id: send.id,
        recipient_type: ['student', 'contact', 'manual'].includes(r.source) ? r.source : 'manual',
        student_id: studentId,
        contact_id: contactId,
        school_name: studentId ? schoolOfStudent.get(studentId) || null : contactId ? schoolOfContact.get(contactId) || null : null,
        name: String(r.name || '').trim().slice(0, 200) || null,
        email: String(x.email || r.email || '').trim().slice(0, 320),
        status: x.status,
        reason: x.reason ? String(x.reason).slice(0, 200) : null,
        notification_log_id: x.notification_log_id || null,
        resend_message_id: x.resend_message_id || null,
      }
    }).filter(r => r.email)
    if (rows.length) {
      const { error: rrErr } = await db.from('catalog_send_recipients').insert(rows)
      if (rrErr) return { status: 'error', reason: rrErr.message, sendId: send.id }
    }
    return { status: 'logged', sendId: send.id, rows: rows.length }
  } catch (err) {
    return { status: 'error', reason: err?.message || 'unknown' }
  }
}
