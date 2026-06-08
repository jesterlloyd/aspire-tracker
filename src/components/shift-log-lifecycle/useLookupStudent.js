// useLookupStudent.js — B1 lookup hook for the shift-log lifecycle.
// Calls POST /api/shift-log/lookup-student. Returns the parsed response, or
// { _networkError: true } on timeout / network failure / 5xx. No PII logged.

import { useState, useCallback } from 'react'

export function useLookupStudent() {
  const [loading, setLoading] = useState(false)

  const lookup = useCallback(async (schoolEmail) => {
    setLoading(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch('/api/shift-log/lookup-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_email: schoolEmail }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (res.status >= 500) return { _networkError: true }
      return await res.json()
    } catch {
      clearTimeout(timeoutId)
      return { _networkError: true }
    } finally {
      setLoading(false)
    }
  }, [])

  return { lookup, loading }
}
