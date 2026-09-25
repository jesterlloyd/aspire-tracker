// lib/server/forms/people.js
//
// CATALOG-PEOPLE-1 (Owner, 2026-09-24): everyone one Catalog item went to, for the Catalog's
// detail panel. A form item is one row per link (voided links are not listed); a signature
// template is one row per request, named by its first signer, with the others counted. Draft
// and voided requests were never "sent to" anyone the reader tracks, so they are left out.
// Each row carries what catalogModel.completionStatus reads (due_at, opened_at, completed_at)
// plus `closed`, the word for a link that can no longer be answered, or ''.
//
// Either table may be missing (a database before that phase's migration); a failed read of
// one simply contributes nothing.
export async function peopleFor(db, resourceId, isDemo) {
  const out = []
  const forms = await db.from('form_assignments').select('id, name, email, school_name, status, due_at, sent_at, opened_at, submitted_at, reminder_count, last_reminded_at')
    .eq('catalog_resource_id', resourceId).eq('is_demo', isDemo).neq('status', 'voided').order('sent_at', { ascending: false }).limit(2000)
  if (!forms.error) {
    for (const a of forms.data || []) {
      out.push({ kind: 'form', id: a.id, name: a.name, email: a.email, school: a.school_name || '', due_at: a.due_at, sent_at: a.sent_at,
        opened_at: a.opened_at, completed_at: a.submitted_at, closed: a.status === 'closed' ? 'Closed' : '', reminders: a.reminder_count || 0 })
    }
  }
  const sigs = await db.from('sig_requests').select('id, status, due_at, sent_at, completed_at').eq('catalog_resource_id', resourceId).eq('is_demo', isDemo)
    .in('status', ['sent', 'progress', 'opened', 'completed', 'expired', 'declined']).order('sent_at', { ascending: false }).limit(2000)
  if (!sigs.error && sigs.data?.length) {
    const ids = sigs.data.map(r => r.id)
    const signers = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('sig_request_signers').select('request_id, name, email, school_name, recipient_type, order_index, opened_at, reminder_count')
        .in('request_id', ids.slice(i, i + 200)).eq('recipient_type', 'signer').order('order_index')
      signers.push(...(data || []))
    }
    for (const r of sigs.data) {
      const mine = signers.filter(x => x.request_id === r.id)
      const first = mine[0] || {}
      out.push({ kind: 'signature', id: r.id, name: first.name || first.email || 'Signer', email: first.email || '', school: first.school_name || '',
        others: Math.max(0, mine.length - 1), due_at: r.due_at, sent_at: r.sent_at, opened_at: mine.find(x => x.opened_at)?.opened_at || null,
        completed_at: r.completed_at, closed: r.status === 'expired' ? 'Expired' : r.status === 'declined' ? 'Declined' : '', reminders: mine.reduce((n, x) => n + (x.reminder_count || 0), 0) })
    }
  }
  return out
}
