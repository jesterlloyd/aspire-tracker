import { useState, useRef, useEffect, useCallback } from 'react'
import Tooltip from './ui/Tooltip'
import BackButton from './BackButton'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { displayName } from '../lib/utils'
import StudentAvatar from './StudentAvatar'
import { PATIENT_POPULATION_MAP, UNITS_BY_DIVISION, ASPIRE_STATUS_CONFIG, gpaBand } from '../lib/constants'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'
import ScoreFlag from './ScoreFlag'
import FlagRibbon from './rubric/FlagRibbon'
import { useBookScale } from './rubric/useBookScale'
import './rubric/rubricBook.css'
import { logEvent, eventExists } from '../lib/logEvent'
import { logActivity } from '../lib/logActivity'
import { useAuth } from '../contexts/AuthContext'
import { openStudentFile } from '../lib/useStudentFile'
import { getAvailabilityReadiness } from '../lib/availability'
import { resumeActionLabel } from '../lib/fileUtils'
// WS1e-A3b: rubric outcomes persist through the explicit save_interview_outcome
// action (Owner/Admin/Interviewer) instead of the generic onStudentUpdate path.
import { saveInterviewOutcome } from '../lib/studentProxy'
import { normalizeStaffRole } from '../lib/permissions'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'
import { toInterviewRubricWrite, toInterviewRubricInsert, resolveDraftRubricId,
  isOwnRubricRow, isSelfInterviewerName, selectResumableRubric } from '../lib/interviewRubricWrite'
import { moveInterviewBooking } from '../lib/interviewBooking'
import { toLocalDateStr } from '../../shared/dateUtils.js'

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
  'What personal strengths or qualities do you bring that make you a good fit for ASPIRE?',
]
const DOMAIN_QUESTIONS = { cj: CJ_QUESTIONS, pp: PP_QUESTIONS, ga: GA_QUESTIONS }

const DOMAIN_REF = {
  cj: { desc:'Ability to observe, interpret, prioritize, and respond to patient needs using integrated clinical knowledge and critical thinking.', basis:"Tanner's Clinical Judgment Model and Benner's Novice to Expert framework.", listen:'Patient safety awareness, prioritization, logical reasoning, situational awareness.' },
  pp: { desc:'Demonstrates professional behavior, emotional intelligence, and readiness to function as part of a healthcare team.', basis:'QSEN competencies for teamwork, communication, and patient-centered care.', listen:'Self-reflection, receptiveness to feedback, professionalism under stress, accountability.' },
  ga: { desc:"Alignment of the student's learning goals, career intentions, and values with ASPIRE's mission.", basis:"Cedars-Sinai's Nursing Professional Practice Model and ASPIRE's mission.", listen:'Clarity of purpose, motivation for ASPIRE, learning goals, cultural fit, post-graduation plans.' },
}
// RUBRIC-BOOK-1: the scale reads as five steps of the same journey (Owner, from the
// approved mockup). The stored value is the NUMBER, so the flag thresholds, the
// averages and every report are untouched by this wording.
const SCORE_LABELS = ['', 'Limited', 'Developing', 'Adequate', 'Strong', 'Highly Aligned']
const SCORE_GUIDE = [
  { s: 1, label: 'Limited',        desc: 'Response is vague, unclear, unsafe, or lacks insight' },
  { s: 2, label: 'Developing',     desc: 'Some awareness is present but reasoning or insight is limited' },
  { s: 3, label: 'Adequate',       desc: 'Response is appropriate, safe, and acceptable for student level' },
  { s: 4, label: 'Strong',         desc: 'Response is thoughtful, clear, and demonstrates good judgment or maturity' },
  { s: 5, label: 'Highly Aligned', desc: 'Response is insightful, well-articulated, reflective, and strongly aligned with expected readiness' },
]
const REC_OPTIONS = [
  { value:'Recommend',                     label:'Recommend',                     bg:'#dcfce7', color:'#166534', border:'#a7f3d0' },
  { value:'Recommend with Reservations',   label:'Recommend with Reservations',   bg:'#fef3c7', color:'#92400e', border:'#fde68a' },
  { value:'Do Not Recommend at This Time', label:'Do Not Recommend at This Time', bg:'#fee2e2', color:'#991b1b', border:'#fecaca' },
]

// The three scored domains, in the order the interview runs.
const DOMAINS = [
  { key: 'cj', snum: 3, title: 'Clinical Judgment',     questions: CJ_QUESTIONS },
  { key: 'pp', snum: 4, title: 'Professional Presence', questions: PP_QUESTIONS },
  { key: 'ga', snum: 5, title: 'Goal Alignment',        questions: GA_QUESTIONS },
]
const SECTION_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7']
// The nine answers Mark Complete insists on. The head reports progress against this
// same number, so the percentage and the gate can never tell different stories.
const REQUIRED_ANSWERS = 9

