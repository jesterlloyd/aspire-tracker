// src/portal/unit/StudentDetailDrawer.jsx
//
// UL-PORTAL: the student detail drawer.
//
// Opened from a row on the Students screen. Shows ONLY the approved Unit Leader
// fields. Everything excluded is excluded by construction, not by filtering: this
// component reads three endpoints and none of them can return an interview rubric,
// a readiness survey answer, a certificate, an uploaded onboarding document, an
// internal staff note, or the raw support-needed narrative. There is no prop, no
// state, and no render path here through which that data could arrive.
//
// FILES: the photo and the resume come from the Wave F-2 server-mediated endpoint,
// which mints a short-lived signed URL against the PRIVATE bucket. No public URL is
// ever constructed, and no signed URL is persisted or written to a link the browser
// keeps. Expiry is handled two different ways on purpose:
//   - the photo holds a URL in an <img src>, so an expired link surfaces as a load
//     error; the drawer then requests a fresh link ONCE and shows a retry control
//     if that also fails.
//   - the resume is never held as a URL at all. The link is minted at click time,
//     so it cannot be stale by construction.
//
// ACCESSIBILITY: a modal dialog with a trapped, cycling Tab order, Escape to close,
// focus moved to the close control on open, and focus returned to the triggering
// row button on close. The trigger element is passed by ref rather than remembered
// globally so focus returns to the RIGHT row when several drawers are opened in a
// session.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  EMPTY, orDash, studentName, BUCKET_LABEL,
  getStudentDetail, getMilestones, getStudentFileUrl,
} from './unitLeaderApi'
import { LoadingState, EmptyState, ErrorState, DeniedState } from './UnitLeaderChrome'
import { peekStudentPhotoUrl, resolveStudentPhotoUrl, clearStudentPhotoCache } from '../../lib/studentPhotoCache'
import { ulPhotoKey } from './useUnitStudentPhotos'
import { stageToken } from './unitStageTokens'

