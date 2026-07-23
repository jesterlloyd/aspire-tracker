// Shared HTTP helpers for portal feedback APIs. Safe error shapes only; no
// feedback text, authorization headers, provider details, or SQL text in logs.

/* global Buffer */

import { PORTAL_FEEDBACK_MAX_BODY_BYTES } from '../../lib/server/portalFeedback/config.js';

export function readPortalFeedbackJsonBody(req) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) {
    return { ok: false, status: 415, error: 'invalid_content_type' };
  }
  const raw = req.body;
  const size = typeof raw === 'string'
    ? Buffer.byteLength(raw)
    : Buffer.byteLength(JSON.stringify(raw || {}));
  if (size > PORTAL_FEEDBACK_MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload_too_large' };
  }
  const body = typeof raw === 'string' ? safeParse(raw) : raw;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 422, error: 'invalid_body' };
  }
  return { ok: true, body };
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export function safePortalFeedbackLog(endpoint, code, err) {
  const message = String(err?.message || '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  console.error(`[portal-feedback] ${endpoint} ${code}: ${message}`);
}
