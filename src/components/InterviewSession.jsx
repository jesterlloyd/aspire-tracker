import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { displayName } from '../lib/utils'

const STATUS_CLASS = {
  'Form Sent':'badge-gray','Pending Outreach':'badge-pending',
  'Interviewed':'badge-purple','Accepted':'badge-green',
  'Active Rotation':'badge-teal','Completed':'badge-navy','Declined':'badge-red',
}

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
  'What personal strengths or qualities do you bring that make you a good fit for ASPIRE?',
]

const DOMAIN_REF = {
  cj: {
    description: "Ability to observe, interpret, prioritize, and respond to patient needs using integrated clinical knowledge and critical thinking.",
    basis: "Informed by Tanner's Clinical Judgment Model and Benner's Novice to Expert framework.",
    listen: "Patient safety awareness, ability to prioritize competing needs, logical reasoning about clinical observations, situational awareness.",
  },
  pp: {
    description: "Demonstrates professional behavior, emotional intelligence, and readiness to function as part of a healthcare team.",
    basis: "Grounded in QSEN competencies for teamwork, communication, and patient-centered care.",
    listen: "Self-reflection, receptiveness to feedback, professionalism under stress, communication style, accountability.",
  },
  ga: {
    description: "Alignment of the student's learning goals, career intentions, and values with ASPIRE's mission and Cedars-Sinai's culture.",
    basis: "Alignment with Cedars-Sinai's Nursing Professional Practice Model and ASPIRE's mission.",
    listen: "Clarity of purpose, motivation specific to ASPIRE, articulation of learning goals, cultural fit, post-graduation plans.",
  },
}

const DOMAIN_CONFIG = {
  cj: { accent: '#1d2567', badge: 'Domain 1', title: 'Clinical Judgment' },
  pp: { accent: '#0d7a8a', badge: 'Domain 2', title: 'Professional Presence' },
  ga: { accent: '#166534', badge: 'Domain 3', title: 'Goal Alignment' },
}

// Score colors per CHANGE 4 spec
const SCORE_LABELS = ['','Not Yet Ready','Emerging','Competent','Strong','Highly Aligned / Practice Ready']
const SCORE_COLORS = [
  null,
  { bg:'#fee2e2', color:'#991b1b', border:'#991b1b' },
  { bg:'#fef3c7', color:'#92400e', border:'#92400e' },
  { bg:'#e0f2fe', color:'#0369a1', border:'#0369a1' },
  { bg:'#dcfce7', color:'#166534', border:'#166534' },
  { bg:'#1d2567', color:'#ffffff', border:'#1d2567'  },
]

const REC_OPTIONS = [
  { value:'Recommend',                     label:'Recommend',                     bg:'#dcfce7', color:'#166534', border:'#a7f3d0' },
  { value:'Recommend with Reservations',   label:'Recommend with Reservations',   bg:'#fef3c7', color:'#92400e', border:'#fde68a' },
  { value:'Do Not Recommend at This Time', label:'Do Not Recommend at This Time', bg:'#fee2e2', color:'#991b1b', border:'#fecaca' },
]

const initForm = () => ({
  interview_date: new Date().toISOString().slice(0,10),
  interviewer_name: '',
  unit_preferences_rationale: '',
  cj_question_asked: '', cj_score: 0, cj_notes: '',
  pp_question_asked: '', pp_score: 0, pp_notes: '',
  ga_question_asked: '', ga_score: 0, ga_notes: '',
  student_questions: '',
  overall_recommendation: '',
  suggested_unit: '',
  summary_comments: '',
  composite_score: 0,
  status: 'In Progress',
})

