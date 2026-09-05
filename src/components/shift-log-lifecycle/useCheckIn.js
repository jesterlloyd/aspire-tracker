// useCheckIn.js - B2 check-in hook for the shift-log lifecycle.
// Calls POST /api/shift-log/check-in. Returns { status, data } or
// { _networkError: true }. No PII logged.

import { useState, useCallback } from 'react'

export function useCheckIn(transport = null) {
  const [submitting, setSubmitting] = useState(false)

  const checkIn = useCallback(async (payload) => {
    setSubmitting(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    try {
      // STUDENT-SHIFT-TAB-1: the portal supplies a transport that carries its session
      // token to the authenticated endpoint; the public page keeps the plain POST.
      const res = transport?.send
        ? await transport.send(payload, controller.signal)
        : await fetch('/api/shift-log/check-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
      clearTimeout(timeoutId)
      if (res.status >= 500) return { _networkError: true }
      const data = await res.json().catch(() => ({}))
      return { status: res.status, data }
    } catch {
      clearTimeout(timeoutId)
      return { _networkError: true }
    } finally {
      setSubmitting(false)
    }
  }, [transport])

  return { checkIn, submitting }
}
