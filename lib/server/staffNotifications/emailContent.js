// lib/server/staffNotifications/emailContent.js
//
// PHASE 2C: pure builder for the Owner/Admin notification email. No I/O. A concise summary of a
// preceptor assignment change (or a UL-created preceptor / a >90-day override) plus a link to the
// affected student or preceptor. Never includes anything beyond the assignment metadata.

const APP_BASE = 'https://aspireintelligence.app/app.html#'

function fullUrl(destUrl) {
  if (!destUrl) return APP_BASE
  return APP_BASE + destUrl
}

const EVENT_LABEL = {
  preceptor_primary_changed: 'Primary preceptor changed',
  preceptor_add_secondary: 'Secondary preceptor added',
  preceptor_replace_secondary: 'Secondary preceptor replaced',
  preceptor_end_secondary: 'Secondary preceptor ended',
  preceptor_add_coverage: 'Coverage preceptor added',
  preceptor_replace_coverage: 'Coverage preceptor replaced',
  preceptor_end_coverage: 'Coverage preceptor ended',
  preceptor_created: 'New preceptor created',
  preceptor_match_anomaly: 'Match record needs review',
}

export function buildStaffNotificationEmail(row) {
  const label = EVENT_LABEL[row.event_type] || row.subject || 'Preceptor update'
  const actor = row.actor_name || 'A team member'
  const actorRole = row.actor_role === 'unit_leader' ? 'Unit Leader' : 'Owner/Admin'
  const url = fullUrl(row.dest_url)
  const overrideTag = row.was_override ? ' (historical override, beyond the 90-day window)' : ''

  const lines = [
    `${actor} (${actorRole}) — ${label}${overrideTag}.`,
    row.unit_key ? `Unit: ${row.unit_key}` : null,
    row.assignment_role ? `Role: ${row.assignment_role}` : null,
    (row.old_value || row.new_value) ? `Change: ${row.old_value || '(none)'} -> ${row.new_value || '(none)'}` : null,
    row.reason ? `Reason: ${row.reason}` : null,
    `Open: ${url}`,
  ].filter(Boolean)

  const subject = `ASPIRE: ${label}${overrideTag}`
  const text = lines.join('\n')
  const html = `<p>${lines.map(l => escapeHtml(l)).join('<br>')}</p>`
    .replace(escapeHtml(url), `<a href="${url}">${url}</a>`)
  return { subject, text, html }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
