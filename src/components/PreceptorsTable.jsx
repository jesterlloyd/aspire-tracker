import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { usePreceptors } from '../hooks/usePreceptors'
import PreceptorFormModal from './PreceptorFormModal'
import PreceptorAssignmentModal from './PreceptorAssignmentModal'
import ConfirmDeleteModal from './ConfirmDeleteModal'

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PreceptorsTable({ students = [], cohortId, toast }) {
  const { data: preceptors = [], isLoading, error } = usePreceptors()
  const queryClient = useQueryClient()
  const [search,       setSearch]      = useState('')
  const [addOpen,      setAddOpen]     = useState(false)
  const [editTarget,   setEditTarget]  = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]    = useState(false)
  const [assignState,  setAssignState] = useState(null)

  const filtered = search.trim()
    ? preceptors.filter(p =>
        p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.email?.toLowerCase().includes(search.toLowerCase())
      )
    : preceptors

  // Map preceptor_id → student for current cohort
  const studentByPreceptorId = {}
  for (const s of students) {
    if (s.preceptor_id) studentByPreceptorId[s.preceptor_id] = s
  }

  const handleSaved = (preceptor) => {
    if (editTarget) {
      toast?.success('Preceptor updated', `${preceptor.full_name} has been updated.`)
    } else {
      toast?.success('Preceptor added', `${preceptor.full_name} added to the roster.`)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const { error: err } = await supabase.from('preceptors').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (err) {
      toast?.error('Delete failed', err.message || 'Could not delete preceptor.')
    } else {
      queryClient.invalidateQueries({ queryKey: ['preceptors'] })
      toast?.success('Preceptor deleted', `${deleteTarget.full_name} removed from the roster.`)
      setDeleteTarget(null)
    }
  }

  if (error) {
    return (
      <div style={{ padding: '32px 24px', fontFamily: 'DM Sans, sans-serif', color: '#6b7280', fontSize: 13 }}>
        Could not load preceptors. Make sure the database migration has been applied.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'DM Sans, sans-serif' }}>
      {/* Toolbar */}
      <div style={{ padding: '0 20px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          onClick={() => setAddOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 7,
            background: '#1D2567', border: 'none',
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#fff',
            cursor: 'pointer', flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#141928'}
          onMouseLeave={e => e.currentTarget.style.background = '#1D2567'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Preceptor
        </button>

        <input
          className="form-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          style={{ maxWidth: 280, fontSize: 13 }}
        />

        <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
          {isLoading ? 'Loading…' : `${filtered.length} preceptor${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 24 }}>
        {!isLoading && preceptors.length === 0 ? (
          /* Empty state */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: 260, gap: 10, padding: '32px 24px',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: '#EDEEF4',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>No preceptors yet</div>
            <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 300, textAlign: 'center', lineHeight: 1.6 }}>
              Click "Add Preceptor" to start your roster.
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
                {['Name', 'Email', 'Unit', 'Shift', 'Status', 'Current Student', 'Cohorts', 'Last Active', ''].map(h => (
                  <th key={h} style={{
                    padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const currentStudent = studentByPreceptorId[p.id]
                const isActive       = p.is_active !== false

                return (
                  <tr
                    key={p.id}
                    style={{ borderBottom: '1px solid #f3f4f6' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafbff'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#111', whiteSpace: 'nowrap' }}>
                      {p.full_name}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#4b5563', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.email || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {p.unit_name || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {p.shift_type || '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: isActive ? '#dcfce7' : '#f3f4f6',
                        color:      isActive ? '#166534' : '#6b7280',
                      }}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#374151', whiteSpace: 'nowrap' }}>
                      {currentStudent
                        ? `${currentStudent.first_name} ${currentStudent.last_name}`
                        : <span style={{ color: '#9ca3af' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', textAlign: 'center' }}>
                      {p.cohorts_participated ?? '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {p.last_active_cohort
                        ? <span title={fmtDate(p.last_active_date)}>{p.last_active_cohort}</span>
                        : fmtDate(p.last_active_date)
                      }
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setEditTarget(p)}
                          title="Edit preceptor"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: '#f3f4f6', border: 'none', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#e5e7eb'}
                          onMouseLeave={e => e.currentTarget.style.background = '#f3f4f6'}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteTarget(p)}
                          title="Delete preceptor"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: '#fef2f2', border: 'none', fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                          onMouseLeave={e => e.currentTarget.style.background = '#fef2f2'}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <PreceptorFormModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={handleSaved}
        cohortId={cohortId}
      />

      <PreceptorFormModal
        isOpen={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={p => { handleSaved(p); setEditTarget(null) }}
        initialData={editTarget}
        cohortId={cohortId}
      />

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Delete ${deleteTarget.full_name}?`}
          warning={`This will permanently remove ${deleteTarget.full_name} from the preceptor roster. Any students linked to this preceptor will have their preceptor assignment cleared.`}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {assignState && (
        <PreceptorAssignmentModal
          isOpen
          onClose={() => setAssignState(null)}
          student={assignState.student}
          onAssigned={() => setAssignState(null)}
        />
      )}
    </div>
  )
}
