// PHASE2-PORTAL / ASPIRE-STUDENT-PORTAL / ASPIRE-STUDENT-HOME: student portal
// home. Mobile-first, profile-forward; the desktop layout adds a purposeful
// 12-column grid, a stronger profile hero with a current-stage panel, a Next
// Steps progress timeline, a Need Help panel raised into the top desktop rows,
// and a secure Documents area (ID badge status + Certificate of Completion
// download).
//
// Reads (all server-authorized):
//   - Summary (profile, placement, cohort, hours, badge_created): GET
//     /api/portal/student-summary
//   - Shift logs / evaluation statuses / certificate: scoped definer views
//     (empty for anyone without an active student grant)
// Writes: only self-service presentation fields via /api/portal/update-profile
// (EditProfileDrawer). Shift logging stays on the public /shift-log flow;
// evaluations stay on their tokenized links. Document downloads go through
// authenticated, server-authorized endpoints that resolve the linked student
// from the caller's grant (never from a client-supplied id).
import { useState, useEffect, useRef } from 'react'
import { MapPin, Clock, ListChecks, ClipboardCheck, CalendarPlus, LifeBuoy, Pencil, Mail, ChevronRight, Copy, FileText, Download, Award, IdCard } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { deriveHeroStage, derivePortalTimeline, deriveClinicalHours } from '../lib/portalProgress'
import { deriveBadgeStatus, deriveCertificateStatus } from '../lib/portalDocuments'
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