export default function InterviewSession({ student, cohortId, onBack, onStudentUpdate, onInterviewsChange }) {
  const [form,            setForm]            = useState(initForm())
  const [interviewId,     setInterviewId]     = useState(null)
  const [loaded,          setLoaded]          = useState(false)
  const [saveStatus,      setSaveStatus]      = useState('idle')
  const [interviewers,    setInterviewers]    = useState([])
  const [availableUnits,  setAvailableUnits]  = useState([])
  const [prefs, setPrefs] = useState({
    unit_preference_1: student.unit_preference_1 || '',
    unit_preference_2: student.unit_preference_2 || '',
    unit_preference_3: student.unit_preference_3 || '',
  })
  const [cjOpen,          setCjOpen]          = useState(false)
  const [ppOpen,          setPpOpen]          = useState(false)
  const [gaOpen,          setGaOpen]          = useState(false)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [confirmUnlock,   setConfirmUnlock]   = useState(false)
  const [confirmReset,    setConfirmReset]    = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    supabase.rpc('get_active_interviewers')
      .then(({ data }) => setInterviewers((data || []).map(p => p.full_name)))
  }, [])

  useEffect(() => {
    if (!cohortId) return
    supabase.from('units').select('unit_name')
      .eq('is_participating', true).eq('cohort_id', cohortId).order('unit_name')
      .then(({ data }) => setAvailableUnits((data || []).map(u => u.unit_name)))
  }, [cohortId])

  useEffect(() => {
    supabase.from('interviews').select('*')
      .eq('student_id', student.id).eq('cohort_id', cohortId)
      .limit(1).single()
      .then(({ data }) => {
        if (data) { setInterviewId(data.id); setForm(data) }
        setLoaded(true)
      })
  }, [student.id, cohortId])

  const composite = (form.cj_score || 0) + (form.pp_score || 0) + (form.ga_score || 0)

  const persist = async (updates) => {
    setSaveStatus('saving')
    const payload = { ...updates, updated_at: new Date().toISOString() }
    let id = interviewId
    if (!id) {
      const { data, error } = await safeWrite(
        () => supabase.from('interviews').insert({ student_id: student.id, cohort_id: cohortId, ...payload }).select().single(),
        { name: 'create interview' }
      )
      if (error) { setSaveStatus('idle'); return }
      id = data.id
      setInterviewId(id)
    } else {
      await safeWrite(
        () => supabase.from('interviews').update(payload).eq('id', id),
        { name: 'update interview' }
      )
    }
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 1800)
    if (onInterviewsChange) onInterviewsChange()
  }

  const saveText = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => persist({ [field]: value }), 1000)
  }
  const saveImmediate = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    persist({ [field]: value })
  }
  const savePreference = (field, value) => {
    setPrefs(p => ({ ...p, [field]: value }))
    onStudentUpdate(student.id, { [field]: value })
  }

  const handleMarkComplete = async () => {
    setConfirmComplete(false)
    const comp = composite
    const outcomeMap = {
      'Recommend': 'Recommend',
      'Recommend with Reservations': 'Recommend with Reservations',
      'Do Not Recommend at This Time': 'Do Not Recommend',
    }
    const interview_outcome = outcomeMap[form.overall_recommendation] || 'Pending Interview'
    await persist({ ...form, composite_score: comp, status: 'Completed' })
    setForm(p => ({ ...p, composite_score: comp, status: 'Completed' }))
    await onStudentUpdate(student.id, {
      interview_id: interviewId,
      composite_score: comp,
      cj_score: form.cj_score || 0,
      pp_score: form.pp_score || 0,
      ga_score: form.ga_score || 0,
      interviewer_name: form.interviewer_name,
      interview_date: form.interview_date,
      interviewer_suggested_unit: form.suggested_unit,
      overall_recommendation: form.overall_recommendation,
      summary_comments: form.summary_comments,
      interview_outcome,
      status: 'Interviewed',
    })
  }

  const handleUnlock = async () => {
    setConfirmUnlock(false)
    await safeWrite(
      () => supabase.from('interviews').update({ status: 'In Progress', updated_at: new Date().toISOString() }).eq('id', interviewId),
      { name: 'unlock interview' }
    )
    setForm(p => ({ ...p, status: 'In Progress' }))
    if (onInterviewsChange) onInterviewsChange()
  }

  const handleReset = async () => {
    setConfirmReset(false)
    const blank = {
      unit_preferences_rationale: '',
      cj_question_asked: '', cj_score: 0, cj_notes: '',
      pp_question_asked: '', pp_score: 0, pp_notes: '',
      ga_question_asked: '', ga_score: 0, ga_notes: '',
      student_questions: '',
      overall_recommendation: '',
      suggested_unit: '',
      summary_comments: '',
      composite_score: 0,
      status: 'In Progress',
      updated_at: new Date().toISOString(),
    }
    if (interviewId) await safeWrite(
      () => supabase.from('interviews').update(blank).eq('id', interviewId),
      { name: 'reset interview' }
    )
    setForm(p => ({ ...p, ...blank }))
    await onStudentUpdate(student.id, {
      composite_score: 0, cj_score: 0, pp_score: 0, ga_score: 0,
      interviewer_suggested_unit: '', overall_recommendation: '',
      summary_comments: '', interview_outcome: 'Pending Interview',
    })
    if (onInterviewsChange) onInterviewsChange()
  }

  if (!loaded) return (
    <div className="iv-session-wrap">
      <div className="state-box"><div className="spinner" /><p>Loading interview…</p></div>
    </div>
  )

  const locked = form.status === 'Completed'

  return (
    <div className="iv-session-wrap">
      <div className="iv-session">

        {/* ── Header ── */}
        <div className="iv-session-header">
          <button className="iv-back-btn" onClick={onBack}>← Back to Interview List</button>
          <div className="iv-save-indicator">
            {saveStatus === 'saving' && <span className="iv-saving">Saving…</span>}
            {saveStatus === 'saved'  && <span className="iv-saved">✓ Saved</span>}
          </div>
          {locked && (
            <button className="btn btn-outline-modal" style={{ marginLeft: 'auto' }}
              onClick={() => setConfirmUnlock(true)}>
              Unlock to Edit
            </button>
          )}
        </div>

        {/* ── Student bar ── */}
        <div className="iv-student-bar">
          <div className="iv-student-bar-left">
            <span className="iv-student-name">{displayName(student)}</span>
            <span className="iv-student-school">{student.school}</span>
            {student.status && (
              <span className={`badge ${STATUS_CLASS[student.status] || 'badge-gray'}`}>{student.status}</span>
            )}
          </div>
          <div className="iv-pref-pills">
            {[prefs.unit_preference_1, prefs.unit_preference_2, prefs.unit_preference_3]
              .filter(Boolean).map((p, i) => (
                <span key={i} className="iv-pref-pill">{i+1}. {p}</span>
              ))}
          </div>
        </div>

        {/* ── Modals ── */}
        {confirmUnlock && (
          <div className="modal-overlay" onClick={() => setConfirmUnlock(false)}>
            <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header"><h2>Unlock Interview</h2>
                <button className="modal-close" onClick={() => setConfirmUnlock(false)}>×</button>
              </div>
              <div className="modal-body">
                <p className="confirm-delete-warning">Unlock this interview for editing? The interview will return to In Progress status.</p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-modal" onClick={() => setConfirmUnlock(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleUnlock}>Confirm Unlock</button>
              </div>
            </div>
          </div>
        )}
        {confirmReset && (
          <div className="modal-overlay" onClick={() => setConfirmReset(false)}>
            <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header"><h2>Reset Interview Form</h2>
                <button className="modal-close" onClick={() => setConfirmReset(false)}>×</button>
              </div>
              <div className="modal-body">
                <p className="confirm-delete-warning">
                  This will clear all responses, scores, and notes for this interview and return the
                  form to its default state. This cannot be undone.
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-modal" onClick={() => setConfirmReset(false)}>Cancel</button>
                <button className="btn btn-destructive-filled" onClick={handleReset}>Yes, Reset Form</button>
              </div>
            </div>
          </div>
        )}

        <div className="iv-form-body">

          {/* ── Section 1: Interview Info ── */}
          <div className="iv-section">
            <div className="iv-section-title">Section 1: Interview Info</div>
            <div className="iv-grid-2">
              <div className="iv-field">
                <label className="iv-label">Date of Interview</label>
                {locked
                  ? <div className="iv-readonly">{form.interview_date || '-'}</div>
                  : <input className="iv-input" type="date" value={form.interview_date}
                      onChange={e => saveImmediate('interview_date', e.target.value)} />
                }
              </div>
              <div className="iv-field">
                <label className="iv-label">Interviewer Name</label>
                {locked
                  ? <div className="iv-readonly">{form.interviewer_name || '-'}</div>
                  : <select className="iv-input" value={form.interviewer_name}
                      onChange={e => saveImmediate('interviewer_name', e.target.value)}>
                      <option value="">Select interviewer…</option>
                      {interviewers.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                }
              </div>
            </div>
          </div>

          {/* ── Section 2: Unit Preferences + Rationale ── */}
          <div className="iv-section">
            <div className="iv-section-title">Section 2: Unit Preferences and Rationale</div>
            <p className="iv-prompt">
              "Before we dive into the main interview questions, I'd love to hear a bit about your
              interests. Can you share your top three unit choices and tell me why you'd like to
              rotate in any one of them?"
            </p>
            <div className="iv-grid-3" style={{ marginBottom: 16 }}>
              {['unit_preference_1','unit_preference_2','unit_preference_3'].map((field, i) => (
                <div className="iv-field" key={field}>
                  <label className="iv-label">{['1st Choice','2nd Choice','3rd Choice'][i]}</label>
                  {locked
                    ? <div className="iv-readonly">{prefs[field] || '-'}</div>
                    : <select className="iv-input" value={prefs[field]}
                        onChange={e => savePreference(field, e.target.value)}>
                        <option value="">Not specified</option>
                        {availableUnits.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                  }
                </div>
              ))}
            </div>
            <div className="iv-field">
              <label className="iv-label">Unit Preferences, Rationale, and Introduction Notes</label>
              {locked
                ? <div className="iv-readonly iv-readonly-tall">{form.unit_preferences_rationale || '-'}</div>
                : <textarea className="iv-textarea iv-notes-textarea" rows={4}
                    value={form.unit_preferences_rationale}
                    onChange={e => saveText('unit_preferences_rationale', e.target.value)}
                    placeholder="Capture the student's rationale for their unit choices, anything notable from their introduction, or general observations from the opening of the interview." />
              }
            </div>
          </div>

          {/* ── Domain 1: Clinical Judgment ── */}
          <DomainSection
            domainKey="cj"
            sectionNum={3}
            questions={CJ_QUESTIONS}
            refData={DOMAIN_REF.cj}
            open={cjOpen} onToggle={() => setCjOpen(o => !o)}
            selectedQ={form.cj_question_asked}
            onSelectQ={q => saveImmediate('cj_question_asked', q)}
            score={form.cj_score}
            onScore={s => saveImmediate('cj_score', s)}
            notes={form.cj_notes}
            onNotes={v => saveText('cj_notes', v)}
            locked={locked}
          />

          {/* ── Domain 2: Professional Presence ── */}
          <DomainSection
            domainKey="pp"
            sectionNum={4}
            questions={PP_QUESTIONS}
            refData={DOMAIN_REF.pp}
            open={ppOpen} onToggle={() => setPpOpen(o => !o)}
            selectedQ={form.pp_question_asked}
            onSelectQ={q => saveImmediate('pp_question_asked', q)}
            score={form.pp_score}
            onScore={s => saveImmediate('pp_score', s)}
            notes={form.pp_notes}
            onNotes={v => saveText('pp_notes', v)}
            locked={locked}
          />

          {/* ── Domain 3: Goal Alignment ── */}
          <DomainSection
            domainKey="ga"
            sectionNum={5}
            questions={GA_QUESTIONS}
            refData={DOMAIN_REF.ga}
            open={gaOpen} onToggle={() => setGaOpen(o => !o)}
            selectedQ={form.ga_question_asked}
            onSelectQ={q => saveImmediate('ga_question_asked', q)}
            score={form.ga_score}
            onScore={s => saveImmediate('ga_score', s)}
            notes={form.ga_notes}
            onNotes={v => saveText('ga_notes', v)}
            locked={locked}
          />

          {/* ── Composite Score ── */}
          <div className="iv-composite-card">
            <div className="iv-composite-label">Composite Score</div>
            <div className="iv-composite-num">{composite}<span className="iv-composite-denom"> / 15</span></div>
            <div className="iv-composite-breakdown">
              <div style={{ color: DOMAIN_CONFIG.cj.accent }}>
                Clinical Judgment: <strong>{form.cj_score || 0}/5</strong>
              </div>
              <div style={{ color: DOMAIN_CONFIG.pp.accent }}>
                Professional Presence: <strong>{form.pp_score || 0}/5</strong>
              </div>
              <div style={{ color: DOMAIN_CONFIG.ga.accent }}>
                Goal Alignment: <strong>{form.ga_score || 0}/5</strong>
              </div>
            </div>
          </div>

          {/* ── Section 6: Student Questions ── */}
          <div className="iv-section">
            <div className="iv-section-title">Section 6: Student Questions</div>
            <p className="iv-prompt">"Before we wrap up, what questions do you have for us?"</p>
            {locked
              ? <div className="iv-readonly iv-readonly-tall">{form.student_questions || '-'}</div>
              : <textarea className="iv-textarea iv-notes-textarea" rows={3}
                  value={form.student_questions}
                  onChange={e => saveText('student_questions', e.target.value)}
                  placeholder="Student questions and notable comments (optional)…" />
            }
          </div>

          {/* ── Section 7: Overall Recommendation ── */}
          <div className="iv-rec-section">
            <div className="iv-rec-heading">Overall Recommendation</div>
            <p className="iv-rec-subtext">
              Summarize your impression of the student and indicate your recommendation.
              Do not share your decision with the student.
            </p>
            <div className="iv-rec-tiles">
              {REC_OPTIONS.map(opt => {
                const sel = form.overall_recommendation === opt.value
                return locked
                  ? sel && (
                      <div key={opt.value} className="iv-rec-tile"
                        style={{ background: opt.bg, color: opt.color, border: `2px solid ${opt.border}` }}>
                        {opt.label}
                      </div>
                    )
                  : (
                      <div key={opt.value} className="iv-rec-tile"
                        style={{
                          background: sel ? opt.bg : 'var(--pearl)',
                          color: sel ? opt.color : 'var(--text-secondary)',
                          border: `2px solid ${sel ? opt.border : 'var(--border)'}`,
                          cursor: 'pointer',
                        }}
                        onClick={() => saveImmediate('overall_recommendation', opt.value)}>
                        {opt.label}
                      </div>
                    )
              })}
            </div>
            <div className="iv-field" style={{ marginTop: 20 }}>
              <label className="iv-label">Suggested Unit (Interviewer's Recommendation)</label>
              {locked
                ? <div className="iv-readonly">{form.suggested_unit || '-'}</div>
                : <>
                    <input className="iv-input" value={form.suggested_unit}
                      onChange={e => saveText('suggested_unit', e.target.value)}
                      placeholder="Unit you would suggest for this student" />
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      This is stored as the interviewer's suggestion and does not automatically update the student's placement preferences.
                    </p>
                  </>
              }
            </div>
            <div className="iv-field" style={{ marginTop: 16 }}>
              <label className="iv-label">Summary Comments</label>
              {locked
                ? <div className="iv-readonly iv-readonly-tall">{form.summary_comments || '-'}</div>
                : <textarea className="iv-textarea iv-notes-textarea" rows={4}
                    value={form.summary_comments}
                    onChange={e => saveText('summary_comments', e.target.value)}
                    placeholder="Overall impressions, strengths, areas for development…" />
              }
            </div>
          </div>

          {/* ── Action zone ── */}
          {!locked && (
            <div className="iv-complete-zone">
              {(confirmComplete || confirmReset) ? null : (
                <div className="iv-action-row">
                  <button className="iv-reset-btn" onClick={() => setConfirmReset(true)}>
                    Reset Form
                  </button>
                  <button className="iv-complete-btn" onClick={() => setConfirmComplete(true)}>
                    Mark Interview Complete
                  </button>
                </div>
              )}
              {confirmComplete && (
                <div className="iv-confirm-box">
                  <p className="iv-confirm-msg">
                    Mark this interview as complete? The student's record will be updated with the
                    scores and recommendation.
                  </p>
                  <div className="iv-confirm-actions">
                    <button className="btn btn-outline-modal" onClick={() => setConfirmComplete(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleMarkComplete}>Confirm</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {locked && (
            <div className="iv-locked-notice">
              ✓ This interview is marked Complete. Click "Unlock to Edit" to make changes.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DomainSection({ domainKey, sectionNum, questions, refData, open, onToggle, selectedQ, onSelectQ, score, onScore, notes, onNotes, locked }) {
  const config = DOMAIN_CONFIG[domainKey]
  const accent = config.accent

  const isOtherStored = selectedQ && selectedQ.startsWith('Other: ')
  const [otherSelected, setOtherSelected] = useState(isOtherStored)
  const [otherText,     setOtherText]     = useState(isOtherStored ? selectedQ.slice(7) : '')
  const otherTimer = useRef(null)

  const handleQuestionClick = (q) => {
    setOtherSelected(false)
    onSelectQ(q)
  }
  const handleOtherClick = () => {
    setOtherSelected(true)
    onSelectQ('Other: ' + otherText)
  }
  const handleOtherText = (val) => {
    setOtherText(val)
    clearTimeout(otherTimer.current)
    otherTimer.current = setTimeout(() => onSelectQ('Other: ' + val), 800)
  }

  const isQuestionSel = q => !otherSelected && selectedQ === q

  return (
    <div className="iv-domain-card" style={{ borderTopColor: accent }}>
      <div className="iv-domain-header">
        <div>
          <div className="iv-domain-title" style={{ color: accent }}>
            Section {sectionNum}: {config.title}
          </div>
        </div>
        <span className="iv-domain-badge" style={{ background: accent }}>
          {config.badge}
        </span>
      </div>

      <button className="iv-ref-toggle" onClick={onToggle} style={{ color: accent, borderColor: accent }}>
        <span className="iv-ref-chevron">{open ? '▾' : '▸'}</span>
        {open ? 'Hide Interview Guide' : 'Show Interview Guide'}
      </button>

      {open && (
        <div className="iv-ref-panel">
          <p className="iv-ref-row"><strong>Description:</strong> {refData.description}</p>
          <p className="iv-ref-row"><strong>Theoretical basis:</strong> {refData.basis}</p>
          <p className="iv-ref-row"><strong>What to listen for:</strong> {refData.listen}</p>
        </div>
      )}

      <p className="iv-prompt">Ask at least one of the following questions:</p>

      <div className="iv-questions">
        {questions.map((q, i) => {
          const sel = isQuestionSel(q)
          if (locked && !sel) return null
          return (
            <div key={i}
              className={`iv-question-card${sel ? ' iv-question-card-sel' : ''}`}
              style={{
                borderColor: sel ? accent : '#d1d5db',
                background: sel ? accent : '#ffffff',
                cursor: locked ? 'default' : 'pointer',
              }}
              onClick={!locked ? () => handleQuestionClick(q) : undefined}>
              <div className="iv-question-radio" style={{
                border: `2px solid ${sel ? '#fff' : '#9ca3af'}`,
                background: sel ? '#fff' : 'transparent',
              }}>
                {sel && <div className="iv-question-radio-dot" style={{ background: accent }} />}
              </div>
              <span style={{ color: sel ? '#fff' : '#191919' }}>{q}</span>
            </div>
          )
        })}

        {/* Other option */}
        {(!locked || otherSelected) && (
          <div
            className={`iv-question-card${otherSelected ? ' iv-question-card-sel' : ''}`}
            style={{
              borderColor: otherSelected ? accent : '#d1d5db',
              background: otherSelected ? accent : '#ffffff',
              cursor: locked ? 'default' : 'pointer',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 10,
            }}
            onClick={!locked && !otherSelected ? handleOtherClick : undefined}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
              <div className="iv-question-radio" style={{
                border: `2px solid ${otherSelected ? '#fff' : '#9ca3af'}`,
                background: otherSelected ? '#fff' : 'transparent',
                flexShrink: 0,
              }}>
                {otherSelected && <div className="iv-question-radio-dot" style={{ background: accent }} />}
              </div>
              <span style={{ color: otherSelected ? '#fff' : '#191919' }}>Other</span>
            </div>
            {otherSelected && !locked && (
              <input
                className="iv-other-input"
                placeholder="Enter your custom question…"
                value={otherText}
                onClick={e => e.stopPropagation()}
                onChange={e => handleOtherText(e.target.value)}
              />
            )}
            {otherSelected && locked && otherText && (
              <span style={{ color: '#fff', fontSize: 15, paddingLeft: 36, opacity: 0.9 }}>{otherText}</span>
            )}
          </div>
        )}
      </div>

      <div className="iv-field" style={{ marginTop: 20 }}>
        <label className="iv-label">Notes and Response Summary</label>
        {locked
          ? <div className="iv-readonly iv-readonly-tall">{notes || '-'}</div>
          : <textarea className="iv-textarea iv-notes-textarea" rows={4} value={notes}
              onChange={e => onNotes(e.target.value)}
              placeholder="Capture key points from the student's response…" />
        }
      </div>

      <div className="iv-field" style={{ marginTop: 20 }}>
        <label className="iv-label iv-score-label">Rate this domain:</label>
        <div className="iv-score-tiles">
          {[1,2,3,4,5].map(s => {
            const sel = score === s
            const c   = SCORE_COLORS[s]
            if (locked && !sel) return null
            return (
              <div key={s} className="iv-score-tile"
                style={{
                  background: sel ? c.bg : '#ffffff',
                  borderColor: sel ? c.border : '#d1d5db',
                  cursor: locked ? 'default' : 'pointer',
                }}
                onClick={!locked ? () => onScore(s) : undefined}>
                <div className="iv-score-num" style={{ color: sel ? c.color : '#191919' }}>{s}</div>
                <div className="iv-score-desc" style={{ color: sel ? c.color : '#6b7280' }}>{SCORE_LABELS[s]}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
