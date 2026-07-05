import { AlertTriangle } from 'lucide-react'

// ConflictDialog - shown when an optimistic concurrency check fails.
// The student row's updated_at changed between load time and save time,
// meaning another user (or another tab) saved while this user was editing.
//
// Three resolution paths:
//   Discard  - reload fresh data from DB, lose pending edit
//   Force    - save anyway (overwrites), logged to program_events for audit
//   Continue - dismiss dialog, keep unsaved edit in form; user decides later

export default function ConflictDialog({ studentName, fieldName, onDiscard, onForce, onContinue }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: 448, maxWidth: '92vw',
        boxShadow: '0 24px 64px rgba(29,37,103,0.22)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1c2452 0%, #141928 100%)',
          padding: '16px 22px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertTriangle size={16} color="#f59e0b" strokeWidth={2.5} />
          <span style={{ fontWeight: 700, fontSize: 14, color: '#fff', letterSpacing: '0.01em' }}>
            Edit Conflict
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px 22px' }}>
          <p style={{
            fontSize: 13.5, color: '#374151', lineHeight: 1.65,
            margin: '0 0 6px',
          }}>
            <strong>{studentName || 'This student'}</strong>'s record was updated by someone
            else while you were editing
            {fieldName && fieldName !== 'name' ? <> (<em>{fieldName}</em>)</> : ''}.
          </p>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: '0 0 20px' }}>
            Your changes have <strong>not</strong> been saved yet.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {/* Option 1: Discard (recommended) */}
            <button
              onClick={onDiscard}
              style={{
                padding: '11px 16px', borderRadius: 10, width: '100%',
                background: '#1D2567', border: 'none', cursor: 'pointer',
                textAlign: 'left', display: 'block',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>
                ↺ Discard my changes and reload
              </div>
              <div style={{ fontWeight: 400, fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
                Recommended, see what changed and re-apply if needed
              </div>
            </button>

            {/* Option 2: Force save */}
            <button
              onClick={onForce}
              style={{
                padding: '11px 16px', borderRadius: 10, width: '100%',
                background: '#fffbeb', border: '1.5px solid #fde68a',
                cursor: 'pointer', textAlign: 'left', display: 'block',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>
                ⚠ Force save my changes
              </div>
              <div style={{ fontWeight: 400, fontSize: 11.5, color: '#b45309', marginTop: 3 }}>
                Overwrites the other person's edit, this action is logged for audit
              </div>
            </button>

            {/* Option 3: Continue editing */}
            <button
              onClick={onContinue}
              style={{
                padding: '11px 16px', borderRadius: 10, width: '100%',
                background: '#f9fafb', border: '1px solid #e5e7eb',
                cursor: 'pointer', textAlign: 'left', display: 'block',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>
                → Continue editing without saving
              </div>
              <div style={{ fontWeight: 400, fontSize: 11.5, color: '#6b7280', marginTop: 3 }}>
                Your changes are preserved in the form; decide later
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
