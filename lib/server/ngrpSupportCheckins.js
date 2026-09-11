// lib/server/ngrpSupportCheckins.js
//
// RESIDENCY-SUPPORT-1: Weekly Email Check-ins are sent through ASPIRE Connect,
// Send to One (Owner, 2026-09-11), so they are counted from what Connect
// already records rather than stored twice. api/connect-send-direct-email.js
// writes one notification_log row per email ONLY after the provider accepted
// it, and stamps metadata.template_key for a resident check-in.
export const RESIDENT_CHECKIN_TEMPLATE_KEY = 'resident_weekly_checkin'

export async function fetchResidentCheckins(db, studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))]
  if (ids.length === 0) return { rows: [] }
  const { data, error } = await db.from('notification_log')
    .select('student_id, sent_at')
    .eq('notification_type', 'direct_message_sent')
    .eq('status', 'sent')
    .eq('metadata->>template_key', RESIDENT_CHECKIN_TEMPLATE_KEY)
    .in('student_id', ids)
    .order('sent_at', { ascending: false })
  if (error) return { error }
  return { rows: (data || []).filter(r => r.student_id && r.sent_at) }
}
