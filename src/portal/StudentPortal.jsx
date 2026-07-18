// ASPIRE-COMPASS: Student Portal home. The public site is the map; this is
// the compass. One orientation band answers "where am I, what needs my
// attention, what do I do next"; the surfaces below it are ordered by
// priority for the student's actual stage instead of rendered as equal cards.
//
// Reads (all server-authorized, UNCHANGED from the previous home):
//   - Summary (profile, placement, cohort, hours, badge_created): GET
//     /api/portal/student-summary
//   - Shift logs / evaluation statuses / certificate: scoped definer views
//     (empty for anyone without an active student grant)
//   - Latest-message strip: the SAME shared inbox query Messages uses
//     (usePortalInboxPreview); listing never marks anything read.
// Writes: only self-service presentation fields via /api/portal/update-profile
// (EditProfileDrawer). Shift logging stays on the public /shift-log flow;
// surveys stay on their tokenized email links. Document downloads go through
// authenticated, server-authorized endpoints that resolve the linked student
// from the caller's grant (never from a client-supplied id).
//
// Student-facing vocabulary (display only; API fields are untouched):
//   Evaluations -> Surveys, Documents -> Badge & Certificate,
//   Need help? -> Support.
import { useState, useEffect, useRef } from 'react'
import {
  MapPin, Clock, ClipboardCheck, CalendarPlus, LifeBuoy, Pencil, Mail,
  ChevronRight, Copy, Download, Award, IdCard, MessageSquare, ArrowRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { deriveHeroStage, derivePortalTimeline, deriveClinicalHours } from '../lib/portalProgress'
import { deriveCompassAction, deriveAttentionItems } from '../lib/portalHome'
import { deriveBadgeStatus, deriveCertificateStatus } from '../lib/portalDocuments'
import { fmtDate, placementWindow, TBC } from '../lib/portalDates'
import { composePortalEmail } from '../lib/outlookCompose'
import { usePortalInboxPreview } from '../lib/messages/portalMessagesPolling'
import { formatInboxTimestamp, formatUnread } from '../lib/messages/messagesConstants'
import { usePortalHeadshotUrl } from '../lib/useStudentFile'
import { classifyStoredFileRef } from '../lib/studentFileClient'
import EditProfileDrawer from './EditProfileDrawer'

const SUPPORT = 'aspire@cshs.org'
const CONTACT_SUBJECT = 'ASPIRE Student Support Request'

const EVAL_STATUS_LABELS = {
  draft: 'Not yet sent', sent: 'Waiting for you', opened: 'In progress',
  completed: 'Completed', reminder_due: 'Waiting for you',
  non_responder: 'Window closed', expired: 'Window closed', revoked: 'Withdrawn',
}
const EVAL_WAITING = new Set(['sent', 'opened', 'reminder_due'])

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

// Loading skeleton: stable shapes, no invented data, announced politely.
function HomeSkeleton() {
  return (
    <div className="ptl-skel-page">
      <div className="ptl-skel ptl-skel-band" aria-hidden="true" />
      <div className="ptl-skel-row" aria-hidden="true">
        <div className="ptl-skel ptl-skel-card" />
        <div className="ptl-skel ptl-skel-card" />
      </div>
      <p className="ptl-visually-hidden" role="status">Loading your information</p>
    </div>
  )
}

export default function StudentPortal({
  editOpen = false, onOpenEdit, onCloseEdit,
  unread = 0, onOpenMessages, onOpenThread, onMobileAction,
}) {
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

  // Latest-message strip: shared inbox cache, never marks read.
  const { latest } = usePortalInboxPreview({ enabled: true })

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

  // Report the stage-aware action upward for the phone bottom bar. Called
  // from the data-arrival and rotation-switch events (never from an effect):
  // the certificate variant needs an in-page activation, wrapped here.
  const reportMobileAction = (studentObj, evalsData, certsData) => {
    if (!onMobileAction) return
    if (!studentObj) { onMobileAction(null); return }
    const cert = (certsData || []).find(c => c.student_id === studentObj.id) || null
    const evalRows = (evalsData || []).filter(e => e.student_id === studentObj.id)
    const cs = deriveCertificateStatus({ certificate: cert, status: studentObj.status, evaluations: evalRows })
    const a = deriveCompassAction({ status: studentObj.status, certificateDownloadable: !!cs?.downloadable })
    if (!a) { onMobileAction(null); return }
    onMobileAction(a.kind === 'certificate' ? { ...a, onActivate: downloadCertificate } : a)
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
      // Data-arrival event: report the stage-aware action for the bottom bar.
      const first = summaryData.students?.find(s => s.id === activeId) || summaryData.students?.[0] || null
      reportMobileAction(first, evalsRes.data || [], certsRes.data || [])
    } catch {
      setError('We could not load your portal right now. Please try again shortly.')
    }
    setLoading(false)
  }

  useEffect(() => { let c = false; load().then(() => { if (c) return }); return () => { c = true } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const students = summary?.students || []
  const student = students.find(s => s.id === activeId) || students[0] || null

  // WAVE F-2: the student's own portal headshot resolves through the portal
  // access endpoint (own headshot only). Hook is unconditional (before the
  // loading/error returns below). A stored value means a photo exists; the signed
  // URL is what renders. The Fable .ptl-avatar markup and initials fallback are
  // unchanged.
  const portalHeadshotStored = classifyStoredFileRef(student?.headshot_url) !== 'empty'
  const { url: ownHeadshotUrl } = usePortalHeadshotUrl({
    enabled: portalHeadshotStored,
    refreshKey: student?.headshot_url,
  })
  const myLogs  = student ? logs.filter(l => l.student_id === student.id) : []
  const myEvals = student ? evals.filter(e => e.student_id === student.id) : []
  const myCert  = student ? (certs.find(c => c.student_id === student.id) || null) : null
  const certStatus = student
    ? deriveCertificateStatus({ certificate: myCert, status: student.status, evaluations: myEvals })
    : null
  const action = student
    ? deriveCompassAction({ status: student.status, certificateDownloadable: !!certStatus?.downloadable })
    : null

  if (loading) return <HomeSkeleton />
  if (error)   return <div className="ptl-card ptl-error">{error}</div>

  if (students.length === 0) {
    return (
      <div className="ptl-card ptl-center-card ptl-prepared">
        <div className="ptl-prepared-art" aria-hidden="true">
          <img src="/public-site/illustrations/hero.png" alt="" loading="lazy" decoding="async" />
        </div>
        <h1 className="ptl-card-title">No student record is linked yet</h1>
        <p className="ptl-muted">Your account is active, but no student record is connected to it yet. Please contact the ASPIRE team.</p>
        <button type="button" className="ptl-btn ptl-btn-sm" onClick={() => contactAspire({})} aria-label="Contact ASPIRE (opens an email compose in a new tab)"><Mail size={15} /> Contact ASPIRE</button>
        <ComposeNote compose={compose} onDismiss={() => setCompose(null)} onCopyEmail={() => copy(SUPPORT)} onCopyMessage={copy} />
      </div>
    )
  }

  const supportItems = myLogs.filter(l => (l.support_needed || '').trim().length > 0)

  const hours = deriveClinicalHours(student.hours)
  const stage = deriveHeroStage(student.status)
  const timeline = derivePortalTimeline({ status: student.status, certificateUnlocked: !!myCert?.certificate_unlocked_at })
  const badgeStatus = deriveBadgeStatus({ badgeCreated: student.badge_created, status: student.status })
  const attention = deriveAttentionItems({ unreadMessages: unread, evaluations: myEvals, shiftLogs: myLogs })

  const displayName = student.preferred_first_name || student.first_name
  const fullName = [displayName, student.last_name].filter(Boolean).join(' ')
  const cohortName = student.cohort?.name || null
  const rotationWindow = placementWindow(student.cohort, student.term_dates)
  const activeRotation = student.status === 'Active Rotation'
  const placedMoment = student.status === 'Placed'
  const completedMoment = student.status === 'Completed'
  const onContact = () => contactAspire({ name: fullName, school: student.school, cohort: cohortName, status: student.status })

  const shiftCount = myLogs.length
  const mostRecentShift = fmtDate(myLogs[0]?.shift_date)
  const waitingSurveys = myEvals.filter(e => EVAL_WAITING.has(e.status))
  const badgeRelevant = badgeStatus && badgeStatus.state !== 'not_yet'
  const certRelevant = certStatus && (certStatus.downloadable || ['processing', 'eligible', 'available'].includes(certStatus.state))
  const attentionTarget = (t) => {
    if (t === 'messages') onOpenMessages?.()
    else if (t === 'surveys') document.getElementById('ptl-surveys')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (t === 'shifts') document.getElementById('ptl-hours')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="ptl-student">
      <h1 className="ptl-visually-hidden">Student Portal home</h1>
      {students.length > 1 && (
        <div className="ptl-rotation-switch">
          <label className="ptl-label" htmlFor="ptl-rotation-pick">Rotation</label>
          <select id="ptl-rotation-pick" className="ptl-select" value={student.id}
            onChange={e => {
              setActiveId(e.target.value)
              const next = students.find(s => s.id === e.target.value) || null
              reportMobileAction(next, evals, certs)
            }}>
            {students.map(s => <option key={s.id} value={s.id}>{s.cohort?.name || 'Rotation'} ({s.status})</option>)}
          </select>
        </div>
      )}

      {/* ── The Compass: one orientation band ─────────────────────────────── */}
      <section className="ptl-compass" aria-label="Your ASPIRE orientation">
        <div className="ptl-compass-main">
          <div className="ptl-compass-id">
            <div className="ptl-avatar" aria-hidden="true">
              {ownHeadshotUrl ? <img src={ownHeadshotUrl} alt="" onError={e => { e.currentTarget.style.display = 'none' }} /> : initials(fullName)}
            </div>
            <div className="ptl-compass-text">
              <p className="ptl-compass-hello">Welcome back,</p>
              <p className="ptl-compass-name">{displayName}</p>
              <p className="ptl-compass-meta">{[student.school, cohortName].filter(Boolean).join(' · ') || 'ASPIRE Student'}{student.unit_name ? ` · ${student.unit_name}` : ''}</p>
            </div>
          </div>

          {/* Attention: real items only; silent when nothing waits. */}
          {attention.length > 0 && (
            <ul className="ptl-attention" aria-label="Needs your attention">
              {attention.map(item => (
                <li key={item.key}>
                  <button type="button" className="ptl-attention-chip" onClick={() => attentionTarget(item.target)}>
                    <span className="ptl-attention-count" aria-hidden="true">{item.count}</span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ptl-compass-side">
          {stage ? (
            <>
              <p className="ptl-compass-stage-eyebrow">Current stage</p>
              <p className="ptl-compass-stage">{stage.current}</p>
              {/* The pathway strip: the authenticated echo of the public
                  waypoint motif. Text state lives in the timeline card copy
                  below the fold via the same derivation; here the dots are
                  decorative reinforcement, never the only signal. */}
              {!timeline.terminal && (
                <div className="ptl-compass-dots" aria-hidden="true">
                  {timeline.steps.map(s => <span key={s.key} className={`ptl-dot ptl-dot-${s.state}`} />)}
                </div>
              )}
              <p className="ptl-compass-next"><span className="ptl-compass-next-label">Next:</span> {stage.next}</p>
            </>
          ) : (
            <p className="ptl-compass-next">{timeline.steps[0]?.label}</p>
          )}
          {action && (
            action.kind === 'shift-log'
              ? <a className="ptl-btn ptl-compass-cta" href={action.href}><CalendarPlus size={16} /> {action.label}</a>
              : <button type="button" className="ptl-btn ptl-compass-cta" onClick={downloadCertificate} disabled={certBusy}><Award size={16} /> {certBusy ? 'Preparing...' : action.label}</button>
          )}
        </div>
      </section>

      <ComposeNote compose={compose} onDismiss={() => setCompose(null)} onCopyEmail={() => copy(SUPPORT)} onCopyMessage={copy} />

      <div className="ptl-grid">
        {/* ── Hours & shifts: ONE authoritative surface ─────────────────────── */}
        <section className={`ptl-card ptl-section ptl-col-7${activeRotation ? '' : ' ptl-section-quiet'}`} id="ptl-hours">
          <div className="ptl-section-head">
            <span className="ptl-section-icon" style={{ background: '#e0f7fa', color: '#0d7a8a' }}><Clock size={16} /></span>
            <h2 className="ptl-section-title">Hours &amp; shifts</h2>
          </div>
          {hours.reliable ? (
            <>
              <div className="ptl-hours-stats">
                <div className="ptl-stat"><span className="ptl-stat-num ptl-hours-big">{hours.completed}</span><span className="ptl-stat-label">Approved hours</span></div>
                <div className="ptl-stat"><span className="ptl-stat-num">{hours.required}</span><span className="ptl-stat-label">Required</span></div>
                <div className="ptl-stat"><span className="ptl-stat-num">{hours.remaining}</span><span className="ptl-stat-label">Remaining</span></div>
                {hours.pending > 0 && <div className="ptl-stat"><span className="ptl-stat-num ptl-stat-pending">{hours.pending}</span><span className="ptl-stat-label">Pending review</span></div>}
              </div>
              <div className="ptl-progress" role="progressbar" aria-label="Approved clinical hours"
                aria-valuenow={hours.pct} aria-valuemin={0} aria-valuemax={100}
                aria-valuetext={`${hours.completed} of ${hours.required} approved hours, ${hours.pct} percent`}>
                <div className="ptl-progress-fill" style={{ width: `${hours.pct}%` }} />
              </div>
              <div className="ptl-muted ptl-small">{hours.pct}% of your required hours are approved{hours.pending > 0 ? '. Pending hours are counted after review.' : '.'}</div>
            </>
          ) : (
            <div className="ptl-empty">Rotation hours have not been configured yet. You will see required, approved, and remaining hours here once your rotation begins.</div>
          )}

          {shiftCount > 0 && (
            <>
              <div className="ptl-shift-divider">
                <span className="ptl-shift-count">{shiftCount} {shiftCount === 1 ? 'shift' : 'shifts'} logged</span>
                {mostRecentShift && <span className="ptl-muted ptl-small">Most recent: {mostRecentShift}</span>}
              </div>
              <ul className="ptl-list">
                {myLogs.slice(0, 4).map(l => (
                  <li key={l.id}>
                    <span>{fmtDate(l.shift_date) || 'Date pending'}{l.unit_name ? ` · ${l.unit_name}` : ''}{l.total_hours != null ? ` · ${l.total_hours}h` : ''}</span>
                    <span className={`ptl-chip ptl-chip-soft ptl-chip-${l.status === 'approved' ? 'ok' : 'wait'}`}>{l.status === 'approved' ? 'Approved' : 'Awaiting review'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {activeRotation && shiftCount === 0 && (
            <div className="ptl-empty" style={{ marginTop: 12 }}>No shifts logged yet. Record your first shift to start building your approved hours.</div>
          )}
          {activeRotation && (
            <a className="ptl-btn ptl-btn-sm" href="/shift-log"><CalendarPlus size={15} /> Log a Shift</a>
          )}
        </section>

        {/* ── Latest message: awareness only; never marks read ──────────────── */}
        <section className="ptl-card ptl-section ptl-col-5" aria-labelledby="ptl-latest-title">
          <div className="ptl-section-head">
            <span className="ptl-section-icon" style={{ background: '#eef2fb', color: '#1D2567' }}><MessageSquare size={16} /></span>
            <h2 className="ptl-section-title" id="ptl-latest-title">Messages</h2>
            {unread > 0 && <span className="ptl-nav-badge" aria-hidden="true">{formatUnread(unread)}</span>}
          </div>
          {latest ? (
            <button type="button" className="ptl-latest-row" onClick={() => onOpenThread?.(latest.id)}>
              <span className="ptl-latest-top">
                <span className={`ptl-latest-subject${Number(latest.unread_count) > 0 ? ' ptl-latest-unread' : ''}`}>{latest.subject}</span>
                <span className="ptl-latest-time">{formatInboxTimestamp(latest.last_message_at)}</span>
              </span>
              {latest.latest_preview && <span className="ptl-latest-preview">{latest.latest_preview}</span>}
              <span className="ptl-latest-open">Open conversation <ArrowRight size={13} aria-hidden="true" /></span>
            </button>
          ) : (
            <p className="ptl-muted">Messages between you and the ASPIRE Team will appear here.</p>
          )}
          <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={() => onOpenMessages?.()}>
            Go to Messages <ChevronRight size={14} aria-hidden="true" />
          </button>
        </section>

        {/* ── Placement ─────────────────────────────────────────────────────── */}
        <section className={`ptl-card ptl-section ptl-col-7${placedMoment ? ' ptl-moment' : ''}`}>
          <div className="ptl-section-head">
            <span className="ptl-section-icon" style={{ background: '#eef2fb', color: '#1D2567' }}><MapPin size={16} /></span>
            <h2 className="ptl-section-title">Placement</h2>
            {placedMoment && <span className="ptl-chip ptl-chip-ok">Confirmed</span>}
          </div>
          {placedMoment && (
            <p className="ptl-moment-line">Your placement is confirmed. Welcome to {student.unit_name || 'your unit'}.</p>
          )}
          <dl className="ptl-dl ptl-dl-lg">
            <div><dt>Unit</dt><dd>{student.unit_name || TBC}</dd></div>
            <div><dt>Preceptor</dt><dd>{student.preceptor_name || TBC}</dd></div>
            <div><dt>Rotation window</dt><dd>{rotationWindow}</dd></div>
            <div><dt>School</dt><dd>{student.school || TBC}</dd></div>
          </dl>
        </section>

        {/* ── Your progress (single detailed representation) ────────────────── */}
        <section className="ptl-card ptl-section ptl-col-5">
          <div className="ptl-section-head">
            <span className="ptl-section-icon" style={{ background: '#edf2e2', color: '#166534' }}><ClipboardCheck size={16} /></span>
            <h2 className="ptl-section-title">Your progress</h2>
          </div>
          <ol className="ptl-timeline" aria-label="Your ASPIRE progress">
            {timeline.steps.map(s => (
              <li key={s.key} className={`ptl-tl-step ptl-tl-${s.state}`}>
                <span className="ptl-tl-mark" aria-hidden="true">{s.state === 'complete' ? '✓' : s.state === 'current' ? '●' : '○'}</span>
                <span className="ptl-tl-label">{s.label}</span>
                <span className="ptl-tl-state">{s.stateLabel}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Surveys (prominent only when one is waiting) ──────────────────── */}
        <section className={`ptl-card ptl-section ptl-col-4${waitingSurveys.length === 0 ? ' ptl-section-quiet' : ' ptl-section-attend'}`} id="ptl-surveys">
          <div className="ptl-section-head">
            <span className="ptl-section-icon" style={{ background: '#fdf3e3', color: '#92400e' }}><ClipboardCheck size={16} /></span>
            <h2 className="ptl-section-title">Surveys</h2>
          </div>
          {myEvals.length === 0 ? (
            <div className="ptl-empty">No surveys are currently available. When a survey opens, you will receive an email and see its status here.</div>
          ) : (
            <>
              {waitingSurveys.length > 0 && (
                <p className="ptl-surveys-note">Your survey link arrives by email from the ASPIRE team. Check your inbox for the message with your personal link.</p>
              )}
              <ul className="ptl-eval-list">
                {myEvals.map(e => {
                  const meta = [
                    e.timepoint ? (TIMEPOINT_LABELS[e.timepoint] || e.timepoint) : null,
                    fmtDate(e.sent_at) ? `Sent ${fmtDate(e.sent_at)}` : null,
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
            </>
          )}
        </section>

        {/* ── Badge & Certificate (quiet until relevant) ────────────────────── */}
        <section className={`ptl-card ptl-section ptl-col-4${certStatus?.downloadable ? ' ptl-moment-cert' : (!badgeRelevant && !certRelevant ? ' ptl-section-quiet' : '')}`}>
          <div className="ptl-section-head">
            <span className="ptl-section-icon" style={{ background: '#eef2fb', color: '#1D2567' }}><Award size={16} /></span>
            <h2 className="ptl-section-title">Badge &amp; Certificate</h2>
          </div>
          <div className="ptl-doc-list">
            {/* ID Badge: status only. No downloadable badge file exists server-side
                (see src/lib/portalDocuments.js), so no download button renders. */}
            <div className="ptl-doc-row">
              <div className="ptl-doc-head">
                <span className="ptl-doc-icon" aria-hidden="true"><IdCard size={16} /></span>
                <span className="ptl-doc-title">ID Badge</span>
                <span className={`ptl-doc-status ptl-doc-${badgeStatus.state}`}>{badgeStatus.label}</span>
              </div>
              <p className="ptl-muted ptl-small">{badgeStatus.detail}</p>
            </div>

            <div className="ptl-doc-row">
              <div className="ptl-doc-head">
                <span className="ptl-doc-icon" aria-hidden="true"><Award size={16} /></span>
                <span className="ptl-doc-title">Certificate of Completion</span>
                <span className={`ptl-doc-status ptl-doc-${certStatus.state}`}>{certStatus.label}</span>
              </div>
              {certStatus.downloadable ? (
                <>
                  {completedMoment && (
                    <p className="ptl-moment-cert-line">Congratulations, {displayName}. You completed your ASPIRE rotation.</p>
                  )}
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
          </div>
        </section>

        {/* ── Support (one clear place to get help) ─────────────────────────── */}
        <section className="ptl-card ptl-section ptl-col-4">
          <div className="ptl-section-head">
            <span className="ptl-section-icon" style={{ background: '#fdecec', color: '#b91c1c' }}><LifeBuoy size={16} /></span>
            <h2 className="ptl-section-title">Support</h2>
          </div>
          <div className="ptl-help-actions">
            <button type="button" className="ptl-help-action" onClick={onContact} aria-label="Contact ASPIRE (opens an email compose in a new tab)">
              <span className="ptl-help-action-icon" aria-hidden="true"><Mail size={16} /></span>
              <span className="ptl-help-action-text">
                <span className="ptl-help-action-title">Contact ASPIRE</span>
                <span className="ptl-help-action-desc">General questions and anything else. We are glad to help.</span>
              </span>
              <ChevronRight size={16} className="ptl-help-action-chev" aria-hidden="true" />
            </button>
            <button type="button" ref={editBtnRef} className="ptl-help-action" onClick={() => onOpenEdit?.()}>
              <span className="ptl-help-action-icon" aria-hidden="true"><Pencil size={16} /></span>
              <span className="ptl-help-action-text">
                <span className="ptl-help-action-title">Edit your profile</span>
                <span className="ptl-help-action-desc">Update your preferred name or phone, or request a correction.</span>
              </span>
              <ChevronRight size={16} className="ptl-help-action-chev" aria-hidden="true" />
            </button>
          </div>
          <div className="ptl-help-email">
            <span className="ptl-muted ptl-small">{SUPPORT}</span>
            <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={() => copy(SUPPORT)} aria-label="Copy the ASPIRE email address"><Copy size={13} /> Copy</button>
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
        </section>
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
