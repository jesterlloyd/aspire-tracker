import { useState } from 'react'
import Tooltip from './ui/Tooltip'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { usePreceptors } from '../hooks/usePreceptors'
import PreceptorFormModal from './PreceptorFormModal'
import PreceptorAssignmentModal from './PreceptorAssignmentModal'
import ConfirmDeleteModal from './ConfirmDeleteModal'

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export default function PreceptorsTable({ students = [], cohortId, toast }) {
  const { data: preceptors = [], isLoading, error } = usePreceptors()

  // Fetch avatar_url from contacts by email for display-only avatar resolution.
  // Preceptors imported into Contacts carry avatar_url on the contacts row.
  // This is read-only; no mutation occurs here.
  const { data: contactAvatarMap = {} } = useQuery({
    queryKey: ['preceptor_contact_avatars'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contacts')
        .select('email, avatar_url')
        .not('avatar_url', 'is', null)
        .not('email', 'is', null)
      if (!data) return {}
      // Build a lowercase-email → avatar_url map (first match wins)
      const map = {}
      for (const c of data) {
        const key = c.email.toLowerCase().trim()
        if (!map[key]) map[key] = c.avatar_url
      }
      return map
    },
    staleTime: 5 * 60 * 1000, // 5-minute cache; avatars don't change often
  })

  const queryClient = useQueryClient()
  const [search,       setSearch]       = useState('')
  const [addOpen,      setAddOpen]      = useState(false)
  const [editTarget,   setEditTarget]   = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)
  const [assignState,  setAssignState]  = useState(null)
  const [sortBy,       setSortBy]       = useState('full_name')
  const [sortDir,      setSortDir]      = useState('asc')

  const filtered = search.trim()
    ? preceptors.filter(p =>
        p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.email?.toLowerCase().includes(search.toLowerCase())
      )
    : preceptors

  // Map preceptor_id → student for current cohort (PRIMARY source - students.preceptor_id, unchanged)
  const studentByPreceptorId = {}
  for (const s of students) {
    if (s.preceptor_id) studentByPreceptorId[s.preceptor_id] = s
  }

  // PRECEPTOR-MODEL-3: read-only cohort-scoped ACTIVE secondary/coverage assignments so a preceptor
  // with a coverage relationship is no longer shown "without a student assigned". Read via the
  // table's Owner/Admin SELECT RLS; this only AUGMENTS the predicate, it does not change the primary
  // source. (Backfilled active-primary rows are intentionally ignored here - primary is shown above.)
  const { data: coverageRows = [] } = useQuery({
    queryKey: ['spa_active_coverage', cohortId],
    enabled: !!cohortId,
    queryFn: async () => {
      const { data } = await supabase
        .from('student_preceptor_assignments')
        .select('preceptor_id, student_id, role, status')
        .eq('cohort_id', cohortId)
        .eq('status', 'active')
        .in('role', ['secondary', 'coverage'])
      return data || []
    },
    staleTime: 60 * 1000,
  })
  const studentById = {}
  for (const s of students) studentById[s.id] = s
  const coverageByPreceptorId = {}
  for (const r of coverageRows) {
    (coverageByPreceptorId[r.preceptor_id] ||= []).push(r)
  }

  function getSortValue(p, col) {
    const stu = studentByPreceptorId[p.id]
    switch (col) {
      case 'full_name':       return p.full_name?.toLowerCase() || ''
      case 'unit_name':       return p.unit_name?.toLowerCase() || ''
      case 'current_student': return stu ? `${stu.first_name} ${stu.last_name}`.toLowerCase() : ''
      default: return ''
    }
  }

  function handleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = getSortValue(a, sortBy)
    const bv = getSortValue(b, sortBy)
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    const cmp = av.localeCompare(bv)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const arrow = (col) => sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

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
    const { error: err } = await safeWrite(
      () => supabase.from('preceptors').delete().eq('id', deleteTarget.id),
      { name: 'delete preceptor' }
    )
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
      <div className="am-table-wrap" style={{ margin: '0 20px 24px' }}>
        {!isLoading && preceptors.length === 0 ? (
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
          <table className="am-table">
            <thead>
              <tr>
                <th className="am-th am-sortable" onClick={() => handleSort('full_name')}>
                  Name{arrow('full_name')}
                </th>
                <th className="am-th">Email</th>
                <th className="am-th am-sortable" onClick={() => handleSort('unit_name')}>
                  Unit{arrow('unit_name')}
                </th>
                <th className="am-th">Shift</th>
                <th className="am-th">Status</th>
                <th className="am-th am-sortable" onClick={() => handleSort('current_student')}>
                  Current Student{arrow('current_student')}
                </th>
                <th className="am-th">Cohorts</th>
                <th className="am-th">Last Active</th>
                <th className="am-th"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const currentStudent = studentByPreceptorId[p.id]
                const isActive       = p.is_active !== false
                const avatarUrl      = p.email
                  ? contactAvatarMap[p.email.toLowerCase().trim()] || null
                  : null

                return (
                  <tr key={p.id} className="am-row">
                    <td className="am-td" style={{ fontWeight: 600, color: '#111', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: '#1D2567', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: '#fff', userSelect: 'none',
                          overflow: 'hidden', position: 'relative',
                        }}>
                          {avatarUrl && (
                            <img
                              src={avatarUrl}
                              alt={p.full_name}
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={e => { e.currentTarget.style.display = 'none' }}
                            />
                          )}
                          {getInitials(p.full_name)}
                        </div>
                        {p.full_name}
                      </div>
                    </td>
                    <td className="am-td" style={{ color: '#4b5563', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.email || '-'}
                    </td>
                    <td className="am-td" style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {p.unit_name || '-'}
                    </td>
                    <td className="am-td" style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {p.shift_type || '-'}
                    </td>
                    <td className="am-td">
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: isActive ? '#dcfce7' : '#f3f4f6',
                        color:      isActive ? '#166534' : '#6b7280',
                      }}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="am-td" style={{ color: '#374151', whiteSpace: 'nowrap' }}>
                      {currentStudent
                        ? `${currentStudent.first_name} ${currentStudent.last_name}`
                        : (() => {
                            // PRECEPTOR-MODEL-3: no PRIMARY student, but an active secondary/coverage
                            // relationship means this preceptor IS assigned - show it role-labeled
                            // instead of "-". (Primary, when present, is shown unchanged above.)
                            const cov = coverageByPreceptorId[p.id] || []
                            if (cov.length === 0) return <span style={{ color: '#9ca3af' }}>-</span>
                            const first = cov[0]
                            const stu = studentById[first.student_id]
                            const name = stu ? `${stu.first_name} ${stu.last_name}` : 'Assigned'
                            const roleLabel = first.role === 'coverage' ? 'Coverage' : 'Secondary'
                            const extra = cov.length > 1 ? ` +${cov.length - 1}` : ''
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {name}{extra}
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#3730a3', background: '#eef2ff', padding: '1px 6px', borderRadius: 4 }}>{roleLabel}</span>
                              </span>
                            )
                          })()
                      }
                    </td>
                    <td className="am-td" style={{ color: '#6b7280', textAlign: 'center' }}>
                      {p.cohorts_participated ?? '-'}
                    </td>
                    <td className="am-td" style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {p.last_active_cohort
                        ? <span>{p.last_active_cohort}</span>
                        : fmtDate(p.last_active_date)
                      }
                    </td>
                    <td className="am-td" style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Tooltip label="Edit preceptor" placement="top">
                        <button
                          onClick={() => setEditTarget(p)}
                          aria-label="Edit preceptor"
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
                        </Tooltip>
                        <Tooltip label="Delete preceptor" placement="top">
                        <button
                          onClick={() => setDeleteTarget(p)}
                          aria-label="Delete preceptor"
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
                        </Tooltip>
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
