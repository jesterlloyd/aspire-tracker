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
import { resolveStudentPhotoUrl, peekStudentPhotoUrl } from './studentPhotoCache'
import { downloadFile } from './fileUtils'

// Resolve a signed URL for a student file on mount. Returns { url, loading, error }.
// `enabled` lets a caller skip the fetch (e.g. no stored file, or a role that
// should not even ask). `refreshKey` is the stored reference value; it both re-keys
// the shared cache (so a replacement upload re-signs) and lets the same student's
// photo be reused across views and remounts.
//
// The signed URL is resolved through the shared studentPhotoCache: repeated mounts
// (list<->grid, tab navigation) and multiple avatars for the same student share ONE
// signing request and reuse a STABLE URL until it nears expiry, so warm navigation
// is instant and the browser image cache is not defeated.
export function useStudentFileUrl({ studentId, kind, enabled = true, refreshKey } = {}) {
  const active = Boolean(enabled && studentId && kind)
  const key = active ? `${studentId}:${kind}:${refreshKey ?? ''}` : null
  // Warm render: if the URL is already cached, show it immediately (no flash, no request).
  const [state, setState] = useState(() => {
    const cached = peekStudentPhotoUrl(key)
    return { url: cached, loading: active && !cached, error: false }
  })
  useEffect(() => {
    let cancelled = false
    const p = active
      ? resolveStudentPhotoUrl(key, () => fetchStudentFileUrl({ studentId, kind }))
      : Promise.resolve(null)
    p.then((url) => { if (!cancelled) setState({ url: url || null, loading: false, error: false }) })
      .catch(() => { if (!cancelled) setState({ url: null, loading: false, error: true }) })
    return () => { cancelled = true }
  }, [key, active, studentId, kind])
  return state
}

// The Student Portal caller's own headshot (shares the same cache; keyed to self).
export function usePortalHeadshotUrl({ enabled = true, refreshKey } = {}) {
  const key = enabled ? `portal-self:${refreshKey ?? ''}` : null
  const [state, setState] = useState(() => {
    const cached = peekStudentPhotoUrl(key)
    return { url: cached, loading: Boolean(enabled) && !cached, error: false }
  })
  useEffect(() => {
    let cancelled = false
    const p = enabled
      ? resolveStudentPhotoUrl(key, () => fetchPortalHeadshotUrl())
      : Promise.resolve(null)
    p.then((url) => { if (!cancelled) setState({ url: url || null, loading: false, error: false }) })
      .catch(() => { if (!cancelled) setState({ url: null, loading: false, error: true }) })
    return () => { cancelled = true }
  }, [key, enabled])
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
// signed URL, then the bytes, and saves them. If the caller's filename has no
// extension, the real one is taken from the resolved object path so a saved
// resume keeps its .pdf/.docx. Returns { ok } or { ok:false }.
export async function downloadStudentFile({ studentId, kind, filename }) {
  try {
    const url = await fetchStudentFileUrl({ studentId, kind })
    if (!url) return { ok: false, status: 404 }
    let name = filename
    if (name && !/\.[a-z0-9]+$/i.test(name)) {
      const ext = url.split('?')[0].split('.').pop()
      if (ext && ext.length <= 5) name = `${name}.${ext}`
    }
    await downloadFile(url, name)
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
