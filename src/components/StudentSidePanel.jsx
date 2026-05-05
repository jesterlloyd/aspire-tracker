import { useState, useRef, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import {
  ASPIRE_STATUSES, NGRP_OUTCOMES, INTERVIEW_OUTCOMES,
  SHIFT_OPTIONS, COHORTS,
} from '../lib/constants'
import ConfirmDeleteModal from './ConfirmDeleteModal'

const ACCESS_FIELDS = [
  { key:'access_non_employee',      dateKey:'access_non_employee_date',       label:'Non-Employee Access',   placeholder:'Date' },
  { key:'access_hybrid_student',    dateKey:'access_hybrid_student_date',     label:'Hybrid Student Nurse',  placeholder:'Date' },
  { key:'access_extended_end_date', dateKey:'access_extended_end_date_value', label:'Extended End Date',     placeholder:'New end date' },
  { key:'access_reactivated',       dateKey:'access_reactivated_date',        label:'Reactivated CW Access', placeholder:'Date' },
]

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
  const timerRef        = useRef(null)
  const pendingNameSave = useRef(null)
  const resumeRef       = useRef(null)
  const headshotRef     = useRef(null)

  // Reset data when student changes (prev/next navigation)
  useEffect(() => { setData({ ...student }); setSaveStatus('idle') }, [student.id])

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
    if (!file || file.size > 10*1024*1024) { setResumeMsg('error'); return }
    setUploadingRes(true)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/resume.${ext}`
    const { error } = await supabase.storage.from('student-files').upload(path, file, { upsert:true, contentType:file.type })
    if (error) { setUploadingRes(false); setResumeMsg('error'); return }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    setData(p => ({ ...p, resume_url: url }))
    onUpdate(student.id, { resume_url: url })
    setUploadingRes(false); setResumeMsg('success')
    setTimeout(() => setResumeMsg(null), 3000)
    if (resumeRef.current) resumeRef.current.value = ''
  }
  const handleHeadshotUpload = async file => {
    if (!file || file.size > 5*1024*1024) { setHeadMsg('error'); return }
    setUploadingHead(true)
    const ext  = file.name.split('.').pop()
    const path = `${student.cohort_id}/${student.id}/headshot.${ext}`
    const { error } = await supabase.storage.from('student-files').upload(path, file, { upsert:true, contentType:file.type })
    if (error) { setUploadingHead(false); setHeadMsg('error'); return }
    const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
    const url = urlData.publicUrl
    setData(p => ({ ...p, headshot_url: url }))
    onUpdate(student.id, { headshot_url: url })
    setUploadingHead(false); setHeadMsg('success')
    setTimeout(() => setHeadMsg(null), 3000)
    if (headshotRef.current) headshotRef.current.value = ''
  }

  const participatingUnits = units.filter(u => u.is_participating).map(u => u.unit_name)
  const matchedUnitName    = data.matched_unit_id && units.length > 0
    ? (units.find(u => u.id === data.matched_unit_id)?.unit_name || '—') : '—'

  const accessCount = ACCESS_FIELDS.filter(f => data[f.key]).length
  const accColor = accessCount === 4 ? '#166534' : accessCount === 0 ? '#9ca3af' : '#92400e'
  const accBg    = accessCount === 4 ? '#dcfce7' : accessCount === 0 ? '#f3f4f6' : '#fef3c7'
  const accLabel = accessCount === 4 ? '✓ 4/4 complete' : `${accessCount}/4 complete`

  const initials = `${(student.first_name||'')[0]||''}${(student.last_name||'')[0]||''}`.toUpperCase() || '?'

  return (
    <>
      <div className="sp-container">
        {/* Sticky header */}
        <div className="sp-header">
          <div className="sp-header-left">
            {student.headshot_url
              ? <img src={student.headshot_url} alt="" className="sp-header-avatar" />
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
                  {data.status && <span className={`badge ${{'Form Sent':'badge-gray','Pending Outreach':'badge-pending','Interviewed':'badge-purple','Accepted':'badge-green','Active Rotation':'badge-teal','Completed':'badge-navy','Declined':'badge-red'}[data.status]||'badge-gray'}`}>{data.status}</span>}
                  <select className="sp-select" value={data.status||''} onChange={e => handleSelect('status', e.target.value)}>
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

          {/* 8. CS-Link Access */}
          <div className="sp-section">
            <SectionHeader title="CS-Link Access">
              <span style={{ fontSize:12, fontWeight:600, padding:'1px 8px', borderRadius:4, background:accBg, color:accColor }}>{accLabel}</span>
            </SectionHeader>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {ACCESS_FIELDS.map(f => (
                <div key={f.key} className="sp-access-row">
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:500, flex:1 }}>
                    <input type="checkbox" checked={data[f.key]||false} onChange={e => handleCheck(f.key, e.target.checked)}
                      style={{ accentColor:'var(--nightfall)', width:15, height:15 }} />
                    {f.label}
                  </label>
                  {data[f.key] && (
                    <input className="am-date-input" value={data[f.dateKey]||''} placeholder={f.placeholder}
                      onChange={e => handleText(f.dateKey, e.target.value)} style={{ width:120 }} />
                  )}
                </div>
              ))}
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
                {resumeMsg === 'error'   && <span className="doc-status doc-error">Upload failed.</span>}
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
                {headMsg === 'error'   && <span className="doc-status doc-error">Upload failed.</span>}
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
