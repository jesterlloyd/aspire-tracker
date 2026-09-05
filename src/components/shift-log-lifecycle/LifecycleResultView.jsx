// LifecycleResultView.jsx - confirmations, ineligible states, and errors.
// Student-facing copy only: no "exception flags" / "Auto-Accepted" jargon;
// Pending Review is shown as "submitted for review". The check-in confirmation
// states the ASPIRE team can see the student is onsite (NOT that the preceptor
// was notified).

const F = 'Plus Jakarta Sans, sans-serif'
const JESTER = 'JesterLloyd.Bautista@cshs.org'

const CARD = { background: '#fff', borderRadius: 16, padding: '28px 24px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', fontFamily: F }
const BTN_PRIMARY = {
  width: '100%', minHeight: 52, fontSize: 16, fontWeight: 700, fontFamily: F,
  background: 'var(--nightfall,#1D2567)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer',
}
const BTN_SECONDARY = {
  width: '100%', minHeight: 48, fontSize: 15, fontWeight: 600, fontFamily: F,
  background: '#fff', color: 'var(--nightfall,#1D2567)', border: '2px solid var(--nightfall,#1D2567)', borderRadius: 12, cursor: 'pointer', marginTop: 12,
}

function fmtTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtShiftDate(s) {
  if (!s) return null
  const d = new Date(`${s}T12:00:00`)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Banner({ emoji, bg, color, heading, children }) {
  return (
    <div style={{ background: bg, borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
      <div style={{ fontSize: 40, marginBottom: 6 }}>{emoji}</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color, margin: '0 0 6px', fontFamily: F }}>{heading}</h2>
      <div style={{ fontSize: 14, color, lineHeight: 1.55, fontFamily: F }}>{children}</div>
    </div>
  )
}

function Contact() {
  return (
    <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0', lineHeight: 1.6, fontFamily: F }}>
      Need help? Email <a href={`mailto:${JESTER}`} style={{ color: 'var(--nightfall,#1D2567)' }}>{JESTER}</a>.
    </p>
  )
}

// STUDENT-SHIFT-TAB-1: inside the portal there is no email to change, so `onTryDifferentEmail`
// is null there and the email buttons do not render; the advice text and Contact block stay.
export default function LifecycleResultView({ variant, data = {}, onDone, onTryDifferentEmail, onRetry }) {
  const name = data.studentName
  const shift = data.shift || {}
  const totals = data.totals || {}

  let body = null

  if (variant === 'check_in_success') {
    const t = fmtTime(shift.checked_in_at)
    body = (
      <>
        <Banner emoji="✅" bg="#D1FAE5" color="#065F46" heading="You're checked in">
          {t ? <>Checked in {t}. </> : null}The ASPIRE team can now see that you're onsite.
        </Banner>
        <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, margin: '0 0 16px', fontFamily: F }}>
          Return here when your shift ends and tap Check Out.
        </p>
        <button style={BTN_PRIMARY} onClick={onDone}>Done</button>
      </>
    )
  } else if (variant === 'check_out_success_auto_accepted') {
    body = (
      <>
        <Banner emoji="✅" bg="#D1FAE5" color="#065F46" heading="Shift logged">
          Thanks{name ? `, ${name}` : ''}. {shift.total_hours} hours recorded for your {shift.unit_name} shift on {fmtShiftDate(shift.shift_date)}.
        </Banner>
        {(shift.learning_highlight || shift.support_needed) && (
          <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, margin: '0 0 16px', fontFamily: F }}>
            Thanks for sharing your reflections, the ASPIRE team will see them.
          </p>
        )}
        <button style={BTN_PRIMARY} onClick={onDone}>Done</button>
      </>
    )
  } else if (variant === 'check_out_success_pending_review') {
    body = (
      <>
        <Banner emoji="🟡" bg="#FEF3C7" color="#78350F" heading="Shift submitted for review">
          Thanks{name ? `, ${name}` : ''}. Your {shift.total_hours}-hour shift on {shift.unit_name} has been submitted. The ASPIRE team will review the details and confirm soon.
        </Banner>
        <button style={BTN_PRIMARY} onClick={onDone}>Done</button>
      </>
    )
  } else if (variant === 'check_out_already_completed') {
    body = (
      <>
        <Banner emoji="✅" bg="#D1FAE5" color="#065F46" heading="Looks like you already checked out">
          We have a completed shift on file for {fmtShiftDate(shift.shift_date)}. No action needed.
        </Banner>
        <button style={BTN_PRIMARY} onClick={onDone}>Done</button>
      </>
    )
  } else if (variant === 'ineligible_not_found') {
    body = (
      <>
        <Banner emoji="🔍" bg="#FEF3C7" color="#78350F" heading="We couldn't find that email">
          Make sure you're using the email your school registered with ASPIRE.
        </Banner>
        <Contact />
        {onTryDifferentEmail && <button style={BTN_PRIMARY} onClick={onTryDifferentEmail}>Try a different email</button>}
      </>
    )
  } else if (variant === 'ineligible_not_active_rotation') {
    body = (
      <>
        <Banner emoji="🟡" bg="#FEF3C7" color="#78350F" heading="You're not in an active rotation">
          Your records show you're not currently in an active ASPIRE rotation. If this seems wrong, please reach out to the ASPIRE team.
        </Banner>
        <Contact />
        {onTryDifferentEmail && <button style={BTN_PRIMARY} onClick={onTryDifferentEmail}>Try a different email</button>}
      </>
    )
  } else if (variant === 'ineligible_cohort_archived') {
    body = (
      <>
        <Banner emoji="📁" bg="#FEF3C7" color="#78350F" heading="This rotation has ended">
          The cohort you're associated with has been archived. Please contact the ASPIRE team if you need to update something.
        </Banner>
        <Contact />
        {onTryDifferentEmail && <button style={BTN_PRIMARY} onClick={onTryDifferentEmail}>Try a different email</button>}
      </>
    )
  } else if (variant === 'ambiguous') {
    body = (
      <>
        <Banner emoji="🟡" bg="#FEF3C7" color="#78350F" heading="We need a little help">
          It looks like your email is associated with more than one record. Please contact the ASPIRE team so we can resolve this.
        </Banner>
        <Contact />
        {onTryDifferentEmail && <button style={BTN_PRIMARY} onClick={onTryDifferentEmail}>Try a different email</button>}
      </>
    )
  } else { // network_error
    body = (
      <>
        <Banner emoji="⚠️" bg="#FEE2E2" color="#7F1D1D" heading="Something went wrong">
          We couldn't reach the system. Check your connection and try again.
        </Banner>
        {onRetry && <button style={BTN_PRIMARY} onClick={onRetry}>Try again</button>}
        {onTryDifferentEmail && <button style={BTN_SECONDARY} onClick={onTryDifferentEmail}>Start over</button>}
      </>
    )
  }

  return <div style={CARD}>{body}</div>
}
