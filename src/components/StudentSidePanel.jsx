import { useState, useRef, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { displayName, getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import {
  ASPIRE_STATUSES, ASPIRE_STATUS_CONFIG, NGRP_OUTCOMES, INTERVIEW_OUTCOMES,
  SHIFT_OPTIONS, COHORTS,
} from '../lib/constants'
import ConfirmDeleteModal from './ConfirmDeleteModal'

const CEDARS_STATUS_OPTIONS = [
  { value: 'new',      label: 'New to Cedars-Sinai (no prior rotation or employment)' },
  { value: 'former',   label: 'Former Student or Rotation (has been here before)' },
  { value: 'employee', label: 'Current Cedars-Sinai Employee or Volunteer' },
]

const STAGE1_ACTION_OPTIONS = [
  { value: 'assignment_change', label: 'Assignment Change' },
  { value: 'extend_end_date',   label: 'Extend Project End Date' },
  { value: 'reactivate',        label: 'Reactivate Former Non-Employee' },
]

const STAGE1_ACTION_LABELS = {
  add_non_employee: 'Add Non-Employee',
  assignment_change: 'Assignment Change',
  extend_end_date: 'Extend Project End Date',
  reactivate: 'Reactivate',
  not_applicable: 'Not Applicable',
}

const CS_AFFILIATIONS = ['Current Employee','Former Employee','Volunteer','No prior affiliation']
const CS_WITH_DEPT    = ['Current Employee','Former Employee','Volunteer']
const GENDER_OPTIONS  = ['Male','Female','Non-binary','Prefer not to say','Other']

function SectionHeader({ title, children }) {
  return (
    <div className="sp-section-hdr">
      <span>{title}</span>
      {children}
    </div>
  )
}
function Field({ label, children }) {
  return (
    <div className="sp-field">
      <label className="sp-field-lbl">{label}</label>
      {children}
    </div>
  )
}

export default function StudentSidePanel({
  student, sortedStudents, onSelectStudent, onClose,
  onUpdate, onDelete, units,
}) {
  const [data,          setData]          = useState({ ...student })
  const [saveStatus,    setSaveStatus]    = useState('idle')
  const [showSSN,       setShowSSN]       = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploadingRes,  setUploadingRes]  = useState(false)
  const [uploadingHead, setUploadingHead] = useState(false)
  const [resumeMsg,     setResumeMsg]     = useState(null)
  const [headMsg,       setHeadMsg]       = useState(null)
  const [headshotError, setHeadshotError] = useState(false)
  const timerRef        = useRef(null)
  const pendingNameSave = useRef(null)
  const resumeRef       = useRef(null)
  const headshotRef     = useRef(null)

  // Reset data when student changes (prev/next navigation)
  useEffect(() => { setData({ ...student }); setSaveStatus('idle') }, [student.id])
  useEffect(() => { setHeadshotError(false) }, [data.headshot_url])

  const currentIndex = sortedStudents.findIndex(s => s.id === student.id)
  const prevStudent  = currentIndex > 0 ? sortedStudents[currentIndex - 1] : null
  const nextStudent  = currentIndex < sortedStudents.length - 1 ? sortedStudents[currentIndex + 1] : null

  const doSave = useCallback(async (field, value) => {
    setSaveStatus('saving')
    const err = await onUpdate(student.id, { [field]: value })
    setSaveStatus(err ? 'error' : 'saved')
    if (!err) setTimeout(() => setSaveStatus('idle'), 1800)
  }, [student.id, onUpdate])

  const handleText = (field, value) => {
    setData(p => ({ ...p, [field]: value }))
    setSaveStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 800)
  }
  const handleNameField = (field, value) => {
    setData(prev => {
      const updated = { ...prev, [field]: value }
      updated.name = `${updated.first_name||''} ${updated.last_name||''}`.trim()
      pendingNameSave.current = { first_name: updated.first_name||'', last_name: updated.last_name||'', name: updated.name }
      return updated
    })
    setSaveStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      if (pendingNameSave.current) {
        const err = await onUpdate(student.id, pendingNameSave.current)
        setSaveStatus(err ? 'error' : 'saved')
        if (!err) setTimeout(() => setSaveStatus('idle'), 1800)
        pendingNameSave.current = null
      }
    }, 800)
  }
  const handleSelect = (field, value) => { setData(p => ({ ...p, [field]: value })); doSave(field, value) }
  const handleCheck  = (field, value) => { setData(p => ({ ...p, [field]: value })); doSave(field, value) }
  const handleDecimal = (field, raw) => {
    const value = raw === '' ? null : parseFloat(raw)
    setData(p => ({ ...p, [field]: value }))
    setSaveStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSave(field, value), 800)
  }

  const handleResumeUpload = async file => {
    if (!file || file.size > 10*1024*1024) { setResumeMsg('File too large (max 10 MB)'); return }
    if (!student.id || !student.cohort_id) {
      console.error('Missing student id or cohort_id for resume upload', { id: student.id, cohort_id: student.cohort_id })
      setResumeMsg('Upload failed: student record not found')
      return
    }
    setUploadingRes(true)
    setResumeMsg(null)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/resume.${ext}`
    const { error } = await supabase.storage
      .from('student-files')
      .upload(path, file, { cacheControl: '3600', upsert: true })
    if (error) {
      console.error('Resume upload error:', error)
      setUploadingRes(false)
      setResumeMsg(`Upload failed: ${error.message}`)
      return
    }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    setData(p => ({ ...p, resume_url: url }))
    onUpdate(student.id, { resume_url: url })
    setUploadingRes(false)
    setResumeMsg('success')
    setTimeout(() => setResumeMsg(null), 3000)
    if (resumeRef.current) resumeRef.current.value = ''
  }

  const handleHeadshotUpload = async file => {
    if (!file || file.size > 5*1024*1024) { setHeadMsg('File too large (max 5 MB)'); return }
    if (!student.id || !student.cohort_id) {
      console.error('Missing student id or cohort_id for headshot upload', { id: student.id, cohort_id: student.cohort_id })
      setHeadMsg('Upload failed: student record not found')
      return
    }
    setUploadingHead(true)
    setHeadMsg(null)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/headshot.${ext}`
    const { error } = await supabase.storage
      .from('student-files')
      .upload(path, file, { cacheControl: '3600', upsert: true })
    if (error) {
      console.error('Headshot upload error:', error)
      setUploadingHead(false)
      setHeadMsg(`Upload failed: ${error.message}`)
      return
    }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    setHeadshotError(false)
    // Cache-bust for local display only so browser doesn't serve the old cached image
    setData(p => ({ ...p, headshot_url: `${url}?t=${Date.now()}` }))
    onUpdate(student.id, { headshot_url: url })
    setUploadingHead(false)
    setHeadMsg('success')
    setTimeout(() => setHeadMsg(null), 3000)
    if (headshotRef.current) headshotRef.current.value = ''
  }

  const participatingUnits = units.filter(u => u.is_participating).map(u => u.unit_name)
  const matchedUnitName    = data.matched_unit_id && units.length > 0
    ? (units.find(u => u.id === data.matched_unit_id)?.unit_name || '—') : '—'

  const csStatus    = getCsLinkStatus(data)
  const csStatusCfg = CS_LINK_STATUS_CONFIG[csStatus]

  const initials = `${(student.first_name||'')[0]||''}${(student.last_name||'')[0]||''}`.toUpperCase() || '?'

  return (
    <>
      <div className="sp-container">
        {/* Sticky header */}
        <div className="sp-header">
          <div className="sp-header-left">
            {data.headshot_url && !headshotError
              ? <img src={data.headshot_url} alt={`${student.first_name} ${student.last_name}`} className="sp-header-avatar"
                  onError={() => setHeadshotError(true)} />
              : <div className="sp-header-initials">{initials}</div>
            }
            <div>
              <div className="sp-header-name">{displayName(student)}</div>
              <div className="sp-header-school">{student.school}</div>
            </div>
          </div>
          <div className="sp-header-right">
            <span className={`sp-save-status${saveStatus !== 'idle' ? ' sp-save-visible' : ''}`}>
              {saveStatus === 'saving' && '…'}
              {saveStatus === 'saved'  && '✓ Saved'}
              {saveStatus === 'error'  && '✗ Error'}
            </span>
            <button className="sp-close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="sp-content">

          {/* 1. Contact Information */}
          <div className="sp-section">
            <SectionHeader title="Contact Information" />
            <Field label="School Email">
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <div className="sp-readonly">{data.school_email || '—'}</div>
                {data.school_email && (
                  <button className="sp-copy-btn" onClick={() => navigator.clipboard?.writeText(data.school_email)} title="Copy">⎘</button>
                )}
              </div>
            </Field>
            {data.status === 'Form Received' && data.school_email && (
              <div style={{ marginTop:8 }}>
                <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px' }}
                  onClick={() => {
                    const subject = 'Schedule Your ASPIRE Interview'
                    const body = `Dear ${data.first_name || 'ASPIRE Student'},\n\nThank you for completing your ASPIRE Student Profile. The next step in the process is to schedule your interview with the Nursing Professional Development team.\n\nPlease use the link below to view available times and select one that works for your schedule:\n\nhttps://aspire-tracker.vercel.app/interview-schedule\n\nWhen prompted, enter your school email address to access your scheduling page.\n\nYour interview will be conducted via Microsoft Teams. The meeting link will be sent to you separately after you book your slot.\n\nIf you have any questions, please don't hesitate to reach out.\n\nWarm regards,\nJester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN\nBrawerman Nursing Institute | Cedars-Sinai Medical Center\nJesterLloyd.Bautista@cshs.org | 310-248-8964`
                    const a = document.createElement('a')
                    a.href = `mailto:${encodeURIComponent(data.school_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
                    a.click()
                  }}>
                  ✉ Send Scheduling Link
                </button>
              </div>
            )}
            <Field label="Personal Email">
              <input className="sp-input" value={data.personal_email||''} onChange={e => handleText('personal_email', e.target.value)} />
            </Field>
            <Field label="Phone">
              <input className="sp-input" value={data.phone||''} onChange={e => handleText('phone', e.target.value)} />
            </Field>
          </div>

          {/* 2. Program Details */}
          <div className="sp-section">
            <SectionHeader title="Program Details" />
            <div className="sp-grid-2">
              <Field label="School"><div className="sp-readonly">{data.school||'—'}</div></Field>
              <Field label="Program Type"><div className="sp-readonly">{data.program_type||'—'}</div></Field>
              <Field label="Term Dates"><div className="sp-readonly">{data.term_dates||'—'}</div></Field>
              <Field label="Hours Required">
                <input className="sp-input" type="text" inputMode="numeric" pattern="[0-9]*"
                  value={data.hours_required??''} onChange={e => handleText('hours_required', e.target.value)} />
              </Field>
              <Field label="Est. Graduation"><div className="sp-readonly">{data.estimated_graduation||'—'}</div></Field>
            </div>
          </div>

          {/* 3. Personal Information */}
          <div className="sp-section">
            <SectionHeader title="Personal Information" />
            <div className="sp-grid-2">
              <Field label="First Name">
                <input className="sp-input" value={data.first_name||''} onChange={e => handleNameField('first_name', e.target.value)} />
              </Field>
              <Field label="Last Name">
                <input className="sp-input" value={data.last_name||''} onChange={e => handleNameField('last_name', e.target.value)} />
              </Field>
              <Field label="Date of Birth">
                <input className="sp-input" type="date" value={data.date_of_birth||''} onChange={e => handleText('date_of_birth', e.target.value)} />
              </Field>
              <Field label="Last 4 SSN">
                <div style={{ display:'flex', gap:6 }}>
                  <input className="sp-input" type={showSSN ? 'text' : 'password'} maxLength={4}
                    value={data.ssn_last4||''} onChange={e => handleText('ssn_last4', e.target.value.replace(/\D/g,'').slice(0,4))} />
                  <button className="btn-clear" style={{ fontSize:11, padding:'4px 8px' }} onClick={() => setShowSSN(p => !p)}>
                    {showSSN ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>
              <Field label="Gender">
                <select className="sp-select" value={data.gender||''} onChange={e => handleSelect('gender', e.target.value)}>
                  <option value="">Select…</option>
                  {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              <Field label="Cumulative GPA">
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input className="sp-input" type="text" inputMode="decimal" pattern="[0-9.]*"
                    style={{ maxWidth:80 }} value={data.cumulative_gpa??''} placeholder="0.00"
                    onChange={e => handleDecimal('cumulative_gpa', e.target.value)} />
                  {data.cumulative_gpa != null && (
                    <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
                      {parseFloat(data.cumulative_gpa).toFixed(2)} / 4.0
                    </span>
                  )}
                </div>
              </Field>
              <Field label="Shift Preference">
                <select className="sp-select" value={data.shift_availability||''} onChange={e => handleSelect('shift_availability', e.target.value)}>
                  <option value="">Select…</option>
                  {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* 4. Background and Affiliation */}
          <div className="sp-section">
            <SectionHeader title="Background and Affiliation" />
            <Field label="Prior Healthcare Experience">
              <input className="sp-input" value={data.prior_healthcare_experience||''} onChange={e => handleText('prior_healthcare_experience', e.target.value)} placeholder="e.g. CNA, EMT" />
            </Field>
            <Field label="CS Affiliation">
              <select className="sp-select" value={data.cs_affiliation||''} onChange={e => handleSelect('cs_affiliation', e.target.value)}>
                <option value="">Select…</option>
                {CS_AFFILIATIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            {CS_WITH_DEPT.includes(data.cs_affiliation) && (
              <div className="sp-grid-2">
                <Field label="CS Department">
                  <input className="sp-input" value={data.cs_department||''} onChange={e => handleText('cs_department', e.target.value)} />
                </Field>
                <Field label="CS Role / Job Title">
                  <input className="sp-input" value={data.cs_role||''} onChange={e => handleText('cs_role', e.target.value)} />
                </Field>
              </div>
            )}
          </div>

          {/* 5. Interest Statement */}
          <div className="sp-section">
            <SectionHeader title="Interest Statement" />
            {data.interest_statement
              ? <div className="sr-interest-block">{data.interest_statement}</div>
              : <p style={{ fontSize:14, color:'#9ca3af', fontStyle:'italic' }}>Not yet submitted.</p>
            }
          </div>

          {/* 6. Unit Preferences */}
          <div className="sp-section">
            <SectionHeader title="Unit Preferences" />
            <div className="sp-grid-3">
              {['unit_preference_1','unit_preference_2','unit_preference_3'].map((f,i) => (
                <Field key={f} label={`Preference ${i+1}`}>
                  <select className="sp-select" value={data[f]||''} onChange={e => handleSelect(f, e.target.value)}>
                    <option value="">Not specified</option>
                    {participatingUnits.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </div>

          {/* 7. Placement and Outcomes */}
          <div className="sp-section">
            <SectionHeader title="Placement and Outcomes" />
            <div className="sp-grid-2">
              <Field label="ASPIRE Status">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.status && (() => { const cfg = ASPIRE_STATUS_CONFIG[data.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']; return <span style={{ fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, alignSelf:'flex-start' }}>{data.status}</span> })()}
                  <select className="sp-select" value={data.status||''} onChange={e => handleSelect('status', e.target.value)}>
                    <option value="">Select status…</option>
                    {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Interview Outcome">
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {data.interview_outcome && (
                    <span className={`interview-pill ${ data.interview_outcome === 'Accepted' ? 'pill-green' : data.interview_outcome === 'Accepted with Reservations' ? 'pill-yellow' : data.interview_outcome === 'Declined' ? 'pill-red' : 'pill-gray' }`}>{data.interview_outcome}</span>
                  )}
                  <select className="sp-select" value={data.interview_outcome||''} onChange={e => handleSelect('interview_outcome', e.target.value)}>
                    {INTERVIEW_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Matched Unit"><div className="sp-readonly">{matchedUnitName}</div></Field>
              <Field label="Matched Preceptor">
                <input className="sp-input" value={data.matched_preceptor||''} onChange={e => handleText('matched_preceptor', e.target.value)} placeholder="Assign preceptor…" />
              </Field>
              <Field label="NGRP Cohort Target">
                <input className="sp-input" value={data.ngrp_cohort_target||''} onChange={e => handleText('ngrp_cohort_target', e.target.value)} placeholder="e.g. Spring 2027" />
              </Field>
              <Field label="NGRP Outcome">
                <select className="sp-select" value={data.ngrp_outcome||''} onChange={e => handleSelect('ngrp_outcome', e.target.value)}>
                  {NGRP_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* 8. CS-Link Access Workflow */}
          <div className="sp-section">
            <SectionHeader title="CS-Link Access">
              <span style={{ fontSize:11, fontWeight:600, padding:'2px 9px', borderRadius:20, background:csStatusCfg.bg, color:csStatusCfg.text }}>
                {csStatusCfg.label}
              </span>
            </SectionHeader>

            {/* Step 1: Cedars-Sinai History */}
            <div className="csw-step">
              <div className="csw-step-label">Step 1: Cedars-Sinai Status</div>
              <select className="sp-select" value={data.cs_cedars_status||''}
                onChange={e => {
                  const v = e.target.value
                  const extras = v === 'employee'
                    ? { cs_stage1_action:'not_applicable', cs_stage1_submitted:true, cs_stage1_complete:true }
                    : v === 'new'
                    ? { cs_stage1_action:'add_non_employee', cs_stage1_submitted:false, cs_stage1_complete:false }
                    : { cs_stage1_action:'', cs_stage1_submitted:false, cs_stage1_complete:false }
                  setData(p => ({ ...p, cs_cedars_status:v, ...extras }))
                  onUpdate(student.id, { cs_cedars_status:v, ...extras })
                }}>
                <option value="">Select status…</option>
                {CEDARS_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Step 2: Stage 1 Action */}
            {data.cs_cedars_status && (
              <div className={`csw-step${!data.cs_cedars_status ? ' csw-step-dim' : ''}`}>
                <div className="csw-step-label">Step 2: Service Center Request</div>

                {data.cs_cedars_status === 'employee' && (
                  <div className="csw-info-green">Stage 1 not required. Current Cedars-Sinai employees already have a worker record. Proceed directly to adding CS-Link access.</div>
                )}

                {data.cs_cedars_status === 'new' && (
                  <>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', marginBottom:8 }}>Add Non-Employee</div>
                    <p className="csw-note">Submit an Add Non-Employee request in the Service Center for this student.</p>
                    <div className="csw-check-row">
                      <label className="csw-check-label">
                        <input type="checkbox" checked={data.cs_stage1_submitted||false}
                          onChange={e => { handleCheck('cs_stage1_submitted', e.target.checked) }}
                          style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                        Submitted to Service Center
                      </label>
                      {data.cs_stage1_submitted && (
                        <input className="csw-date-input" value={data.cs_stage1_submitted_date||''}
                          placeholder="Date" onChange={e => handleText('cs_stage1_submitted_date', e.target.value)} />
                      )}
                    </div>
                  </>
                )}

                {data.cs_cedars_status === 'former' && (
                  <>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', marginBottom:8 }}>Update Non-Employee</div>
                    <Field label="Request Type:">
                      <select className="sp-select" value={data.cs_stage1_action||''}
                        onChange={e => handleSelect('cs_stage1_action', e.target.value)}>
                        <option value="">Select type…</option>
                        {STAGE1_ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <div className="csw-check-row">
                      <label className="csw-check-label">
                        <input type="checkbox" checked={data.cs_stage1_submitted||false}
                          onChange={e => handleCheck('cs_stage1_submitted', e.target.checked)}
                          style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                        Submitted to Service Center
                      </label>
                      {data.cs_stage1_submitted && (
                        <input className="csw-date-input" value={data.cs_stage1_submitted_date||''}
                          placeholder="Date" onChange={e => handleText('cs_stage1_submitted_date', e.target.value)} />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 3: Account Active Confirmation */}
            {(data.cs_stage1_submitted || data.cs_cedars_status === 'employee') && (
              <div className="csw-step">
                <div className="csw-step-label">Step 3: Contingent Worker Account Active</div>
                {data.cs_cedars_status === 'employee' ? (
                  <div className="csw-info-gray">Not applicable for current employees.</div>
                ) : (
                  <>
                    <div className="csw-check-row">
                      <label className="csw-check-label">
                        <input type="checkbox" checked={data.cs_stage1_complete||false}
                          onChange={e => handleCheck('cs_stage1_complete', e.target.checked)}
                          style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                        Account is active in the system
                      </label>
                      {data.cs_stage1_complete && (
                        <input className="csw-date-input" value={data.cs_stage1_complete_date||''}
                          placeholder="Date" onChange={e => handleText('cs_stage1_complete_date', e.target.value)} />
                      )}
                    </div>
                    <p className="csw-note">Confirm the Service Center request was processed and the student's account is active before adding CS-Link.</p>
                  </>
                )}
              </div>
            )}

            {/* Step 4: CS-Link Access */}
            {(data.cs_stage1_complete || data.cs_cedars_status === 'employee') && (
              <div className="csw-step">
                <div className="csw-step-label">Step 4: Add CS-Link Access</div>
                <div className="csw-check-row">
                  <label className="csw-check-label">
                    <input type="checkbox" checked={data.cs_link_requested||false}
                      onChange={e => handleCheck('cs_link_requested', e.target.checked)}
                      style={{ accentColor:'var(--nightfall)', width:14, height:14 }} />
                    CS-Link access requested
                  </label>
                  {data.cs_link_requested && (
                    <input className="csw-date-input" value={data.cs_link_requested_date||''}
                      placeholder="Date" onChange={e => handleText('cs_link_requested_date', e.target.value)} />
                  )}
                </div>
                {data.cs_link_requested && (
                  <div className="csw-check-row" style={{ marginTop:6 }}>
                    <label className="csw-check-label">
                      <input type="checkbox" checked={data.cs_link_complete||false}
                        onChange={e => handleCheck('cs_link_complete', e.target.checked)}
                        style={{ accentColor:'#16a34a', width:14, height:14 }} />
                      CS-Link confirmed active and working
                    </label>
                    {data.cs_link_complete && (
                      <input className="csw-date-input" value={data.cs_link_complete_date||''}
                        placeholder="Date" onChange={e => handleText('cs_link_complete_date', e.target.value)} />
                    )}
                  </div>
                )}
                <p className="csw-note">Only mark as complete once the student has confirmed their CS-Link access is working.</p>
                {data.cs_link_complete && (
                  <div className="csw-success-banner">✓ Access setup complete for this student.</div>
                )}
              </div>
            )}

            {/* Notes */}
            <div style={{ marginTop:12 }}>
              <Field label="Access Notes">
                <textarea className="sp-textarea" rows={2} value={data.cs_access_notes||''}
                  onChange={e => handleText('cs_access_notes', e.target.value)} placeholder="Add notes…" />
              </Field>
            </div>
          </div>

          {/* 9. Documents */}
          <div className="sp-section">
            <SectionHeader title="Documents" />
            <div className="doc-section">
              <div className="doc-upload-area">
                <div className="doc-area-label">Resume</div>
                <input ref={resumeRef} type="file" style={{ display:'none' }} accept=".pdf,.doc,.docx"
                  onChange={e => handleResumeUpload(e.target.files[0])} />
                {data.resume_url ? (
                  <div className="doc-existing-file">
                    <a className="doc-file-link" href={data.resume_url} target="_blank" rel="noopener noreferrer">
                      {decodeURIComponent(data.resume_url.split('/').pop()?.split('?')[0] || 'Resume')}
                    </a>
                    <button className="doc-replace-btn" disabled={uploadingRes} onClick={() => resumeRef.current?.click()}>Replace</button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => resumeRef.current?.click()}>
                    <span className="doc-zone-icon">📄</span>
                    <span className="doc-zone-text">Upload Resume (PDF/Word, max 10MB)</span>
                    <button type="button" className="doc-zone-btn" onClick={e => { e.stopPropagation(); resumeRef.current?.click() }}>Choose File</button>
                  </div>
                )}
                {uploadingRes && <span className="doc-status doc-uploading">Uploading…</span>}
                {resumeMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded</span>}
                {resumeMsg && resumeMsg !== 'success' && <span className="doc-status doc-error" style={{ color:'var(--cs-red)' }}>{resumeMsg}</span>}
              </div>
              <div className="doc-upload-area">
                <div className="doc-area-label">Headshot</div>
                <input ref={headshotRef} type="file" style={{ display:'none' }} accept=".jpg,.jpeg,.png"
                  onChange={e => handleHeadshotUpload(e.target.files[0])} />
                {data.headshot_url ? (
                  <div className="doc-existing-file">
                    <img src={data.headshot_url} alt="Headshot" className="doc-headshot-preview" />
                    <button className="doc-replace-btn" disabled={uploadingHead} onClick={() => headshotRef.current?.click()}>Replace</button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => headshotRef.current?.click()}>
                    <span className="doc-zone-icon">🖼</span>
                    <span className="doc-zone-text">Upload Headshot (JPG/PNG, max 5MB)</span>
                    <button type="button" className="doc-zone-btn" onClick={e => { e.stopPropagation(); headshotRef.current?.click() }}>Choose File</button>
                  </div>
                )}
                {uploadingHead && <span className="doc-status doc-uploading">Uploading…</span>}
                {headMsg === 'success' && <span className="doc-status doc-success">✓ Uploaded</span>}
                {headMsg && headMsg !== 'success' && <span className="doc-status doc-error" style={{ color:'var(--cs-red)' }}>{headMsg}</span>}
              </div>
            </div>
          </div>

          {/* 10. Notes */}
          <div className="sp-section">
            <SectionHeader title="Notes" />
            <textarea className="sp-textarea" rows={4} value={data.notes||''} onChange={e => handleText('notes', e.target.value)} placeholder="Add notes…" />
          </div>

          {/* Delete */}
          <div style={{ padding:'16px', borderTop:'1px solid var(--border-lt)' }}>
            <button className="btn btn-destructive" onClick={() => setConfirmDelete(true)}>Delete Student</button>
          </div>

          {/* Prev / Next */}
          <div className="sp-nav-row">
            <button className="sp-nav-btn" disabled={!prevStudent} onClick={() => prevStudent && onSelectStudent(prevStudent.id)}>
              ← {prevStudent ? displayName(prevStudent) : 'No previous'}
            </button>
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
              {currentIndex + 1} / {sortedStudents.length}
            </span>
            <button className="sp-nav-btn" disabled={!nextStudent} onClick={() => nextStudent && onSelectStudent(nextStudent.id)}>
              {nextStudent ? displayName(nextStudent) : 'No next'} →
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDeleteModal
          title={`Delete ${displayName(student)}?`}
          warning="This action cannot be undone. Any match assignments for this student will also be cleared."
          onConfirm={() => { setConfirmDelete(false); onDelete(student.id); onClose() }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
