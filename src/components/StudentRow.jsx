import { useState, useRef, useCallback } from 'react'
import {
  SCHOOLS, UNITS_BY_DIVISION, ASPIRE_STATUSES, NGRP_OUTCOMES, COHORTS,
  INTERVIEW_OUTCOMES, SHIFT_OPTIONS, UNIT_NAMES,
} from '../lib/constants'
import { displayName } from '../lib/utils'
import ConfirmDeleteModal from './ConfirmDeleteModal'

const STATUS_CLASS = {
  'Form Sent':      'badge-gray',
  'Pending Outreach': 'badge-pending',
  'Interviewed':    'badge-purple',
  'Accepted':       'badge-green',
  'Active Rotation':'badge-teal',
  'Completed':      'badge-navy',
  'Declined':       'badge-red',
}
const NGRP_CLASS = {
  'Pending':'badge-gray', 'Applied':'badge-blue', 'Interviewed':'badge-purple',
  'Offered':'badge-amber', 'Hired':'badge-green', 'Declined':'badge-red',
}

export default function StudentRow({ student, units = [], onUpdate, onDelete }) {
  const [expanded,      setExpanded]      = useState(false)
  const [data,          setData]          = useState(student)
  const [saveState,     setSaveState]     = useState('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const timerRef        = useRef(null)
  const pendingNameSave = useRef(null)

  const doSave = useCallback(async (field, value) => {
    setSaveState('saving')
    const err = await onUpdate(student.id, { [field]: value })
    setSaveState(err ? 'error' : 'saved')
    if (!err) setTimeout(() => setSaveState('idle'), 2000)
  }, [student.id, onUpdate])

  const handleText = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }))
    setSaveState('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 600)
  }

  // Handles first_name / last_name — computes + saves all three fields together
  const handleNameField = (field, value) => {
    setData(prev => {
      const updated = { ...prev, [field]: value }
      updated.name = `${updated.first_name || ''} ${updated.last_name || ''}`.trim()
      pendingNameSave.current = {
        first_name: updated.first_name || '',
        last_name:  updated.last_name  || '',
        name:       updated.name,
      }
      return updated
    })
    setSaveState('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      if (pendingNameSave.current) {
        const err = await onUpdate(student.id, pendingNameSave.current)
        setSaveState(err ? 'error' : 'saved')
        if (!err) setTimeout(() => setSaveState('idle'), 2000)
        pendingNameSave.current = null
      }
    }, 600)
  }

  const handleNum = (field, raw) => {
    const value = parseInt(raw) || 0
    setData(prev => ({ ...prev, [field]: value }))
    setSaveState('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 600)
  }

  const handleSelect = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }))
    doSave(field, value)
  }

  const handleCheck = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }))
    doSave(field, value)
  }

  const hoursProgress = data.hours_required > 0
    ? Math.min(100, Math.round(((data.hours_completed || 0) / data.hours_required) * 100))
    : 0

  const matchedUnitName = data.matched_unit_id && units.length > 0
    ? (units.find(u => u.id === data.matched_unit_id)?.unit_name || '—')
    : (data.matched_unit_id ? '(loading…)' : '—')

  const dname = displayName(data)

  return (
    <div className={`student-row${expanded ? ' expanded' : ''}`}>
      {/* ── Collapsed header ── */}
      <div className="row-header" onClick={() => setExpanded(e => !e)}>
        <div className="col-chevron">
          <span className={`chevron${expanded ? ' open' : ''}`}>›</span>
        </div>
        <div className="col-name">
          <span className="student-name">{dname}</span>
          {data.school_email && data.school_email !== 'pending' && (
            <span className="student-email">{data.school_email}</span>
          )}
        </div>
        <div className="col-school">{data.school}</div>
        <div className="col-cohort">{data.aspire_cohort}</div>
        <div className="col-status">
          {data.status && <span className={`badge ${STATUS_CLASS[data.status] || 'badge-gray'}`}>{data.status}</span>}
        </div>
        <div className="col-ngrp">
          {data.ngrp_outcome && <span className={`badge ${NGRP_CLASS[data.ngrp_outcome] || 'badge-gray'}`}>{data.ngrp_outcome}</span>}
        </div>
        <div className="col-hours">
          {data.hours_required > 0 && (
            <div className="hours-wrap">
              <span className="hours-text">{data.hours_completed || 0}/{data.hours_required}</span>
              <div className="hours-bar"><div className="hours-bar-fill" style={{ width: `${hoursProgress}%` }} /></div>
            </div>
          )}
        </div>
      </div>

      {/* ── Expanded edit form ── */}
      {expanded && (
        <div className="row-expand" onClick={e => e.stopPropagation()}>
          <div className="expand-topbar">
            <span className="expand-title">Editing — {dname}</span>
            <span className={`save-status save-${saveState}`}>
              {saveState === 'saving' && '· Saving…'}
              {saveState === 'saved'  && '✓ Saved'}
              {saveState === 'error'  && '✗ Save failed'}
            </span>
          </div>

          {/* Contact — first/last name + contact fields */}
          <div className="form-section">
            <div className="section-label">Contact Information</div>
            <div className="form-grid form-grid-5">
              <Field label="First Name">
                <input className="form-input" value={data.first_name || ''} onChange={e => handleNameField('first_name', e.target.value)} />
              </Field>
              <Field label="Last Name">
                <input className="form-input" value={data.last_name || ''} onChange={e => handleNameField('last_name', e.target.value)} />
              </Field>
              <Field label="School Email">
                <input className="form-input" value={data.school_email || ''} onChange={e => handleText('school_email', e.target.value)} />
              </Field>
              <Field label="Personal Email">
                <input className="form-input" value={data.personal_email || ''} onChange={e => handleText('personal_email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input className="form-input" value={data.phone || ''} onChange={e => handleText('phone', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Academic */}
          <div className="form-section">
            <div className="section-label">Academic Information</div>
            <div className="form-grid form-grid-5">
              <Field label="School">
                <select className="form-select" value={data.school || ''} onChange={e => handleSelect('school', e.target.value)}>
                  <option value="">Select…</option>
                  {SCHOOLS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="ASPIRE Cohort">
                <select className="form-select" value={data.aspire_cohort || ''} onChange={e => handleSelect('aspire_cohort', e.target.value)}>
                  <option value="">Select…</option>
                  {COHORTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Term Dates">
                <input className="form-input" value={data.term_dates || ''} onChange={e => handleText('term_dates', e.target.value)} />
              </Field>
              <Field label="Hrs Required">
                <input className="form-input" type="number" min="0" value={data.hours_required || ''} onChange={e => handleNum('hours_required', e.target.value)} />
              </Field>
              <Field label="Hrs Completed">
                <input className="form-input" type="number" min="0" value={data.hours_completed || ''} onChange={e => handleNum('hours_completed', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Placement */}
          <div className="form-section">
            <div className="section-label">Placement Information</div>
            <div className="form-grid form-grid-5">
              <Field label="Unit">
                <select className="form-select" value={data.unit || ''} onChange={e => handleSelect('unit', e.target.value)}>
                  <option value="">Select unit…</option>
                  {Object.entries(UNITS_BY_DIVISION).map(([div, unitList]) => (
                    <optgroup key={div} label={`── ${div} ──`}>
                      {unitList.map(u => <option key={u} value={u}>{u}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label="Preceptor Name">
                <input className="form-input" value={data.preceptor_name || ''} onChange={e => handleText('preceptor_name', e.target.value)} />
              </Field>
              <Field label="ASPIRE Status">
                <select className="form-select" value={data.status || ''} onChange={e => handleSelect('status', e.target.value)}>
                  {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="NGRP Cohort Target">
                <input className="form-input" value={data.ngrp_cohort_target || ''} onChange={e => handleText('ngrp_cohort_target', e.target.value)} placeholder="e.g. Spring 2027" />
              </Field>
              <Field label="NGRP Outcome">
                <select className="form-select" value={data.ngrp_outcome || ''} onChange={e => handleSelect('ngrp_outcome', e.target.value)}>
                  {NGRP_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* ASPIRE Matching */}
          <div className="form-section">
            <div className="section-label">ASPIRE Matching</div>
            <div className="form-grid form-grid-5">
              <Field label="Interview Outcome">
                <select className="form-select" value={data.interview_outcome || 'Pending Interview'} onChange={e => handleSelect('interview_outcome', e.target.value)}>
                  {INTERVIEW_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Shift Availability">
                <select className="form-select" value={data.shift_availability || ''} onChange={e => handleSelect('shift_availability', e.target.value)}>
                  <option value="">Select…</option>
                  {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Unit Preference 1">
                <select className="form-select" value={data.unit_preference_1 || ''} onChange={e => handleSelect('unit_preference_1', e.target.value)}>
                  <option value="">Select…</option>
                  {UNIT_NAMES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Unit Preference 2">
                <select className="form-select" value={data.unit_preference_2 || ''} onChange={e => handleSelect('unit_preference_2', e.target.value)}>
                  <option value="">Select…</option>
                  {UNIT_NAMES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Unit Preference 3">
                <select className="form-select" value={data.unit_preference_3 || ''} onChange={e => handleSelect('unit_preference_3', e.target.value)}>
                  <option value="">Select…</option>
                  {UNIT_NAMES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
            </div>
            <div className="form-grid form-grid-2" style={{ marginTop: 10 }}>
              <Field label="Matched Unit (read-only)">
                <div className="form-readonly">{matchedUnitName}</div>
              </Field>
              <Field label="Matched Preceptor (read-only)">
                <div className="form-readonly">{data.matched_preceptor || '—'}</div>
              </Field>
            </div>
          </div>

          {/* Compliance */}
          <div className="form-section">
            <div className="section-label">Compliance</div>
            <div className="compliance-grid">
              {[
                ['gpa_verified','GPA Verified'],['bls_current','BLS Current'],
                ['health_cleared','Health Cleared'],['background_check','Background Check'],
              ].map(([field, label]) => (
                <label key={field} className="checkbox-item">
                  <input type="checkbox" checked={data[field] || false} onChange={e => handleCheck(field, e.target.checked)} />
                  <span className={data[field] ? 'check-label checked' : 'check-label'}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Coordinators & Notes */}
          <div className="form-section">
            <div className="form-grid form-grid-2">
              <Field label="School Coordinators">
                <textarea className="form-textarea" rows={3} value={data.coordinators || ''} onChange={e => handleText('coordinators', e.target.value)} />
              </Field>
              <Field label="Notes">
                <textarea className="form-textarea" rows={3} value={data.notes || ''} onChange={e => handleText('notes', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Delete */}
          <div className="delete-zone">
            <button className="btn btn-destructive" onClick={() => setConfirmDelete(true)}>
              Delete Student
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          title={`Delete ${dname}?`}
          warning="This action cannot be undone. Any match assignments for this student will also be cleared."
          onConfirm={() => { setConfirmDelete(false); onDelete(student.id) }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}
