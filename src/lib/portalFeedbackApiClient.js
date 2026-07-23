// Dormant shared browser foundation for a future portal feedback UI. This file
// is intentionally not imported by PortalShell or any routed portal surface.

import { supabase } from './supabase.js';
import { validatePortalFeedbackClientPayload as validateClientPayload, normalizePortalPathname } from './portalFeedbackValidation.js';

const STORAGE_PREFIX = 'aspire.portalFeedback.requestId.v1:';

export class PortalFeedbackApiError extends Error {
  constructor(message, { status, code, retryAfterSeconds } = {}) {
    super(message);
    this.name = 'PortalFeedbackApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds || null;
  }
}

export function createPortalFeedbackRequestId(intentKey = 'default') {
  const key = `${STORAGE_PREFIX}${intentKey}`;
  const existing = window.localStorage?.getItem(key);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  window.localStorage?.setItem(key, id);
  return id;
}

export function clearPortalFeedbackRequestId(intentKey = 'default') {
  window.localStorage?.removeItem(`${STORAGE_PREFIX}${intentKey}`);
}

export function buildPortalFeedbackPayload(input = {}) {
  return {
    request_id: input.request_id,
    type: input.type,
    message: input.message,
    pathname: input.pathname,
    section: input.section ?? null,
    build_sha: input.build_sha ?? null,
    environment: input.environment ?? null,
    ...(input.type === 'bug' ? {
      expected_behavior: input.expected_behavior ?? null,
      actual_behavior: input.actual_behavior ?? null,
      reproduction_steps: input.reproduction_steps ?? null,
      viewport_width: input.viewport_width ?? null,
      viewport_height: input.viewport_height ?? null,
    } : {}),
  };
}

export function validatePortalFeedbackClientPayload(input) {
  return validateClientPayload(buildPortalFeedbackPayload(input));
}

export { normalizePortalPathname };

export async function submitPortalFeedbackReport(payload, { signal } = {}) {
  const session = await supabase.auth.getSession();
  const token = session?.data?.session?.access_token;
  if (!token) throw new PortalFeedbackApiError('Not signed in', { status: 401, code: 'unauthorized' });

  const res = await fetch('/api/portal/feedback-submit', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildPortalFeedbackPayload(payload)),
    signal,
  });
  const retryAfterSeconds = Number(res.headers.get('Retry-After')) || null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PortalFeedbackApiError('Portal feedback submission failed', {
      status: res.status,
      code: body?.error || 'request_failed',
      retryAfterSeconds,
    });
  }
  return body;
}
