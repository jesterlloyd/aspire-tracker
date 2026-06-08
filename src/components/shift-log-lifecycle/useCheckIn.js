// useCheckIn.js — B2 check-in hook for the shift-log lifecycle.
// Calls POST /api/shift-log/check-in. Returns { status, data } or
// { _networkError: true }. No PII logged.

import { useState, useCallback } from 'react'

export function useCheckIn() {
  const [submitting, setSubmitting] = useState(false)

  const checkIn = useCallback(async (payload) => {
    setSubmitting(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch('/api/shift-log/check-in', {
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
  }, [])

  return { checkIn, submitting }
}
