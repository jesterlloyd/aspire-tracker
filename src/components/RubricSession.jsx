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
  const [flagging,       setFlagging]       = useState(false)
  const [flagNote,       setFlagNote]       = useState(student.flag_note || '')
  const [isFlagged,      setIsFlagged]      = useState(!!student.flagged_for_second_interview)
  const [prefs, setPrefs] = useState({
    unit_preference_1: student.unit_preference_1 || '',
    unit_preference_2: student.unit_preference_2 || '',
    unit_preference_3: student.unit_preference_3 || '',
  })
  const timerRef = useRef(null)

  // Rubrics for this student
  const studentRubrics = rubrics.filter(r => r.student_id === student.id)
  const completedRubrics = studentRubrics.filter(r => r.status === 'Completed')

  useEffect(() => {
    supabase.from('interviewers').select('name').eq('is_active', true).order('name')
      .then(({ data }) => setInterviewers((data || []).map(i => i.name)))
    supabase.from('units').select('unit_name').eq('is_participating', true).eq('cohort_id', cohortId).order('unit_name')
      .then(({ data }) => setAvailUnits((data || []).map(u => u.unit_name)))
  }, [cohortId])

  // When interviewer_name changes, try to load their existing rubric
  const handleInterviewerChange = async (name) => {
    const f = { ...form, interviewer_name: name }
    if (name) {
      const existing = studentRubrics.find(r => r.interviewer_name === name && r.status !== 'Completed')
      if (existing) {
        setForm(existing); setRubricId(existing.id); return
      }
      // If this interviewer has a completed rubric, start fresh for a new one
    }
    setForm(f)
    setRubricId(null)
  }

  const composite = (form.cj_score || 0) + (form.pp_score || 0) + (form.ga_score || 0)

  const persist = async (updates) => {
    setSaveStatus('saving')
    const payload = { ...updates, composite_score: (updates.cj_score ?? (form.cj_score || 0)) + (updates.pp_score ?? (form.pp_score || 0)) + (updates.ga_score ?? (form.ga_score || 0)), updated_at: new Date().toISOString() }
    let id = rubricId
    if (!id) {
      if (!form.interviewer_name) { setSaveStatus('idle'); return }
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

  const saveText = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => persist({ [field]: value }), 800)
  }
  const saveImmediate = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    persist({ [field]: value })
  }
  const savePreference = async (field, value) => {
    setPrefs(p => ({ ...p, [field]: value }))
    await onStudentUpdate(student.id, { [field]: value })
  }

  const handleMarkComplete = async () => {
    setConfirmComplete(false)
    await persist({ ...form, status:'Completed', composite_score: composite })
    setForm(p => ({ ...p, status:'Completed', composite_score: composite }))
    // Recalculate averages from all completed rubrics (including this one)
    const allCompleted = [...completedRubrics.filter(r => r.id !== rubricId), { ...form, cj_score: form.cj_score||0, pp_score: form.pp_score||0, ga_score: form.ga_score||0, status:'Completed' }]
    const n = allCompleted.length
    if (n === 0) return
    const avgCJ   = allCompleted.reduce((s,r) => s + (r.cj_score||0), 0) / n
    const avgPP   = allCompleted.reduce((s,r) => s + (r.pp_score||0), 0) / n
    const avgGA   = allCompleted.reduce((s,r) => s + (r.ga_score||0), 0) / n
    const avgComp = avgCJ + avgPP + avgGA
    const autoRec = getAutoRec(avgComp)
    const outcome = getInterviewOutcome(avgComp)
    await onStudentUpdate(student.id, {
      avg_cj_score: +avgCJ.toFixed(2), avg_pp_score: +avgPP.toFixed(2),
      avg_ga_score: +avgGA.toFixed(2), avg_composite_score: +avgComp.toFixed(2),
      auto_recommendation: autoRec, rubric_count: n,
      interview_outcome: outcome, status: 'Interviewed',
    })
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
            {student.headshot_url
              ? <img src={student.headshot_url} alt="headshot" className="rub-headshot" />
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
              { key:'cj', snum:3, title:'Clinical Judgment', color:'#1d2567', questions:CJ_QUESTIONS },
              { key:'pp', snum:4, title:'Professional Presence', color:'#0d7a8a', questions:PP_QUESTIONS },
              { key:'ga', snum:5, title:'Goal Alignment', color:'#166534', questions:GA_QUESTIONS },
            ].map(({ key, snum, title, color, questions }) => {
              const qField = `${key}_question_asked`, sField = `${key}_score`, nField = `${key}_notes`
              const ref = DOMAIN_REF[key]
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
                    {questions.map((q, qi) => {
                      const sel = form[qField] === q
                      return (!locked || sel) ? (
                        <div key={qi} className={`iv-question-card${sel ? ' iv-question-card-sel' : ''}`}
                          style={{ borderColor: sel ? color : '#d1d5db', background: sel ? color : '#fff', cursor: locked ? 'default' : 'pointer' }}
                          onClick={!locked ? () => saveImmediate(qField, q) : undefined}>
                          <div className="iv-question-radio" style={{ border:`2px solid ${sel ? '#fff' : '#9ca3af'}`, background: sel ? '#fff' : 'transparent' }}>
                            {sel && <div className="iv-question-radio-dot" style={{ background: color }} />}
                          </div>
                          <span style={{ color: sel ? '#fff' : '#191919' }}>{q}</span>
                        </div>
                      ) : null
                    })}
                  </div>
                  <div className="iv-field" style={{ marginTop:14 }}>
                    <label className="iv-label iv-score-label">Notes and Response Summary</label>
                    {locked ? <div className="iv-readonly iv-readonly-tall">{form[nField] || '—'}</div>
                      : <textarea className="iv-textarea iv-notes-textarea" rows={3} value={form[nField]} onChange={e => saveText(nField, e.target.value)} placeholder="Key points from the student's response…" />}
                  </div>
                  <div className="iv-field" style={{ marginTop:14 }}>
                    <label className="iv-label iv-score-label">Rate this domain:</label>
                    <div className="iv-score-tiles">
                      {[1,2,3,4,5].map(s => {
                        const sel = form[sField] === s; const c = SCORE_COLORS[s]
                        return (!locked || sel) ? (
                          <div key={s} className="iv-score-tile"
                            style={{ background: sel ? c.bg : '#fff', borderColor: sel ? c.border : '#d1d5db', cursor: locked ? 'default' : 'pointer' }}
                            onClick={!locked ? () => saveImmediate(sField, s) : undefined}>
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
                        onClick={() => saveImmediate('individual_recommendation', opt.value)}>{opt.label}</div>
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
                {completedRubrics.map(r => {
                  const comp = (r.cj_score||0)+(r.pp_score||0)+(r.ga_score||0)
                  const rec = r.individual_recommendation
                  const recColor = rec === 'Recommend' ? '#166534' : rec === 'Recommend with Reservations' ? '#92400e' : '#991b1b'
                  const recBg = rec === 'Recommend' ? '#dcfce7' : rec === 'Recommend with Reservations' ? '#fef3c7' : '#fee2e2'
                  return (
                    <div key={r.id} className="rub-rubric-card">
                      <div className="rub-rc-top">
                        <span className="rub-rc-name">{r.interviewer_name || 'Unknown'}</span>
                        <span className="rub-rc-date">{r.interview_date}</span>
                        <span className="rub-rc-score">{comp}/15</span>
                        {rec && <span style={{ fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:4, background:recBg, color:recColor }}>{rec}</span>}
                      </div>
                      <div className="rub-rc-scores">
                        <span>CJ: {r.cj_score||0}/5</span>
                        <span>PP: {r.pp_score||0}/5</span>
                        <span>GA: {r.ga_score||0}/5</span>
                      </div>
                      {r.summary_comments && <p className="rub-rc-comments">{r.summary_comments}</p>}
                    </div>
                  )
                })}
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
