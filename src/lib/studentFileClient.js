// src/lib/studentFileClient.js
//
// WAVE F-2 (Pass 1): the browser client for student files. Every consumer reads
// and uploads through here, so the browser never touches Supabase storage
// directly and never constructs an object path.
//
// Reads are server-mediated: a consumer asks the access endpoint for a
// short-lived signed URL by { studentId, kind } and renders that. This is
// identical before and after the Pass 2 backfill (the endpoint resolves a legacy
// public URL or a canonical path) and before and after the Pass 3 privatization
// (a signed URL works on a public or private bucket), so consumers never change
// again.
//
// Uploads use server-issued signed upload tokens (uploadToSignedUrl); no direct
// anonymous or authenticated storage upload remains in the app.

import { supabase } from './supabase'

const BUCKET = 'student-files'

// Pure classifier, mirroring the server parseStoredFileRef, for tests and for
// components that want to know whether a value is already a legacy URL.
export function classifyStoredFileRef(value) {
  if (value == null || String(value).trim() === '') return 'empty'
  const s = String(value).trim()
  if (/^https?:\/\//i.test(s)) {
    return s.includes(`/object/public/${BUCKET}/`) ? 'legacyPublicUrl' : 'unknown'
  }
  const clean = s.replace(/^\/+/, '')
  if (clean.includes('..') || clean.includes('\\') || clean.includes('//')
    || (clean.match(/\//g) || []).length !== 2) return 'unknown'
  return 'path'
}

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new StudentFileError(401, 'unauthenticated')
  return `Bearer ${token}`
}

export class StudentFileError extends Error {
  constructor(status, code) {
    super(code || `http_${status}`)
    this.name = 'StudentFileError'
    this.status = status
    this.code = code || null
  }
}

async function safeCode(res) {
  try {
    const j = await res.json()
    return typeof j?.error === 'string' ? j.error : null
  } catch { return null }
}

// ── Reads (staff) ───────────────────────────────────────────────────────────
// Batch: [{ studentId, kind }] -> Map keyed `${studentId}:${kind}` -> signedUrl|null.
export async function fetchStudentFileUrls(items, { signal } = {}) {
  const list = (items || []).filter((i) => i && i.studentId && i.kind)
  if (!list.length) return new Map()
  const res = await fetch('/api/student-file-access', {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: list.map((i) => ({ student_id: i.studentId, kind: i.kind })) }),
    signal,
  })
  if (!res.ok) throw new StudentFileError(res.status, await safeCode(res))
  const data = await res.json()
  const map = new Map()
  for (const r of data.results || []) map.set(`${r.student_id}:${r.kind}`, r.signed_url ?? null)
  return map
}

// Single: returns a signed URL or null.
export async function fetchStudentFileUrl({ studentId, kind, signal } = {}) {
  if (!studentId || !kind) return null
  const res = await fetch('/api/student-file-access', {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId, kind }),
    signal,
  })
  if (!res.ok) throw new StudentFileError(res.status, await safeCode(res))
  const data = await res.json()
  return data.signed_url ?? null
}

// ── Reads (portal own headshot) ─────────────────────────────────────────────
export async function fetchPortalHeadshotUrl({ signal } = {}) {
  const res = await fetch('/api/portal/student-file-access', {
    method: 'GET',
    headers: { Authorization: await authHeader() },
    signal,
  })
  if (!res.ok) throw new StudentFileError(res.status, await safeCode(res))
  const data = await res.json()
  return data.signed_url ?? null
}

// ── Uploads ─────────────────────────────────────────────────────────────────
// Anonymous intake: no auth header; server resolves the student by school email.
// Returns the object path on success. Throws StudentFileError otherwise.
export async function signAndUploadIntakeFile({ schoolEmail, kind, file }) {
  const res = await fetch('/api/student-intake-file-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ school_email: schoolEmail, kind, filename: file.name, content_type: file.type, size: file.size }),
  })
  if (!res.ok) throw new StudentFileError(res.status, await safeCode(res))
  const { token, path } = await res.json()
  const { error } = await supabase.storage.from(BUCKET)
    .uploadToSignedUrl(path, token, file, { upsert: true, contentType: file.type })
  if (error) throw new StudentFileError(502, 'upload_failed')
  return { path }
}

// Authenticated staff (Owner/Admin, enforced server-side). Returns the path.
export async function signAndUploadStaffFile({ studentId, kind, file }) {
  const res = await fetch('/api/student-file-sign', {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId, kind, filename: file.name, content_type: file.type, size: file.size }),
  })
  if (!res.ok) throw new StudentFileError(res.status, await safeCode(res))
  const { token, path } = await res.json()
  const { error } = await supabase.storage.from(BUCKET)
    .uploadToSignedUrl(path, token, file, { upsert: true, contentType: file.type })
  if (error) throw new StudentFileError(502, 'upload_failed')
  return { path }
}

// ── Cleanup (staff) ─────────────────────────────────────────────────────────
export async function cleanupStudentFiles({ studentId, action, kind, keepExt }) {
  const res = await fetch('/api/student-file-cleanup', {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId, action, ...(kind && { kind }), ...(keepExt && { keep_ext: keepExt }) }),
  })
  // Cleanup is best-effort; never throw into a delete/upload flow.
  if (!res.ok) return { ok: false }
  return { ok: true }
}

// Safe, user-facing copy for a read/upload failure.
export function mapStudentFileError(status) {
  switch (Number(status)) {
    case 401: return 'Your session expired. Sign in again to continue.'
    case 403: return 'You do not have access to this file.'
    case 404: return 'That file is no longer available.'
    case 413: return 'That file is too large.'
    case 422: return 'That file type is not accepted.'
    case 429: return 'Too many requests. Wait a moment and try again.'
    default:  return 'Something went wrong with that file. Try again.'
  }
}
