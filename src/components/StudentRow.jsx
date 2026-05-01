import { useState, useRef, useCallback } from 'react'
import {
  SCHOOLS,
  SCHOOL_DEFAULTS,
  UNITS_BY_DIVISION,
  ASPIRE_STATUSES,
  NGRP_OUTCOMES,
  COHORTS,
} from '../lib/constants'

const STATUS_CLASS = {
  'Form Sent': 'badge-gray',
  'Form Returned': 'badge-blue',
  'Interviewed': 'badge-purple',
  'Accepted': 'badge-green',
  'Active Rotation': 'badge-teal',
  'Completed': 'badge-navy',
  'Declined': 'badge-red',
}

const NGRP_CLASS = {
  'Pending': 'badge-gray',
  'Applied': 'badge-blue',
  'Interviewed': 'badge-purple',
  'Offered': 'badge-amber',
  'Hired': 'badge-green',
  'Declined': 'badge-red',
}

export default function StudentRow({ student, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState(student)
  const [saveState, setSaveState] = useState('idle')
  const timerRef = useRef(null)

  const doSave = useCallback(
    async (field, value) => {
      setSaveState('saving')
      const err = await onUpdate(student.id, { [field]: value })
      setSaveState(err ? 'error' : 'saved')
      if (!err) setTimeout(() => setSaveState('idle'), 2000)
    },
    [student.id, onUpdate]
  )

  const handleText = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }))
    setSaveState('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 600)
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

  return (
    <div className={`student-row${expanded ? ' expanded' : ''}`}>
      {/* ── Collapsed header ── */}
      <div className="row-header" onClick={() => setExpanded(e => !e)}>
        <div className="col-chevron">
          <span className={`chevron${expanded ? ' open' : ''}`}>›</span>
        </div>
        <div className="col-name">
          <span className="student-name">{data.name}</span>
          {data.school_email && data.school_email !== 'pending' && (
            <span className="student-email">{data.school_email}</span>
          )}
        </div>
        <div className="col-school">{data.school}</div>
        <div className="col-cohort">{data.aspire_cohort}</div>
        <div className="col-status">
          {data.status && (
            <span className={`badge ${STATUS_CLASS[data.status] || 'badge-gray'}`}>
              {data.status}
            </span>
          )}
        </div>
        <div className="col-ngrp">
          {data.ngrp_outcome && (
            <span className={`badge ${NGRP_CLASS[data.ngrp_outcome] || 'badge-gray'}`}>
              {data.ngrp_outcome}
            </span>
          )}
        </div>
        <div className="col-hours">
          {data.hours_required > 0 && (
            <div className="hours-wrap">
              <span className="hours-text">{data.hours_completed || 0}/{data.hours_required}</span>
              <div className="hours-bar">
                <div className="hours-bar-fill" style={{ width: `${hoursProgress}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Expanded edit form ── */}
      {expanded && (
        <div className="row-expand" onClick={e => e.stopPropagation()}>
          <div className="expand-topbar">
            <span className="expand-title">Editing — {data.name}</span>
            <span className={`save-status save-${saveState}`}>
              {saveState === 'saving' && '· Saving…'}
              {saveState === 'saved' && '✓ Saved'}
              {saveState === 'error' && '✗ Save failed'}
            </span>
          </div>

          {/* Contact */}
          <div className="form-section">
            <div className="section-label">Contact Information</div>
            <div className="form-grid form-grid-4">
              <Field label="Full Name">
                <input className="form-input" value={data.name || ''} onChange={e => handleText('name', e.target.value)} />
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
                  {Object.entries(UNITS_BY_DIVISION).map(([div, units]) => (
                    <optgroup key={div} label={`── ${div} ──`}>
                      {units.map(u => <option key={u} value={u}>{u}</option>)}
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

          {/* Compliance */}
          <div className="form-section">
            <div className="section-label">Compliance</div>
            <div className="compliance-grid">
              {[
                ['gpa_verified', 'GPA Verified'],
                ['bls_current', 'BLS Current'],
                ['health_cleared', 'Health Cleared'],
                ['background_check', 'Background Check'],
              ].map(([field, label]) => (
                <label key={field} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={data[field] || false}
                    onChange={e => handleCheck(field, e.target.checked)}
                  />
                  <span className={data[field] ? 'check-label checked' : 'check-label'}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Coordinators & Notes */}
          <div className="form-section">
            <div className="form-grid form-grid-2">
              <Field label="School Coordinators">
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={data.coordinators || ''}
                  onChange={e => handleText('coordinators', e.target.value)}
                />
              </Field>
              <Field label="Notes">
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={data.notes || ''}
                  onChange={e => handleText('notes', e.target.value)}
                />
              </Field>
            </div>
          </div>
        </div>
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
