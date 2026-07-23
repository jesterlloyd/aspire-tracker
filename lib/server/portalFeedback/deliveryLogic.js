import {
  PORTAL_FEEDBACK_BACKOFF_SECONDS,
  PORTAL_FEEDBACK_MAX_ATTEMPTS,
} from './config.js';

export function nextPortalFeedbackDelaySeconds(attemptsMade) {
  const idx = Math.min(Math.max(attemptsMade - 1, 0), PORTAL_FEEDBACK_BACKOFF_SECONDS.length - 1);
  return PORTAL_FEEDBACK_BACKOFF_SECONDS[idx];
}

export function nextPortalFeedbackDeliveryState({ outcome, attemptsMade, maxAttempts = PORTAL_FEEDBACK_MAX_ATTEMPTS } = {}) {
  if (outcome === 'sent') return { deliveryStatus: 'sent', delaySeconds: 0 };
  if (outcome === 'permanent') return { deliveryStatus: 'permanent_failure', delaySeconds: 0 };
  if (outcome === 'transient') {
    if (attemptsMade >= maxAttempts) return { deliveryStatus: 'permanent_failure', delaySeconds: 0 };
    return { deliveryStatus: 'retryable_failure', delaySeconds: nextPortalFeedbackDelaySeconds(attemptsMade) };
  }
  throw new Error(`unknown portal feedback delivery outcome ${outcome}`);
}

export function sanitizePortalFeedbackError(text) {
  if (text == null) return null;
  return String(text)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

const PERMANENT_CODES = new Set([
  'validation_error',
  'invalid_from_address',
  'invalid_parameter',
  'missing_required_field',
  'restricted_api_key',
  'invalid_api_key',
  'missing_api_key',
  'invalid_access',
]);

export function classifyPortalFeedbackSendError(errorCode) {
  if (errorCode && PERMANENT_CODES.has(errorCode)) return 'permanent';
  return 'transient';
}
