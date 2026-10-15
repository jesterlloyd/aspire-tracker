// FEEDBACK-MENU-1 (Owner, 2026-10-14): Send Feedback is no longer a floating button. A student
// mistook it for Messages and sent a message as feedback, so it now opens from a place you go
// on purpose: Settings > General in the staff app, the profile menu in a portal. The panel
// still lives where it always did (StaffApp, PortalUtilityLayer); this is the one way to open
// it from elsewhere. Same announce/subscribe shape as keithBus.js: tiny, behavioural, no React
// beyond the availability hook.

import { useSyncExternalStore } from 'react'

const openers = new Set()
const watchers = new Set()
const notify = () => watchers.forEach(fn => { try { fn() } catch { /* ignore */ } })

/** Open the feedback panel. Does nothing where no panel is mounted (or feedback is off). */
export function openFeedback() {
  openers.forEach(fn => { try { fn() } catch { /* one bad listener must not break the rest */ } })
}

/** A mounted, enabled feedback panel registers here. Returns an unsubscribe function. */
export function onOpenFeedback(fn) {
  openers.add(fn)
  notify()
  return () => { openers.delete(fn); notify() }
}

/** True while some feedback panel can be opened, so a menu shows the item only when it works. */
export function useFeedbackAvailable() {
  return useSyncExternalStore(
    (fn) => { watchers.add(fn); return () => watchers.delete(fn) },
    () => openers.size > 0,
    () => false,
  )
}
