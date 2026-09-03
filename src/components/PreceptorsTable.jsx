import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { usePreceptors } from '../hooks/usePreceptors'
import PreceptorDirectoryTable from './shared/PreceptorDirectoryTable'
import PreceptorFormModal from './PreceptorFormModal'
import UnitLeaderPreceptorManager from '../portal/unit/UnitLeaderPreceptorManager'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import { mutateStaffPreceptorAssignment } from '../lib/staffPreceptorAssignmentApi'
import { sortPreceptorDirectoryRows } from '../lib/preceptorDirectory'

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PreceptorsTable({ students = [], units = [], cohortId, toast }) {
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
  const [assignState,  setAssignState]  = useState(null)
  const [sortBy,       setSortBy]       = useState('name')
  const [sortDir,      setSortDir]      = useState('asc')
  const [assignNotice, setAssignNotice] = useState(null)

  const filtered = search.trim()
    ? preceptors.filter(p =>
        p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.email?.toLowerCase().includes(search.toLowerCase())
      )
    : preceptors

  // PRECEPTOR-MODEL-3 + portal convergence: read all active Primary, Secondary,
  // and Coverage assignment rows for this cohort so the Current Student column
  // can show every active relationship and open the exact-row manager.
  const { data: activeAssignmentRows = [] } = useQuery({
    queryKey: ['spa_active_assignments', cohortId],
    enabled: !!cohortId,
    queryFn: async () => {
      const { data } = await supabase
        .from('student_preceptor_assignments')
        .select('id, preceptor_id, student_id, role, status, start_date, end_date')
        .eq('cohort_id', cohortId)
        .eq('status', 'active')
        .in('role', ['primary', 'secondary', 'coverage'])
      return data || []
    },
    staleTime: 60 * 1000,
  })
  const studentById = {}
  for (const s of students) studentById[s.id] = s
  const assignmentsByPreceptorId = {}
  for (const r of activeAssignmentRows) {
    const student = studentById[r.student_id]
    if (!student) continue
    const first = student.preferred_first_name || student.first_name || ''
    const name = `${first} ${student.last_name || ''}`.trim() || 'Student'
    const roleLabel = r.role === 'primary' ? 'Primary' : r.role === 'coverage' ? 'Coverage' : 'Secondary'
    ;(assignmentsByPreceptorId[r.preceptor_id] ||= []).push({
      id: r.id,
      student_id: r.student_id,
      student_name: name,
      student_unit: student.matched_unit || student.unit_name || student.unit_key || '',
      student_shift: student.shift || student.shift_assigned || student.assigned_shift_type || student.shift_availability || '',
      role: roleLabel,
      role_label: roleLabel,
      status: r.status,
      start_date: r.start_date || null,
      end_date: r.end_date || null,
      preceptor_id: r.preceptor_id,
    })
  }

  // Compatibility fallback for older rows if a primary mirror row is absent.
  for (const s of students) {
    if (!s.preceptor_id) continue
    const existing = assignmentsByPreceptorId[s.preceptor_id] || []
    if (existing.some(row => row.student_id === s.id && row.role === 'Primary')) continue
    const first = s.preferred_first_name || s.first_name || ''
    existing.push({
      id: `primary:${s.id}:${s.preceptor_id}`,
      student_id: s.id,
      student_name: `${first} ${s.last_name || ''}`.trim() || 'Student',
      student_unit: s.matched_unit || s.unit_name || s.unit_key || '',
      student_shift: s.shift || s.shift_assigned || s.assigned_shift_type || s.shift_availability || '',
      role: 'Primary',
      role_label: 'Primary',
      status: 'active',
      preceptor_id: s.preceptor_id,
    })
    assignmentsByPreceptorId[s.preceptor_id] = existing
  }

  const rowsForDirectory = filtered.map(p => ({
    ...p,
    home_unit: { id: p.unit_id || null, name: p.unit_name || null },
    shift: p.shift_type || null,
    assignments: assignmentsByPreceptorId[p.id] || [],
    active_assignment_count: (assignmentsByPreceptorId[p.id] || []).length,
    last_active_display: p.last_active_cohort || fmtDate(p.last_active_date),
  }))

  function handleSort(col) {
    const next = col === 'unit_name' ? 'unit' : col === 'full_name' ? 'name' : col
    if (sortBy === next) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(next); setSortDir('asc') }
  }

  const sorted = sortPreceptorDirectoryRows(rowsForDirectory, { sortBy, sortDir })

  const handleSaved = (preceptor) => {
    if (editTarget) {
      toast?.success('Preceptor updated', `${preceptor.full_name} has been updated.`)
    } else {
      toast?.success('Preceptor added', `${preceptor.full_name} added to the roster.`)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const { error: err } = await safeWrite(
      () => supabase.from('preceptors').delete().eq('id', deleteTarget.id),
      { name: 'delete preceptor' }
    )
    if (err) {
      toast?.error('Delete failed', err.message || 'Could not delete preceptor.')
    } else {
      queryClient.invalidateQueries({ queryKey: ['preceptors'] })
      toast?.success('Preceptor deleted', `${deleteTarget.full_name} removed from the roster.`)
      setDeleteTarget(null)
    }
  }

  const openAssignmentManager = (row, triggerEl) => {
    const assignment = row?.assignments?.[0]
    if (!assignment) {
      setAssignNotice('No active assignments are available for this preceptor.')
      triggerEl?.focus?.()
      return
    }
    setAssignState({
      student: {
        id: assignment.student_id,
        first_name: assignment.student_name,
        last_name: '',
        unit_key: assignment.student_unit,
        shift: assignment.student_shift,
      },
      returnFocusRef: { current: triggerEl || null },
    })
  }

  const loadStaffAssignments = async () => ({
    ok: true,
    data: {
      roster: rowsForDirectory,
      candidates: preceptors
        .filter(row => row.is_active !== false)
        .map(row => ({
          id: row.id,
          full_name: row.full_name || '',
          home_unit: { id: row.unit_id || null, name: row.unit_name || null },
          shift: row.shift_type || null,
        })),
    },
  })

  const assignmentCommitted = async (_result, message) => {
    setAssignNotice(message)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['preceptors'] }),
      queryClient.invalidateQueries({ queryKey: ['spa_active_assignments', cohortId] }),
    ])
    toast?.success('Assignment updated', message)
    return true
  }

  if (error) {
    return (
      <div style={{ padding: '32px 24px', fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#6b7280', fontSize: 13 }}>
        Could not load preceptors. Make sure the database migration has been applied.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      {/* Toolbar */}
      <div style={{ padding: '0 20px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          onClick={() => setAddOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 7,
            background: '#1D2567', border: 'none',
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#fff',
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
          <>
            {assignNotice && <p className="sr-only" role="status">{assignNotice}</p>}
            <PreceptorDirectoryTable
              rows={sorted}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
              onManagePreceptorAssignments={openAssignmentManager}
              onEditPreceptor={setEditTarget}
              onDeletePreceptor={setDeleteTarget}
              contactAvatarMap={contactAvatarMap}
              showCohorts
              showLastActive
              showAdminActions
              caption="Preceptor Directory"
            />
          </>
        )}
      </div>

      <PreceptorFormModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={handleSaved}
        cohortId={cohortId}
        units={units}
      />

      <PreceptorFormModal
        isOpen={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={p => { handleSaved(p); setEditTarget(null) }}
        initialData={editTarget}
        cohortId={cohortId}
        units={units}
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
        <UnitLeaderPreceptorManager
          student={assignState.student}
          returnFocusRef={assignState.returnFocusRef}
          loadPreceptors={loadStaffAssignments}
          mutateAssignment={mutateStaffPreceptorAssignment}
          readOnlyMessage="Assignments are read-only because this completed rotation is outside the owner/admin override flow."
          onCommitted={assignmentCommitted}
          onClose={() => setAssignState(null)}
        />
      )}
    </div>
  )
}
