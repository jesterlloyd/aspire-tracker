// ASPIRE PORTAL FEEDBACK: shared backend constants. No secrets, no I/O.

export const PORTAL_FEEDBACK_RATE_LIMIT = {
  action: 'portal_feedback_submission',
  maxPerWindow: 5,
  windowSeconds: 3600,
};

export const PORTAL_FEEDBACK_MAX_BODY_BYTES = 64 * 1024;
export const PORTAL_FEEDBACK_MAX_TEXT_CHARS = 5000;
export const PORTAL_FEEDBACK_MAX_PATH_CHARS = 240;
export const PORTAL_FEEDBACK_MAX_SECTION_CHARS = 120;
export const PORTAL_FEEDBACK_MAX_BUILD_CHARS = 80;
export const PORTAL_FEEDBACK_MAX_ENV_CHARS = 40;
export const PORTAL_FEEDBACK_MAX_VIEWPORT = 10000;

export const PORTAL_FEEDBACK_TYPES = ['feedback', 'bug'];
export const PORTAL_FEEDBACK_ROLES = ['student', 'unit_leader', 'academic_partner'];

export const PORTAL_FEEDBACK_MAX_ATTEMPTS = 5;
export const PORTAL_FEEDBACK_CLAIM_STALE_SECONDS = 300;
export const PORTAL_FEEDBACK_CLAIM_BATCH_LIMIT = 20;
export const PORTAL_FEEDBACK_BACKOFF_SECONDS = [60, 300, 900, 1800, 3600];

export const PORTAL_FEEDBACK_ALLOWED_FIELDS = [
  'request_id',
  'type',
  'message',
  'pathname',
  'section',
  'build_sha',
  'environment',
  'expected_behavior',
  'actual_behavior',
  'reproduction_steps',
  'viewport_width',
  'viewport_height',
];
