import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { displayName, getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import { isIsoDateString, isLegacyNonIsoDateValue, dateInputValue } from '../lib/csLinkDateUtils'
import StudentAvatar from './StudentAvatar'
import SortHeader from './shared/SortHeader'
import ServiceNowLink from './shared/ServiceNowLink'
import { SERVICENOW_LINKS, STAGE1_REQUESTS, stage1RequestsFor, tickedStage1Request, isLegacyNotApplicable, stage1ResetFor, tickPatch, CS_TICK_DATE_FIELD } from '../lib/csLinkServiceNow'

// CSLINK-DATE-PICKER-DATA-RECOVERY: the four CS-Link date columns are TEXT and may hold legacy
// non-ISO values. We only ever WRITE a date field the user actually touched - untouched fields are
// omitted from the save so a legacy value is never coerced to null.
const CSLINK_DATE_FIELDS = ['cs_stage1_submitted_date', 'cs_stage1_complete_date', 'cs_link_requested_date', 'cs_link_complete_date']

const CEDARS_STATUS_OPTIONS = [
  { value: 'new',      label: 'New to Cedars-Sinai' },
  { value: 'former',   label: 'Former Student or Rotation' },
  { value: 'employee', label: 'Current Cedars-Sinai Employee or Volunteer' },
]

export default function AccessTab({ students, onUpdate, focusStudentId }) {
  const [sortBy,       setSortBy]       = useState('last_name')
  const [sortDir,      setSortDir]      = useState('asc')

  const sorted = [...students].sort((a, b) => {
    const av = (sortBy === 'last_name' ? (a.last_name || a.name || '') : (a.school || '')).toLowerCase()
    const bv = (sortBy === 'last_name' ? (b.last_name || b.name || '') : (b.school || '')).toLowerCase()
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const toggleSort = field => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  return (
    <div className="access-tab">

      {/* CSLINK-SERVICENOW-1: the status strip that stood here is retired; the five KPI cards
          above the toolbar carry the same counts and filter the table. */}

      {/* Table */}
      <div className="am-table-wrap">
        <table className="am-table">
          <thead>
            <tr>
              {/* UI-CONSISTENCY-3: the shared sort header. Arrow only on the sorted column;
                  no resting glyph, matching the Evaluation table. */}
              <SortHeader sortKey="last_name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>Student Name</SortHeader>
              <SortHeader sortKey="school" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>School</SortHeader>
              <th className="am-th">Cedars-Sinai Status</th>
              <th className="am-th">Step 2, Service Center</th>
              <th className="am-th">Step 3, Account Active</th>
              <th className="am-th">Step 4, CS-Link</th>
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

  // null until student data is confirmed present - prevents rendering inputs
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

  // Toggle a boolean field. CSLINK-SERVICENOW-1: ticking fills the paired date with today
  // (tickPatch), and that date counts as touched so Save writes it. Unticking keeps the date
  // hidden but intact, so re-checking the box restores it without losing the value.
  const handleToggleBox = (boolField, extra = {}) => {
    const patch = { ...extra, ...tickPatch(formData, boolField, !formData[boolField]) }
    const dateField = CS_TICK_DATE_FIELD[boolField]
    if (dateField && dateField in patch) touchedDatesRef.current.add(dateField)
    setFormData(prev => ({ ...prev, ...patch }))
    setIsDirty(true)
  }

  // A Step 2 request tick. The first tick records which request went out; ticking the other
  // request switches it (date kept); ticking the ticked one clears Submitted.
  const handleToggleRequest = (action) => {
    if (tickedStage1Request(formData) === action) return handleToggleBox('cs_stage1_submitted')
    if (formData.cs_stage1_submitted) {
      setFormData(prev => ({ ...prev, cs_stage1_action: action }))
      setIsDirty(true)
      return
    }
    handleToggleBox('cs_stage1_submitted', { cs_stage1_action: action })
  }

  // Update a date or text field in local state only - no save yet.
  const handleChangeField = (field, value) => {
    if (CSLINK_DATE_FIELDS.includes(field)) touchedDatesRef.current.add(field)
    setFormData(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
  }

  // Cedars-Sinai status cascades: setting the status also resets Steps 2 and 3 in formData
  // (no auto-save - waits for Save button). CSLINK-SERVICENOW-1: every status, employees
  // included, starts at Step 2 unticked (stage1ResetFor).
  const handleChangeCedarsStatus = (v) => {
    setFormData(prev => ({ ...prev, cs_cedars_status:v, ...stage1ResetFor(v) }))
    setIsDirty(true)
  }

  // Explicit Save: write the full payload in one atomic update so that boolean
  // and date fields always travel together. This is the fix for the race where
  // clearTimeout(timerRef) in per-field checkbox saves was canceling in-flight
  // date debounce timers - dates never reached Supabase, so they vanished on refresh.
  const handleSave = async () => {
    if (!student?.id || !formData || saving) return
    setSaving(true)

    // CSLINK-DATE-PICKER-DATA-RECOVERY: never overwrite a legacy non-ISO date. Booleans / status /
    // notes always save atomically; a date field is written ONLY if the user touched it this session
    // - then a valid pick saves as ISO and an intentional clear saves null. Untouched date fields are
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
        <td className="am-td am-td-school">{student.school || '-'}</td>
        <td className="am-td" colSpan={6} />
      </tr>
    )
  }

  const status    = getCsLinkStatus(formData)
  const statusCfg = CS_LINK_STATUS_CONFIG[status]

  // The date a tick fills: editable, with the legacy free-text hint when one is stored.
  const dateFor = (field) => (
    <>
      <input type="date" className="am-date-input" aria-label="Date"
        value={dateInputValue(formData[field])}
        onChange={e => handleChangeField(field, e.target.value)}
        placeholder="Date" />
      {isLegacyNonIsoDateValue(formData[field]) && (
        <span style={{ fontSize:9, color:'#92400e', display:'block' }} title="Legacy value, re-enter to update">was: {formData[field]}</span>
      )}
    </>
  )
  const requests = stage1RequestsFor(formData.cs_cedars_status)
  const ticked   = tickedStage1Request(formData)

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
      <td className="am-td am-td-school">{student.school || '-'}</td>

      {/* Col 3: Cedars-Sinai Status */}
      <td className="am-td">
        <select className="am-select" value={formData.cs_cedars_status || ''}
          onChange={e => handleChangeCedarsStatus(e.target.value)}>
          <option value="">-</option>
          {CEDARS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>

      {/* Col 4: Step 2 - Service Center request. CSLINK-SERVICENOW-1: each request is a tickbox
          beside its ServiceNow link. The link only opens the form; the tick records it was sent. */}
      <td className="am-td">
        {isLegacyNotApplicable(formData) ? (
          <div className="am-step-note">Not Applicable</div>
        ) : requests.length === 0 ? (
          <div style={{ fontSize:11, color:'#9ca3af' }}>-</div>
        ) : (
          <div className="am-request-stack">
            {requests.map(action => (
              <div key={action} className="am-access-cell am-request">
                <span className="am-request-head">
                  <input type="checkbox" className="am-checkbox"
                    aria-label={`${STAGE1_REQUESTS[action].label} submitted`}
                    checked={ticked === action}
                    onChange={() => handleToggleRequest(action)} />
                  <ServiceNowLink href={STAGE1_REQUESTS[action].href}>{STAGE1_REQUESTS[action].label}</ServiceNowLink>
                </span>
                {ticked === action && dateFor('cs_stage1_submitted_date')}
              </div>
            ))}
          </div>
        )}
      </td>

      {/* Col 5: Step 3 - Account Active */}
      <td className="am-td">
        <div className="am-access-cell am-request">
          <input type="checkbox" className="am-checkbox" aria-label="Account active"
            checked={formData.cs_stage1_complete || false}
            onChange={() => handleToggleBox('cs_stage1_complete')} />
          {formData.cs_stage1_complete && dateFor('cs_stage1_complete_date')}
        </div>
      </td>

      {/* Col 6: Step 4 - CS-Link. Unticked, Requested is a Request link to the ServiceNow cart;
          ticked, it reads Requested with today's date. */}
      <td className="am-td">
        <div className="am-request-stack">
          <div className="am-access-cell am-request">
            <span className="am-request-head">
              <input type="checkbox" className="am-checkbox" id={`cs-req-${student.id}`}
                aria-label="CS-Link requested"
                checked={formData.cs_link_requested || false}
                onChange={() => handleToggleBox('cs_link_requested')} />
              {formData.cs_link_requested
                ? <label htmlFor={`cs-req-${student.id}`} style={{ cursor:'pointer' }}>Requested</label>
                : <ServiceNowLink href={SERVICENOW_LINKS.csLinkRequest}>Request</ServiceNowLink>}
            </span>
            {formData.cs_link_requested && dateFor('cs_link_requested_date')}
          </div>
          <div className="am-access-cell am-request">
            <label className="am-request-head" style={{ cursor:'pointer' }}>
              <input type="checkbox" className="am-checkbox"
                checked={formData.cs_link_complete || false}
                onChange={() => handleToggleBox('cs_link_complete')} />
              Complete
            </label>
            {formData.cs_link_complete && dateFor('cs_link_complete_date')}
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
