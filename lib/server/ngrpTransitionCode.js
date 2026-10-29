// lib/server/ngrpTransitionCode.js
//
// TRANSITION-FORM-CODE-1 (Owner, 2026-10-29): a forwarded Transition Form link must not open
// the form. The link now needs a 6-digit code emailed to the alumnus's own address (the same
// address the form was sent to, resolveStudentEmail: personal once their rotation has ended),
// then a short session carries them through the form.
//
// Stateless on purpose, so no migration: the code is an HMAC of the assignment, the link's
// token hash and a 10-minute window, so it changes every window, dies with the link (a revoked
// or reissued link has a different hash) and is accepted for the current and previous window
// only. Attempts are bounded by the shared rate limiter, keyed by the link, in the endpoint.
// The session is the same kind of HMAC with an expiry, held in the page's memory only.

import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { aspireEmailShell } from './email/aspireShell.js'
import { escapeHtml } from './email/emailPrimitives.js'

export const CODE_WINDOW_MINUTES = 10
export const SESSION_MINUTES = 120
const WINDOW_MS = CODE_WINDOW_MINUTES * 60 * 1000

function secret() {
  const s = process.env.NGRP_CODE_SECRET || process.env.SIG_TOKEN_SECRET
  if (!s) throw new Error('ngrp_code_secret_missing')
  return s
}

const hmac = (msg, key = secret()) => crypto.createHmac('sha256', key).update(msg).digest()

function codeFor(assignmentId, tokenHash, window, key) {
  const n = hmac(`ngrp-code:${assignmentId}:${tokenHash}:${window}`, key).readUInt32BE(0) % 1_000_000
  return String(n).padStart(6, '0')
}

export function issueCode(assignmentId, tokenHash, nowMs = Date.now(), key) {
  return codeFor(assignmentId, tokenHash, Math.floor(nowMs / WINDOW_MS), key)
}

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function checkCode(code, assignmentId, tokenHash, nowMs = Date.now(), key) {
  const typed = String(code || '').replace(/\D/g, '')
  if (typed.length !== 6) return false
  const w = Math.floor(nowMs / WINDOW_MS)
  return same(typed, codeFor(assignmentId, tokenHash, w, key)) || same(typed, codeFor(assignmentId, tokenHash, w - 1, key))
}

export function issueSession(assignmentId, tokenHash, nowMs = Date.now(), key) {
  const exp = nowMs + SESSION_MINUTES * 60 * 1000
  const sig = hmac(`ngrp-session:${assignmentId}:${tokenHash}:${exp}`, key).toString('base64url')
  return `${exp}.${sig}`
}

export function checkSession(session, assignmentId, tokenHash, nowMs = Date.now(), key) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(session || ''))
  if (!m) return false
  const exp = Number(m[1])
  if (!(exp > nowMs)) return false
  return same(m[2], hmac(`ngrp-session:${assignmentId}:${tokenHash}:${exp}`, key).toString('base64url'))
}

// "j•••@gmail.com": enough for the alumnus to recognise their own inbox, too little to
// hand a stranger holding a forwarded link anyone's address.
export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!local || !domain) return null
  return `${local[0]}${'•'.repeat(Math.min(Math.max(local.length - 1, 3), 6))}@${domain}`
}

export function transitionCodeEmail({ code, firstName }) {
  const P = t => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#191919;">${t}</p>`
  return {
    subject: `Your NGRP Transition Form code: ${code}`,
    html: aspireEmailShell({ body: [
      P(`Hi ${escapeHtml(firstName || 'there')},`),
      P('Your one-time code to open your NGRP Transition Form is:'),
      `<p style="margin:6px 0 16px;font-size:30px;letter-spacing:8px;font-weight:700;color:#1D2567;font-family:Menlo,Consolas,monospace;">${escapeHtml(code)}</p>`,
      P(`It works for about ${CODE_WINDOW_MINUTES} minutes. If you did not ask for it, someone may have your form link; you can ignore this email, and please let the ASPIRE team know at aspire@cshs.org.`),
    ].join(''), preheader: `Your code: ${code}` }),
  }
}
