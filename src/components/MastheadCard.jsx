// MASTHEAD-PHASE-2b: the app's one way to show the masthead.
//
// The card is its own program now (docs/product/MASTHEAD_SERVICE_PLAN.md),
// served once at MASTHEAD_URL and loaded live: when a city or an effect lands
// there, this app shows it on the next page load with no build. This wrapper
// loads the element's script once, keeps the app's theme and the host props
// in step with the element, and carries the welcome tour's anchor, which has
// to be light DOM the tour can find.
import { useEffect, useImperativeHandle, useRef } from 'react'
import { ensureMasthead } from '../lib/mastheadService'

// The app's theme is an attribute on <html>; the element takes it as a prop
// and follows it, rather than the OS setting, so the card matches the page.
function appTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export default function MastheadCard({
  fullName,
  userKey = null,
  items = null,
  calendar = null,
  flush = false,
  headingRef = null,     // { focus() } that moves focus to the greeting for screen readers
  dateLabel = null,      // accepted for host parity; the clock owns the date
  contextLabel = null,   // accepted for host parity; the cohort lives in the scope picker
  onCampusCount = 0,     // accepted for host parity
}) {
  void dateLabel; void contextLabel; void onCampusCount
  const ref = useRef(null)
  useEffect(() => { ensureMasthead().catch(() => {}) }, [])

  // Object-valued inputs are properties on the element, not attributes. They
  // are applied again once the script has arrived: the element adopts a value
  // set before it upgraded, and this makes the same promise from the host side.
  useEffect(() => {
    let live = true
    const apply = () => {
      const el = ref.current
      if (!el || !live) return
      el.items = items || []
      el.calendar = calendar ? { label: calendar.label } : null
    }
    apply()
    ensureMasthead().then(apply).catch(() => {})
    return () => { live = false }
  }, [items, calendar])

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const onCalendar = () => calendar?.onClick?.()
    el.addEventListener('masthead-calendar', onCalendar)
    return () => el.removeEventListener('masthead-calendar', onCalendar)
  }, [calendar])

  // Follow the app's theme toggle live.
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const apply = () => el.setAttribute('theme', appTheme())
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  useImperativeHandle(headingRef, () => ({
    focus: () => { const el = ref.current; return typeof el?.focusHeading === 'function' ? el.focusHeading() : false },
  }), [])

  return (
    // WELCOME-TOUR-MASTHEAD-1: the tour anchors here, on light DOM, not inside the shadow root.
    <div data-tour="masthead" className="mast-host">
      <masthead-card
        ref={ref}
        mode="full"
        name={fullName || ''}
        user-key={userKey || undefined}
        flush={flush ? '' : undefined}
      />
    </div>
  )
}