const initForm = () => ({
  interview_date: toLocalDateStr(),
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

// Returns true only if the draft contains actual user-entered data (not just auto-populated fields).
// Prevents false-positive "draft restored" toasts when the stored draft is effectively empty.
function hasRubricContent(draft) {
  if (!draft?.formState) return false
  const f = draft.formState
  const userTypedFields = [
    // interviewer_name is intentionally excluded because interviewer accounts
    // receive it automatically; identity alone is not an in-progress draft.
    'interview_time', 'unit_preferences_rationale',
    'cj_question_asked', 'cj_notes',
    'pp_question_asked', 'pp_notes',
    'ga_question_asked', 'ga_notes',
    'student_questions',
    'individual_recommendation', 'suggested_unit', 'summary_comments',
  ]
  const hasText  = userTypedFields.some(k => typeof f[k] === 'string' && f[k].trim() !== '')
  const hasScore = ['cj_score', 'pp_score', 'ga_score'].some(k => (f[k] ?? 0) > 0)
  const hasFlag  = typeof draft.flagNote === 'string' && draft.flagNote.trim() !== ''
  const hasOther = draft.otherClicked && Object.values(draft.otherClicked).some(Boolean)
  return hasText || hasScore || hasFlag || hasOther
}

const getAutoRec = avg => {
  if (avg >= 12)  return 'Recommend'
  if (avg >= 8)   return 'Recommend with Reservations'
  return 'Do Not Recommend at This Time'
}
const getInterviewOutcome = avg => {
  if (avg >= 12) return 'Recommend'
  if (avg >= 8)  return 'Recommend with Reservations'
  return 'Do Not Recommend'
}

// Format a Date for the "Saved at HH:MM AM/PM" indicator
function fmtSaveTime(dt) {
  if (!dt) return ''
  return dt.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
}

// ── Recalculate student averages from fresh DB fetch ─────────
async function recalculateStudentAverages(studentId, cohortId, supabase) {
  // The summary RPC includes every completed rubric while redacting another
  // interviewer's answer-bearing fields. Direct table reads are intentionally
  // restricted to the caller's own rows and would produce a false N=1 average.
  const { data, error } = await supabase.rpc('list_interview_rubrics_for_cohort', {
    p_cohort_id: cohortId,
  })
  const rubrics = (data || []).filter(r => r.student_id === studentId && r.status === 'Completed')

  if (error || !rubrics || rubrics.length === 0) return null

  const count        = rubrics.length
  const avgCj        = rubrics.reduce((sum, r) => sum + (r.cj_score        || 0), 0) / count
  const avgPp        = rubrics.reduce((sum, r) => sum + (r.pp_score        || 0), 0) / count
  const avgGa        = rubrics.reduce((sum, r) => sum + (r.ga_score        || 0), 0) / count
  const avgComposite = rubrics.reduce((sum, r) => sum + (r.composite_score || 0), 0) / count

  // Majority vote from individual_recommendation fields
  const recs             = rubrics.map(r => r.individual_recommendation).filter(Boolean)
  const recommendCount   = recs.filter(r => r === 'Recommend').length
  const reservationsCount= recs.filter(r => r === 'Recommend with Reservations').length
  const declineCount     = recs.filter(r => r === 'Do Not Recommend at This Time' || r === 'Do Not Recommend').length

  let autoRec
  if (recs.length === 0 || declineCount > recs.length / 2) {
    autoRec = 'Do Not Recommend at This Time'
  } else if (recommendCount > recs.length / 2) {
    autoRec = 'Recommend'
  } else if (reservationsCount > recs.length / 2) {
    autoRec = 'Recommend with Reservations'
  } else {
    // Tie goes to more cautious
    autoRec = reservationsCount >= recommendCount ? 'Recommend with Reservations' : 'Recommend'
  }

  // Score discrepancy flag
  let scoreFlag        = false
  let scoreFlagMessage = ''
  if (autoRec === 'Recommend' && avgComposite < 12) {
    scoreFlag = true
    scoreFlagMessage = `Average composite score is ${avgComposite.toFixed(1)}/15, below the Recommend threshold of 12/15. Review scores before finalizing.`
  } else if (autoRec === 'Recommend with Reservations' && avgComposite < 8) {
    scoreFlag = true
    scoreFlagMessage = `Average composite score is ${avgComposite.toFixed(1)}/15, below the Recommend with Reservations threshold of 8/15. Review scores before finalizing.`
  }

  let interviewOutcome, aspireStatus
  if (autoRec === 'Recommend') {
    interviewOutcome = 'Recommend';           aspireStatus = 'Interviewed'
  } else if (autoRec === 'Recommend with Reservations') {
    interviewOutcome = 'Recommend with Reservations'; aspireStatus = 'Interviewed'
  } else {
    // Phase 2A safety guardrail (May 26, 2026):
    // A low rubric score no longer automatically sets students.status to 'Declined'.
    // The student remains 'Interviewed' and is surfaced for human selection review
    // via Action Center. The interview_outcome value preserves the rubric semantic.
    // Phase 2B will create the formal disposition workflow.
    // See: docs/STUDENT_DISPOSITION_WORKFLOW.md
    interviewOutcome = 'Do Not Recommend';
    aspireStatus = 'Interviewed';
  }

  return {
    avg_cj_score:        Math.round(avgCj        * 100) / 100,
    avg_pp_score:        Math.round(avgPp        * 100) / 100,
    avg_ga_score:        Math.round(avgGa        * 100) / 100,
    avg_composite_score: Math.round(avgComposite * 100) / 100,
    rubric_count:        count,
    auto_recommendation: autoRec,
    score_flag:          scoreFlag,
    score_flag_message:  scoreFlagMessage,
    interview_outcome:   interviewOutcome,
    status:              aspireStatus,
  }
}

// ── Editable rubric card in the consolidated view ────────────
function RubricCard({ r, interviewers, onSave, canEdit, canView, canChangeInterviewer, onView }) {
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
    const saved = await onSave(r.id, editForm)
    setSaving(false)
    if (saved !== false) setEditing(false)
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
          <div style={{ marginLeft:'auto', display:'flex', gap:6, flexShrink:0 }}>
            <Tooltip label={canView ? 'View rubric' : 'Rubric view restricted'} placement="top">
              <span style={{ display:'inline-flex' }}>
                <button className="btn btn-outline-modal"
                  style={{ fontSize:11, padding:'2px 10px', opacity:canView ? 1 : 0.45, cursor:canView ? 'pointer' : 'not-allowed' }}
                  disabled={!canView}
                  aria-disabled={!canView}
                  onClick={canView ? () => onView(r) : undefined}>
                  View
                </button>
              </span>
            </Tooltip>
            {canEdit && (
              <button className="btn btn-outline-modal" style={{ fontSize:11, padding:'2px 10px' }}
                onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>
        </div>
        <div className="rub-rc-scores">
          <span>CJ: {r.cj_score||0}/5</span>
          <span>PP: {r.pp_score||0}/5</span>
          <span>GA: {r.ga_score||0}/5</span>
          {r.suggested_unit && (
            <span style={{ marginLeft:8, paddingLeft:8, borderLeft:'1px solid #e5e7eb', color:'var(--text-secondary)', fontWeight:400 }}>
              Suggested: <strong style={{ color:'var(--nightfall,#1D2567)', fontWeight:600 }}>{r.suggested_unit.trim()}</strong>
            </span>
          )}
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
          {canChangeInterviewer ? (
            <select className="iv-input" style={{ fontSize:12, padding:'4px 8px', width:'100%' }}
              value={editForm.interviewer_name}
              onChange={e => setEditForm(p => ({ ...p, interviewer_name: e.target.value }))}>
              <option value="">-</option>
              {interviewers.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : <div className="iv-readonly">{r.interviewer_name || 'Unknown'}</div>}
        </div>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>Recommendation</div>
          <select className="iv-input" style={{ fontSize:12, padding:'4px 8px', width:'100%' }}
            value={editForm.individual_recommendation}
            onChange={e => setEditForm(p => ({ ...p, individual_recommendation: e.target.value }))}>
            <option value="">-</option>
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

// The candidate's ASPIRE status, in the canonical colours the legend explains. A
// Not Proceeding student carries their disposition instead, which is the same pill
// with the disposition's own words.
function AspireStatusPill({ student }) {
  if (!student?.status) return null
  const dispositionType = student.status === 'Not Proceeding' ? student.active_disposition?.disposition_type : null
  const c = dispositionType
    ? (DISPOSITION_PILL_COLORS[dispositionType] || DISPOSITION_PILL_COLORS['not_selected'])
    : (ASPIRE_STATUS_CONFIG[student.status] || ASPIRE_STATUS_CONFIG['Pending Outreach'])
  const label = dispositionType ? (DISPOSITION_TYPES[dispositionType] || student.status) : student.status
  return (
    <span className="rb-chip" data-testid="rb-status-pill"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {label}
    </span>
  )
}

export default function RubricSession({ student, rubrics, cohortId, onBack, onStudentUpdate, onRefreshStudents, onRubricsChange, toast, readOnly = false, initialRubric = null }) {
  const { userProfile, canViewStudentResumeInCohort } = useAuth()
  const normalizedRole = normalizeStaffRole(userProfile?.role)
  const canManageAllRubrics = userProfile?.is_owner === true
    || ['owner', 'admin', 'co-lead'].includes(normalizedRole)
  const isInterviewerOnly = normalizedRole === 'interviewer' && !canManageAllRubrics
  // RUBRIC-SCHEDULE-1: moving an appointment is the scheduling grant, which is
  // Owner/Admin only (api/student-update deliberately withholds it from Co-Lead),
  // so it is NOT canManageAllRubrics. Everyone else reads the appointment.
  const canReschedule = userProfile?.is_owner === true || ['owner', 'admin'].includes(normalizedRole)
  // The appointment, read once. student.* is the booking; form.* is the rubric's own
  // snapshot, which only still answers for rubrics written before a booking existed.
  const bookedDate = student.interview_scheduled_date || ''
  const bookedTime = (student.interview_scheduled_time || '').slice(0, 5)
  // RUBRIC-RESUME-OWN-1: your own unfinished rubric reopens whatever your role is.
  // This used to be gated on isInterviewerOnly, so an Owner, Admin or Co-lead who
  // saved a draft returned to a blank form while the banner counted the row they
  // had just written. Ownership is decided per row by the server's is_own verdict,
  // so a wider role can still only ever resume its OWN work, never a colleague's.
  const initialOwnRubric = selectResumableRubric(rubrics, {
    studentId: student.id,
    fullName: userProfile?.full_name,
  })
  const initialForm = initialRubric || initialOwnRubric || {
    ...initForm(),
    // Unchanged: a privileged user may be entering a rubric on behalf of an
    // interviewer, so their own name is not assumed on a blank form.
    interviewer_name: isInterviewerOnly ? (userProfile?.full_name || '') : '',
  }
  const [form,           setForm]           = useState(initialForm)
  const [rubricId,       setRubricId]       = useState(initialForm?.id || null)
  const [saveStatus,     setSaveStatus]     = useState('idle')
  const [confirmComplete,setConfirmComplete]= useState(false)
  const [confirmReset,   setConfirmReset]   = useState(false)
  const [confirmUnlock,  setConfirmUnlock]  = useState(false)
  const [refOpen,        setRefOpen]        = useState({ cj:false, pp:false, ga:false })
  const [scriptOpen,     setScriptOpen]     = useState(false)
  const [legendOpen,     setLegendOpen]     = useState(false)
  const [closingOpen,    setClosingOpen]    = useState(false)
  const [flagNote,       setFlagNote]       = useState(student.flag_note || '')
  // RUBRIC-BOOK-1 fix: the flag lives on the student RECORD, and this screen reads it
  // rather than keeping its own copy. It used to seed a state from the prop once, write,
  // and never refresh the parent: the row in memory stayed false, so leaving the rubric
  // and coming back showed the flag gone even though the database had it. flagPending is
  // only the optimistic beat between the click and the refetch.
  const [flagPending, setFlagPending] = useState(null)
  const isFlagged = flagPending ?? !!student.flagged_for_second_interview
  const [prefs, setPrefs] = useState({
    unit_preference_1: student.unit_preference_1 || '',
    unit_preference_2: student.unit_preference_2 || '',
    unit_preference_3: student.unit_preference_3 || '',
  })
  const timerRef = useRef(null)
  // RUBRIC-BOOK-1: one layout at every width, scaled; below the legibility floor
  // the spread shows one page at a time and the toolbar offers the switch.
  const { shellRef, stageRef, shellHeight, mode } = useBookScale()
  const [page, setPage] = useState('right')


  // ── Auto-save and session protection ─────────────────────────────────────
  // lastSavedAt: timestamp of the most recent successful persist() call.
  // hasUnsavedEditsRef: true between "user typed something" and "persist succeeded".
  // Refs for form/rubricId/locked allow the 30s interval to always read fresh
  // values without being recreated on every render.
  const [lastSavedAt,      setLastSavedAt]      = useState(null)
  const hasUnsavedEditsRef = useRef(false)
  const formRef            = useRef(null)
  const rubricIdRef        = useRef(null)
  const lockedRef          = useRef(false)
  const persistRef         = useRef(null)  // filled in below, after persist is defined

  // Tracks which domains are in "Other / Custom" mode per rubric instance
  const [otherClicked,    setOtherClicked]    = useState({ cj: false, pp: false, ga: false })
  const [viewingRubric,   setViewingRubric]   = useState(null)
  const [showValidation,  setShowValidation]  = useState(false)
  // Rubrics for this student
  const studentRubrics  = rubrics.filter(r => r.student_id === student.id)
  const completedRubrics = studentRubrics.filter(r => r.status === 'Completed')

  // Interviewers list and available units.
  // staleTime: 0 ensures the list is always fresh when a rubric opens - critical so
  // newly-added interviewers (from InterviewersModal) appear without a page reload.
  const { data: interviewer_unit_data } = useQuery({
    queryKey: ['rubric_support_data', cohortId],
    queryFn: async () => {
      const [profilesRes, unitsRes, catalogRes, roleInterviewersRes] = await Promise.all([
        supabase.rpc('get_active_interviewers'),        // user_profiles WHERE can_conduct_interviews = true
        supabase.from('units').select('unit_name').eq('is_participating', true).eq('cohort_id', cohortId).order('unit_name'),
        supabase.from('interviewers').select('name').order('name'),  // InterviewersModal catalog
        // Direct fallback: invited users with role='interviewer' whose can_conduct_interviews
        // may be NULL (e.g., invited before the invite flow was patched).
        supabase.from('user_profiles').select('id, full_name').eq('role', 'interviewer').eq('is_active', true),
      ])
      const rpcNames    = (profilesRes.data         || []).map(p => p.full_name).filter(Boolean)
      const catalogNames= (catalogRes.data          || []).map(i => i.name).filter(Boolean)
      const roleNames   = (roleInterviewersRes.data || []).map(p => p.full_name).filter(Boolean)
      // All three sources merged, deduplicated, alphabetically sorted
      const merged = [...new Set([...rpcNames, ...catalogNames, ...roleNames])].sort((a, b) => a.localeCompare(b))
      return {
        interviewers: merged,
        interviewerProfilesByName: Object.fromEntries(
          [...(profilesRes.data || []), ...(roleInterviewersRes.data || [])]
            .filter(p => p.id && p.full_name)
            .map(p => [p.full_name, p.id])
        ),
        availUnits:   (unitsRes.data || []).map(u => u.unit_name),
      }
    },
    enabled:   !!cohortId && !readOnly,
    staleTime: 0,  // always refetch on mount so new interviewers appear immediately
  })
  const interviewers = interviewer_unit_data?.interviewers || []
  const interviewerProfilesByName = interviewer_unit_data?.interviewerProfilesByName || {}
  const availUnits   = interviewer_unit_data?.availUnits   || []

  // Unit Availability snapshot for the student's 3 preferences - cached per student+cohort+prefs
  const { data: unitAvailability = [null, null, null], isLoading: availLoading } = useQuery({
    queryKey: ['unit_availability', cohortId, student.id,
      student.unit_preference_1, student.unit_preference_2, student.unit_preference_3],
    queryFn: async () => {
      const prefFields = [student.unit_preference_1, student.unit_preference_2, student.unit_preference_3]
      return Promise.all(prefFields.map(async unitName => {
        if (!unitName) return null
        const [unitRes, d1, d2, d3] = await Promise.all([
          supabase.from('units').select('slots_remaining, total_slots')
            .eq('unit_name', unitName).eq('cohort_id', cohortId).maybeSingle(),
          supabase.from('students').select('id', { count:'exact', head:true })
            .eq('cohort_id', cohortId).eq('unit_preference_1', unitName),
          supabase.from('students').select('id', { count:'exact', head:true })
            .eq('cohort_id', cohortId).eq('unit_preference_2', unitName),
          supabase.from('students').select('id', { count:'exact', head:true })
            .eq('cohort_id', cohortId).eq('unit_preference_3', unitName),
        ])
        return { unit: unitRes.data, demand1: d1.count||0, demand2: d2.count||0, demand3: d3.count||0 }
      }))
    },
    enabled: !!cohortId && !!student.id && !readOnly,
  })

  // When interviewer_name changes, try to load their existing rubric
  const handleInterviewerChange = async (name) => {
    if (isInterviewerOnly) return
    if (name) {
      const selectedProfileId = interviewerProfilesByName[name] || null
      const existing = studentRubrics.find(r => (
        (selectedProfileId && r.interviewer_profile_id === selectedProfileId)
        || (!selectedProfileId && r.interviewer_name === name)
      ) && r.status !== 'Completed')
      if (existing) {
        setForm(existing); setRubricId(existing.id); return
      }
    }
    // RUBRIC-RESUME-OWN-1: a name that reaches this dropdown only from the
    // `interviewers` catalog carries no id, and the row would be written owned by
    // nobody, which is how an unfinished rubric became unreachable. When the chosen
    // name is the signed-in person's own, stamp their profile id so the row is
    // theirs and reopens next time. A colleague's name is never stamped with it.
    const interviewerProfileId = interviewerProfilesByName[name]
      || (isSelfInterviewerName(name, userProfile?.full_name) ? (userProfile?.id || null) : null)
    setForm(p => ({ ...p, interviewer_name: name, interviewer_profile_id: interviewerProfileId }))
    setRubricId(null)
    // Selecting an interviewer is a meaningful action - create record immediately
    if (name) persist({ interviewer_name: name, interviewer_profile_id: interviewerProfileId }, true)
  }

  const composite = (form.cj_score || 0) + (form.pp_score || 0) + (form.ga_score || 0)

  // createIfNeeded=false: only update existing record, never create
  // createIfNeeded=true:  create record on first meaningful edit
  // Returns true on success, false on failure (caller should check before showing success UI)
  const persist = async (updates, createIfNeeded = false) => {
    if (readOnly) return false
    setSaveStatus('saving')
    const identityUpdates = isInterviewerOnly ? {
      interviewer_profile_id: userProfile?.id || null,
      interviewer_name: userProfile?.full_name || '',
    } : {}
    const scopedUpdates = { ...updates, ...identityUpdates }
    // The form may have been seeded from a list_interview_rubrics_for_cohort row, or a
    // browser draft of one, and those rows carry can_view_details / can_edit / is_own.
    // They are not columns; PostgREST rejects the whole write if one reaches it. The
    // auto-save and Mark Complete send the whole form, so every write passes the gate.
    const payload = toInterviewRubricWrite({
      ...scopedUpdates,
      composite_score: (scopedUpdates.cj_score ?? (form.cj_score || 0)) + (scopedUpdates.pp_score ?? (form.pp_score || 0)) + (scopedUpdates.ga_score ?? (form.ga_score || 0)),
      updated_at: new Date().toISOString(),
    })
    // A restored browser draft carries the id of the rubric it was taken from while
    // rubricId can still be null (the seed set only the form). Adopt that row rather
    // than inserting its id a second time, which violates interview_rubrics_pkey.
    let id = rubricId || resolveDraftRubricId(form, studentRubrics)
    if (id && !rubricId) setRubricId(id)
    if (!id) {
      const effectiveInterviewerName = payload.interviewer_name || form.interviewer_name
      if (!createIfNeeded || !effectiveInterviewerName) { setSaveStatus('idle'); return false }
      const { data, error } = await safeWrite(
        () => supabase.from('interview_rubrics').insert(toInterviewRubricInsert({
          student_id: student.id, cohort_id: cohortId, ...initForm(), ...form,
          ...(bookedDate ? { interview_date: bookedDate } : {}),
          ...(bookedTime ? { interview_time: bookedTime } : {}),
          ...payload,
        })).select().single(),
        { name: 'create rubric' }
      )
      if (error) {
        setSaveStatus('idle')
        toast?.error('Save failed', error.message || 'Could not save rubric. Please try again.')
        logEvent(supabase, {
          studentId: student.id, cohortId,
          eventType: 'rubric_save_failed',
          notes: `Interviewer: ${effectiveInterviewerName}. Error: ${error.message}`,
          auto: true,
        })
        return false
      }
      id = data.id
      setRubricId(id)
      logEvent(supabase, {
        studentId: student.id, cohortId,
        eventType: 'rubric_saved',
        notes: `Interviewer: ${effectiveInterviewerName}. Rubric created (id: ${id}).`,
        auto: true,
      })
    } else {
      const { error } = await safeWrite(
        () => supabase.from('interview_rubrics').update(payload).eq('id', id),
        { name: 'update rubric' }
      )
      if (error) {
        setSaveStatus('idle')
        toast?.error('Save failed', error.message || 'Could not save rubric. Please try again.')
        logEvent(supabase, {
          studentId: student.id, cohortId,
          eventType: 'rubric_save_failed',
          notes: `Interviewer: ${form.interviewer_name || '(unset)'}. Error: ${error.message}. Rubric id: ${id}.`,
          auto: true,
        })
        return false
      }
    }
    setSaveStatus('saved')
    setLastSavedAt(new Date())
    hasUnsavedEditsRef.current = false
    setTimeout(() => setSaveStatus('idle'), 3000)
    if (onRubricsChange) onRubricsChange()
    return true
  }

  // Debounced save - never creates a new record
  const saveText = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    hasUnsavedEditsRef.current = true
    setSaveStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => persist({ [field]: value }, false), 800)
  }
  // RUBRIC-SCHEDULE-1: saveImmediate is gone with its last caller. It existed for
  // Section 1 date and time, which now move the real booking through reschedule()
  // instead of writing a second copy onto the rubric row.
  // Immediate save for meaningful edits - creates record if first interaction
  const saveMeaningful = (field, value) => {
    setForm(p => ({ ...p, [field]: value }))
    hasUnsavedEditsRef.current = true
    persist({ [field]: value }, true)
  }
  const savePreference = async (field, value) => {
    setPrefs(p => ({ ...p, [field]: value }))
    await saveInterviewOutcome(student.id, { [field]: value })
  }

  const handleMarkComplete = async () => {
    setConfirmComplete(false)
    // createIfNeeded=true: if rubricId is somehow null (e.g. the initial INSERT
    // failed silently and the user continued typing), attempt an INSERT here
    // rather than silently doing nothing.
    const saved = await persist({ ...form, status:'Completed', composite_score: composite }, true)
    if (!saved) {
      // persist already showed an error toast - do not show success UI
      return
    }
    setForm(p => ({ ...p, status:'Completed', composite_score: composite }))
    // Fetch all completed rubrics fresh from DB so stale local state can never affect the result
    const recalc = await recalculateStudentAverages(student.id, cohortId, supabase)
    if (recalc) await saveInterviewOutcome(student.id, recalc)
    // Auto-log interview event on first rubric completion
    const already = await eventExists(supabase, student.id, 'interview')
    if (!already) {
      await logEvent(supabase, {
        studentId: student.id,
        cohortId: student.cohort_id,
        eventType: 'interview',
        notes: `Rubric submitted. Score: ${composite}/15`,
        auto: true,
      })
    }
    toast?.success('Rubric submitted', `Interview scored ${composite}/15.`)
    // Clear the localStorage draft - rubric is now persisted on the server.
    try {
      if (student?.id && userId) localStorage.removeItem(`aspire.rubric.draft.${student.id}.${userId}`)
    } catch (_) { /* non-critical */ }
    logActivity({ userProfile, actionType:'rubric_submitted', entityType:'student', entityId:student.id, cohortId, description:`${userProfile?.full_name} submitted interview rubric for ${student.first_name} ${student.last_name}. Score: ${composite}/15`, metadata:{ score: composite } })
  }

  // RUBRIC-SCHEDULE-1: Section 1's date and time ARE the appointment. Editing one
  // moves the real booking, so the Interviews Today card (which reads the calendar
  // slot) and the Interview Recommendations table (which reads the student's copy)
  // both follow. The rubric's own interview_date / interview_time columns are kept
  // in step as a snapshot, so a submitted rubric still records when it happened and
  // the roster export keeps its column, but they are no longer a second opinion.
  const [reschedError, setReschedError] = useState(null)
  const [rescheduling, setRescheduling] = useState(false)
  const reschedule = async (field, value) => {
    if (!canReschedule || !value) return
    const nextDate = field === 'date' ? value : bookedDate
    const nextTime = field === 'time' ? value : bookedTime
    if (!nextDate || !nextTime) {
      setReschedError('This student has no booked interview yet. Schedule one from the interview calendar first.')
      return
    }
    setRescheduling(true); setReschedError(null)
    try {
      const moved = await moveInterviewBooking(student.id, { date: nextDate, time: nextTime })
      const appliedDate = moved?.slot_date || nextDate
      const appliedTime = moved?.slot_time || nextTime
      setForm(p => ({ ...p, interview_date: appliedDate, interview_time: appliedTime }))
      if (rubricId) {
        await safeWrite(
          () => supabase.from('interview_rubrics')
            .update(toInterviewRubricWrite({ interview_date: appliedDate, interview_time: appliedTime, updated_at: new Date().toISOString() }))
            .eq('id', rubricId),
          { name: 'mirror rubric schedule' }
        )
      }
      toast?.success('Interview moved', `Now ${appliedDate} at ${appliedTime}.`)
      if (onRefreshStudents) await onRefreshStudents()
      if (onRubricsChange) onRubricsChange()
    } catch (err) {
      setReschedError(err.message || 'Could not move the interview.')
    } finally {
      setRescheduling(false)
    }
  }

  const handleReset = async () => {
    setConfirmReset(false)
    const blank = { ...initForm(), interviewer_name: form.interviewer_name, interview_date: form.interview_date }
    if (rubricId) await safeWrite(
      () => supabase.from('interview_rubrics').update(toInterviewRubricWrite({ ...blank, updated_at: new Date().toISOString() })).eq('id', rubricId),
      { name: 'reset rubric' }
    )
    setForm(blank)
    try {
      if (student?.id && userId) localStorage.removeItem(`aspire.rubric.draft.${student.id}.${userId}`)
    } catch (_) { /* non-critical */ }
    if (onRubricsChange) onRubricsChange()
  }

  const handleUnlock = async () => {
    setConfirmUnlock(false)
    if (rubricId) await safeWrite(
      () => supabase.from('interview_rubrics').update(toInterviewRubricWrite({ status: 'In Progress', updated_at: new Date().toISOString() })).eq('id', rubricId),
      { name: 'unlock rubric' }
    )
    setForm(p => ({ ...p, status:'In Progress' }))
    if (onRubricsChange) onRubricsChange()
  }

  // RUBRIC-BOOK-1 (Owner, 2026-09-17): pulling the ribbon IS the flag. There is no
  // reason field any more, so a new flag writes the flag alone; a note written before
  // this change stays on the record until the flag is removed.
  //
  // A refused write used to pass silently (saveInterviewOutcome throws, nothing caught
  // it), so the ribbon could sit there red with nothing saved. A Co-Lead is not allowed
  // to write this field at all, which is exactly the case that looked like it worked.
  const setFlag = async (next) => {
    setFlagPending(next)
    try {
      await saveInterviewOutcome(student.id, next
        ? { flagged_for_second_interview: true }
        : { flagged_for_second_interview: false, flag_note: '' })
      // The Interviews list reads this field for its Flagged card, its row chip and its
      // Review Flag action, so the roster is refetched rather than left stale. This is
      // onRefreshStudents, NOT onStudentUpdate: the latter is a writer that ignores a
      // call with no fields, which is why the ribbon used to spring back.
      if (onRefreshStudents) await onRefreshStudents()
      toast?.success(next ? 'Flagged' : 'Flag removed',
        next
          ? `${getStudentPreferredFullName(student)} is flagged for the placement huddle.`
          : `${getStudentPreferredFullName(student)} is no longer flagged.`)
    } catch (e) {
      toast?.error(next ? 'Not flagged' : 'Flag not removed',
        e?.message || 'The change could not be saved. Your role may not include this.')
    } finally {
      setFlagPending(null)   // whatever happened, the record is the answer
    }
  }
  const handleFlag = () => setFlag(true)
  const handleUnflag = () => setFlag(false)

  const handleRubricEdit = async (rubricId, updates) => {
    const targetRubric = studentRubrics.find(r => r.id === rubricId)
    if (!targetRubric?.can_edit) {
      toast?.error('Rubric view restricted', 'You can edit only rubrics submitted from your account.')
      return false
    }
    const safeUpdates = isInterviewerOnly
      ? { ...updates, interviewer_name: userProfile?.full_name || targetRubric.interviewer_name }
      : updates
    const composite = (safeUpdates.cj_score||0) + (safeUpdates.pp_score||0) + (safeUpdates.ga_score||0)
    const { error } = await supabase.from('interview_rubrics')
      .update(toInterviewRubricWrite({ ...safeUpdates, composite_score: composite, updated_at: new Date().toISOString() }))
      .eq('id', rubricId)
    if (error) {
      toast?.error('Save failed', error.message || 'Could not update rubric.')
      return false
    }
    if (onRubricsChange) onRubricsChange()
    // Fetch all completed rubrics fresh from DB so stale local state can never affect the result
    const recalc = await recalculateStudentAverages(student.id, cohortId, supabase)
    if (recalc) {
      await saveInterviewOutcome(student.id, recalc)
    }
    return true
  }

  const locked = readOnly || form.status === 'Completed'

  // Keep refs in sync with latest render values so the auto-save interval
  // (which has a stable closure) always uses current data.
  formRef.current     = form
  rubricIdRef.current = rubricId
  lockedRef.current   = locked
  persistRef.current  = persist

  // ── Auto-save interval (30 s) ─────────────────────────────────────────────
  // Fires every 30 seconds; if there are unsaved edits and a row exists, saves
  // the full current form state.  Acts as a safety net when field-level saves
  // fail silently due to network blips or transient RLS issues.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!hasUnsavedEditsRef.current) return
      if (!rubricIdRef.current || lockedRef.current) return
      await persistRef.current(formRef.current, false)
    }, 30_000)
    return () => clearInterval(interval)
  }, []) // deliberately [] - reads from refs, not re-created on every render

  // ── Session refresh (every 15 min) ────────────────────────────────────────
  // Ensures the JWT stays valid during long interview sessions (Supabase tokens
  // expire after 1 hour; auto-refresh normally handles this but can silently
  // fail if the tab was in the background).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          const { error } = await supabase.auth.refreshSession()
          if (error) {
            toast?.error(
              'Session expired',
              'Your session has expired. Copy your notes now, then refresh the page to continue.'
            )
          }
        }
      } catch (e) {
        console.warn('[RubricSession] session check failed (non-fatal):', e.message)
      }
    }
    checkSession()
    const interval = setInterval(checkSession, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // ── localStorage safety net ───────────────────────────────────────────────
  // Write form state to localStorage on every change (and on tab-hide / beforeunload)
  // so a refresh/crash/refetch can restore the user's work.  Keyed by student+user
  // so multiple drafts coexist safely.  This is a backup layer; the existing auto-save
  // and submit logic remain unchanged.

  const userId = userProfile?.id
  const restoredDraftKeyRef = useRef(null)
  const draftHydratedKeyRef = useRef(null)

  // Always-current snapshot of form state, used by event-driven saves that fire
  // outside the React render cycle (visibilitychange, beforeunload).
  const formStateRef = useRef({ form, prefs, flagNote, isFlagged, otherClicked })
  useEffect(() => {
    formStateRef.current = { form, prefs, flagNote, isFlagged, otherClicked }
  }, [form, prefs, flagNote, isFlagged, otherClicked])

  // Core save function - reads from ref so it always captures the latest values.
  // Guards: only writes when there is real user-entered content (not just auto-populated initial state).
  const saveDraftToLocalStorage = useCallback(() => {
    if (readOnly) return
    if (!student?.id || !userId) return
    const key = `aspire.rubric.draft.${student.id}.${userId}`
    // The save effect runs before the restore effect on first mount. Wait until
    // storage has been inspected so server state cannot overwrite a newer
    // browser draft or manufacture a fresh draft and false restore notice.
    if (draftHydratedKeyRef.current !== key) return
    try {
      const { form: f, prefs: p, flagNote: fn, isFlagged: fi, otherClicked: oc } = formStateRef.current
      if (f.status === 'Completed') {
        localStorage.removeItem(key)
        return
      }
      const draft = { formState: f, prefs: p, flagNote: fn, isFlagged: fi, otherClicked: oc, savedAt: new Date().toISOString() }
      if (!hasRubricContent(draft)) return
      localStorage.setItem(key, JSON.stringify(draft))
    } catch (err) {
      console.warn('[RubricSession] localStorage backup failed:', err)
    }
  }, [student?.id, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save on any state change (primary trigger)
  useEffect(() => {
    saveDraftToLocalStorage()
  }, [form, prefs, flagNote, isFlagged, otherClicked, saveDraftToLocalStorage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save on tab hide and browser close/refresh (catches edits the state-change effect may have missed)
  useEffect(() => {
    const onHide        = () => { if (document.visibilityState === 'hidden') saveDraftToLocalStorage() }
    const onBeforeUnload = () => saveDraftToLocalStorage()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [saveDraftToLocalStorage])

  // Restore draft from localStorage on mount or student change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (readOnly) return
    if (!student?.id || !userId) return
    const key = `aspire.rubric.draft.${student.id}.${userId}`
    if (restoredDraftKeyRef.current === key) return
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const draft = JSON.parse(raw)
      if (!draft?.savedAt) return

      // Completed rubrics are authoritative on the server and must never be
      // resurrected as browser drafts after submission.
      if (draft.formState?.status === 'Completed') {
        localStorage.removeItem(key)
        return
      }

      // Skip restore if the server has newer data (the server is authoritative)
      const serverUpdatedAt = rubrics?.find?.(r => r.student_id === student.id)?.updated_at
        || student?.updated_at
      if (serverUpdatedAt && new Date(draft.savedAt) <= new Date(serverUpdatedAt)) return

      // Skip restore if the draft has no real user-entered content - avoids false-positive toasts
      if (!hasRubricContent(draft)) {
        localStorage.removeItem(key)
        return
      }

      // Mark before updating state or showing the toast. Either operation can
      // rerender the tree, but a stored draft is restored only once per student.
      restoredDraftKeyRef.current = key

      // Restore every tracked field, and the row the draft belongs to: a draft taken
      // from an existing rubric carries that row's id, and without rubricId the next
      // edit would create a second row with the same id.
      if (draft.formState) {
        setForm(isInterviewerOnly ? {
          ...draft.formState,
          interviewer_profile_id: userProfile?.id || null,
          interviewer_name: userProfile?.full_name || '',
        } : draft.formState)
        const draftRubricId = resolveDraftRubricId(draft.formState, rubrics)
        if (draftRubricId) setRubricId(draftRubricId)
      }
      if (draft.prefs)                       setPrefs(draft.prefs)
      if (draft.flagNote   !== undefined)    setFlagNote(draft.flagNote)
      if (draft.otherClicked !== undefined)  setOtherClicked(draft.otherClicked)

      const time = new Date(draft.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      toast?.success('Draft restored', `Restored your in-progress rubric from ${time}.`)
      console.info('[RubricSession] restored localStorage draft for student', student.id)
    } catch (err) {
      console.warn('[RubricSession] localStorage restore failed:', err)
    } finally {
      // Whether storage was empty, stale, invalid, completed, or restored, the
      // current student is now safe to back up after their next real edit.
      draftHydratedKeyRef.current = key
    }
  }, [isInterviewerOnly, readOnly, rubrics, student?.id, student?.updated_at, toast, userId, userProfile?.full_name, userProfile?.id])

  // ─────────────────────────────────────────────────────────────────────────────

  // Derived question-selected flags (preset text OR Other tile clicked)
  const hasQCj = !!form.cj_question_asked || otherClicked.cj
  const hasQPp = !!form.pp_question_asked || otherClicked.pp
  const hasQGa = !!form.ga_question_asked || otherClicked.ga

  // Tri-state progress steps: 'empty' | 'partial' | 'complete'
  const stepSt = (complete, partial) => complete ? 'complete' : partial ? 'partial' : 'empty'
  const steps = [
    { id:'s1', label:'Info',           status: stepSt(!!((bookedDate || form.interview_date) && form.interviewer_name), !!((bookedDate || form.interview_date) || form.interviewer_name)) },
    { id:'s2', label:'Preferences',    status: stepSt(!!prefs.unit_preference_1, false) },
    { id:'s3', label:'Clinical',       status: stepSt(hasQCj && form.cj_score > 0, hasQCj || form.cj_score > 0) },
    { id:'s4', label:'Professional',   status: stepSt(hasQPp && form.pp_score > 0, hasQPp || form.pp_score > 0) },
    { id:'s5', label:'Goal',           status: stepSt(hasQGa && form.ga_score > 0, hasQGa || form.ga_score > 0) },
    { id:'s6', label:'Questions',      status: form.student_questions ? 'partial' : 'empty' },
    { id:'s7', label:'Recommendation', status: stepSt(!!form.individual_recommendation, false) },
  ]

  // Validation errors - computed live, gate Mark Complete, and feed the completion
  // percentage in the head. REQUIRED_ANSWERS is the length of this list.
  const validationErrors = !locked ? [
    !form.interviewer_name                       && 'Interviewer name is required in Section 1',
    !(bookedDate || form.interview_date)         && 'Date of interview is required in Section 1',
    (!form.cj_question_asked && !otherClicked.cj) && 'A question must be selected for Clinical Judgment',
    !form.cj_score                               && 'A score must be selected for Clinical Judgment',
    (!form.pp_question_asked && !otherClicked.pp) && 'A question must be selected for Professional Presence',
    !form.pp_score                               && 'A score must be selected for Professional Presence',
    (!form.ga_question_asked && !otherClicked.ga) && 'A question must be selected for Goal Alignment',
    !form.ga_score                               && 'A score must be selected for Goal Alignment',
    !form.individual_recommendation              && 'Overall recommendation is required',
  ].filter(Boolean) : []

  // How much of the rubric is done, counted against the same nine answers that gate
  // Mark Complete. A submitted rubric is finished by definition.
  const completion = locked
    ? 100
    : Math.round(((REQUIRED_ANSWERS - validationErrors.length) / REQUIRED_ANSWERS) * 100)

  // ESC closes the rubric view modal
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!viewingRubric) return
    const onKey = e => { if (e.key === 'Escape') setViewingRubric(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [viewingRubric])

  // ── The index down the fore edge follows whichever section is being read ──
  const scrollRef = useRef(null)
  const [activeStep, setActiveStep] = useState('s1')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = scrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]?.target?.id) setActiveStep(visible[0].target.id)
    }, { root, rootMargin: '0px 0px -72% 0px', threshold: 0 })
    SECTION_IDS.forEach(id => {
      const el = root.querySelector(`#${id}`)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  const goToSection = (id) => {
    const el = scrollRef.current?.querySelector(`#${id}`)
    if (!el) return
    if (mode === 'single') setPage('right')
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveStep(id)
  }

  const saveIndicator = (
    <>
      {saveStatus === 'saving' && <span className="rb-save">Saving…</span>}
      {saveStatus === 'saved'  && <span className="rb-save rb-save-ok">Saved{lastSavedAt ? ` ${fmtSaveTime(lastSavedAt)}` : ''}</span>}
      {saveStatus === 'idle' && lastSavedAt && <span className="rb-save">Saved {fmtSaveTime(lastSavedAt)}</span>}
      {saveStatus === 'error' && (
        <button type="button" className="rb-save-err" onClick={() => persistRef.current?.(formRef.current, !rubricIdRef.current)}>
          Save failed · retry
        </button>
      )}
    </>
  )

  // The three ranked units, with what the cohort already knows about each one.
  const prefRows = [
    { pref: student.unit_preference_1, rank: '1st', idx: 0 },
    { pref: student.unit_preference_2, rank: '2nd', idx: 1 },
    { pref: student.unit_preference_3, rank: '3rd', idx: 2 },
  ].map(row => {
    const avail = unitAvailability[row.idx]
    const unit  = avail?.unit ?? null
    const slots = unit?.slots_remaining ?? 0
    return {
      ...row,
      unit,
      d1: avail?.demand1 ?? 0,
      d2: avail?.demand2 ?? 0,
      d3: avail?.demand3 ?? 0,
      slots,
      // A unit is in high demand when more people want it first than it can take.
      highDemand: !!unit && (avail?.demand1 ?? 0) >= slots + 2,
    }
  })
  const seatChip = (unit, slots) => {
    if (!unit) return null
    if (slots > 1)  return <span className="rb-chip rb-chip-open" data-testid="seat-chip">{slots} open</span>
    if (slots === 1) return <span className="rb-chip rb-chip-demand" data-testid="seat-chip">1 left</span>
    return <span className="rb-chip rb-chip-full" data-testid="seat-chip">Full</span>
  }
  // The role the candidate already holds here, when we hold one. There is no
  // years-of-service field in ASPIRE, so the book says the role, not a tenure.
  const currentRole = [student.cs_role, student.cs_department].filter(Boolean).join(', ')
    || student.cs_affiliation || ''

  // The left page opens with who this person already is: the role they hold here, the
  // affiliation that role sits in, whatever healthcare work came before it, and the shift
  // they asked for. Anything unanswered is left out rather than shown as a blank.
  const backgroundRows = [
    ['Current role', currentRole],
    ['Cedars-Sinai affiliation', student.cs_affiliation],
    ['Healthcare experience', student.prior_healthcare_experience],
    ['Shift preference', student.shift_availability],
  ].filter(([, v]) => v)

  // AVAILABILITY-CANON-1B: structural facts only, never a reason or a note. The rotation
  // row is not loaded here, so the program's minimum days is simply absent from the facts.
  const availabilityAnswered = student.availability_ack != null
    || (Array.isArray(student.unavailable_weekdays) && student.unavailable_weekdays.length > 0)
    || (Array.isArray(student.preferred_days) && student.preferred_days.length > 0)
    || student.nights_available != null
    || student.weekends_available != null
    || (Array.isArray(student.personal_blackout_dates) && student.personal_blackout_dates.length > 0)
  const availability = availabilityAnswered ? getAvailabilityReadiness({ student }) : null


  return (
    <div
      className="rb-shell"
      ref={shellRef}
      data-rubric-book=""
      data-rb-mode={mode}
      data-rb-page={page}
      data-rb-readonly={readOnly ? 'true' : 'false'}
      style={shellHeight ? { '--rb-shell-h': `${shellHeight}px` } : undefined}
    >
      {!readOnly && (
        <div className="rb-toolbar">
          <BackButton label="Back to Interview List" onClick={onBack} />
          {saveIndicator}
          {mode === 'single' && (
            <div className="rb-switch" role="group" aria-label="Which page">
              <button type="button" aria-pressed={page === 'left'}  onClick={() => setPage('left')}>Candidate</button>
              <button type="button" aria-pressed={page === 'right'} onClick={() => setPage('right')}>Rubric</button>
            </div>
          )}
          {locked && (
            <div className="rb-toolbar-right">
              <button type="button" className="rb-btn" onClick={() => setConfirmUnlock(true)}>Unlock to Edit</button>
            </div>
          )}
        </div>
      )}

      <div className="rb-stage" ref={stageRef}>
        <div className="rb-book">
          <div className="rb-cover material-leather-tan">
            <div className="rb-spread">

              {/* The ribbon is sewn into the book, so it stays put while the page
                  under it scrolls. */}
              {!readOnly && (
                <FlagRibbon flagged={isFlagged} onFlag={handleFlag} onUnflag={handleUnflag} />
              )}

              {/* ── Left page: the candidate ───────────────────────────────── */}
              <section className="rb-page rb-page-left" aria-label="Candidate">
                <div className="rb-id">
                  <div className="rb-avatar">
                    <StudentAvatar student={student} size={96} style={{ fontSize: '30px' }} />
                  </div>
                  <div className="rb-name">{getStudentPreferredFullName(student)}</div>
                  <div className="rb-sub">
                    {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
                  </div>
                  <div className="rb-chiprow"><AspireStatusPill student={student} /></div>
                  {(student.cumulative_gpa != null || (canViewStudentResumeInCohort(cohortId) && student.resume_url)) && (
                    <div className="rb-chiprow" style={{ marginTop: 10 }}>
                      {student.cumulative_gpa != null && (
                        <span className={`rb-chip rb-chip-quiet${gpaBand(student.cumulative_gpa) ? ` rb-chip-gpa-${gpaBand(student.cumulative_gpa)}` : ''}`}
                          data-testid="gpa-chip">
                          GPA {parseFloat(student.cumulative_gpa).toFixed(2)}
                        </span>
                      )}
                      {/* WAVE F-2: the resume opens through the server access endpoint, and
                          only for someone entitled to this cohort's files. */}
                      {canViewStudentResumeInCohort(cohortId) && student.resume_url && (
                        <button type="button" className="rb-chip rb-chip-quiet rb-chip-btn"
                          data-testid="resume-button"
                          onClick={() => openStudentFile({ studentId: student.id, kind: 'resume' })}>
                          {resumeActionLabel(student.resume_url)}
                        </button>
                      )}
                    </div>
                  )}
                  {!readOnly && (
                    <p className="rb-flagnote" data-testid="flag-caption">
                      {isFlagged
                        ? 'Flagged for the placement huddle. The ASPIRE team sees this candidate first.'
                        : 'Not flagged. Pull the ribbon down to flag for the placement huddle.'}
                    </p>
                  )}
                  {/* A reason written before RUBRIC-BOOK-1 is still on the record, so it
                      is still shown. New flags carry no note. */}
                  {isFlagged && flagNote && (
                    <p className="rb-flagnote" data-testid="flag-legacy-note">Earlier note: {flagNote}</p>
                  )}
                </div>

                {/* The appointment is Section 1's, editable there; repeating it here as
                    read-only text told the interviewer nothing twice (Owner, 2026-09-17).
                    What the left page opens with instead is who this person already is. */}
                {backgroundRows.length > 0 && (
                  <div className="rb-block">
                    <div className="rb-block-label">Background</div>
                    {backgroundRows.map(([label, value]) => (
                      <div className="rb-kv" key={label}>
                        <span className="rb-kv-key">{label}</span>
                        <span className="rb-kv-val">{value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rb-block">
                  {/* No Refresh control: the availability query runs when the rubric opens,
                      which is the only moment an interviewer would have pressed it. */}
                  <div className="rb-block-label">Submitted Preferences</div>
                  {prefRows.every(r => !r.pref) && <div className="rb-empty">Not submitted</div>}
                  {prefRows.filter(r => r.pref).map(({ pref, rank, unit, d1, d2, d3, slots, highDemand }) => (
                    <div className="rb-pref" key={rank} data-testid="pref-block">
                      <div className="rb-pref-top">
                        <div style={{ minWidth: 0 }}>
                          <div className="rb-pref-name">
                            <span className="rb-pref-rank">{rank}</span>{pref}
                          </div>
                          {unit && (
                            <div className="rb-pref-counts">1st: {d1} · 2nd: {d2} · 3rd: {d3}</div>
                          )}
                        </div>
                        {highDemand && <span className="rb-chip rb-chip-demand" data-testid="demand-chip">High demand</span>}
                      </div>
                      {availLoading && !unit
                        ? <div className="avail-skeleton" />
                        : !unit
                          ? <div className="rb-empty">Not participating this cycle</div>
                          : <div className="rb-pref-chips">{seatChip(unit, slots)}</div>}
                      {unit && slots === 0 && (
                        <div className="rb-warn">This unit is full. Consider exploring alternatives during the interview.</div>
                      )}
                    </div>
                  ))}
                </div>

                {student.interest_statement && (
                  <div className="rb-block">
                    <div className="rb-block-label">Interest Statement</div>
                    <div className="rb-quote-block">{student.interest_statement}</div>
                  </div>
                )}

                {/* AVAILABILITY-CANON-1B: what the student answered on the form, in the
                    same privacy-safe structural terms the Placement Board uses. Shown only
                    when they answered something; there is nothing to report otherwise. */}
                {availability && (
                  <div className="rb-block">
                    <div className="rb-block-label">Availability</div>
                    {/* The readiness pill and the acknowledgement line are the Placement
                        Board's business, not the interviewer's (Owner, 2026-09-17): in the
                        room, what matters is which days the student can actually work. */}
                    {availability.facts.filter(f => !f.startsWith('Acknowledged')).map(fact => {
                      const at = fact.indexOf(':')
                      const key = at === -1 ? fact : fact.slice(0, at)
                      const val = at === -1 ? '' : fact.slice(at + 1).trim()
                      return (
                        <div className="rb-kv" key={fact}>
                          <span className="rb-kv-key">{key}</span>
                          <span className="rb-kv-val">{val}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <div className="rb-seam" aria-hidden="true" />

              {/* ── Right page: the rubric ─────────────────────────────────── */}
              <section className="rb-page rb-page-right" aria-label="Rubric">
                {/* Three things, and the head stays one line: how much of THIS rubric is
                    done, the guide that explains the scale, and the score it adds up to.
                    The recommendation is Section 7's own answer and the ASPIRE status is on
                    the candidate page; neither is repeated here (Owner, 2026-09-17). */}
                <header className="rb-head" data-testid="rb-head">
                  <span className="rb-head-side">
                    <span className="rb-head-key">Completion</span>
                    <span className="rb-head-pct" data-testid="rb-completion">{completion}%</span>
                  </span>

                  <button type="button" className="rb-head-guide" data-testid="rb-guide-toggle"
                    aria-expanded={legendOpen} onClick={() => setLegendOpen(p => !p)}>
                    {legendOpen ? '▾' : '▸'} Scoring Guide
                  </button>

                  <span className="rb-head-score">
                    <span className="rb-head-key">Composite</span>
                    <span className="rb-head-num" data-testid="rb-composite">{composite}</span>
                    <span className="rb-head-den">/ 15</span>
                  </span>
                </header>

                {/* Open from the head, so a 4 can be looked up from anywhere on the page. */}
                {legendOpen && (
                  <div className="rb-guide-drawer" data-testid="scoring-guide">
                    {SCORE_GUIDE.map(row => (
                      <p key={row.s}>
                        <span className="rb-guide-head">{row.s} · {row.label}:</span> {row.desc}
                      </p>
                    ))}
                  </div>
                )}

                <div className="rb-scroll" id="rb-scroll" ref={scrollRef}>
                  {!locked && !form.interviewer_name && (
                    <div className="rb-banner">Select your name in Section 1 to begin saving your rubric.</div>
                  )}

                  {/* Other people's rubrics for this student. Your own is the form on
                      screen, so it is never counted back to you. */}
                  {!readOnly && (() => {
                    const others     = studentRubrics.filter(r => !isOwnRubricRow(r, { fullName: userProfile?.full_name }))
                    const submitted  = others.filter(r => r.status === 'Completed').length
                    const unfinished = others.filter(r => r.status !== 'Completed')
                    if (!submitted && !unfinished.length) return null
                    const parts = []
                    if (submitted) parts.push(`${submitted} rubric${submitted !== 1 ? 's' : ''} already submitted`)
                    if (unfinished.length) {
                      const who = [...new Set(unfinished.map(r => String(r.interviewer_name || '').trim()).filter(Boolean))]
                      parts.push(`${unfinished.length} rubric${unfinished.length !== 1 ? 's' : ''} in progress`
                        + (who.length ? ` (${who.join(', ')})` : ''))
                    }
                    return (
                      <div className="rb-banner">
                        <strong>{parts.join(' and ')}</strong> for this student.
                        {!rubricId && ' You are adding a new rubric. Each interviewer scores independently.'}
                      </div>
                    )
                  })()}

                  {/* ── Section 1 ── */}
                  <section className="rb-section" id="s1">
                    <div className="rb-title">Section 1: Interview Info</div>
                    <div className="rb-grid-2">
                      <div className="rb-field">
                        <label className="rb-label" htmlFor="rb-date">Date of interview</label>
                        {canReschedule && !readOnly
                          ? <input id="rb-date" className="rb-input rb-input-mono" type="date" disabled={rescheduling}
                              value={bookedDate} onChange={e => reschedule('date', e.target.value)} />
                          : <div className="rb-readonly">{bookedDate || form.interview_date || '-'}</div>}
                      </div>
                      <div className="rb-field">
                        <label className="rb-label" htmlFor="rb-interviewer">Interviewer name</label>
                        {locked || isInterviewerOnly
                          ? <div className="rb-readonly">{form.interviewer_name || userProfile?.full_name || '-'}</div>
                          : <select id="rb-interviewer" className="rb-input" value={form.interviewer_name}
                              onChange={e => handleInterviewerChange(e.target.value)}>
                              <option value="">Select interviewer…</option>
                              {interviewers.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>}
                      </div>
                    </div>
                    <div className="rb-grid-2">
                      <div className="rb-field">
                        <label className="rb-label" htmlFor="rb-time">Interview time</label>
                        {canReschedule && !readOnly
                          ? <input id="rb-time" className="rb-input rb-input-mono" type="time" step="60" disabled={rescheduling}
                              value={bookedTime} onChange={e => reschedule('time', e.target.value)} />
                          : <div className="rb-readonly">{bookedTime || form.interview_time || '-'}</div>}
                      </div>
                    </div>
                    {/* The band speaks only when the move was refused. That the date moves the
                        booking is not news to anyone who just changed it (Owner, 2026-09-17). */}
                    {canReschedule && !readOnly && reschedError && (
                      <p className="rb-note-band rb-note-band-err">{reschedError}</p>
                    )}
                  </section>

                  <button type="button" className="rb-disclosure" onClick={() => setScriptOpen(p => !p)} aria-expanded={scriptOpen}>
                    <span className="rb-disclosure-mark">{scriptOpen ? '▾' : '▸'}</span>Interview Opening Script
                  </button>
                  {scriptOpen && (
                    <div className="rb-guide">
                      <p className="rb-guide-head">Getting started</p>
                      <p>Begin by introducing yourself and your role. Then invite the student to briefly introduce themselves.</p>
                      <p>Once you are both settled, say:</p>
                      <p className="rb-quote">"Thanks for being here today. The goal of this interview is to get a better sense of your clinical readiness and explore how we can best support your transition into professional nursing practice."</p>
                      <p className="rb-guide-head">Introduce ASPIRE</p>
                      <p className="rb-quote">"ASPIRE offers senior nursing students the opportunity to complete their final clinical rotation at Cedars-Sinai Medical Center. It is designed to support a seamless transition into our New Graduate RN Residency Program through personalized unit and preceptor matching, mentorship, application guidance, and connection to a strong nursing community."</p>
                      <p className="rb-guide-head">Explain the interview format</p>
                      <p className="rb-quote">"This is a structured, rubric-based interview. I will be asking at least one question in each of three areas: Clinical Judgment, Professional Presence, and Goal Alignment. These are grounded in the AACN Essentials for nursing practice. There are no right or wrong answers. We simply want to hear your honest thoughts and experiences. I may take notes as we go, and we will close with a brief recommendation. Take all the time you need before answering. Ready to begin?"</p>
                    </div>
                  )}

                  {/* ── Section 2 ── */}
                  <section className="rb-section" id="s2">
                    <div className="rb-title">Section 2: Unit Preferences and Rationale</div>
                    <p className="rb-prompt">"Before we dive in, can you share your top three unit choices and why?"</p>
                    <div className="rb-grid-3">
                      {(['unit_preference_1','unit_preference_2','unit_preference_3']).map((f, i) => (
                        <div className="rb-field" key={f}>
                          <label className="rb-label" htmlFor={`rb-${f}`}>{['1st','2nd','3rd'][i]} choice</label>
                          {locked
                            ? <div className="rb-readonly">{prefs[f] || '-'}</div>
                            : <select id={`rb-${f}`} className="rb-input" value={prefs[f]} onChange={e => savePreference(f, e.target.value)}>
                                <option value="">Not specified</option>
                                {availUnits.map(u => <option key={u} value={u}>{u}</option>)}
                              </select>}
                          {prefRows[i]?.unit && (
                            <div className="rb-pref-chips">{seatChip(prefRows[i].unit, prefRows[i].slots)}</div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="rb-field">
                      <label className="rb-label" htmlFor="rb-rationale">Unit preferences, rationale, and introduction notes</label>
                      {locked
                        ? <div className="rb-readonly rb-readonly-tall">{form.unit_preferences_rationale || '-'}</div>
                        : <textarea id="rb-rationale" className="rb-textarea" rows={4} value={form.unit_preferences_rationale}
                            onChange={e => saveText('unit_preferences_rationale', e.target.value)}
                            placeholder="Capture rationale, introduction observations…" />}
                    </div>
                  </section>

                  {/* ── Sections 3 to 5: the scored domains ── */}
                  {DOMAINS.map(({ key, snum, title, questions }) => {
                    const qField = `${key}_question_asked`
                    const sField = `${key}_score`
                    const nField = `${key}_notes`
                    const ref    = DOMAIN_REF[key]
                    const isOtherActive = otherClicked[key] || (!!form[qField] && !questions.includes(form[qField]))

                    return (
                      <section className="rb-section" id={`s${snum}`} key={key}>
                        <div className="rb-eyebrow">Domain {snum - 2}</div>
                        <div className="rb-title">Section {snum}: {title}</div>

                        <button type="button" className="rb-disclosure" aria-expanded={!!refOpen[key]}
                          onClick={() => setRefOpen(p => ({ ...p, [key]: !p[key] }))}>
                          <span className="rb-disclosure-mark">{refOpen[key] ? '▾' : '▸'}</span>Show interview guide
                        </button>
                        {refOpen[key] && (
                          <div className="rb-guide">
                            <p><span className="rb-guide-head">Description:</span> {ref.desc}</p>
                            <p><span className="rb-guide-head">Basis:</span> {ref.basis}</p>
                            <p><span className="rb-guide-head">Listen for:</span> {ref.listen}</p>
                          </div>
                        )}

                        <p className="rb-label">Ask at least one of the following</p>
                        <div className="rb-choices" role="radiogroup" aria-label={`Question asked for ${title}`}>
                          {questions.map((q, qi) => {
                            const sel = form[qField] === q && !isOtherActive
                            if (locked && !sel) return null
                            return (
                              <button type="button" key={qi} role="radio" aria-checked={sel} disabled={locked}
                                className={`rb-choice${sel ? ' rb-choice-sel' : ''}`}
                                onClick={!locked ? () => {
                                  setOtherClicked(p => ({ ...p, [key]: false }))
                                  saveMeaningful(qField, q)
                                } : undefined}>
                                {q}
                              </button>
                            )
                          })}
                          {(!locked || isOtherActive) && (
                            <button type="button" role="radio" aria-checked={isOtherActive} disabled={locked}
                              className={`rb-choice${isOtherActive ? ' rb-choice-sel' : ''}`}
                              data-testid={`other-${key}`}
                              onClick={!locked ? () => {
                                setOtherClicked(p => ({ ...p, [key]: true }))
                                if (questions.includes(form[qField])) setForm(p => ({ ...p, [qField]: '' }))
                              } : undefined}>
                              Other / custom question
                            </button>
                          )}
                        </div>

                        {isOtherActive && (
                          <div className="rb-field" style={{ marginTop: 14 }}>
                            <label className="rb-label" htmlFor={`rb-${qField}`}>Type the custom question asked</label>
                            {locked
                              ? <div className="rb-readonly">{form[qField] || '-'}</div>
                              : <textarea id={`rb-${qField}`} className="rb-textarea" rows={2} value={form[qField]}
                                  placeholder="Enter the question you asked the student…"
                                  onChange={e => saveText(qField, e.target.value)} />}
                          </div>
                        )}

                        <div className="rb-field" style={{ marginTop: 14 }}>
                          <label className="rb-label" htmlFor={`rb-${nField}`}>Notes and response summary</label>
                          {locked
                            ? <div className="rb-readonly rb-readonly-tall">{form[nField] || '-'}</div>
                            : <textarea id={`rb-${nField}`} className="rb-textarea" rows={3} value={form[nField]}
                                placeholder="Key points from the student's response…"
                                onChange={e => saveText(nField, e.target.value)} />}
                        </div>

                        <div className="rb-field">
                          <span className="rb-label">Rate this domain</span>
                          <div className="rb-scale" role="radiogroup" aria-label={`Rate ${title}`}>
                            {[1,2,3,4,5].map(s => {
                              const sel = form[sField] === s
                              return (
                                <button type="button" key={s} role="radio" aria-checked={sel} disabled={locked}
                                  className={`rb-score${sel ? ' rb-score-sel' : ''}`}
                                  data-testid={`score-${key}-${s}`}
                                  onClick={!locked ? () => saveMeaningful(sField, s) : undefined}>
                                  <span className="rb-score-num">{s}</span>
                                  <span className="rb-score-lbl">{SCORE_LABELS[s]}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </section>
                    )
                  })}

                  <div className="rb-scores-line" data-testid="rb-breakdown">
                    <span>Clinical Judgment <strong>{form.cj_score || 0}/5</strong></span>
                    <span>Professional Presence <strong>{form.pp_score || 0}/5</strong></span>
                    <span>Goal Alignment <strong>{form.ga_score || 0}/5</strong></span>
                  </div>

                  {/* ── Section 6 ── */}
                  <section className="rb-section" id="s6" style={{ marginTop: 34 }}>
                    <div className="rb-title">Section 6: Student Questions</div>
                    <p className="rb-prompt">"Before we wrap up, what questions do you have for us?"</p>
                    {locked
                      ? <div className="rb-readonly rb-readonly-tall">{form.student_questions || '-'}</div>
                      : <textarea className="rb-textarea" rows={3} value={form.student_questions}
                          placeholder="Student questions and notable comments (optional)…"
                          onChange={e => saveText('student_questions', e.target.value)} />}
                  </section>

                  <button type="button" className="rb-disclosure" onClick={() => setClosingOpen(p => !p)} aria-expanded={closingOpen}>
                    <span className="rb-disclosure-mark">{closingOpen ? '▾' : '▸'}</span>Interview Closing Script
                  </button>
                  {closingOpen && (
                    <div className="rb-guide">
                      {/* Owner, 2026-09-17: the script says only what Section 6 does not.
                          The closing question, the note-taking instruction and the
                          résumé reminder all live elsewhere, so they are not repeated. */}
                      <p className="rb-guide-head">Closing the interview</p>
                      <p className="rb-quote">"Thank you so much for your time today. It was wonderful speaking with you. From here, our team will review your rubric and work with unit leadership to find a preceptor who is a great fit for your learning goals. Once a placement is confirmed, we will reach out with your rotation schedule and orientation details.</p>
                      <p className="rb-quote">You will hear from us either way. If anything comes up before then, please reach out. It was a pleasure meeting you."</p>
                    </div>
                  )}

                  {/* ── Section 7 ── */}
                  <section className="rb-section" id="s7">
                    <div className="rb-title">Section 7: Your Recommendation</div>
                    <p className="rb-label">This is your individual recommendation. Do not share your decision with the student.</p>
                    <div className="rb-recs" role="radiogroup" aria-label="Your recommendation">
                      {REC_OPTIONS.map(opt => {
                        const sel = form.individual_recommendation === opt.value
                        if (locked && !sel) return null
                        return (
                          <button type="button" key={opt.value} role="radio" aria-checked={sel} disabled={locked}
                            className={`rb-rec${sel ? ' rb-rec-sel' : ''}`}
                            style={sel ? { background: opt.bg, color: opt.color } : undefined}
                            onClick={!locked ? () => saveMeaningful('individual_recommendation', opt.value) : undefined}>
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                    <p className="rb-note-band">
                      The final recommendation is averaged from every interviewer's composite score. Yours is recorded, and the averaged result is what drives the student's interview outcome.
                    </p>
                    <div className="rb-field" style={{ marginTop: 16 }}>
                      <label className="rb-label" htmlFor="rb-suggested">Suggested unit</label>
                      {locked
                        ? <div className="rb-readonly">{form.suggested_unit || '-'}</div>
                        : <input id="rb-suggested" className="rb-input" value={form.suggested_unit}
                            placeholder="Unit you would suggest"
                            onChange={e => saveText('suggested_unit', e.target.value)} />}
                    </div>
                    <div className="rb-field">
                      <label className="rb-label" htmlFor="rb-summary">Summary comments</label>
                      {locked
                        ? <div className="rb-readonly rb-readonly-tall">{form.summary_comments || '-'}</div>
                        : <textarea id="rb-summary" className="rb-textarea" rows={4} value={form.summary_comments}
                            placeholder="Overall impressions, strengths, areas for development…"
                            onChange={e => saveText('summary_comments', e.target.value)} />}
                    </div>
                  </section>

                  {!locked && (
                    <>
                      {showValidation && validationErrors.length > 0 && (
                        <div className="rb-errors" data-testid="rb-validation">
                          <div className="rb-errors-head">Please complete the following before submitting:</div>
                          {validationErrors.map((e, i) => <div key={i}>• {e}</div>)}
                        </div>
                      )}
                      <div className="rb-actions">
                        <button type="button" className="rb-btn" onClick={() => setConfirmReset(true)}>Reset Form</button>
                        <button type="button" className="rb-btn rb-btn-primary"
                          style={{ opacity: validationErrors.length > 0 ? 0.55 : 1 }}
                          onClick={() => {
                            if (validationErrors.length > 0) { setShowValidation(true); return }
                            setShowValidation(false); setConfirmComplete(true)
                          }}>
                          Mark My Rubric Complete
                        </button>
                      </div>
                    </>
                  )}
                  {locked && (
                    <div className="rb-locked">Your rubric is marked Complete. Use Unlock to Edit to make changes.</div>
                  )}

                  {!readOnly && completedRubrics.length > 0 && (
                    <div className="rb-others">
                      <div className="rb-others-title">All Rubrics for This Student ({completedRubrics.length})</div>
                      {completedRubrics.map(r => {
                        const canViewRubric = canManageAllRubrics || r.can_view_details === true
                        const canEditRubric = canManageAllRubrics || r.can_edit === true
                        return (
                          <RubricCard key={r.id} r={r} interviewers={interviewers} onSave={handleRubricEdit}
                            canView={canViewRubric}
                            canEdit={canEditRubric}
                            canChangeInterviewer={canManageAllRubrics}
                            onView={() => { if (canViewRubric) setViewingRubric(r) }} />
                        )
                      })}
                      <div className="rub-avg-display">
                        <span>Average Composite: <strong>{(() => {
                          const scored = completedRubrics.filter(r => (r.composite_score || 0) > 0)
                          if (!scored.length) return '-'
                          const avg = scored.reduce((s, r) => s + (r.composite_score || 0), 0) / scored.length
                          return avg.toFixed(1)
                        })()}/15</strong></span>
                        {student.auto_recommendation && (() => {
                          const rec = student.auto_recommendation
                          const recColor = rec === 'Recommend' ? '#166534' : rec === 'Recommend with Reservations' ? '#92400e' : '#991b1b'
                          const recBg    = rec === 'Recommend' ? '#dcfce7' : rec === 'Recommend with Reservations' ? '#fef3c7' : '#fee2e2'
                          return (
                            <span style={{ marginLeft:16, display:'inline-flex', alignItems:'center', gap:4 }}>
                              <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:'var(--aspire-radius-pill)', background:recBg, color:recColor }}>
                                {rec === 'Recommend' ? 'Recommend' : rec === 'Recommend with Reservations' ? 'With Reservations' : 'Do Not Recommend'}
                              </span>
                              <ScoreFlag message={student.score_flag ? student.score_flag_message : ''} />
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* ── The index down the fore edge ───────────────────────────── */}
              <nav className="rb-index" aria-label="Rubric sections">
                {/* The number leads, as it does on a real index. How much is done is
                    a percentage in the head now, so a tab carries no second mark. */}
                {steps.map((s, i) => (
                  <button type="button" key={s.id} data-testid={`rb-tab-${s.id}`}
                    className={`rb-tab${activeStep === s.id ? ' rb-tab-active' : ''}`}
                    /* A tab's share of the edge follows the length of its own word. */
                    style={{ flexGrow: s.label.length + 5 }}
                    aria-current={activeStep === s.id ? 'true' : undefined}
                    aria-label={`Section ${i + 1}: ${s.label}`}
                    onClick={() => goToSection(s.id)}>
                    <span className="rb-tab-num">{String(i + 1).padStart(2, '0')}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </nav>

            </div>
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

      {/* A colleague's rubric opens in the same book, with the pen put down. */}
      {viewingRubric && (canManageAllRubrics || viewingRubric.can_view_details === true) && (
        <div className="modal-overlay" onMouseDown={() => setViewingRubric(null)}>
          <div className="modal-rubric-view" onMouseDown={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderBottom:'1px solid var(--color-border-subtle, #f3f4f6)', flexShrink:0 }}>
              <div style={{ fontFamily:'Plus Jakarta Sans', fontWeight:700, fontSize:15, color:'var(--color-text-primary)' }}>
                Rubric, {viewingRubric.interviewer_name || 'Unknown Interviewer'}
              </div>
              <button className="modal-close" onClick={() => setViewingRubric(null)}>×</button>
            </div>
            <div style={{ overflowY:'auto', flex:1 }}>
              <RubricSession
                student={student}
                rubrics={rubrics}
                cohortId={cohortId}
                onBack={() => setViewingRubric(null)}
                onStudentUpdate={onStudentUpdate}
                onRubricsChange={onRubricsChange}
                toast={toast}
                readOnly
                initialRubric={viewingRubric}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
