import { useState, useRef, useCallback } from 'react'
import {
  SCHOOLS, ASPIRE_STATUSES, NGRP_OUTCOMES, COHORTS,
  INTERVIEW_OUTCOMES, SHIFT_OPTIONS,
} from '../lib/constants'
import { displayName } from '../lib/utils'
import { supabase } from '../lib/supabase'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import ScoreFlag from './ScoreFlag'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'

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
  const [showSSN,        setShowSSN]        = useState(false)
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

  const handleDecimal = (field, raw) => {
    const value = raw === '' ? null : parseFloat(raw)
    setData(prev => ({ ...prev, [field]: value }))
    setSaveState('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 600)
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
          {data.status && (() => {
            const dispRaw1 = data.active_disposition
            const disp1 = Array.isArray(dispRaw1) ? (dispRaw1[0] ?? null) : (dispRaw1 || null)
            const dispType = disp1?.disposition_type
            if (data.status === 'Not Proceeding' && dispType) {
              const colors = DISPOSITION_PILL_COLORS[dispType] || DISPOSITION_PILL_COLORS['not_selected']
              return (
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                  fontSize: 11, fontWeight: 700,
                  background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                }}>
                  {DISPOSITION_TYPES[dispType] || dispType}
                </span>
              )
            }
            return <span className={`badge ${STATUS_CLASS[data.status] || 'badge-gray'}`}>{data.status}</span>
          })()}
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

          {/* 1. Contact Information */}
          <div className="form-section">
            <div className="section-label">Contact Information</div>
            <div className="form-grid form-grid-3">
              <Field label="School Email">
                <div className="form-readonly">{data.school_email || '—'}</div>
              </Field>
              <Field label="Personal Email">
                <input className="form-input" value={data.personal_email || ''} onChange={e => handleText('personal_email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input className="form-input" value={data.phone || ''} onChange={e => handleText('phone', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* 2. Program Details */}
          <div className="form-section">
            <div className="section-label">Program Details</div>
            <div className="form-grid form-grid-3">
              <Field label="School">
                <div className="form-readonly">{data.school || '—'}</div>
              </Field>
              <Field label="Program Type">
                <div className="form-readonly">{data.program_type || '—'}</div>
              </Field>
              <Field label="Term Dates">
                <div className="form-readonly">{data.term_dates || '—'}</div>
              </Field>
              <Field label="Hours Required">
                <input className="form-input" type="text" inputMode="numeric" pattern="[0-9]*"
                  value={data.hours_required ?? ''}
                  onChange={e => handleNum('hours_required', e.target.value)} />
              </Field>
              <Field label="Estimated Graduation">
                <div className="form-readonly">{data.estimated_graduation || '—'}</div>
              </Field>
            </div>
          </div>

          {/* 3. Personal Information */}
          <div className="form-section">
            <div className="section-label">Personal Information</div>
            <div className="form-grid form-grid-3">
              <Field label="First Name">
                <input className="form-input" value={data.first_name || ''} onChange={e => handleNameField('first_name', e.target.value)} />
              </Field>
              <Field label="Last Name">
                <input className="form-input" value={data.last_name || ''} onChange={e => handleNameField('last_name', e.target.value)} />
              </Field>
              <Field label="Date of Birth">
                <input className="form-input" type="date" value={data.date_of_birth || ''} onChange={e => handleText('date_of_birth', e.target.value)} />
              </Field>
              <Field label="Last 4 SSN">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="form-input" type={showSSN ? 'text' : 'password'}
                    value={data.ssn_last4 || ''} maxLength={4}
                    onChange={e => handleText('ssn_last4', e.target.value.replace(/\D/g,'').slice(0,4))} />
                  <button type="button" className="btn-clear"
                    style={{ flexShrink: 0, padding: '4px 8px', fontSize: 11 }}
                    onClick={() => setShowSSN(p => !p)}>
                    {showSSN ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>
              <Field label="Gender">
                <select className="form-select" value={data.gender || ''} onChange={e => handleSelect('gender', e.target.value)}>
                  <option value="">Select…</option>
                  <option>Male</option><option>Female</option>
                  <option>Non-binary</option><option>Prefer not to say</option><option>Other</option>
                </select>
              </Field>
              <Field label="Cumulative GPA">
                <input className="form-input" type="text" inputMode="decimal" pattern="[0-9.]*"
                  value={data.cumulative_gpa ?? ''} placeholder="0.00"
                  onChange={e => handleDecimal('cumulative_gpa', e.target.value)} />
                {data.cumulative_gpa != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {parseFloat(data.cumulative_gpa).toFixed(2)} / 4.0
                  </div>
                )}
              </Field>
              <Field label="Shift Preference">
                <select className="form-select" value={data.shift_availability || ''} onChange={e => handleSelect('shift_availability', e.target.value)}>
                  <option value="">Select…</option>
                  <option>Day</option><option>Night</option><option>Either</option>
                </select>
              </Field>
            </div>
          </div>

          {/* 4. Background and Affiliation */}
          <div className="form-section">
            <div className="section-label">Background and Affiliation</div>
            <div className="form-grid form-grid-2">
              <Field label="Prior Healthcare Experience">
                <input className="form-input" value={data.prior_healthcare_experience || ''}
                  onChange={e => handleText('prior_healthcare_experience', e.target.value)}
                  placeholder="e.g. CNA, EMT, Medical Assistant" />
              </Field>
              <Field label="CS Affiliation">
                <select className="form-select" value={data.cs_affiliation || ''} onChange={e => handleSelect('cs_affiliation', e.target.value)}>
                  <option value="">Select…</option>
                  <option>Current Employee</option><option>Former Employee</option>
                  <option>Volunteer</option><option>No prior affiliation</option>
                </select>
              </Field>
              {['Current Employee','Former Employee','Volunteer'].includes(data.cs_affiliation) && (
                <>
                  <Field label="CS Department">
                    <input className="form-input" value={data.cs_department || ''} onChange={e => handleText('cs_department', e.target.value)} />
                  </Field>
                  <Field label="CS Role / Job Title">
                    <input className="form-input" value={data.cs_role || ''} onChange={e => handleText('cs_role', e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          </div>

          {/* 5. Interest Statement */}
          <div className="form-section">
            <div className="section-label">Interest Statement</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--nightfall)', marginBottom: 8 }}>
              Why are you interested in completing your senior rotation at Cedars-Sinai?
            </div>
            {data.interest_statement ? (
              <div className="sr-interest-block">{data.interest_statement}</div>
            ) : (
              <p style={{ fontSize: 14, color: '#9ca3af', fontStyle: 'italic' }}>Not yet submitted.</p>
            )}
          </div>

          {/* 6. Unit Preferences */}
          <div className="form-section">
            <div className="section-label">Unit Preferences</div>
            <div className="form-grid form-grid-3">
              {['unit_preference_1','unit_preference_2','unit_preference_3'].map((field, i) => (
                <Field key={field} label={`Preference ${i+1}`}>
                  <select className="form-select" value={data[field] || ''} onChange={e => handleSelect(field, e.target.value)}>
                    <option value="">Select…</option>
                    {units.filter(u => u.is_participating).map(u => (
                      <option key={u.id} value={u.unit_name}>{u.unit_name}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>

          {/* 7. Placement and Outcomes */}
          <div className="form-section">
            <div className="section-label">Placement and Outcomes</div>
            <div className="form-grid form-grid-3">
              <Field label="ASPIRE Status">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.status && (() => {
                    const dispRaw2 = data.active_disposition
                    const disp2 = Array.isArray(dispRaw2) ? (dispRaw2[0] ?? null) : (dispRaw2 || null)
                    const dispType = disp2?.disposition_type
                    if (data.status === 'Not Proceeding' && dispType) {
                      const colors = DISPOSITION_PILL_COLORS[dispType] || DISPOSITION_PILL_COLORS['not_selected']
                      return (
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                          fontSize: 11, fontWeight: 700,
                          background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                        }}>
                          {DISPOSITION_TYPES[dispType] || dispType}
                        </span>
                      )
                    }
                    return <span className={`badge ${STATUS_CLASS[data.status] || 'badge-gray'}`}>{data.status}</span>
                  })()}
                  <select className="form-select" value={data.status || ''} onChange={e => handleSelect('status', e.target.value)}>
                    {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Interview Outcome">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.interview_outcome && (
                    <span className={`interview-pill ${
                      data.interview_outcome === 'Recommend' ? 'pill-green' :
                      data.interview_outcome === 'Recommend with Reservations' ? 'pill-yellow' :
                      data.interview_outcome === 'Do Not Recommend' ? 'pill-red' : 'pill-gray'
                    }`}>{data.interview_outcome}</span>
                  )}
                  <select className="form-select" value={data.interview_outcome || ''} onChange={e => handleSelect('interview_outcome', e.target.value)}>
                    {INTERVIEW_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Matched Unit">
                <div className="form-readonly">{matchedUnitName}</div>
              </Field>
              <Field label="Matched Preceptor">
                <input className="form-input" value={data.matched_preceptor || ''}
                  onChange={e => handleText('matched_preceptor', e.target.value)}
                  placeholder="Assign preceptor…" />
              </Field>
              <Field label="NGRP Cohort Target">
                <input className="form-input" value={data.ngrp_cohort_target || ''}
                  onChange={e => handleText('ngrp_cohort_target', e.target.value)} placeholder="e.g. Spring 2027" />
              </Field>
              <Field label="NGRP Outcome">
                <select className="form-select" value={data.ngrp_outcome || ''} onChange={e => handleSelect('ngrp_outcome', e.target.value)}>
                  {NGRP_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* Notes */}
          <div className="form-section">
            <div className="section-label">Notes</div>
            <Field label="">
              <textarea className="form-textarea" rows={3} value={data.notes || ''} onChange={e => handleText('notes', e.target.value)} />
            </Field>
          </div>

          {/* Interview Summary */}
          <div className="form-section">
            <div className="section-label">Interview Summary</div>
            {!data.rubric_count && !data.interview_scheduled_date ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No interview on record.</p>
            ) : (
              <div className="iv-summary-readonly">
                {data.interview_scheduled_date && (
                  <div className="iv-summary-row">
                    <span className="iv-summary-lbl">Scheduled</span>
                    <span className="iv-summary-val">
                      {data.interview_scheduled_date}{data.interview_scheduled_time ? ` at ${data.interview_scheduled_time}` : ''}
                    </span>
                  </div>
                )}
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Rubrics Submitted</span>
                  <span className="iv-summary-val" style={{ fontWeight: 700 }}>{data.rubric_count || 0}</span>
                </div>
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Avg Composite</span>
                  <span className="iv-summary-val" style={{ fontWeight: 700, color: 'var(--nightfall)' }}>
                    {data.avg_composite_score > 0 ? `${parseFloat(data.avg_composite_score).toFixed(1)}/15` : '—'}
                  </span>
                </div>
                {data.avg_composite_score > 0 && (
                  <>
                    <div className="iv-summary-row">
                      <span className="iv-summary-lbl">Avg CJ</span>
                      <span className="iv-summary-val">{parseFloat(data.avg_cj_score||0).toFixed(1)}/5</span>
                    </div>
                    <div className="iv-summary-row">
                      <span className="iv-summary-lbl">Avg PP</span>
                      <span className="iv-summary-val">{parseFloat(data.avg_pp_score||0).toFixed(1)}/5</span>
                    </div>
                    <div className="iv-summary-row">
                      <span className="iv-summary-lbl">Avg GA</span>
                      <span className="iv-summary-val">{parseFloat(data.avg_ga_score||0).toFixed(1)}/5</span>
                    </div>
                  </>
                )}
                <div className="iv-summary-row">
                  <span className="iv-summary-lbl">Auto Recommendation</span>
                  <span className="iv-summary-val" style={{ display:'flex', alignItems:'center', gap:4 }}>
                    {data.auto_recommendation
                      ? <>
                          <span className="iv-rec-badge-sm" style={{
                            background: data.auto_recommendation === 'Recommend' ? '#dcfce7' : data.auto_recommendation === 'Recommend with Reservations' ? '#fef3c7' : '#fee2e2',
                            color:      data.auto_recommendation === 'Recommend' ? '#166534' : data.auto_recommendation === 'Recommend with Reservations' ? '#92400e' : '#991b1b',
                          }}>{data.auto_recommendation}</span>
                          <ScoreFlag message={data.score_flag ? data.score_flag_message : ''} />
                        </>
                      : '—'}
                  </span>
                </div>
                {data.flagged_for_second_interview && (
                  <div className="iv-summary-row">
                    <span className="iv-summary-lbl">Flagged</span>
                    <span className="iv-summary-val" style={{ color:'#991b1b', fontWeight:600 }}>
                      🚩 Second Interview{data.flag_note ? ` — ${data.flag_note}` : ''}
                    </span>
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
