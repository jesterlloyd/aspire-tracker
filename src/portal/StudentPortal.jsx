// PHASE2-PORTAL / ASPIRE-STUDENT-PORTAL: student portal home. Mobile-first,
// profile-forward redesign.
//
// Reads (all server-authorized):
//   - Summary (profile, placement, cohort, hours): GET /api/portal/student-summary
//   - Shift logs / evaluation statuses / certificate: scoped definer views
//     (empty for anyone without an active student grant)
// Writes: only self-service presentation fields via /api/portal/update-profile
// (EditProfileDrawer). Shift logging stays on the public /shift-log flow;
// evaluations stay on their tokenized links.
import { useState, useEffect, useRef } from 'react'
import { MapPin, Clock, ListChecks, ClipboardCheck, CalendarPlus, LifeBuoy, Pencil, Mail, ChevronRight, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { deriveNextSteps } from '../lib/portalNextSteps'
import { fmtDate, placementWindow, TBC } from '../lib/portalDates'
import { composePortalEmail } from '../lib/outlookCompose'
import EditProfileDrawer from './EditProfileDrawer'

const SUPPORT = 'aspire@cshs.org'
const CONTACT_SUBJECT = 'ASPIRE Student Support Request'

const EVAL_STATUS_LABELS = {
  draft: 'Not yet sent', sent: 'Waiting for you', opened: 'In progress',
  completed: 'Completed', reminder_due: 'Waiting for you',
  non_responder: 'Window closed', expired: 'Window closed', revoked: 'Withdrawn',
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

// Approved, non-sensitive support message body (no ids, notes, scores, or history).
function buildContactBody({ name, school, cohort, status } = {}) {
  return `Hello ASPIRE Team,\n\nI am contacting you for assistance.\n\nName: ${name || 'not available'}\nSchool: ${school || 'not available'}\nCohort: ${cohort || 'not available'}\nASPIRE status: ${status || 'not available'}\n\nMy question or concern:\n\n\nThank you.`
}

function SectionCard({ icon: Icon, title, accent, children, span }) {
  return (
    <section className={`ptl-card ptl-section${span ? ' ptl-span2' : ''}`}>
      <div className="ptl-section-head">
        <span className="ptl-section-icon" style={accent ? { background: accent.bg, color: accent.fg } : undefined}><Icon size={16} /></span>
        <h2 className="ptl-section-title">{title}</h2>
      </div>
      {children}
    </section>
  )
}

export default function StudentPortal({ editOpen = false, onOpenEdit, onCloseEdit }) {
  const { user } = useAuth()
  const loginEmail = user?.email || ''
  const [summary, setSummary]   = useState(null)
  const [logs, setLogs]         = useState([])
  const [evals, setEvals]       = useState([])
  const [certs, setCerts]       = useState([])
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [compose, setCompose]   = useState(null) // { kind: 'outlook'|'sent'|'blocked', loginEmail?, body? }
  const editBtnRef = useRef(null)

  // Contact ASPIRE: route recognized Microsoft 365 logins to Outlook Web, others
  // to a separate-tab mailto. Called synchronously from the click so the popup is
  // attributed to the gesture; never navigates the current ASPIRE tab.
  const contactAspire = (ctx) => {
    const body = buildContactBody(ctx)
    const res = composePortalEmail({ to: SUPPORT, subject: CONTACT_SUBJECT, body, loginEmail })
    if (!res.opened) setCompose({ kind: 'blocked', body })
    else if (res.mode === 'outlook') setCompose({ kind: 'outlook', loginEmail: res.loginEmail })
    else setCompose({ kind: 'sent' })
  }
  const copy = (text) => { try { navigator.clipboard?.writeText(text) } catch { /* clipboard unavailable */ } }

  async function load() {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) { setError('Your session expired. Please sign in again.'); setLoading(false); return }
      const [summaryRes, logsRes, evalsRes, certsRes] = await Promise.all([
        fetch('/api/portal/student-summary', { headers: { Authorization: `Bearer ${token}` } }),
        supabase.from('portal_my_shift_logs').select('*').order('shift_date', { ascending: false }),
        supabase.from('portal_my_evaluation_assignments').select('*').order('sent_at', { ascending: false }),
        supabase.from('portal_my_certificates').select('*'),
      ])
      const summaryData = summaryRes.ok ? await summaryRes.json() : { students: [] }
      setSummary(summaryData)
      setActiveId(prev => prev || summaryData.students?.[0]?.id || null)
      setLogs(logsRes.data || [])
      setEvals(evalsRes.data || [])
      setCerts(certsRes.data || [])
    } catch {
      setError('We could not load your portal right now. Please try again shortly.')
    }
    setLoading(false)
  }

  useEffect(() => { let c = false; load().then(() => { if (c) return }); return () => { c = true } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="ptl-muted ptl-loading">Loading your information...</div>
  if (error)   return <div className="ptl-card ptl-error">{error}</div>

  const students = summary?.students || []
  if (students.length === 0) {
    return (
      <div className="ptl-card ptl-center-card">
        <div className="ptl-card-title">No student record is linked yet</div>
        <p className="ptl-muted">Your account is active, but no student record is connected to it yet. Please contact the ASPIRE team.</p>
        <button type="button" className="ptl-btn ptl-btn-sm" onClick={() => contactAspire({})} aria-label="Contact ASPIRE (opens an email compose in a new tab)"><Mail size={15} /> Contact ASPIRE</button>
        <ComposeNote compose={compose} onDismiss={() => setCompose(null)} onCopyEmail={() => copy(SUPPORT)} onCopyMessage={copy} />
      </div>
    )
  }

  const student = students.find(s => s.id === activeId) || students[0]
  const myLogs  = logs.filter(l => l.student_id === student.id)
  const myEvals = evals.filter(e => e.student_id === student.id)
  const myCert  = certs.find(c => c.student_id === student.id) || null
  const supportItems = myLogs.filter(l => (l.support_needed || '').trim().length > 0)

  const required = student.hours.required
  const approved = student.hours.approved || 0
  const pending  = student.hours.pending || 0
  const hoursReliable = Number.isFinite(required) && required > 0 && Number.isFinite(approved)
  const pct = hoursReliable ? Math.min(100, Math.round((approved / required) * 100)) : null

  const steps = deriveNextSteps({ status: student.status, hours: { approved, required }, evaluations: myEvals, certificate: myCert })
  const displayName = student.preferred_first_name || student.first_name
  const fullName = [displayName, student.last_name].filter(Boolean).join(' ')
  const cohortName = student.cohort?.name || null
  const rotationWindow = placementWindow(student.cohort, student.term_dates)
  const activeRotation = student.status === 'Active Rotation'
  const onContact = () => contactAspire({ name: fullName, school: student.school, cohort: cohortName, status: student.status })

  const openEdit = () => onOpenEdit?.()

  return (
    <div className="ptl-student">
      {students.length > 1 && (
        <div className="ptl-rotation-switch">
          <label className="ptl-label" htmlFor="ptl-rotation-pick">Rotation</label>
          <select id="ptl-rotation-pick" className="ptl-select" value={student.id} onChange={e => setActiveId(e.target.value)}>
            {students.map(s => <option key={s.id} value={s.id}>{s.cohort?.name || 'Rotation'} ({s.status})</option>)}
          </select>
        </div>
      )}

      {/* Profile hero */}
      <section className="ptl-hero">
        <div className="ptl-hero-top">
          <div className="ptl-hero-id">
            <div className="ptl-avatar" aria-hidden="true">
              {student.headshot_url ? <img src={student.headshot_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }} /> : initials(fullName)}
            </div>
            <div className="ptl-hero-text">
              <div className="ptl-hero-hello">Welcome back,</div>
              <div className="ptl-hero-name">{displayName}</div>
              <div className="ptl-hero-meta">{[student.school, cohortName].filter(Boolean).join(' · ') || 'ASPIRE Student'}</div>
              <div className="ptl-hero-chips">
                {student.status ? <span className="ptl-chip">{student.status}</span> : null}
                <span className="ptl-chip ptl-chip-soft">{student.unit_name ? `Unit: ${student.unit_name}` : 'Placement pending'}</span>
              </div>
            </div>
          </div>
          <button type="button" ref={editBtnRef} className="ptl-edit-btn" onClick={openEdit}><Pencil size={14} /> Edit Profile</button>
        </div>
        <div className="ptl-hero-actions">
          <a className="ptl-btn ptl-btn-primary" href="/shift-log"><CalendarPlus size={16} /> Log a Shift</a>
          <button type="button" className="ptl-btn-outline ptl-btn-contact" onClick={onContact} aria-label="Contact ASPIRE (opens an email compose in a new tab)"><Mail size={15} /> Contact ASPIRE</button>
        </div>
      </section>

      <ComposeNote compose={compose} onDismiss={() => setCompose(null)} onCopyEmail={() => copy(SUPPORT)} onCopyMessage={copy} />

      <div className="ptl-grid">
        <SectionCard icon={MapPin} title="Placement" accent={{ bg: '#eef2fb', fg: '#1D2567' }}>
          <dl className="ptl-dl">
            <div><dt>Unit</dt><dd>{student.unit_name || TBC}</dd></div>
            <div><dt>Preceptor</dt><dd>{student.preceptor_name || TBC}</dd></div>
            <div><dt>Rotation window</dt><dd>{rotationWindow}</dd></div>
            <div><dt>School</dt><dd>{student.school || TBC}</dd></div>
          </dl>
        </SectionCard>

        <SectionCard icon={Clock} title="Clinical hours" accent={{ bg: '#e0f7fa', fg: '#0d7a8a' }}>
          {hoursReliable ? (
            <>
              <div className="ptl-hours-line"><span className="ptl-hours-big">{approved}</span><span className="ptl-muted"> of {required} hours approved</span></div>
              <div className="ptl-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="ptl-progress-fill" style={{ width: `${pct}%` }} /></div>
              <div className="ptl-muted ptl-small">{pending > 0 ? `${pending} hours pending review. ` : ''}{Math.max(0, required - approved)} hours remaining.</div>
            </>
          ) : (
            <div className="ptl-empty">Your required hours will appear once your rotation is set up.</div>
          )}
        </SectionCard>

        <SectionCard icon={ListChecks} title="Next steps" accent={{ bg: '#edf2e2', fg: '#166534' }} span>
          <ul className="ptl-steps">
            {steps.map(s => <li key={s.key} className={s.done ? 'ptl-step-done' : ''}><span className="ptl-step-mark">{s.done ? '✓' : '○'}</span> {s.label}</li>)}
          </ul>
          {activeRotation && <a className="ptl-btn ptl-btn-sm" href="/shift-log"><CalendarPlus size={15} /> Log a Shift</a>}
        </SectionCard>

        <SectionCard icon={ClipboardCheck} title="Evaluations" accent={{ bg: '#fdf3e3', fg: '#92400e' }}>
          {myEvals.length === 0 ? (
            <div className="ptl-empty">No evaluations yet. Links arrive by email when one opens.</div>
          ) : (
            <ul className="ptl-list">
              {myEvals.map(e => (
                <li key={e.id}>
                  <span>{e.instrument_title || e.instrument_slug}</span>
                  <span className={`ptl-chip ptl-chip-soft ptl-chip-${e.status === 'completed' ? 'ok' : 'wait'}`}>{EVAL_STATUS_LABELS[e.status] || e.status}</span>
                </li>
              ))}
            </ul>
          )}
          {myCert?.certificate_unlocked_at && <div className="ptl-cert">Certificate <strong>{myCert.certificate_number}</strong> issued. Use the download link from your certificate email.</div>}
        </SectionCard>

        <SectionCard icon={CalendarPlus} title="Shift logs" accent={{ bg: '#eef2fb', fg: '#1D2567' }}>
          {myLogs.length === 0 ? (
            <div className="ptl-empty">No shifts logged yet. Use <strong>Log a Shift</strong> to record your first one.</div>
          ) : (
            <ul className="ptl-list">
              {myLogs.slice(0, 6).map(l => (
                <li key={l.id}>
                  <span>{fmtDate(l.shift_date) || 'Date pending'}{l.unit_name ? ` · ${l.unit_name}` : ''}{l.total_hours != null ? ` · ${l.total_hours}h` : ''}</span>
                  <span className={`ptl-chip ptl-chip-soft ptl-chip-${l.status === 'approved' ? 'ok' : 'wait'}`}>{l.status}</span>
                </li>
              ))}
            </ul>
          )}
          <a className="ptl-inline-link" href="/shift-log">Log a Shift <ChevronRight size={13} /></a>
        </SectionCard>

        <SectionCard icon={LifeBuoy} title="Need help?" accent={{ bg: '#fdecec', fg: '#b91c1c' }} span>
          <div className="ptl-help-grid">
            <div className="ptl-help-item">
              <div className="ptl-help-title">Shift documentation</div>
              <p className="ptl-muted ptl-small">Use <strong>Log a Shift</strong> to record hours and flag shift-related support.</p>
              <a className="ptl-inline-link" href="/shift-log">Log a Shift <ChevronRight size={13} /></a>
            </div>
            <div className="ptl-help-item">
              <div className="ptl-help-title">General questions</div>
              <p className="ptl-muted ptl-small">Use <strong>Contact ASPIRE</strong> for anything else. We are glad to help.</p>
              <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={onContact} aria-label="Contact ASPIRE (opens an email compose in a new tab)">Contact ASPIRE <ChevronRight size={13} /></button>
            </div>
          </div>
          {supportItems.length > 0 && (
            <div className="ptl-support-notes">
              <div className="ptl-help-title">Your recent support notes</div>
              <ul className="ptl-list">
                {supportItems.slice(0, 4).map(l => <li key={l.id}><span>{fmtDate(l.shift_date) || 'Recent'}: {l.support_needed}</span></li>)}
              </ul>
              <div className="ptl-muted ptl-small">The ASPIRE team reviews every support note. For anything urgent, contact your NPD practitioner directly.</div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Mobile sticky action bar (respects the iOS safe area) */}
      <div className="ptl-actionbar">
        <a className="ptl-btn ptl-btn-primary" href="/shift-log"><CalendarPlus size={16} /> Log a Shift</a>
        <button type="button" className="ptl-btn-outline ptl-btn-contact" onClick={onContact} aria-label="Contact ASPIRE (opens an email compose in a new tab)"><Mail size={15} /> Contact</button>
      </div>

      <EditProfileDrawer open={editOpen} student={student} loginEmail={loginEmail} returnFocusRef={editBtnRef} onClose={onCloseEdit} onSaved={() => load()} />
    </div>
  )
}

// Feedback shown after a Contact ASPIRE click: an Outlook confirm-your-account
// note, or a popup-blocked panel with Copy actions. Nothing sensitive is shown.
function ComposeNote({ compose, onDismiss, onCopyEmail, onCopyMessage }) {
  if (!compose) return null
  if (compose.kind === 'blocked') {
    return (
      <div className="ptl-compose-note ptl-compose-blocked" role="alert">
        <div>Your browser blocked the email window. Allow pop-ups or copy {SUPPORT}.</div>
        <div className="ptl-compose-actions">
          <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={onCopyEmail}><Copy size={13} /> Copy email address</button>
          <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => onCopyMessage(compose.body)}><Copy size={13} /> Copy message</button>
          <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    )
  }
  const text = compose.kind === 'outlook'
    ? (compose.loginEmail
        ? `Compose opened in Outlook. Confirm you are sending from ${compose.loginEmail}.`
        : 'Compose opened in Outlook. Confirm you are using the intended email account.')
    : 'Email compose opened in a new tab. Confirm you are using the intended email account.'
  return (
    <div className="ptl-compose-note" role="status">
      <span>{text}</span>
      <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
