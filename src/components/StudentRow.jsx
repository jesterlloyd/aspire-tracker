import { useState, useRef, useCallback } from 'react'
import {
  SCHOOLS, UNITS_BY_DIVISION, ASPIRE_STATUSES, NGRP_OUTCOMES, COHORTS,
  INTERVIEW_OUTCOMES, SHIFT_OPTIONS, UNIT_NAMES,
} from '../lib/constants'
import { displayName } from '../lib/utils'
import { supabase } from '../lib/supabase'
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

const ACCESS_SUMMARY_FIELDS = [
  { key: 'access_non_employee',      dateKey: 'access_non_employee_date',       label: 'Non-Employee Access' },
  { key: 'access_hybrid_student',    dateKey: 'access_hybrid_student_date',     label: 'Hybrid Student Nurse' },
  { key: 'access_extended_end_date', dateKey: 'access_extended_end_date_value', label: 'Extended End Date' },
  { key: 'access_reactivated',       dateKey: 'access_reactivated_date',        label: 'Reactivated CW Access' },
]

export default function StudentRow({ student, units = [], onUpdate, onDelete, onSwitchToAccess }) {
  const [expanded,       setExpanded]       = useState(false)
  const [data,           setData]           = useState(student)
  const [saveState,      setSaveState]      = useState('idle')
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [uploadingRes,   setUploadingRes]   = useState(false)
  const [uploadingHead,  setUploadingHead]  = useState(false)
  const [resumeMsg,      setResumeMsg]      = useState(null)
  const [headMsg,        setHeadMsg]        = useState(null)
  const timerRef         = useRef(null)
  const pendingNameSave  = useRef(null)
  const resumeInputRef   = useRef(null)
  const headshotInputRef = useRef(null)

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

  const handleResumeUpload = async file => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setResumeMsg('error'); return }
    setUploadingRes(true); setResumeMsg(null)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/resume.${ext}`
    const { error } = await supabase.storage.from('student-files')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (error) { setUploadingRes(false); setResumeMsg('error'); return }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    setData(p => ({ ...p, resume_url: url }))
    onUpdate(student.id, { resume_url: url })
    setUploadingRes(false); setResumeMsg('success')
    setTimeout(() => setResumeMsg(null), 3000)
    if (resumeInputRef.current) resumeInputRef.current.value = ''
  }

  const handleHeadshotUpload = async file => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setHeadMsg('error'); return }
    setUploadingHead(true); setHeadMsg(null)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/headshot.${ext}`
    const { error } = await supabase.storage.from('student-files')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (error) { setUploadingHead(false); setHeadMsg('error'); return }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    setData(p => ({ ...p, headshot_url: url }))
    onUpdate(student.id, { headshot_url: url })
    setUploadingHead(false); setHeadMsg('success')
    setTimeout(() => setHeadMsg(null), 3000)
    if (headshotInputRef.current) headshotInputRef.current.value = ''
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
          {data.composite_score > 0 && (
            <span className="iv-score-mini">{data.composite_score}/15</span>
          )}
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

          {/* Interview Summary */}
          <div className="form-section">
            <div className="section-label">Interview Summary</div>
            {!data.interview_date && !data.interviewer_name && !data.composite_score ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No interview on record.</p>
            ) : (
              <div className="iv-summary-readonly">
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Date</span>
                  <span className="iv-summary-val">{data.interview_date || '—'}</span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Interviewer</span>
                  <span className="iv-summary-val">{data.interviewer_name || '—'}</span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">CJ Score</span>
                  <span className="iv-summary-val">{data.cj_score > 0 ? `${data.cj_score}/5` : '—'}</span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">PP Score</span>
                  <span className="iv-summary-val">{data.pp_score > 0 ? `${data.pp_score}/5` : '—'}</span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">GA Score</span>
                  <span className="iv-summary-val">{data.ga_score > 0 ? `${data.ga_score}/5` : '—'}</span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Composite</span>
                  <span className="iv-summary-val" style={{ fontWeight: 700, color: 'var(--nightfall)' }}>
                    {data.composite_score > 0 ? `${data.composite_score}/15` : '—'}
                  </span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Recommendation</span>
                  <span className="iv-summary-val">
                    {data.overall_recommendation
                      ? <span className="iv-rec-badge-sm" style={{
                          background: data.overall_recommendation === 'Recommend' ? '#dcfce7'
                            : data.overall_recommendation === 'Recommend with Reservations' ? '#fef3c7'
                            : '#fee2e2',
                          color: data.overall_recommendation === 'Recommend' ? '#166534'
                            : data.overall_recommendation === 'Recommend with Reservations' ? '#92400e'
                            : '#991b1b',
                        }}>
                          {data.overall_recommendation}
                        </span>
                      : '—'
                    }
                  </span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Suggested Unit</span>
                  <span className="iv-summary-val">{data.interviewer_suggested_unit || '—'}</span>
                </div>
                {data.summary_comments && (
                  <div className="iv-summary-comments">
                    <span className="iv-summary-lbl">Summary Comments</span>
                    <p style={{ fontSize: 13, color: 'var(--raven)', marginTop: 4, lineHeight: 1.5 }}>{data.summary_comments}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CS-Link Access */}
          <div className="form-section">
            <div className="section-label">CS-Link Access</div>
            <div className="am-access-summary-readonly">
              {ACCESS_SUMMARY_FIELDS.map(({ key, dateKey, label }) => (
                <div key={key} className={`am-summary-item${data[key] ? ' am-summary-item-done' : ''}`}>
                  <span className="am-summary-check">{data[key] ? '✓' : '○'}</span>
                  <span className="am-summary-label">{label}</span>
                  {data[key] && data[dateKey] && (
                    <span className="am-summary-date">{data[dateKey]}</span>
                  )}
                </div>
              ))}
            </div>
            {onSwitchToAccess && (
              <button
                type="button"
                className="btn-clear"
                style={{ marginTop: 10, fontSize: 12, color: 'var(--nightfall)', paddingLeft: 0 }}
                onClick={() => onSwitchToAccess(student.id)}
              >
                Manage in Access Tab →
              </button>
            )}
          </div>

          {/* Documents */}
          <div className="form-section">
            <div className="section-label">Documents</div>
            <div className="doc-section">

              {/* Resume */}
              <div className="doc-upload-area">
                <div className="doc-area-label">Resume</div>
                <input ref={resumeInputRef} type="file" style={{ display: 'none' }}
                  accept=".pdf,.doc,.docx"
                  onChange={e => handleResumeUpload(e.target.files[0])} />
                {data.resume_url ? (
                  <div className="doc-existing-file">
                    <a className="doc-file-link" href={data.resume_url}
                      target="_blank" rel="noopener noreferrer">
                      {decodeURIComponent(data.resume_url.split('/').pop()?.split('?')[0] || 'Resume')}
                    </a>
                    <button type="button" className="doc-replace-btn"
                      disabled={uploadingRes}
                      onClick={() => resumeInputRef.current?.click()}>
                      Replace
                    </button>
                  </div>
                ) : (
                  <div className="doc-upload-zone"
                    onClick={() => resumeInputRef.current?.click()}>
                    <span className="doc-zone-icon">📄</span>
                    <span className="doc-zone-text">Upload Resume (PDF or Word, max 10MB)</span>
                    <button type="button" className="doc-zone-btn"
                      onClick={e => { e.stopPropagation(); resumeInputRef.current?.click() }}>
                      Choose File
                    </button>
                  </div>
                )}
                {uploadingRes && <span className="doc-status doc-uploading">Uploading…</span>}
                {resumeMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded successfully</span>}
                {resumeMsg === 'error'   && <span className="doc-status doc-error">Upload failed or file too large.</span>}
              </div>

              {/* Headshot */}
              <div className="doc-upload-area">
                <div className="doc-area-label">Headshot</div>
                <input ref={headshotInputRef} type="file" style={{ display: 'none' }}
                  accept=".jpg,.jpeg,.png"
                  onChange={e => handleHeadshotUpload(e.target.files[0])} />
                {data.headshot_url ? (
                  <div className="doc-existing-file">
                    <img src={data.headshot_url} alt="Headshot" className="doc-headshot-preview" />
                    <button type="button" className="doc-replace-btn"
                      disabled={uploadingHead}
                      onClick={() => headshotInputRef.current?.click()}>
                      Replace
                    </button>
                  </div>
                ) : (
                  <div className="doc-upload-zone"
                    onClick={() => headshotInputRef.current?.click()}>
                    <span className="doc-zone-icon">🖼</span>
                    <span className="doc-zone-text">Upload Headshot (JPG or PNG, max 5MB)</span>
                    <button type="button" className="doc-zone-btn"
                      onClick={e => { e.stopPropagation(); headshotInputRef.current?.click() }}>
                      Choose File
                    </button>
                  </div>
                )}
                {uploadingHead && <span className="doc-status doc-uploading">Uploading…</span>}
                {headMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded successfully</span>}
                {headMsg === 'error'   && <span className="doc-status doc-error">Upload failed or file too large.</span>}
              </div>

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
