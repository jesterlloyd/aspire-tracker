import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { PATIENT_POPULATION_MAP, UNITS_BY_DIVISION } from '../lib/constants'

// ── Domain data ──────────────────────────────────────────────
const CJ_QUESTIONS = [
  'Tell me about a clinical situation where you had to make a quick decision. What happened, and what did you do?',
  "Describe a time when a patient's condition changed suddenly. How did you recognize it, and what actions did you take?",
  'If two patients need attention at once, one is anxious and in pain, and the other has abnormal vital signs, how would you decide what to do first?',
  'Tell me about a time you noticed something concerning in a clinical setting. What did you do, and what was the outcome?',
  "What do you pay attention to first when you walk into a patient's room, and why?",
]
const PP_QUESTIONS = [
  'Tell me about a time you received difficult feedback in clinicals. How did you handle it?',
  'Describe a situation where you had to work with someone who had a different communication style. How did you adapt?',
  'What do you do when you feel overwhelmed or unsure during a clinical shift?',
  "Can you share one of the biggest challenges you've faced during nursing school and how you navigated it?",
  'Tell me about a time you had to advocate for a patient or speak up during clinical.',
]
const GA_QUESTIONS = [
  'What are your learning goals for this rotation, and how do they connect to your future plans?',
  'Tell me what type of unit or preceptor helps you learn best, and why.',
  'How do you see this ASPIRE experience preparing you for your first nursing job?',
  'What drew you to Cedars-Sinai for your senior preceptorship, and how do you see this experience supporting your growth as a nurse?',
  'What personal strengths or qualities do you bring that make you a good fit for the ASPIRE Program?',
]
const DOMAIN_QUESTIONS = { cj: CJ_QUESTIONS, pp: PP_QUESTIONS, ga: GA_QUESTIONS }

const DOMAIN_REF = {
  cj: { desc:'Ability to observe, interpret, prioritize, and respond to patient needs using integrated clinical knowledge and critical thinking.', basis:"Tanner's Clinical Judgment Model and Benner's Novice to Expert framework.", listen:'Patient safety awareness, prioritization, logical reasoning, situational awareness.' },
  pp: { desc:'Demonstrates professional behavior, emotional intelligence, and readiness to function as part of a healthcare team.', basis:'QSEN competencies for teamwork, communication, and patient-centered care.', listen:'Self-reflection, receptiveness to feedback, professionalism under stress, accountability.' },
  ga: { desc:"Alignment of the student's learning goals, career intentions, and values with the ASPIRE Program's mission.", basis:"Cedars-Sinai's Nursing Professional Practice Model and the ASPIRE Program's mission.", listen:'Clarity of purpose, motivation for ASPIRE, learning goals, cultural fit, post-graduation plans.' },
}
const SCORE_LABELS = ['','Not Yet Ready','Emerging','Competent','Strong','Highly Aligned']
const SCORE_COLORS = [null,
  { bg:'#fee2e2', color:'#991b1b', border:'#991b1b' },
  { bg:'#fef3c7', color:'#92400e', border:'#92400e' },
  { bg:'#e0f2fe', color:'#0369a1', border:'#0369a1' },
  { bg:'#dcfce7', color:'#166534', border:'#166534' },
  { bg:'#1d2567', color:'#ffffff', border:'#1d2567' },
]
const REC_OPTIONS = [
  { value:'Recommend',                     label:'Recommend',                     bg:'#dcfce7', color:'#166534', border:'#a7f3d0' },
  { value:'Recommend with Reservations',   label:'Recommend with Reservations',   bg:'#fef3c7', color:'#92400e', border:'#fde68a' },
  { value:'Do Not Recommend at This Time', label:'Do Not Recommend at This Time', bg:'#fee2e2', color:'#991b1b', border:'#fecaca' },
]

const initForm = () => ({
  interview_date: new Date().toISOString().slice(0,10),
  interviewer_name: '', interview_time: '',
  unit_preferences_rationale: '',
  cj_question_asked:'', cj_score:0, cj_notes:'',
  pp_question_asked:'', pp_score:0, pp_notes:'',
  ga_question_asked:'', ga_score:0, ga_notes:'',
  student_questions: '',
  individual_recommendation:'', suggested_unit:'', summary_comments:'',
  composite_score: 0, status:'In Progress',
})

const ALL_UNITS = Object.values(UNITS_BY_DIVISION).flat()

// ── Helpers ──────────────────────────────────────────────────
const getAutoRec = avg => {
  if (avg >= 12)  return 'Recommend'
  if (avg >= 8)   return 'Recommend with Reservations'
  return 'Do Not Recommend at This Time'
}
const getInterviewOutcome = avg => {
  if (avg >= 12) return 'Accepted'
  if (avg >= 8)  return 'Accepted with Reservations'
  return 'Declined'
}

// ── Recalculate student averages from fresh DB fetch ─────────
async function recalculateStudentAverages(studentId, supabase) {
  const { data: rubrics, error } = await supabase
    .from('interview_rubrics')
    .select('cj_score, pp_score, ga_score, composite_score')
    .eq('student_id', studentId)
    .eq('status', 'Completed')

  if (error || !rubrics || rubrics.length === 0) return null

  const count        = rubrics.length
  const avgCj        = rubrics.reduce((sum, r) => sum + (r.cj_score        || 0), 0) / count
  const avgPp        = rubrics.reduce((sum, r) => sum + (r.pp_score        || 0), 0) / count
  const avgGa        = rubrics.reduce((sum, r) => sum + (r.ga_score        || 0), 0) / count
  const avgComposite = rubrics.reduce((sum, r) => sum + (r.composite_score || 0), 0) / count

  let autoRec         = 'Do Not Recommend at This Time'
  let interviewOutcome = 'Declined'
  if (avgComposite >= 12) {
    autoRec = 'Recommend'; interviewOutcome = 'Accepted'
  } else if (avgComposite >= 8) {
    autoRec = 'Recommend with Reservations'; interviewOutcome = 'Accepted with Reservations'
  }

  return {
    avg_cj_score:        Math.round(avgCj        * 100) / 100,
    avg_pp_score:        Math.round(avgPp        * 100) / 100,
    avg_ga_score:        Math.round(avgGa        * 100) / 100,
    avg_composite_score: Math.round(avgComposite * 100) / 100,
    rubric_count:        count,
    auto_recommendation: autoRec,
    interview_outcome:   interviewOutcome,
  }
}

