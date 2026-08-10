// PHASE 2C: the "Notifications" tab body inside the Action Center. Renders durable
// staff_notifications rows (Owner/Admin preceptor activity) as a read/unread activity list, fully
// separate from the live-derived "Action Needed" task list (notification events are never mixed
// into the task list). Data + markRead come from useStaffNotifications (hoisted to App). Opening an
// item follows its allowlisted student or Preceptor Directory destination and marks that item read;
// a "Mark all read" affordance clears the rest.

import { BADGE_COUNT_BG } from '../lib/badgeTokens'
import { createStaffNotificationActivation } from '../lib/staffNotificationNavigation'

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

function labelFor(row) {
  return EVENT_LABEL[row.event_type] || row.subject || 'Preceptor update'
}

function roleLabel(actorRole) {
  if (actorRole === 'unit_leader') return 'Unit Leader'
  if (actorRole === 'owner_admin') return 'Owner/Admin'
  return actorRole || 'Team member'
}

// Compact relative time. Absolute date kept in the title attribute for precision.
function relTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function StaffNotificationsPanel({
  items = [], unreadCount = 0, isLoading, isError, onMarkRead, onMarkAllRead,
  onNavigateDestination,
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '8px 0 calc(18px + env(safe-area-inset-bottom))', fontFamily: 'DM Sans, sans-serif' }}>
      {unreadCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 16px 6px' }}>
          <button
            onClick={onMarkAllRead}
            style={{
              fontSize: 11.5, fontWeight: 600, color: '#3949ab', background: 'none',
              border: '1px solid rgba(57,73,171,0.30)', borderRadius: 6, padding: '3px 9px',
              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
            }}>
            Mark all read
          </button>
        </div>
      )}

      {isError && (
        <div style={{ padding: '10px 16px', fontSize: 12, color: '#92400e', background: '#fef3c7', borderBottom: '1px solid #fde68a' }}>
          Notifications could not be loaded.
        </div>
      )}

      {isLoading && items.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 24px' }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Loading notifications…</span>
        </div>
      ) : items.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 28px', gap: 10 }}>
          <div style={{
            width: 54, height: 54, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(29,37,103,0.08)', border: '1px solid rgba(29,37,103,0.16)',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1D2567" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <span style={{ fontSize: 13, color: '#6b7280' }}>No preceptor activity yet.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map(row => {
            const unread = !row.in_app_read_at
            const behavior = createStaffNotificationActivation(row, {
              onMarkRead,
              onNavigate: onNavigateDestination,
            })
            const change = (row.old_value || row.new_value)
              ? `${row.old_value || '(none)'} → ${row.new_value || '(none)'}`
              : null
            return (
              <div
                key={row.id}
                role={behavior.interactive ? 'button' : undefined}
                tabIndex={behavior.interactive ? 0 : undefined}
                onClick={behavior.interactive ? behavior.activate : undefined}
                onKeyDown={behavior.interactive ? behavior.onKeyDown : undefined}
                style={{
                  display: 'flex', gap: 10, padding: '11px 16px',
                  borderBottom: '1px solid rgba(0,0,0,0.05)',
                  background: unread ? 'rgba(29,37,103,0.035)' : 'transparent',
                  cursor: behavior.interactive ? 'pointer' : 'default',
                }}
              >
                <span aria-hidden="true" style={{
                  marginTop: 6, flexShrink: 0, width: 8, height: 8, borderRadius: '50%',
                  background: unread ? BADGE_COUNT_BG : 'transparent',
                  border: unread ? 'none' : '1px solid rgba(0,0,0,0.12)',
                }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: unread ? 700 : 600, color: '#1f2937' }}>
                      {labelFor(row)}
                    </span>
                    {row.was_override && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 20 }}>
                        override
                      </span>
                    )}
                    <span style={{ fontSize: 10.5, color: '#8a93a3', marginLeft: 'auto', whiteSpace: 'nowrap' }} title={row.created_at ? new Date(row.created_at).toLocaleString() : ''}>
                      {relTime(row.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.actor_name || 'A team member'} ({roleLabel(row.actor_role)})
                    {row.unit_key ? ` · ${row.unit_key}` : ''}
                    {row.assignment_role ? ` · ${row.assignment_role}` : ''}
                  </div>
                  {change && (
                    <div style={{ fontSize: 11.5, color: '#4b5563', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {change}
                    </div>
                  )}
                  {row.reason && (
                    <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Reason: {row.reason}
                    </div>
                  )}
                  {behavior.destination && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#3949ab', marginTop: 4 }}>
                      {row.student_id ? 'Open student' : 'Open preceptor directory'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