const TIMEPOINT_LABELS = {
  baseline: 'Baseline', early_rotation_baseline: 'Early rotation',
  midpoint: 'Midpoint', post_rotation: 'Post-rotation',
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

// Approved, non-sensitive support message body (no ids, notes, scores, or history).
function buildContactBody({ name, school, cohort, status } = {}) {
  return `Hello ASPIRE Team,\n\nI am contacting you for assistance.\n\nName: ${name || 'not available'}\nSchool: ${school || 'not available'}\nCohort: ${cohort || 'not available'}\nASPIRE status: ${status || 'not available'}\n\nMy question or concern:\n\n\nThank you.`
}

function SectionCard({ icon: Icon, title, accent, children, cols = 12 }) {
  return (
    <section className={`ptl-card ptl-section ptl-col-${cols}`}>
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
  const [certBusy, setCertBusy] = useState(false)
  const [certMsg, setCertMsg]   = useState(null)  // { ok, text } | null
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

  // Certificate of Completion download. The endpoint resolves the linked student
  // from the caller's grant and generates the PDF on demand; NO student id or
  // path is placed in the URL. The blob is downloaded without navigating the
  // portal tab.
  const downloadCertificate = async () => {
    setCertBusy(true); setCertMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setCertMsg({ ok: false, text: 'Please sign in again to download your certificate.' }); setCertBusy(false); return }
      const res = await fetch('/api/portal/download-certificate', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) { setCertMsg({ ok: false, text: 'Your certificate could not be downloaded right now.' }); setCertBusy(false); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'ASPIRE-Certificate-of-Completion.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setCertMsg({ ok: true, text: 'Your certificate download has started.' })
    } catch {
      setCertMsg({ ok: false, text: 'Your certificate could not be downloaded right now.' })
    }
    setCertBusy(false)
  }

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

  const hours = deriveClinicalHours(student.hours)
  const stage = deriveHeroStage(student.status)
  const timeline = derivePortalTimeline({ status: student.status, certificateUnlocked: !!myCert?.certificate_unlocked_at })
  const badgeStatus = deriveBadgeStatus({ badgeCreated: student.badge_created, status: student.status })
  const certStatus  = deriveCertificateStatus({ certificate: myCert, status: student.status, evaluations: myEvals })

  const displayName = student.preferred_first_name || student.first_name
  const fullName = [displayName, student.last_name].filter(Boolean).join(' ')
  const cohortName = student.cohort?.name || null
  const rotationWindow = placementWindow(student.cohort, student.term_dates)
  const activeRotation = student.status === 'Active Rotation'
  const onContact = () => contactAspire({ name: fullName, school: student.school, cohort: cohortName, status: student.status })

  const shiftCount = myLogs.length
  const totalShiftHours = Math.round(myLogs.reduce((sum, l) => sum + (Number(l.total_hours) || 0), 0) * 10) / 10
  const mostRecentShift = fmtDate(myLogs[0]?.shift_date)

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

      {/* Profile hero (row 1, full width) */}
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
          <div className="ptl-hero-aside">
            <button type="button" ref={editBtnRef} className="ptl-edit-btn" onClick={openEdit}><Pencil size={14} /> Edit Profile</button>
            {stage && (
              <div className="ptl-hero-stage">
                <div className="ptl-stage-block">
                  <span className="ptl-stage-eyebrow">Current stage</span>
                  <span className="ptl-stage-value">{stage.current}</span>
                </div>
                <div className="ptl-stage-block">
                  <span className="ptl-stage-eyebrow">Next</span>
                  <span className="ptl-stage-next">{stage.next}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ptl-hero-actions">
          <a className="ptl-btn ptl-btn-primary" href="/shift-log"><CalendarPlus size={16} /> Log a Shift</a>
          <button type="button" className="ptl-btn-outline ptl-btn-contact" onClick={onContact} aria-label="Contact ASPIRE (opens an email compose in a new tab)"><Mail size={15} /> Contact ASPIRE</button>
        </div>
      </section>

      <ComposeNote compose={compose} onDismiss={() => setCompose(null)} onCopyEmail={() => copy(SUPPORT)} onCopyMessage={copy} />

      <div className="ptl-grid">
        {/* Row 2: Placement (7) + Clinical hours (5) */}
        <SectionCard icon={MapPin} title="Placement" accent={{ bg: '#eef2fb', fg: '#1D2567' }} cols={7}>
          <dl className="ptl-dl ptl-dl-lg">
            <div><dt>Unit</dt><dd>{student.unit_name || TBC}</dd></div>
            <div><dt>Preceptor</dt><dd>{student.preceptor_name || TBC}</dd></div>
            <div><dt>Rotation window</dt><dd>{rotationWindow}</dd></div>
            <div><dt>School</dt><dd>{student.school || TBC}</dd></div>
          </dl>
        </SectionCard>

        <SectionCard icon={Clock} title="Clinical hours" accent={{ bg: '#e0f7fa', fg: '#0d7a8a' }} cols={5}>
          {hours.reliable ? (
            <>
              <div className="ptl-hours-stats">
                <div className="ptl-stat"><span className="ptl-stat-num ptl-hours-big">{hours.completed}</span><span className="ptl-stat-label">Completed</span></div>
                <div className="ptl-stat"><span className="ptl-stat-num">{hours.required}</span><span className="ptl-stat-label">Required</span></div>
                <div className="ptl-stat"><span className="ptl-stat-num">{hours.remaining}</span><span className="ptl-stat-label">Remaining</span></div>
              </div>
              <div className="ptl-progress" role="progressbar" aria-label="Clinical hours completed"
                aria-valuenow={hours.pct} aria-valuemin={0} aria-valuemax={100}
                aria-valuetext={`${hours.completed} of ${hours.required} hours completed, ${hours.pct} percent`}>
                <div className="ptl-progress-fill" style={{ width: `${hours.pct}%` }} />
              </div>
              <div className="ptl-muted ptl-small">{hours.pct}% complete{hours.pending > 0 ? ` · ${hours.pending} hours pending review` : ''}</div>
            </>
          ) : (
            <div className="ptl-empty">Rotation hours have not been configured yet. You will see required, completed, and remaining hours here once your rotation begins.</div>
          )}
        </SectionCard>

        {/* Row 3: Next steps timeline (8) + Need help (4) */}
        <SectionCard icon={ListChecks} title="Next steps" accent={{ bg: '#edf2e2', fg: '#166534' }} cols={8}>
          <ol className="ptl-timeline" aria-label="Your ASPIRE progress">
            {timeline.steps.map(s => (
              <li key={s.key} className={`ptl-tl-step ptl-tl-${s.state}`}>
                <span className="ptl-tl-mark" aria-hidden="true">{s.state === 'complete' ? '✓' : s.state === 'current' ? '●' : '○'}</span>
                <span className="ptl-tl-label">{s.label}</span>
                <span className="ptl-tl-state">{s.stateLabel}</span>
              </li>
            ))}
          </ol>
          {activeRotation && <a className="ptl-btn ptl-btn-sm" href="/shift-log"><CalendarPlus size={15} /> Log a Shift</a>}
        </SectionCard>

        <SectionCard icon={LifeBuoy} title="Need help?" accent={{ bg: '#fdecec', fg: '#b91c1c' }} cols={4}>
          <div className="ptl-help-list">
            <div className="ptl-help-item">
              <div className="ptl-help-title">Log a shift</div>
              <p className="ptl-muted ptl-small">Record hours and flag shift-related support.</p>
              <a className="ptl-inline-link" href="/shift-log">Log a Shift <ChevronRight size={13} /></a>
            </div>
            <div className="ptl-help-item">
              <div className="ptl-help-title">Contact ASPIRE</div>
              <p className="ptl-muted ptl-small">General questions and anything else. We are glad to help.</p>
              <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={onContact} aria-label="Contact ASPIRE (opens an email compose in a new tab)">Contact ASPIRE <ChevronRight size={13} /></button>
            </div>
            <div className="ptl-help-item">
              <div className="ptl-help-title">Request a profile correction</div>
              <p className="ptl-muted ptl-small">Ask us to fix a managed field like school, cohort, or placement.</p>
              <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={openEdit}>Request a correction <ChevronRight size={13} /></button>
            </div>
            <div className="ptl-help-item">
              <div className="ptl-help-title">Email</div>
              <p className="ptl-muted ptl-small ptl-help-email">
                <span>{SUPPORT}</span>
                <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={() => copy(SUPPORT)} aria-label="Copy the ASPIRE email address"><Copy size={13} /> Copy</button>
              </p>
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

        {/* Row 4: Evaluations (4) + Shift logs (4) + Documents (4) */}
        <SectionCard icon={ClipboardCheck} title="Evaluations" accent={{ bg: '#fdf3e3', fg: '#92400e' }} cols={4}>
          {myEvals.length === 0 ? (
            <div className="ptl-empty">No evaluations are currently available. When an evaluation opens, you will receive an email and see its status here.</div>
          ) : (
            <ul className="ptl-eval-list">
              {myEvals.map(e => {
                const meta = [
                  e.timepoint ? (TIMEPOINT_LABELS[e.timepoint] || e.timepoint) : null,
                  fmtDate(e.sent_at) ? `Sent ${fmtDate(e.sent_at)}` : null,
                  fmtDate(e.opened_at) ? `Opened ${fmtDate(e.opened_at)}` : null,
                  fmtDate(e.completed_at) ? `Completed ${fmtDate(e.completed_at)}` : null,
                  fmtDate(e.expires_at) ? `Expires ${fmtDate(e.expires_at)}` : null,
                ].filter(Boolean).join(' · ')
                return (
                  <li key={e.id} className="ptl-eval-item">
                    <div className="ptl-eval-head">
                      <span className="ptl-eval-title">{e.instrument_title || e.instrument_slug}</span>
                      <span className={`ptl-chip ptl-chip-soft ptl-chip-${e.status === 'completed' ? 'ok' : 'wait'}`}>{EVAL_STATUS_LABELS[e.status] || e.status}</span>
                    </div>
                    {meta && <div className="ptl-muted ptl-small ptl-eval-meta">{meta}</div>}
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard icon={CalendarPlus} title="Shift logs" accent={{ bg: '#eef2fb', fg: '#1D2567' }} cols={4}>
          {shiftCount === 0 ? (
            <>
              <div className="ptl-empty">No shifts logged yet. Record your first shift when your clinical rotation begins.</div>
              <a className="ptl-btn ptl-btn-sm" href="/shift-log"><CalendarPlus size={15} /> Log a Shift</a>
            </>
          ) : (
            <>
              <div className="ptl-shift-summary">
                <div className="ptl-stat"><span className="ptl-stat-num">{shiftCount}</span><span className="ptl-stat-label">Shifts</span></div>
                <div className="ptl-stat"><span className="ptl-stat-num">{totalShiftHours}</span><span className="ptl-stat-label">Hours</span></div>
                {mostRecentShift && <div className="ptl-stat"><span className="ptl-stat-num ptl-stat-date">{mostRecentShift}</span><span className="ptl-stat-label">Most recent</span></div>}
              </div>
              <ul className="ptl-list">
                {myLogs.slice(0, 4).map(l => (
                  <li key={l.id}>
                    <span>{fmtDate(l.shift_date) || 'Date pending'}{l.unit_name ? ` · ${l.unit_name}` : ''}{l.total_hours != null ? ` · ${l.total_hours}h` : ''}</span>
                    <span className={`ptl-chip ptl-chip-soft ptl-chip-${l.status === 'approved' ? 'ok' : 'wait'}`}>{l.status}</span>
                  </li>
                ))}
              </ul>
              <a className="ptl-btn ptl-btn-sm" href="/shift-log"><CalendarPlus size={15} /> Log a Shift</a>
            </>
          )}
        </SectionCard>

        <SectionCard icon={FileText} title="Documents" accent={{ bg: '#eef2fb', fg: '#1D2567' }} cols={4}>
          {/* ID Badge: status only. No downloadable badge file exists server-side
              (see src/lib/portalDocuments.js), so no active download button is
              ever rendered here. */}
          <div className="ptl-doc-row">
            <div className="ptl-doc-head">
              <span className="ptl-doc-icon" aria-hidden="true"><IdCard size={16} /></span>
              <span className="ptl-doc-title">ID Badge</span>
              <span className={`ptl-doc-status ptl-doc-${badgeStatus.state}`}>{badgeStatus.label}</span>
            </div>
            <p className="ptl-muted ptl-small">{badgeStatus.detail}</p>
          </div>

          {/* Certificate of Completion */}
          <div className="ptl-doc-row">
            <div className="ptl-doc-head">
              <span className="ptl-doc-icon" aria-hidden="true"><Award size={16} /></span>
              <span className="ptl-doc-title">Certificate of Completion</span>
              <span className={`ptl-doc-status ptl-doc-${certStatus.state}`}>{certStatus.label}</span>
            </div>
            {certStatus.downloadable ? (
              <>
                <div className="ptl-muted ptl-small ptl-doc-meta">
                  {[
                    certStatus.number ? `Certificate ${certStatus.number}` : null,
                    certStatus.year ? String(certStatus.year) : null,
                    fmtDate(certStatus.unlockedAt) ? `Unlocked ${fmtDate(certStatus.unlockedAt)}` : null,
                  ].filter(Boolean).join(' · ')}
                </div>
                <button type="button" className="ptl-btn ptl-btn-sm" onClick={downloadCertificate} disabled={certBusy}
                  aria-label="Download your Certificate of Completion (PDF)">
                  <Download size={15} /> {certBusy ? 'Preparing...' : 'Download Certificate'}
                </button>
                {certMsg && <div className={certMsg.ok ? 'ptl-form-ok' : 'ptl-form-error'} role="status">{certMsg.text}</div>}
              </>
            ) : (
              <p className="ptl-muted ptl-small">{certStatus.lockedReason}</p>
            )}
          </div>
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
