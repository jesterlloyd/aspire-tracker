// lib/server/forms/tokens.js
//
// FORMS-PHASE3: a form link is the whole identity check (Owner, 2026-09-23). The token is
// base64url(HMAC-SHA256(secret, "form:" + assignment id + ":" + version)): derived, so a
// reminder carries the SAME link without the server keeping it, and only its SHA-256 is
// stored. The "form:" namespace means a form token can never open a signature request.
//
// FORM_TOKEN_SECRET, else SIG_TOKEN_SECRET (the one secret Signatures already needs).
// Without either, nothing can be issued or checked (fail closed).

import { createHash, createHmac } from 'node:crypto'
import process from 'node:process'

export class FormTokenConfigError extends Error {
  constructor() { super('FORM_TOKEN_SECRET (or SIG_TOKEN_SECRET) is not configured.'); this.code = 'token_secret_missing' }
}

const secret = (env = process.env) => {
  const s = env.FORM_TOKEN_SECRET || env.SIG_TOKEN_SECRET
  if (!s || s.length < 32) throw new FormTokenConfigError()
  return s
}

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')
export const formTokenFor = (assignmentId, version = 1, env) =>
  createHmac('sha256', secret(env)).update(`form:${assignmentId}:${version}`).digest('base64url')
export const FORM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
