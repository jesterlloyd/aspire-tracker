// DEV ONLY - gated by import.meta.env.DEV in App.jsx routing.
// Renders a live DispositionModal with mock student + cohort data for manual QA.
// This file is NOT imported or bundled in production.

import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import DispositionModal from '../components/DispositionModal'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'

const MOCK_STUDENT = {
  id:           '00000000-0000-0000-0000-000000000001',
  first_name:   'Alex',
  last_name:    'Morales',
  school:       'CSU Northridge',
  program_type: 'BSN',
  status:       'Interviewed',
}

const MOCK_COHORT = {
  id:   '00000000-0000-0000-0000-000000000002',
  name: 'Summer 2026',
}

export default function DevDispositionModal() {
  const { userProfile, canEdit, isOwner, isAdmin } = useAuth()
  const { toasts, removeToast, toast } = useToast()
  const [modalOpen,       setModalOpen]       = useState(false)
  const [lastResult,      setLastResult]       = useState(null)

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface-1, #f3f4f6)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Plus Jakarta Sans',
      gap: 20,
      padding: 40,
    }}>
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div style={{
        background: '#fef3c7',
        border: '1px solid #fcd34d',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 12,
        fontWeight: 600,
        color: '#92400e',
        letterSpacing: '0.04em',
      }}>
        DEV HARNESS, DispositionModal · Phase 2B.2a
      </div>

      <div style={{
        background: 'var(--surface-0, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 12,
        padding: 24,
        width: '100%',
        maxWidth: 480,
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #111827)', marginBottom: 12 }}>
          Auth context
        </div>
        <table style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)', borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {[
              ['Logged in as',   userProfile?.full_name || '-'],
              ['Role',           userProfile?.role || '-'],
              ['canEdit',        String(canEdit)],
              ['isOwner',        String(isOwner)],
              ['isAdmin',        String(isAdmin)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '3px 0', paddingRight: 16, fontWeight: 600 }}>{k}</td>
                <td style={{ padding: '3px 0', color: '#111827' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!canEdit && (
          <div style={{
            marginTop: 12, padding: '8px 12px', background: '#fee2e2',
            border: '1px solid #fca5a5', borderRadius: 6,
            fontSize: 12, color: '#991b1b',
          }}>
            Modal will return null, current role does not have canEdit permission.
            Log in as owner or admin to test.
          </div>
        )}
      </div>

      <div style={{
        background: 'var(--surface-0, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 12,
        padding: 24,
        width: '100%',
        maxWidth: 480,
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #111827)', marginBottom: 12 }}>
          Mock student
        </div>
        <pre style={{ fontSize: 11, color: 'var(--text-secondary, #6b7280)', margin: 0, whiteSpace: 'pre-wrap' }}>
          {JSON.stringify({ ...MOCK_STUDENT, cohort: MOCK_COHORT }, null, 2)}
        </pre>
        <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
          RPC calls will execute against the real database. Use a test student UUID if you want a real end-to-end test.
          With mock UUIDs, the RPC will fail with a FK constraint error, this is expected and tests error handling.
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={() => setModalOpen(true)}
        style={{ fontSize: 14, padding: '10px 28px' }}
      >
        Open DispositionModal
      </button>

      {lastResult && (
        <div style={{
          background: '#dcfce7', border: '1px solid #86efac',
          borderRadius: 8, padding: '10px 16px',
          fontSize: 13, color: '#166534',
          maxWidth: 480, width: '100%',
        }}>
          <strong>Last successful disposition ID:</strong><br />
          <code style={{ fontSize: 11 }}>{lastResult}</code>
        </div>
      )}

      <DispositionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        student={MOCK_STUDENT}
        cohort={MOCK_COHORT}
        toast={toast}
        onSuccess={(id) => {
          setLastResult(id)
          toast?.success('onSuccess fired', `dispositionId: ${id}`)
        }}
      />
    </div>
  )
}
