// src/portal/portalAccessSignal.js
//
// How a portal data surface tells the shell that this person's access has ended.
//
// THE PROBLEM THIS SOLVES. Every portal view fetches its own data and owns its own
// error state, so when access was revoked mid-session each one reported the failure
// in its own local terms. The Academic Partner students view said "Something went
// wrong. We could not load your students right now. Please try again shortly", with
// a Try again button. Nothing had gone wrong, the person's access had ended, Try
// again could never succeed, and "shortly" promised a recovery that was not coming.
// On reload the same person correctly reached "No portal access on this account",
// so only the mid-session path was wrong.
//
// A view cannot answer this on its own: it knows one request failed, not what the
// person's standing now is. So it reports upward, and PortalApp, which already owns
// access resolution and the no-access card, decides what to show.
//
// WHAT A VIEW DOES. Call the reporter with the failed request's status and reason.
// It returns the classification, so one call both escalates and tells the caller
// whether to keep rendering its own error:
//
//   const reportFailure = useReportPortalFailure()
//   const kind = reportFailure({ status: res.status, error: payload?.error })
//   if (kind === ACCESS_FAILURE.ACCESS_ENDED) return   // the shell takes over
//   setError('...')                                    // genuinely transient
//
// Views that do not need to distinguish (a per-student photo, an optional badge)
// can keep ignoring failures entirely. The default reporter is a no-op, so a view
// rendered outside the portal shell, or in a test, behaves exactly as before.

import { createContext, useCallback, useContext, useEffect } from 'react'
import { classifyPortalFailure, ACCESS_FAILURE } from '../lib/portalAccessState'

export { ACCESS_FAILURE }

// The default classifies but escalates nowhere, so calling this outside a portal
// shell is harmless rather than an error.
export const PortalAccessSignalContext = createContext(null)

export function useReportPortalFailure() {
  const onAccessEnded = useContext(PortalAccessSignalContext)
  // Consumers may safely use this reporter as an effect or callback dependency. Returning a new
  // function on every render caused the Academic Partner roster effect to cancel its own request
  // and restart indefinitely, leaving the portal on "Loading your students".
  return useCallback((failure) => {
    const kind = classifyPortalFailure(failure)
    if (kind === ACCESS_FAILURE.ACCESS_ENDED && typeof onAccessEnded === 'function') {
      onAccessEnded(failure)
    }
    return kind
  }, [onAccessEnded])
}

// The same escalation for a surface that does not own the fetch, such as a
// react-query view that only learns `isError`. Reports once when the failure
// appears, so the shell can take over.
//
// `failed` gates it so a healthy view reports nothing. The reporter is stable until the provider
// callback changes, and re-reporting the same ended access is harmless anyway: PortalApp only acts
// on the first one.
export function useReportAccessFailureEffect(failed, failure) {
  const reportFailure = useReportPortalFailure()
  const status = failure?.status
  const error = failure?.error
  useEffect(() => {
    if (failed) reportFailure({ status, error })
  }, [failed, status, error, reportFailure])
}
