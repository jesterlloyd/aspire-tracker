import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ASPIRE_STATUSES } from '../lib/constants'
import { displayName, downloadCSV, getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import { isIsoDateString, isLegacyNonIsoDateValue, dateInputValue } from '../lib/csLinkDateUtils'
import StudentAvatar from './StudentAvatar'

// CSLINK-DATE-PICKER-DATA-RECOVERY: the four CS-Link date columns are TEXT and may hold legacy
// non-ISO values. We only ever WRITE a date field the user actually touched — untouched fields are
// omitted from the save so a legacy value is never coerced to null.
const CSLINK_DATE_FIELDS = ['cs_stage1_submitted_date', 'cs_stage1_complete_date', 'cs_link_requested_date', 'cs_link_complete_date']

const STAGE1_ACTION_LABELS = {
  add_non_employee:  'Add Non-Employee',
  assignment_change: 'Assignment Change',
  extend_end_date:   'Extend Project End Date',
  reactivate:        'Reactivate',
  not_applicable:    'Not Applicable',
}

const CEDARS_STATUS_OPTIONS = [
  { value: 'new',      label: 'New to Cedars-Sinai' },
  { value: 'former',   label: 'Former Student or Rotation' },
  { value: 'employee', label: 'Current Cedars-Sinai Employee or Volunteer' },
]

export default function AccessTab({ students, onUpdate, focusStudentId }) {
  const [sortBy,       setSortBy]       = useState('last_name')
  const [sortDir,      setSortDir]      = useState('asc')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const schools = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  const statusCounts = { not_started:0, stage1_pending:0, account_active:0, cslink_pending:0, complete:0 }
  students.forEach(s => { statusCounts[getCsLinkStatus(s)]++ })

  let filtered = students
  if (filterSchool) filtered = filtered.filter(s => s.school === filterSchool)
  if (filterStatus) filtered = filtered.filter(s => s.status === filterStatus)

  const sorted = [...filtered].sort((a, b) => {
    const av = (sortBy === 'last_name' ? (a.last_name || a.name || '') : (a.school || '')).toLowerCase()
    const bv = (sortBy === 'last_name' ? (b.last_name || b.name || '') : (b.school || '')).toLowerCase()
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const toggleSort = field => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  const exportCSV = () => {
    const headers = [
      'Student Name', 'School', 'Cedars-Sinai Status', 'Step 2 Action',
      'Step 2 Submitted Date', 'Step 3 Complete Date',
      'CS-Link Requested Date', 'CS-Link Complete Date',
      'CS Access Notes', 'Workflow Status',
    ]
    const rows = sorted.map(s => [
      displayName(s), s.school || '',
      CEDARS_STATUS_OPTIONS.find(o => o.value === s.cs_cedars_status)?.label || s.cs_cedars_status || '',
      STAGE1_ACTION_LABELS[s.cs_stage1_action] || s.cs_stage1_action || '',
      s.cs_stage1_submitted_date || '',
      s.cs_stage1_complete_date  || '',
      s.cs_link_requested_date   || '',
      s.cs_link_complete_date    || '',
      s.cs_access_notes          || '',
      CS_LINK_STATUS_CONFIG[getCsLinkStatus(s)]?.label || '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    downloadCSV(csv, `aspire-cslink-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="access-tab">

      {/* Compact stats */}
      <div className="am-compact-stats">
        {Object.entries(CS_LINK_STATUS_CONFIG).map(([key, cfg]) => (
          <span key={key} className="am-stat-pill"
            style={{ color: cfg.text, fontWeight: statusCounts[key] > 0 ? 700 : 400 }}>
            {cfg.label}: <strong>{statusCounts[key]}</strong>
          </span>
        ))}
      </div>

      {/* Filter row */}
      <div className="am-filter-row">
        <select className="filter-select" value={filterSchool} onChange={e => setFilterSchool(e.target.value)}>
          <option value="">All Schools</option>
          {schools.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All ASPIRE Statuses</option>
          {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={exportCSV}>
          ↓ Export Access Log CSV
        </button>
      </div>

      {/* Table */}
      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              <th className="am-th am-sortable" onClick={() => toggleSort('last_name')}>
                Student Name&nbsp;{sortBy === 'last_name' ? (sortDir === 'asc' ? '↑' : '↓') : <span className="am-sort-icon">↕</span>}
              </th>
              <th className="am-th am-sortable" onClick={() => toggleSort('school')}>
                School&nbsp;{sortBy === 'school' ? (sortDir === 'asc' ? '↑' : '↓') : <span className="am-sort-icon">↕</span>}
              </th>
              <th className="am-th">Cedars-Sinai Status</th>
              <th className="am-th">Step 2 — Service Center</th>
              <th className="am-th">Step 3 — Account Active</th>
              <th className="am-th">Step 4 — CS-Link</th>
              <th className="am-th">Status</th>
              <th className="am-th">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={8} className="am-empty">No students match the current filters.</td></tr>
            ) : sorted.map(s => (
              <AccessRow key={s.id} student={s} onUpdate={onUpdate} isHighlighted={focusStudentId === s.id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AccessRow({ student, onUpdate, isHighlighted }) {
  const queryClient = useQueryClient()

  // null until student data is confirmed present — prevents rendering inputs
  // before fields arrive and prevents empty-string saves on uninitialized state.
  const [formData, setFormData] = useState(null)
  const [isDirty,  setIsDirty]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  // Which CS-Link date fields the user actually edited this session (reset when the student changes).
  const touchedDatesRef = useRef(new Set())

  // Sync from server ONLY when:
  //   1. student.id is known
  //   2. formData hasn't been built for this student (_sourceStudentId differs)
  //   3. user is not mid-edit (isDirty = false)
  // Field-level deps catch deferred column arrivals (e.g., background refetch
  // that fills in a previously-null column after the row first mounted).
  useEffect(() => {
    if (!student?.id) return
    if (formData?._sourceStudentId === student.id) return
    if (isDirty) return
    touchedDatesRef.current = new Set()   // fresh student → no date edits yet
    setFormData({
      _sourceStudentId:         student.id,
      cs_cedars_status:         student.cs_cedars_status         ?? '',
      cs_stage1_action:         student.cs_stage1_action         ?? '',
      cs_stage1_submitted:      student.cs_stage1_submitted      ?? false,
      cs_stage1_submitted_date: student.cs_stage1_submitted_date ?? '',
      cs_stage1_complete:       student.cs_stage1_complete       ?? false,
      cs_stage1_complete_date:  student.cs_stage1_complete_date  ?? '',
      cs_link_requested:        student.cs_link_requested        ?? false,
      cs_link_requested_date:   student.cs_link_requested_date   ?? '',
      cs_link_complete:         student.cs_link_complete         ?? false,
      cs_link_complete_date:    student.cs_link_complete_date    ?? '',
      cs_access_notes:          student.cs_access_notes          ?? '',
    })
  }, [
    student?.id,
    student?.cs_cedars_status,
    student?.cs_stage1_action,
    student?.cs_stage1_submitted,
    student?.cs_stage1_submitted_date,
    student?.cs_stage1_complete,
    student?.cs_stage1_complete_date,
    student?.cs_link_requested,
    student?.cs_link_requested_date,
    student?.cs_link_complete,
    student?.cs_link_complete_date,
    student?.cs_access_notes,
    formData?._sourceStudentId,
    isDirty,
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle a boolean field. The paired date is kept in formData hidden but
  // intact — re-checking the box restores it without losing the value.
  const handleToggleBox = (boolField) => {
    setFormData(prev => ({ ...prev, [boolField]: !prev[boolField] }))
    setIsDirty(true)
  }

  // Update a date or text field in local state only — no save yet.
  const handleChangeField = (field, value) => {
    if (CSLINK_DATE_FIELDS.includes(field)) touchedDatesRef.current.add(field)
    setFormData(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
  }

  // Cedars-Sinai status cascades: setting the status also updates the action
  // and resets stage1 flags in formData (no auto-save — waits for Save button).
  const handleChangeCedarsStatus = (v) => {
    const extras = v === 'employee'
      ? { cs_stage1_action:'not_applicable', cs_stage1_submitted:true, cs_stage1_complete:true }
      : v === 'new'
        ? { cs_stage1_action:'add_non_employee', cs_stage1_submitted:false, cs_stage1_complete:false }
        : { cs_stage1_action:'', cs_stage1_submitted:false, cs_stage1_complete:false }
    setFormData(prev => ({ ...prev, cs_cedars_status:v, ...extras }))
    setIsDirty(true)
  }

  // Explicit Save: write the full payload in one atomic update so that boolean
  // and date fields always travel together. This is the fix for the race where
  // clearTimeout(timerRef) in per-field checkbox saves was canceling in-flight
  // date debounce timers — dates never reached Supabase, so they vanished on refresh.
  const handleSave = async () => {
    if (!student?.id || !formData || saving) return
    setSaving(true)

    // CSLINK-DATE-PICKER-DATA-RECOVERY: never overwrite a legacy non-ISO date. Booleans / status /
    // notes always save atomically; a date field is written ONLY if the user touched it this session
    // — then a valid pick saves as ISO and an intentional clear saves null. Untouched date fields are
    // OMITTED entirely, so the stored value (ISO or legacy free-text) is preserved as-is.
    const payload = {
      cs_cedars_status:    formData.cs_cedars_status || null,
      cs_stage1_action:    formData.cs_stage1_action || null,
      cs_stage1_submitted: formData.cs_stage1_submitted,
      cs_stage1_complete:  formData.cs_stage1_complete,
      cs_link_requested:   formData.cs_link_requested,
      cs_link_complete:    formData.cs_link_complete,
      cs_access_notes:     formData.cs_access_notes || null,
    }
    for (const f of CSLINK_DATE_FIELDS) {
      if (!touchedDatesRef.current.has(f)) continue   // untouched → preserve stored value (omit)
      const v = formData[f]
      payload[f] = isIsoDateString(v) ? v : null       // touched: valid ISO, else intentional clear → null
    }

    console.log('[CS-Link save] sending:', payload)
    const err = await onUpdate(student.id, payload)
    setSaving(false)
    if (err) {
      console.error('[CS-Link save] failed:', err)
      return
    }
    console.log('[CS-Link save] success')

    setIsDirty(false)
    // Keep students_in_cohort cache fresh for Keith and other consumers
    queryClient.invalidateQueries({ queryKey: ['students_in_cohort', student.cohort_id] })
  }

  // Hold off rendering inputs until formData is ready
  if (!formData) {
    return (
      <tr id={`access-row-${student.id}`} className={`am-row${isHighlighted ? ' am-row-highlight' : ''}`}>
        <td className="am-td am-td-name">
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <StudentAvatar student={student} size={32} />
            <span>{displayName(student)}</span>
          </div>
        </td>
        <td className="am-td am-td-school">{student.school || '—'}</td>
        <td className="am-td" colSpan={6} />
      </tr>
    )
  }

  const status    = getCsLinkStatus(formData)
  const statusCfg = CS_LINK_STATUS_CONFIG[status]

  return (
    <tr id={`access-row-${student.id}`} className={`am-row${isHighlighted ? ' am-row-highlight' : ''}`}>

      {/* Col 1: Student Name */}
      <td className="am-td am-td-name">
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <StudentAvatar student={student} size={32} />
          <span>{displayName(student)}</span>
        </div>
      </td>

      {/* Col 2: School */}
      <td className="am-td am-td-school">{student.school || '—'}</td>

      {/* Col 3: Cedars-Sinai Status */}
      <td className="am-td">
        <select className="am-select" value={formData.cs_cedars_status || ''}
          onChange={e => handleChangeCedarsStatus(e.target.value)}>
          <option value="">—</option>
          {CEDARS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* Col 4: Step 2 — Service Center Request */}
      <td className="am-td">
        {formData.cs_stage1_action
          ? <div style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', marginBottom:5 }}>
              {STAGE1_ACTION_LABELS[formData.cs_stage1_action] || formData.cs_stage1_action}
            </div>
          : <div style={{ fontSize:11, color:'#9ca3af', marginBottom:5 }}>—</div>
        }
        {formData.cs_stage1_action && formData.cs_stage1_action !== 'not_applicable' && (
          <div className="am-access-cell">
            <label style={{ fontSize:11, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox"
                checked={formData.cs_stage1_submitted || false}
                onChange={() => handleToggleBox('cs_stage1_submitted')} />
              Submitted
            </label>
            {/* Date rendered only when checked, but value comes from formData
                so it's preserved when unchecked and restored on re-check */}
            {formData.cs_stage1_submitted && (
              <>
                <input type="date" className="am-date-input"
                  value={dateInputValue(formData.cs_stage1_submitted_date)}
                  onChange={e => handleChangeField('cs_stage1_submitted_date', e.target.value)}
                  placeholder="Date" />
                {isLegacyNonIsoDateValue(formData.cs_stage1_submitted_date) && (
                  <span style={{ fontSize:9, color:'#92400e', display:'block' }} title="Legacy value — re-enter to update">was: {formData.cs_stage1_submitted_date}</span>
                )}
              </>
            )}
          </div>
        )}
      </td>

      {/* Col 5: Step 3 — Account Active */}
      <td className="am-td">
        <div className="am-access-cell">
          <input type="checkbox" className="am-checkbox"
            checked={formData.cs_stage1_complete || false}
            onChange={() => handleToggleBox('cs_stage1_complete')} />
          {formData.cs_stage1_complete && (
            <>
              <input type="date" className="am-date-input"
                value={dateInputValue(formData.cs_stage1_complete_date)}
                onChange={e => handleChangeField('cs_stage1_complete_date', e.target.value)}
                placeholder="Date" />
              {isLegacyNonIsoDateValue(formData.cs_stage1_complete_date) && (
                <span style={{ fontSize:9, color:'#92400e', display:'block' }} title="Legacy value — re-enter to update">was: {formData.cs_stage1_complete_date}</span>
              )}
            </>
          )}
        </div>
      </td>

      {/* Col 6: Step 4 — CS-Link (Requested + Complete stacked) */}
      <td className="am-td">
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div className="am-access-cell">
            <label style={{ fontSize:11, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox"
                checked={formData.cs_link_requested || false}
                onChange={() => handleToggleBox('cs_link_requested')} />
              Requested
            </label>
            {formData.cs_link_requested && (
              <>
                <input type="date" className="am-date-input"
                  value={dateInputValue(formData.cs_link_requested_date)}
                  onChange={e => handleChangeField('cs_link_requested_date', e.target.value)}
                  placeholder="Date" />
                {isLegacyNonIsoDateValue(formData.cs_link_requested_date) && (
                  <span style={{ fontSize:9, color:'#92400e', display:'block' }} title="Legacy value — re-enter to update">was: {formData.cs_link_requested_date}</span>
                )}
              </>
            )}
          </div>
          <div className="am-access-cell">
            <label style={{ fontSize:11, color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox"
                checked={formData.cs_link_complete || false}
                onChange={() => handleToggleBox('cs_link_complete')} />
              Complete
            </label>
            {formData.cs_link_complete && (
              <>
                <input type="date" className="am-date-input"
                  value={dateInputValue(formData.cs_link_complete_date)}
                  onChange={e => handleChangeField('cs_link_complete_date', e.target.value)}
                  placeholder="Date" />
                {isLegacyNonIsoDateValue(formData.cs_link_complete_date) && (
                  <span style={{ fontSize:9, color:'#92400e', display:'block' }} title="Legacy value — re-enter to update">was: {formData.cs_link_complete_date}</span>
                )}
              </>
            )}
          </div>
        </div>
      </td>

      {/* Col 7: Status badge */}
      <td className="am-td">
        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20,
          background:statusCfg.bg, color:statusCfg.text, whiteSpace:'nowrap' }}>
          {statusCfg.label}
        </span>
      </td>

      {/* Col 8: Notes + Save button */}
      <td className="am-td">
        <input className="am-notes-input" type="text"
          value={formData.cs_access_notes || ''}
          onChange={e => handleChangeField('cs_access_notes', e.target.value)}
          placeholder="Notes…" />
        {isDirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              marginTop: 6, width: '100%',
              padding: '4px 0', fontSize: 11, fontWeight: 700,
              background: saving ? '#e5e7eb' : '#1D2567',
              color: saving ? '#9ca3af' : '#ffffff',
              border: 'none', borderRadius: 6, cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </td>
    </tr>
  )
}