// ── Editable rubric card in the consolidated view ────────────
function RubricCard({ r, interviewers, onSave }) {
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [editForm, setEditForm] = useState({
    interviewer_name:         r.interviewer_name || '',
    cj_score:                 r.cj_score || 0,
    pp_score:                 r.pp_score || 0,
    ga_score:                 r.ga_score || 0,
    individual_recommendation: r.individual_recommendation || '',
    summary_comments:         r.summary_comments || '',
  })

  const comp = (r.cj_score||0) + (r.pp_score||0) + (r.ga_score||0)
  const rec = r.individual_recommendation
  const recColor = rec === 'Recommend' ? '#166534' : rec === 'Recommend with Reservations' ? '#92400e' : rec ? '#991b1b' : null
  const recBg    = rec === 'Recommend' ? '#dcfce7' : rec === 'Recommend with Reservations' ? '#fef3c7' : rec ? '#fee2e2' : null

  const scoreRow = (domain, label, color) => {
    const field = `${domain}_score`
    return (
      <div>
        <div style={{ fontSize:11, fontWeight:600, color, marginBottom:4 }}>{label}</div>
        <div style={{ display:'flex', gap:4 }}>
          {[1,2,3,4,5].map(n => {
            const sel = editForm[field] === n
            return (
              <div key={n} onClick={() => setEditForm(p => ({ ...p, [field]: n }))}
                style={{ width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center',
                  borderRadius:4, border:`1.5px solid ${sel ? color : '#d1d5db'}`,
                  background: sel ? color : '#fff', color: sel ? '#fff' : '#191919',
                  fontSize:13, fontWeight:700, cursor:'pointer', flexShrink:0 }}>
                {n}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave(r.id, editForm)
    setSaving(false)
    setEditing(false)
  }

  const handleCancel = () => {
    setEditForm({
      interviewer_name:         r.interviewer_name || '',
      cj_score:                 r.cj_score || 0,
      pp_score:                 r.pp_score || 0,
      ga_score:                 r.ga_score || 0,
      individual_recommendation: r.individual_recommendation || '',
      summary_comments:         r.summary_comments || '',
    })
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="rub-rubric-card">
        <div className="rub-rc-top">
          <span className="rub-rc-name">{r.interviewer_name || 'Unknown'}</span>
          <span className="rub-rc-date">{r.interview_date}</span>
          <span className="rub-rc-score">{comp}/15</span>
          {rec && recColor && <span style={{ fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:4, background:recBg, color:recColor }}>{rec}</span>}
          <button className="btn btn-outline-modal"
            style={{ fontSize:11, padding:'2px 10px', marginLeft:'auto', flexShrink:0 }}
            onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <div className="rub-rc-scores">
          <span>CJ: {r.cj_score||0}/5</span>
          <span>PP: {r.pp_score||0}/5</span>
          <span>GA: {r.ga_score||0}/5</span>
        </div>
        {r.summary_comments && <p className="rub-rc-comments">{r.summary_comments}</p>}
      </div>
    )
  }

  return (
    <div className="rub-rubric-card" style={{ background:'#f9fafb', border:'1.5px solid var(--nova)', gap:10 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>Interviewer</div>
          <select className="iv-input" style={{ fontSize:12, padding:'4px 8px', width:'100%' }}
            value={editForm.interviewer_name}
            onChange={e => setEditForm(p => ({ ...p, interviewer_name: e.target.value }))}>
            <option value="">—</option>
            {interviewers.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>Recommendation</div>
          <select className="iv-input" style={{ fontSize:12, padding:'4px 8px', width:'100%' }}
            value={editForm.individual_recommendation}
            onChange={e => setEditForm(p => ({ ...p, individual_recommendation: e.target.value }))}>
            <option value="">—</option>
            {REC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display:'flex', gap:16, marginBottom:10, flexWrap:'wrap' }}>
        {scoreRow('cj', 'CJ Score', '#1d2567')}
        {scoreRow('pp', 'PP Score', '#0d7a8a')}
        {scoreRow('ga', 'GA Score', '#166534')}
      </div>
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>Summary Comments</div>
        <textarea className="iv-textarea iv-notes-textarea" rows={3} style={{ fontSize:12 }}
          value={editForm.summary_comments}
          onChange={e => setEditForm(p => ({ ...p, summary_comments: e.target.value }))}
          placeholder="Summary comments…" />
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-primary" style={{ fontSize:12, padding:'5px 14px' }}
          onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 14px' }}
          onClick={handleCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function RubricSession({ student, rubrics, cohortId, onBack, onStudentUpdate, onRubricsChange }) {
  const [form,           setForm]           = useState(initForm())
  const [rubricId,       setRubricId]       = useState(null)
  const [interviewers,   setInterviewers]   = useState([])
  const [availUnits,     setAvailUnits]     = useState([])
  const [saveStatus,     setSaveStatus]     = useState('idle')
  const [confirmComplete,setConfirmComplete]= useState(false)
  const [confirmReset,   setConfirmReset]   = useState(false)
  const [confirmUnlock,  setConfirmUnlock]  = useState(false)
  const [refOpen,        setRefOpen]        = useState({ cj:false, pp:false, ga:false })
  const [scriptOpen,     setScriptOpen]     = useState(false)
  const [legendOpen,     setLegendOpen]     = useState(false)
  const [closingOpen,    setClosingOpen]    = useState(false)
  const [flagging,       setFlagging]       = useState(false)
  const [flagNote,       setFlagNote]       = useState(student.flag_note || '')
  const [isFlagged,      setIsFlagged]      = useState(!!student.flagged_for_second_interview)
  const [prefs, setPrefs] = useState({
    unit_preference_1: student.unit_preference_1 || '',
    unit_preference_2: student.unit_preference_2 || '',
    unit_preference_3: student.unit_preference_3 || '',
  })
  const timerRef = useRef(null)

  // Tracks which domains are in "Other / Custom" mode per rubric instance
  const [otherClicked,   setOtherClicked]   = useState({ cj: false, pp: false, ga: false })
  const [headshotError,  setHeadshotError]  = useState(false)

  useEffect(() => { setHeadshotError(false) }, [student.headshot_url])

  // Rubrics for this student
  const studentRubrics  = rubrics.filter(r => r.student_id === student.id)
  const completedRubrics = studentRubrics.filter(r => r.status === 'Completed')

  useEffect(() => {
    supabase.from('interviewers').select('name').eq('is_active', true).order('name')
      .then(({ data }) => setInterviewers((data || []).map(i => i.name)))
    supabase.from('units').select('unit_name').eq('is_participating', true).eq('cohort_id', cohortId).order('unit_name')
      .then(({ data }) => setAvailUnits((data || []).map(u => u.unit_name)))
  }, [cohortId])


  // When interviewer_name changes, try to load their existing rubric
  const handleInterviewerChange = async (name) => {
    if (name) {
      const existing = studentRubrics.find(r => r.interviewer_name === name && r.status !== 'Completed')
      if (existing) {
        setForm(existing); setRubricId(existing.id); return
      }
    }
    setForm(p => ({ ...p, interviewer_name: name }))
    setRubricId(null)
    // Selecting an interviewer is a meaningful action — create record immediately
    if (name) persist({ interviewer_name: name }, true)
  }

  const composite = (form.cj_score || 0) + (form.pp_score || 0) + (form.ga_score || 0)

  // createIfNeeded=false: only update existing record, never create
  // createIfNeeded=true:  create record on first meaningful edit
  const persist = async (updates, createIfNeeded = false) => {
    setSaveStatus('saving')
    const payload = { ...updates, composite_score: (updates.cj_score ?? (form.cj_score || 0)) + (updates.pp_score ?? (form.pp_score || 0)) + (updates.ga_score ?? (form.ga_score || 0)), updated_at: new Date().toISOString() }
    let id = rubricId
    if (!id) {
      if (!createIfNeeded || !form.interviewer_name) { setSaveStatus('idle'); return }
      const { data, error } = await supabase.from('interview_rubrics').insert({
        student_id: student.id, cohort_id: cohortId, ...initForm(), ...form, ...payload,
      }).select().single()
      if (error) { setSaveStatus('idle'); return }
      id = data.id; setRubricId(id)
    } else {
      await supabase.from('interview_rubrics').update(payload).eq('id', id)
    }
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 1800)
    if (onRubricsChange) onRubricsChange()
  }

  // Debounced save — never creates a new record
  const saveText = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => persist({ [field]: value }, false), 800)
  }
  // Immediate non-creating save (date, time, etc.)
  const saveImmediate = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    persist({ [field]: value }, false)
  }
  // Immediate save for meaningful edits — creates record if first interaction
  const saveMeaningful = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    persist({ [field]: value }, true)
  }
  const savePreference = async (field, value) => {
    setPrefs(p => ({ ...p, [field]: value }))
    await onStudentUpdate(student.id, { [field]: value })
  }

  const handleMarkComplete = async () => {
    setConfirmComplete(false)
    await persist({ ...form, status:'Completed', composite_score: composite })
    setForm(p => ({ ...p, status:'Completed', composite_score: composite }))
    // Fetch all completed rubrics fresh from DB so stale local state can never affect the result
    const recalc = await recalculateStudentAverages(student.id, supabase)
    if (recalc) {
      await onStudentUpdate(student.id, { ...recalc, status: 'Interviewed' })
    }
  }

  const handleReset = async () => {
    setConfirmReset(false)
    const blank = { ...initForm(), interviewer_name: form.interviewer_name, interview_date: form.interview_date }
    if (rubricId) await supabase.from('interview_rubrics').update({ ...blank, updated_at: new Date().toISOString() }).eq('id', rubricId)
    setForm(blank)
    if (onRubricsChange) onRubricsChange()
  }

  const handleUnlock = async () => {
    setConfirmUnlock(false)
    if (rubricId) await supabase.from('interview_rubrics').update({ status:'In Progress', updated_at: new Date().toISOString() }).eq('id', rubricId)
    setForm(p => ({ ...p, status:'In Progress' }))
    if (onRubricsChange) onRubricsChange()
  }

  const handleFlag = async () => {
    setIsFlagged(true); setFlagging(false)
    await onStudentUpdate(student.id, { flagged_for_second_interview: true, flag_note: flagNote })
  }
  const handleUnflag = async () => {
    setIsFlagged(false)
    await onStudentUpdate(student.id, { flagged_for_second_interview: false, flag_note: '' })
  }

  const handleRubricEdit = async (rubricId, updates) => {
    const composite = (updates.cj_score||0) + (updates.pp_score||0) + (updates.ga_score||0)
    await supabase.from('interview_rubrics')
      .update({ ...updates, composite_score: composite, updated_at: new Date().toISOString() })
      .eq('id', rubricId)
    if (onRubricsChange) onRubricsChange()
    // Fetch all completed rubrics fresh from DB so stale local state can never affect the result
    const recalc = await recalculateStudentAverages(student.id, supabase)
    if (recalc) {
      await onStudentUpdate(student.id, recalc)
    }
  }

  const locked = form.status === 'Completed'

  // Progress steps fill state
  const steps = [
    { id:'s1', label:'Info',         filled: !!(form.interview_date && form.interviewer_name) },
    { id:'s2', label:'Preferences',  filled: !!(prefs.unit_preference_1) },
    { id:'s3', label:'Clinical',     filled: form.cj_score > 0 },
    { id:'s4', label:'Professional', filled: form.pp_score > 0 },
    { id:'s5', label:'Goal',         filled: form.ga_score > 0 },
    { id:'s6', label:'Questions',    filled: false },
    { id:'s7', label:'Recommendation', filled: !!form.individual_recommendation },
  ]

  const initials = `${(student.first_name||'')[0]||''}${(student.last_name||'')[0]||''}`.toUpperCase()

  return (
    <div className="rub-session">
      {/* Back button */}
      <div className="rub-topbar">
        <button className="iv-back-btn" onClick={onBack}>← Back to Interview List</button>
        <span className="iv-save-indicator">
          {saveStatus === 'saving' && <span className="iv-saving">Saving…</span>}
          {saveStatus === 'saved'  && <span className="iv-saved">✓ Saved</span>}
        </span>
        {locked && <button className="btn btn-outline-modal" style={{ marginLeft:'auto' }} onClick={() => setConfirmUnlock(true)}>Unlock to Edit</button>}
      </div>

      <div className="rub-panels">
        {/* ── Left panel ── */}
        <div className="rub-left">
          {/* Student card */}
          <div className="rub-student-card">
            {student.headshot_url && !headshotError
              ? <img src={student.headshot_url} alt={`${student.first_name} ${student.last_name}`} className="rub-headshot"
                  onError={() => setHeadshotError(true)} />
              : <div className="rub-initials">{initials}</div>
            }
            <div className="rub-student-name">{displayName(student)}</div>
            <div className="rub-student-school">{student.school}</div>
            {student.status && <span className={`badge badge-gray`} style={{ marginTop:4 }}>{student.status}</span>}
            {student.cumulative_gpa != null && (
              <span style={{ fontSize:11, fontWeight:600, background:'#dcfce7', color:'#166534', padding:'1px 7px', borderRadius:4, marginTop:4 }}>
                GPA: {parseFloat(student.cumulative_gpa).toFixed(2)}
              </span>
            )}
            {student.resume_url && (
              <a href={student.resume_url} target="_blank" rel="noopener noreferrer"
                style={{ marginTop:8, display:'inline-block', fontSize:12, fontWeight:600,
                  color:'var(--nightfall)', border:'1px solid var(--nightfall)',
                  borderRadius:4, padding:'3px 10px', textDecoration:'none' }}>
                📄 View Resume
              </a>
            )}
          </div>

          {/* Scheduled info */}
          <div className="rub-divider" />
          <div className="rub-left-section">
            <div className="rub-left-lbl">Scheduled Interview</div>
            {student.interview_scheduled_date
              ? <div style={{ fontSize:13, color:'var(--nightfall)', fontWeight:500 }}>
                  📅 {student.interview_scheduled_date} {student.interview_scheduled_time && `at ${student.interview_scheduled_time}`}
                  {student.interview_duration_minutes && ` (${student.interview_duration_minutes} min)`}
                </div>
              : <div style={{ fontSize:13, color:'#9ca3af' }}>Not scheduled</div>
            }
          </div>

          {/* Preferences */}
          <div className="rub-divider" />
          <div className="rub-left-section">
            <div className="rub-left-lbl">Submitted Preferences</div>
            {['unit_preference_1','unit_preference_2','unit_preference_3'].map((f, i) => {
              const val = student[f]
              const desc = val ? PATIENT_POPULATION_MAP[val] : null
              return (
                <div key={f} style={{ marginBottom:6 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--nightfall)' }}>{i+1}. {val || <span style={{ color:'#9ca3af' }}>Not submitted</span>}</div>
                  {desc && <div style={{ fontSize:11, color:'#6b7280', fontStyle:'italic' }}>{desc}</div>}
                </div>
              )
            })}
          </div>

          {/* Interest statement */}
          <div className="rub-divider" />
          <div className="rub-left-section">
            <div className="rub-left-lbl">Interest Statement</div>
            {student.interest_statement
              ? <div style={{ fontSize:13, color:'var(--raven)', lineHeight:1.6 }}>{student.interest_statement}</div>
              : <div style={{ fontSize:13, color:'#9ca3af', fontStyle:'italic' }}>Not submitted</div>
            }
          </div>

          {/* Background */}
          <div className="rub-divider" />
          <div className="rub-left-section">
            <div className="rub-left-lbl">Background</div>
            {[
              ['Shift', student.shift_availability],
              ['Program', student.program_type],
              ['Healthcare Exp.', student.prior_healthcare_experience],
              ['CS Affiliation', student.cs_affiliation],
            ].map(([lbl, val]) => val ? (
              <div key={lbl} style={{ fontSize:12, marginBottom:3 }}>
                <span style={{ color:'#6b7280', fontWeight:600 }}>{lbl}: </span>
                <span style={{ color:'var(--raven)' }}>{val}</span>
              </div>
            ) : null)}
          </div>

          {/* Flag toggle */}
          <div className="rub-divider" />
          <div className="rub-left-section">
            {isFlagged ? (
              <div className="rub-flag-banner">
                <div style={{ fontWeight:700, marginBottom:6 }}>⚑ Flagged for Second Interview</div>
                <input className="form-input" style={{ fontSize:12, marginBottom:8 }} value={flagNote}
                  onChange={e => setFlagNote(e.target.value)} placeholder="Flag note…" />
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn btn-outline-modal" style={{ fontSize:12 }}
                    onClick={async () => { await onStudentUpdate(student.id, { flag_note: flagNote }) }}>Save Note</button>
                  <button className="btn btn-outline-modal" style={{ fontSize:12 }} onClick={handleUnflag}>Unflag</button>
                </div>
              </div>
            ) : flagging ? (
              <div>
                <input className="form-input" style={{ fontSize:12, marginBottom:8 }} value={flagNote}
                  onChange={e => setFlagNote(e.target.value)} placeholder="Reason for second interview…" />
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn btn-primary" style={{ fontSize:12 }} onClick={handleFlag}>Confirm Flag</button>
                  <button className="btn btn-outline-modal" style={{ fontSize:12 }} onClick={() => setFlagging(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="rub-flag-btn" onClick={() => setFlagging(true)}>
                Flag for Second Interview
              </button>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="rub-right" id="rub-right-scroll">
          {/* Sticky progress bar */}
          <div className="rub-progress-bar">
            {steps.map((s, i) => (
              <div key={s.id} className="rub-step" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior:'smooth', block:'start' })}>
                <div className={`rub-step-circle${s.filled ? ' rub-step-done' : ''}`}>{s.filled ? '✓' : i+1}</div>
                <span className="rub-step-label">{s.label}</span>
              </div>
            ))}
            <div className="rub-save-dot">
              {saveStatus === 'saving' && <span style={{ color:'#6b7280', fontSize:11 }}>…</span>}
              {saveStatus === 'saved'  && <span style={{ color:'#16a34a', fontSize:11 }}>✓</span>}
            </div>
          </div>

          {/* Existing rubrics banner */}
          {studentRubrics.length > 0 && (
            <div style={{ background:'var(--marina)', border:'1px solid #b8d8eb', borderRadius:6, padding:'10px 14px', margin:'0 0 16px', fontSize:13, color:'var(--nightfall)' }}>
              <strong>{studentRubrics.length} rubric{studentRubrics.length !== 1 ? 's' : ''} already submitted</strong> for this student.
              {!rubricId && ' You are adding a new rubric. Each interviewer scores independently.'}
            </div>
          )}

          <div className="rub-form-body">

            {/* ── Opening Script ── */}
            <div className="rub-script-card">
              <button className="rub-script-toggle" onClick={() => setScriptOpen(p => !p)}>
                {scriptOpen ? '▾ Hide Script' : '▸ Show Script'}&nbsp;&nbsp;<span style={{ fontWeight:400 }}>Interview Opening Script</span>
              </button>
              {scriptOpen && (
                <div className="rub-script-body">
                  <p className="rub-script-heading">Getting Started</p>
                  <p>Begin by introducing yourself and your role. Then invite the student to briefly introduce themselves.</p>
                  <p>Once you are both settled, say:</p>
                  <p className="rub-script-quote">"Thanks for being here today. The goal of this interview is to get a better sense of your clinical readiness and explore how we can best support your transition into professional nursing practice."</p>
                  <p className="rub-script-heading">Introduce the ASPIRE Program</p>
                  <p className="rub-script-quote">"The ASPIRE Program offers senior nursing students the opportunity to complete their final clinical rotation at Cedars-Sinai Medical Center. It is designed to support a seamless transition into our New Graduate RN Residency Program through personalized unit and preceptor matching, mentorship, application guidance, and connection to a strong nursing community."</p>
                  <p className="rub-script-heading">Explain the Interview Format</p>
                  <p className="rub-script-quote">"This is a structured, rubric-based interview. I will be asking at least one question in each of three areas: Clinical Judgment, Professional Presence, and Goal Alignment. These are grounded in the AACN Essentials for nursing practice. There are no right or wrong answers. We simply want to hear your honest thoughts and experiences. I may take notes as we go, and we will close with a brief recommendation. Take all the time you need before answering. Ready to begin?"</p>
                  <p>Then ask:</p>
                  <p className="rub-script-quote">"Before we dive in, can you share your top three unit choices and tell me a bit about why you are interested in rotating there?"</p>
                </div>
              )}
            </div>

            {/* ── Domain Ratings Legend ── */}
            <div className="rub-script-card">
              <button className="rub-script-toggle" onClick={() => setLegendOpen(p => !p)}>
                {legendOpen ? '▾ Hide Scoring Guide' : '▸ Show Scoring Guide'}&nbsp;&nbsp;<span style={{ fontWeight:400 }}>Scoring Guide</span>
              </button>
              {legendOpen && (
                <div className="rub-legend-card">
                  <table className="rub-legend-table">
                    <thead>
                      <tr>
                        <th style={{ width:48 }}>Score</th>
                        <th style={{ width:160 }}>Label</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { s:1, bg:'#fee2e2', color:'#991b1b', label:'Not Yet Ready',             desc:'Response is vague, unclear, unsafe, or lacks insight' },
                        { s:2, bg:'#fef3c7', color:'#92400e', label:'Emerging',                  desc:'Some awareness is present but reasoning or insight is limited' },
                        { s:3, bg:'#e0f2fe', color:'#0369a1', label:'Competent',                 desc:'Response is appropriate, safe, and acceptable for student level' },
                        { s:4, bg:'#dcfce7', color:'#166534', label:'Strong',                    desc:'Response is thoughtful, clear, and demonstrates good judgment or maturity' },
                        { s:5, bg:'#1d2567', color:'#ffffff', label:'Highly Aligned / Practice-Ready', desc:'Response is insightful, well-articulated, reflective, and strongly aligned with expected readiness' },
                      ].map(row => (
                        <tr key={row.s} style={{ background: row.bg }}>
                          <td style={{ color: row.color, fontWeight:700, fontSize:14, textAlign:'center' }}>{row.s}</td>
                          <td style={{ color: row.color, fontWeight:600, fontSize:13 }}>{row.label}</td>
                          <td style={{ color: row.color, fontSize:13 }}>{row.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Section 1: Interview Info */}
            <div className="iv-section" id="s1">
              <div className="iv-section-title">Section 1: Interview Info</div>
              <div className="iv-grid-2">
                <div className="iv-field">
                  <label className="iv-label">Date of Interview</label>
                  {locked ? <div className="iv-readonly">{form.interview_date}</div>
                    : <input className="iv-input" type="date" value={form.interview_date} onChange={e => saveImmediate('interview_date', e.target.value)} />}
                </div>
                <div className="iv-field">
                  <label className="iv-label">Interviewer Name</label>
                  {locked ? <div className="iv-readonly">{form.interviewer_name}</div>
                    : <select className="iv-input" value={form.interviewer_name} onChange={e => handleInterviewerChange(e.target.value)}>
                        <option value="">Select interviewer…</option>
                        {interviewers.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>}
                </div>
                <div className="iv-field">
                  <label className="iv-label">Interview Time</label>
                  {locked ? <div className="iv-readonly">{form.interview_time || student.interview_scheduled_time || '—'}</div>
                    : <input className="iv-input" type="text" value={form.interview_time || student.interview_scheduled_time || ''} onChange={e => saveText('interview_time', e.target.value)} placeholder="e.g. 09:00" />}
                </div>
              </div>
            </div>

            {/* Section 2: Unit Preferences */}
            <div className="iv-section" id="s2">
              <div className="iv-section-title">Section 2: Unit Preferences and Rationale</div>
              <p className="iv-prompt">"Before we dive in, can you share your top three unit choices and why?"</p>
              <div className="iv-grid-3" style={{ marginBottom:14 }}>
                {(['unit_preference_1','unit_preference_2','unit_preference_3']).map((f, i) => (
                  <div className="iv-field" key={f}>
                    <label className="iv-label">{['1st','2nd','3rd'][i]} Choice</label>
                    {locked ? <div className="iv-readonly">{prefs[f] || '—'}</div>
                      : <select className="iv-input" value={prefs[f]} onChange={e => savePreference(f, e.target.value)}>
                          <option value="">Not specified</option>
                          {availUnits.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>}
                  </div>
                ))}
              </div>
              <div className="iv-field">
                <label className="iv-label">Unit Preferences, Rationale, and Introduction Notes</label>
                {locked ? <div className="iv-readonly iv-readonly-tall">{form.unit_preferences_rationale || '—'}</div>
                  : <textarea className="iv-textarea iv-notes-textarea" rows={4} value={form.unit_preferences_rationale}
                      onChange={e => saveText('unit_preferences_rationale', e.target.value)}
                      placeholder="Capture rationale, introduction observations…" />}
              </div>
            </div>

            {/* Sections 3-5: Domains */}
            {[
              { key:'cj', snum:3, title:'Clinical Judgment',    color:'#1d2567', questions:CJ_QUESTIONS },
              { key:'pp', snum:4, title:'Professional Presence', color:'#0d7a8a', questions:PP_QUESTIONS },
              { key:'ga', snum:5, title:'Goal Alignment',        color:'#166534', questions:GA_QUESTIONS },
            ].map(({ key, snum, title, color, questions }) => {
              const qField = `${key}_question_asked`
              const sField = `${key}_score`
              const nField = `${key}_notes`
              const ref    = DOMAIN_REF[key]

              // Other is active when explicitly clicked or when a loaded rubric has a custom question
              const isOtherActive = otherClicked[key] || (!!form[qField] && !questions.includes(form[qField]))

              return (
                <div className="iv-domain-card" key={key} id={`s${snum}`} style={{ borderTopColor: color }}>
                  <div className="iv-domain-header">
                    <div className="iv-domain-title" style={{ color }}>Section {snum}: {title}</div>
                    <span className="iv-domain-badge" style={{ background: color }}>Domain {snum-2}</span>
                  </div>
                  <button className="iv-ref-toggle" style={{ color, borderColor: color }} onClick={() => setRefOpen(p => ({ ...p, [key]: !p[key] }))}>
                    <span className="iv-ref-chevron">{refOpen[key] ? '▾' : '▸'}</span>
                    {refOpen[key] ? 'Hide Interview Guide' : 'Show Interview Guide'}
                  </button>
                  {refOpen[key] && (
                    <div className="iv-ref-panel">
                      <p className="iv-ref-row"><strong>Description:</strong> {ref.desc}</p>
                      <p className="iv-ref-row"><strong>Basis:</strong> {ref.basis}</p>
                      <p className="iv-ref-row"><strong>Listen for:</strong> {ref.listen}</p>
                    </div>
                  )}

                  <p className="iv-prompt">Ask at least one of the following:</p>

                  <div className="iv-questions">
                    {/* Preset question tiles — always fully clickable */}
                    {questions.map((q, qi) => {
                      const sel = form[qField] === q && !isOtherActive
                      if (locked && !sel) return null
                      return (
                        <div key={qi}
                          className={`iv-question-card${sel ? ' iv-question-card-sel' : ''}`}
                          style={{ borderColor: sel ? color : '#d1d5db', background: sel ? color : '#fff', cursor: locked ? 'default' : 'pointer' }}
                          onClick={!locked ? () => {
                            setOtherClicked(p => ({ ...p, [key]: false }))
                            saveMeaningful(qField, q)
                          } : undefined}>
                          <div className="iv-question-radio"
                            style={{ border:`2px solid ${sel ? '#fff' : '#9ca3af'}`, background: sel ? '#fff' : 'transparent', flexShrink:0 }}>
                            {sel && <div className="iv-question-radio-dot" style={{ background: color }} />}
                          </div>
                          <span style={{ fontSize:14, color: sel ? '#fff' : '#191919' }}>{q}</span>
                        </div>
                      )
                    })}

                    {/* Other / Custom Question tile */}
                    {(!locked || isOtherActive) && (
                      <div>
                        <div
                          className={`iv-question-card${isOtherActive ? ' iv-question-card-sel' : ''}`}
                          style={{ borderColor: isOtherActive ? color : '#d1d5db', background: isOtherActive ? color : '#fff', cursor: locked ? 'default' : 'pointer' }}
                          onClick={!locked ? () => {
                            setOtherClicked(p => ({ ...p, [key]: true }))
                            // Clear any preset selection so only Other shows as active
                            if (questions.includes(form[qField])) {
                              setForm(p => ({ ...p, [qField]: '' }))
                            }
                          } : undefined}>
                          <div className="iv-question-radio"
                            style={{ border:`2px solid ${isOtherActive ? '#fff' : '#9ca3af'}`, background: isOtherActive ? '#fff' : 'transparent', flexShrink:0 }}>
                            {isOtherActive && <div className="iv-question-radio-dot" style={{ background: color }} />}
                          </div>
                          <span style={{ fontWeight:500, fontSize:14, color: isOtherActive ? '#fff' : '#191919' }}>
                            Other / Custom Question
                          </span>
                        </div>
                        {isOtherActive && (
                          <div style={{ marginTop:8 }}>
                            <label style={{ display:'block', fontSize:13, fontWeight:500, color:'var(--raven)', marginBottom:6 }}>
                              Type the custom question asked:
                            </label>
                            {locked
                              ? <div className="iv-readonly">{form[qField] || '—'}</div>
                              : <textarea
                                  className="iv-textarea iv-notes-textarea"
                                  rows={3}
                                  placeholder="Enter the question you asked the student…"
                                  value={form[qField]}
                                  onChange={e => saveText(qField, e.target.value)}
                                />
                            }
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="iv-field" style={{ marginTop:14 }}>
                    <label className="iv-label iv-score-label">Notes and Response Summary</label>
                    {locked ? <div className="iv-readonly iv-readonly-tall">{form[nField] || '—'}</div>
                      : <textarea className="iv-textarea iv-notes-textarea" rows={3} value={form[nField]} onChange={e => saveText(nField, e.target.value)} placeholder="Key points from the student's response…" />}
                  </div>

                  {/* Score tiles */}
                  <div className="iv-field" style={{ marginTop:14 }}>
                    <label className="iv-label iv-score-label">Rate this domain:</label>
                    <div className="iv-score-tiles">
                      {[1,2,3,4,5].map(s => {
                        const sel = form[sField] === s; const c = SCORE_COLORS[s]
                        return (!locked || sel) ? (
                          <div key={s} className="iv-score-tile"
                            style={{ background: sel ? c.bg : '#fff', borderColor: sel ? c.border : '#d1d5db', cursor: locked ? 'default' : 'pointer' }}
                            onClick={!locked ? () => saveMeaningful(sField, s) : undefined}>
                            <div className="iv-score-num" style={{ color: sel ? c.color : '#191919' }}>{s}</div>
                            <div className="iv-score-desc" style={{ color: sel ? c.color : '#6b7280' }}>{SCORE_LABELS[s]}</div>
                          </div>
                        ) : null
                      })}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Composite score card */}
            <div className="iv-composite-card" id="s6-anchor">
              <div className="iv-composite-label">Live Composite Score</div>
              <div className="iv-composite-num">{composite}<span className="iv-composite-denom"> / 15</span></div>
              <div className="iv-composite-breakdown">
                <div style={{ color:'#1d2567' }}>Clinical Judgment: <strong>{form.cj_score||0}/5</strong></div>
                <div style={{ color:'#0d7a8a' }}>Professional Presence: <strong>{form.pp_score||0}/5</strong></div>
                <div style={{ color:'#166534' }}>Goal Alignment: <strong>{form.ga_score||0}/5</strong></div>
              </div>
            </div>

            {/* Section 6: Student Questions */}
            <div className="iv-section" id="s6">
              <div className="iv-section-title">Section 6: Student Questions</div>
              <p className="iv-prompt">"Before we wrap up, what questions do you have for us?"</p>
              {locked ? <div className="iv-readonly iv-readonly-tall">{form.student_questions || '—'}</div>
                : <textarea className="iv-textarea iv-notes-textarea" rows={3} value={form.student_questions}
                    onChange={e => saveText('student_questions', e.target.value)}
                    placeholder="Student questions and notable comments (optional)…" />}
            </div>

            {/* Section 7: Recommendation */}
            <div className="iv-rec-section" id="s7">
              <div className="iv-rec-heading">Section 7: Your Recommendation</div>
              <p className="iv-rec-subtext">This is your individual recommendation. Do not share your decision with the student.</p>
              <div className="iv-rec-tiles">
                {REC_OPTIONS.map(opt => {
                  const sel = form.individual_recommendation === opt.value
                  return locked
                    ? sel && <div key={opt.value} className="iv-rec-tile" style={{ background:opt.bg, color:opt.color, border:`2px solid ${opt.border}` }}>{opt.label}</div>
                    : <div key={opt.value} className="iv-rec-tile"
                        style={{ background: sel ? opt.bg : '#fff', color: sel ? opt.color : 'var(--text-secondary)', border:`2px solid ${sel ? opt.border : 'var(--border)'}`, cursor:'pointer' }}
                        onClick={() => saveMeaningful('individual_recommendation', opt.value)}>{opt.label}</div>
                })}
              </div>
              <p style={{ fontSize:12, color:'#6b7280', marginTop:10, lineHeight:1.5 }}>
                The final recommendation is determined automatically by averaging all interviewers' composite scores. Your individual recommendation is recorded but the auto-calculated result drives the student's interview outcome.
              </p>
              <div className="iv-field" style={{ marginTop:14 }}>
                <label className="iv-label">Suggested Unit</label>
                {locked ? <div className="iv-readonly">{form.suggested_unit || '—'}</div>
                  : <input className="iv-input" value={form.suggested_unit} onChange={e => saveText('suggested_unit', e.target.value)} placeholder="Unit you would suggest" />}
              </div>
              <div className="iv-field" style={{ marginTop:12 }}>
                <label className="iv-label">Summary Comments</label>
                {locked ? <div className="iv-readonly iv-readonly-tall">{form.summary_comments || '—'}</div>
                  : <textarea className="iv-textarea iv-notes-textarea" rows={4} value={form.summary_comments} onChange={e => saveText('summary_comments', e.target.value)} placeholder="Overall impressions, strengths, areas for development…" />}
              </div>
            </div>

            {/* ── Closing Script ── */}
            <div className="rub-script-card">
              <button className="rub-script-toggle" onClick={() => setClosingOpen(p => !p)}>
                {closingOpen ? '▾ Hide Script' : '▸ Show Script'}&nbsp;&nbsp;<span style={{ fontWeight:400 }}>Interview Closing Script</span>
              </button>
              {closingOpen && (
                <div className="rub-script-body">
                  <p className="rub-script-heading">Closing the Interview</p>
                  <p>Invite the student to ask any questions they may have:</p>
                  <p className="rub-script-quote">"Before we wrap up, what questions do you have for us?"</p>
                  <p>Take notes on any notable questions or comments in the Student Questions section above.</p>
                  <p>Then close with:</p>
                  <p className="rub-script-quote">"Thank you so much for your time today. It was wonderful speaking with you. From here, our team will review your rubric and work with unit leadership to find a preceptor who is a great fit for your learning goals. Once a placement is confirmed, we will reach out with your rotation schedule and orientation details.</p>
                  <p className="rub-script-quote">If you have not already, please email Jester a copy of your résumé and a professional headshot. We also use headshots for your badge, so a clear, professional photo works best.</p>
                  <p className="rub-script-quote">Matching can take some time depending on unit availability, so we appreciate your patience. You will hear from us regardless of the outcome. In the meantime, feel free to reach out if you have any questions. We are rooting for you!"</p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            {!locked && (
              <div className="iv-complete-zone">
                <div className="iv-action-row">
                  <button className="iv-reset-btn" onClick={() => setConfirmReset(true)}>Reset Form</button>
                  <button className="iv-complete-btn" onClick={() => setConfirmComplete(true)}>Mark My Rubric Complete</button>
                </div>
              </div>
            )}
            {locked && (
              <div className="iv-locked-notice">✓ Your rubric is marked Complete. Click "Unlock to Edit" to make changes.</div>
            )}

            {/* All rubrics for this student */}
            {completedRubrics.length > 0 && (
              <div className="rub-all-section">
                <div className="rub-all-title">All Rubrics for This Student ({completedRubrics.length})</div>
                {completedRubrics.map(r => (
                  <RubricCard key={r.id} r={r} interviewers={interviewers} onSave={handleRubricEdit} />
                ))}
                <div className="rub-avg-display">
                  <span>Average Composite: <strong>{student.avg_composite_score ? parseFloat(student.avg_composite_score).toFixed(1) : '—'}/15</strong></span>
                  {student.auto_recommendation && (
                    <span style={{ marginLeft:16, fontSize:13, fontWeight:700,
                      color: student.auto_recommendation === 'Recommend' ? '#166534' : student.auto_recommendation === 'Recommend with Reservations' ? '#92400e' : '#991b1b' }}>
                      Auto: {student.auto_recommendation}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation modals */}
      {confirmComplete && (
        <div className="modal-overlay" onClick={() => setConfirmComplete(false)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Submit Rubric</h2><button className="modal-close" onClick={() => setConfirmComplete(false)}>×</button></div>
            <div className="modal-body"><p className="confirm-delete-warning">Submit your rubric for <strong>{displayName(student)}</strong>? Your scores will be included in the averaged result.</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmComplete(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleMarkComplete}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      {confirmReset && (
        <div className="modal-overlay" onClick={() => setConfirmReset(false)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Reset Interview Form</h2><button className="modal-close" onClick={() => setConfirmReset(false)}>×</button></div>
            <div className="modal-body"><p className="confirm-delete-warning">This will clear all responses and scores for this rubric. This cannot be undone.</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn btn-destructive-filled" onClick={handleReset}>Yes, Reset Form</button>
            </div>
          </div>
        </div>
      )}
      {confirmUnlock && (
        <div className="modal-overlay" onClick={() => setConfirmUnlock(false)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Unlock Rubric</h2><button className="modal-close" onClick={() => setConfirmUnlock(false)}>×</button></div>
            <div className="modal-body"><p className="confirm-delete-warning">Unlock this rubric for editing? It will return to In Progress status.</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmUnlock(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUnlock}>Confirm Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