const MILESTONE_LABEL = {
  arrival: 'Arrival',
  unit_orientation: 'Unit orientation',
  preceptor_confirmation: 'Preceptor confirmed',
  rotation_conclusion: 'Rotation concluded',
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A date, rendered plainly, with the standard placeholder when absent. */
function fmtDate(ymd) {
  if (!ymd) return EMPTY
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return EMPTY
  return new Date(y, m - 1, d).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTimestamp(iso) {
  if (!iso) return EMPTY
  const t = new Date(iso)
  return Number.isNaN(t.getTime())
    ? EMPTY
    : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** One labelled read-only field. */
function Field({ label, children }) {
  return (
    <div className="ptl-detail-field">
      <dt className="ptl-detail-label">{label}</dt>
      <dd className="ptl-detail-value">{children}</dd>
    </div>
  )
}

/** A contact value as a real mailto/tel link, or the placeholder. */
function ContactLink({ kind, value }) {
  if (!value) return EMPTY
  return <a className="ptl-detail-link" href={`${kind === 'phone' ? 'tel' : 'mailto'}:${value}`}>{value}</a>
}

/**
 * The approved photo.
 *
 * Requests a signed URL on mount, and exactly one fresh link if the image fails to
 * load, which is what an expired link looks like to the browser. A second failure
 * stops the cycle and offers a manual retry rather than looping against the endpoint.
 */
function StudentPhoto({ studentId, name, hasPhoto }) {
  // FIRST read the shared cache the roster already primed, synchronously, so a photo
  // opened from the roster appears instantly with no second load. Only on a miss does
  // this sign a fresh URL, through the SAME cache so it obeys the same TTL and scope.
  const cacheKey = ulPhotoKey(studentId)
  const [attempt, setAttempt] = useState(0)
  const [expired, setExpired] = useState(false)
  const warm = peekStudentPhotoUrl(cacheKey)
  const [state, setState] = useState({ key: warm ? `${studentId}:0` : null, url: warm || null })

  const key = `${studentId}:${attempt}`

  useEffect(() => {
    // Warm hit on the first attempt needs no request.
    if (attempt === 0 && peekStudentPhotoUrl(cacheKey)) return undefined
    let live = true
    resolveStudentPhotoUrl(cacheKey, async () => {
      const res = await getStudentFileUrl(studentId, 'headshot')
      return res.ok ? res.data?.signed_url || null : null
    }).then(url => { if (live) setState({ key: `${studentId}:${attempt}`, url: url || null }) })
      .catch(() => { if (live) setState({ key: `${studentId}:${attempt}`, url: null }) })
    return () => { live = false }
  }, [studentId, attempt, cacheKey])

  const retry = () => { setExpired(false); clearStudentPhotoCache(); setAttempt(a => a + 1) }

  // A student with no photo skips the loading state entirely.
  if (hasPhoto === false) {
    return <div className="ptl-detail-photo ptl-detail-photo-empty">No approved photo</div>
  }
  if (state.key !== key) {
    return <div className="ptl-detail-photo ptl-detail-photo-empty" role="status">Loading photo</div>
  }
  if (!state.url) {
    return <div className="ptl-detail-photo ptl-detail-photo-empty">No approved photo</div>
  }
  if (expired) {
    return (
      <div className="ptl-detail-photo ptl-detail-photo-empty">
        <p className="ptl-muted">That photo link expired.</p>
        <button type="button" className="ptl-btn ptl-btn-small" onClick={retry}>Reload photo</button>
      </div>
    )
  }
  return (
    <img
      className="ptl-detail-photo"
      src={state.url}
      alt={`Approved photo of ${name}`}
      onError={() => {
        // A load failure on the first link is treated as expiry and refreshed once,
        // silently. Any later failure stops the cycle and hands the user a control,
        // so a genuinely broken object cannot spin against the endpoint forever.
        if (attempt === 0) { clearStudentPhotoCache(); setAttempt(1) }
        else setExpired(true)
      }}
    />
  )
}

/**
 * The resume, opened through a freshly minted signed URL.
 * Nothing is stored: the link is requested at click time and handed straight to a
 * new tab, so there is no persisted URL and no expiry window to manage.
 */
function ResumeAction({ studentId, available }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!available) return <span className="ptl-muted">No resume on file</span>

  const open = async () => {
    setBusy(true); setFailed(false)
    const res = await getStudentFileUrl(studentId, 'resume')
    setBusy(false)
    const url = res.ok ? res.data?.signed_url : null
    if (!url) { setFailed(true); return }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <button type="button" className="ptl-btn ptl-btn-small" disabled={busy} onClick={open}>
        {busy ? 'Preparing' : 'Open resume'}
      </button>
      {failed && <p className="ptl-notice ptl-notice-error" role="status">That resume could not be opened just now.</p>}
    </>
  )
}

export default function StudentDetailDrawer({ student, onClose, returnFocusRef }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  // Both loads carry the id they resolved FOR. Loading is then derived by comparing
  // that against the id being shown, rather than assigned by a setState in the effect
  // body, which this repo forbids (react-hooks/set-state-in-effect). It also removes a
  // real bug class: a slow response for a previously viewed student can never paint
  // over the student currently on screen, because the ids will not match.
  const [detail, setDetail] = useState({ forId: null, status: 'loading', data: null })
  const [milestones, setMilestones] = useState({ forId: null, status: 'loading', rows: [] })

  const studentId = student?.id || null
  const unitKey = student?.unit_key || null
  const name = useMemo(() => studentName(student), [student])

  // Approved detail record.
  useEffect(() => {
    if (!studentId) return undefined
    const ac = new AbortController()
    let live = true
    getStudentDetail(studentId, ac.signal).then(res => {
      if (!live || res.error === 'aborted') return
      if (res.ok) setDetail({ forId: studentId, status: 'ready', data: res.data?.student || null })
      // 403 and 404 are permission answers, not failures: the drawer shows a denied
      // state rather than an error, because retrying will not change the outcome.
      else if (res.status === 403 || res.status === 404) setDetail({ forId: studentId, status: 'denied', data: null })
      else setDetail({ forId: studentId, status: 'error', data: null })
    })
    return () => { live = false; ac.abort() }
  }, [studentId])

  // Milestone history, through the authorized unit-scoped endpoint, narrowed to this
  // student in the browser. The server has already bounded the set to the caller's
  // units, so this filter is presentation and never authorization.
  useEffect(() => {
    if (!studentId) return undefined
    const ac = new AbortController()
    let live = true
    getMilestones(unitKey, ac.signal).then(res => {
      if (!live || res.error === 'aborted') return
      if (!res.ok) { setMilestones({ forId: studentId, status: 'error', rows: [] }); return }
      const rows = (res.data?.milestones || []).filter(m => m.student_id === studentId)
      setMilestones({ forId: studentId, status: 'ready', rows })
    })
    return () => { live = false; ac.abort() }
  }, [studentId, unitKey])

  const detailStatus = detail.forId === studentId ? detail.status : 'loading'
  const milestoneStatus = milestones.forId === studentId ? milestones.status : 'loading'

  // Focus management: move focus in, trap and cycle Tab, Escape to close, restore
  // focus to the element that opened the drawer.
  useEffect(() => {
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => closeRef.current?.focus?.(), 20)
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll(FOCUSABLE))
        .filter(el => el.offsetParent !== null)
      if (els.length === 0) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      if (prev?.focus) prev.focus()
    }
  }, [onClose, returnFocusRef])

  if (!student) return null
  const d = detail.data

  return (
    <>
      <div className="ptl-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="ptl-drawer ptl-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${name}`}
      >
        {/* Close control floats over the pastel hero so the header can be the full
            identity treatment, matching the staff Student Profile hero. */}
        <button ref={closeRef} type="button" className="ptl-icon-btn ptl-detail-close"
          aria-label="Close student details" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>

        {/* The pastel light-blue hero, reproducing the staff profile's visual
            language: a circular photo, centred identity, and the stage pill. The
            same cached photo the roster resolved is reused, so there is no reload. */}
        <div className="ptl-detail-hero">
          <StudentPhoto studentId={student?.id} name={name} hasPhoto={student?.has_photo} />
          <h2 className="ptl-detail-heroname">{name}</h2>
          {(d?.school || student?.school) && (
            <p className="ptl-detail-heroschool">{orDash(d?.school || student?.school)}</p>
          )}
          {(() => {
            const bucket = d?.bucket || student?.bucket
            const t = stageToken(bucket)
            return bucket ? (
              <span className="ptl-detail-heropill"
                style={{ background: t.bg, color: t.text, border: `1px solid ${t.border}` }}>
                {BUCKET_LABEL[bucket] || EMPTY}
              </span>
            ) : null
          })()}
        </div>

        <div className="ptl-drawer-body">
          {detailStatus === 'loading' && <LoadingState label="Loading student details" />}

          {/* Deliberately worded for THIS student, not for the portal as a whole.
              The default DeniedState text is about having no assigned unit at all,
              which would be a misleading thing to read here. */}
          {detailStatus === 'denied' && (
            <DeniedState
              title="Details not available"
              detail="You do not have access to this student's details. This can happen if the student moved to another unit, or if their rotation ended more than 90 days ago."
            />
          )}

          {detailStatus === 'error' && (
            <ErrorState detail="These details could not be loaded just now." />
          )}

          {detailStatus === 'ready' && !d && (
            <EmptyState title="No details available"
              detail="This student record has no details to show right now." />
          )}

          {detailStatus === 'ready' && d && (
            <>
              <dl className="ptl-detail-grid">
                <Field label="School">{orDash(d.school)}</Field>
                <Field label="Cohort">{orDash(d.cohort?.name)}</Field>
                <Field label="Matched unit">{orDash(d.unit_key)}</Field>
                <Field label="Rotation dates">
                  {d.rotation
                    ? `${fmtDate(d.rotation.start)} to ${fmtDate(d.rotation.end)}`
                    : EMPTY}
                </Field>
                <Field label="Shift">{orDash(d.shift)}</Field>
                <Field label="Hours">
                  {/* UL-POLISH P2: the same mini progress bar the roster uses,
                      with the exact numbers always in text. */}
                  <span className="ptl-detail-hours">
                    {d.hours?.required > 0 && (
                      <span className="ptl-mini-progress" role="img"
                        aria-label={`${d.hours?.approved ?? 0} of ${d.hours.required} required hours approved`}>
                        <i style={{ width: `${Math.min(100, Math.round(((d.hours?.approved ?? 0) / d.hours.required) * 100))}%` }} />
                      </span>
                    )}
                    <span>
                      {`${d.hours?.approved ?? 0} approved of ${orDash(d.hours?.required)} required`}
                      {d.hours?.pending ? ` (${d.hours.pending} pending)` : ''}
                    </span>
                  </span>
                </Field>
                <Field label="Attendance">
                  {`${d.attendance?.shifts_recorded ?? 0} shifts recorded`}
                  {d.attendance?.most_recent_shift
                    ? `, most recent ${fmtDate(d.attendance.most_recent_shift)}`
                    : ''}
                </Field>
                <Field label="Preceptor">{orDash(d.preceptor_name)}</Field>
                <Field label="Work or school email"><ContactLink value={d.school_email} /></Field>
                <Field label="Personal email"><ContactLink value={d.personal_email} /></Field>
                <Field label="Phone"><ContactLink kind="phone" value={d.phone} /></Field>
                <Field label="Resume">
                  <ResumeAction studentId={d.id} available={d.has_resume} />
                </Field>
              </dl>

              <h3 className="ptl-detail-heading">Milestone history</h3>
              {milestoneStatus === 'loading' && <LoadingState label="Loading milestone history" />}
              {milestoneStatus === 'error' && (
                <ErrorState detail="Milestone history could not be loaded just now." />
              )}
              {milestoneStatus === 'ready' && milestones.rows.length === 0 && (
                <EmptyState title="No milestones yet"
                  detail="Confirmed milestones for this student will appear here." />
              )}
              {milestoneStatus === 'ready' && milestones.rows.length > 0 && (
                <ul className="ptl-detail-history">
                  {milestones.rows.map(m => (
                    <li key={m.id}>
                      <span className="ptl-detail-history-name">
                        {MILESTONE_LABEL[m.milestone] || m.milestone}
                      </span>
                      <span className="ptl-muted"> confirmed {fmtTimestamp(m.confirmed_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
