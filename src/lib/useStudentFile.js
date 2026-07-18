// src/lib/useStudentFile.js
//
// WAVE F-2 (Pass 1): React hooks + imperative helpers that let a component read
// a student file through the server access endpoint. A headshot resolves on
// mount (images must render); a resume resolves on click (fresh short-lived URL
// per access, so expiry is never a problem and unopened resumes cost nothing).
//
// The endpoint enforces the access matrix, so a denied role simply receives a
// null URL and the component shows its normal fallback (initials, or no link).

import { useEffect, useRef, useState } from 'react'
import { fetchStudentFileUrl, fetchPortalHeadshotUrl } from './studentFileClient'
import { downloadFile } from './fileUtils'

// Resolve a signed URL for a student file on mount. Returns { url, loading, error }.
// `enabled` lets a caller skip the fetch (e.g. no stored file, or a role that
// should not even ask). `refreshKey` re-fetches when it changes (e.g. after an
// upload replaces the object).
export function useStudentFileUrl({ studentId, kind, enabled = true, refreshKey } = {}) {
  const active = Boolean(enabled && studentId && kind)
  const [state, setState] = useState({ url: null, loading: active, error: false })
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    // Both branches resolve through the async callback, so no setState runs
    // synchronously in the effect body. The previous url is kept while a refetch
    // runs, so an already-rendered image does not flash.
    const p = active
      ? fetchStudentFileUrl({ studentId, kind, signal: ctrl.signal })
      : Promise.resolve(null)
    p.then((url) => { if (!cancelled) setState({ url: url || null, loading: false, error: false }) })
      .catch(() => { if (!cancelled) setState({ url: null, loading: false, error: true }) })
    return () => { cancelled = true; ctrl.abort() }
  }, [studentId, kind, active, refreshKey])
  return state
}

// The Student Portal caller's own headshot.
export function usePortalHeadshotUrl({ enabled = true, refreshKey } = {}) {
  const [state, setState] = useState({ url: null, loading: Boolean(enabled), error: false })
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const p = enabled ? fetchPortalHeadshotUrl({ signal: ctrl.signal }) : Promise.resolve(null)
    p.then((url) => { if (!cancelled) setState({ url: url || null, loading: false, error: false }) })
      .catch(() => { if (!cancelled) setState({ url: null, loading: false, error: true }) })
    return () => { cancelled = true; ctrl.abort() }
  }, [enabled, refreshKey])
  return state
}

// Imperative: open a student file (resume) in a new tab. Mints a fresh signed
// URL on click. Returns { ok } or { ok:false, status }.
export async function openStudentFile({ studentId, kind }) {
  try {
    const url = await fetchStudentFileUrl({ studentId, kind })
    if (!url) return { ok: false, status: 404 }
    window.open(url, '_blank', 'noopener,noreferrer')
    return { ok: true }
  } catch (e) {
    return { ok: false, status: e?.status || 500 }
  }
}

// Imperative: download a student file with a chosen filename. Fetches a fresh
// signed URL, then the bytes, and saves them. Returns { ok } or { ok:false }.
export async function downloadStudentFile({ studentId, kind, filename }) {
  try {
    const url = await fetchStudentFileUrl({ studentId, kind })
    if (!url) return { ok: false, status: 404 }
    await downloadFile(url, filename)
    return { ok: true }
  } catch (e) {
    return { ok: false, status: e?.status || 500 }
  }
}

// A tiny hook to hold "busy" state for an imperative open/download button.
export function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const run = async (fn) => {
    setBusy(true)
    try { return await fn() } finally { if (mounted.current) setBusy(false) }
  }
  return [busy, run]
}
