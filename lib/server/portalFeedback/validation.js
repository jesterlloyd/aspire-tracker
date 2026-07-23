// Pure validation and normalization for portal feedback/bug-report payloads.
// Identity, role, scope, and timestamps are always resolved server-side.

import { createHash } from 'node:crypto';
import {
  PORTAL_FEEDBACK_ALLOWED_FIELDS,
  PORTAL_FEEDBACK_MAX_BUILD_CHARS,
  PORTAL_FEEDBACK_MAX_ENV_CHARS,
  PORTAL_FEEDBACK_MAX_PATH_CHARS,
  PORTAL_FEEDBACK_MAX_SECTION_CHARS,
  PORTAL_FEEDBACK_MAX_TEXT_CHARS,
  PORTAL_FEEDBACK_MAX_VIEWPORT,
  PORTAL_FEEDBACK_TYPES,
} from './config.js';

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const HTML_TAG_RE = /<\s*\/?\s*[a-z][^>]*>/i;
function stripDisallowedControls(value) {
  return [...value].filter((char) => {
    const code = char.charCodeAt(0);
    return code === 10 || code === 9 || (code >= 32 && code !== 127);
  }).join('');
}

function normalizePlainText(value, { trim = false } = {}) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const withNormalizedLines = value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const normalized = stripDisallowedControls(withNormalizedLines);
  return trim ? normalized.trim() : normalized;
}

function validateTextField(value, field, { required = false, max = PORTAL_FEEDBACK_MAX_TEXT_CHARS, trim = false } = {}) {
  const normalized = normalizePlainText(value, { trim });
  if (normalized == null) {
    if (required) return { ok: false, error: `${field}_required` };
    return { ok: true, value: null };
  }
  if (required && normalized.trim().length === 0) return { ok: false, error: `${field}_required` };
  if (normalized.length > max) return { ok: false, error: `${field}_too_long` };
  if (HTML_TAG_RE.test(normalized)) return { ok: false, error: `${field}_html_not_allowed` };
  if (!required && normalized.trim().length === 0) return { ok: true, value: null };
  return { ok: true, value: normalized };
}

export function normalizePortalPathname(input) {
  if (typeof input !== 'string') return { ok: false, error: 'invalid_pathname' };
  const value = input.trim();
  if (!value || value.length > PORTAL_FEEDBACK_MAX_PATH_CHARS) {
    return { ok: false, error: 'invalid_pathname' };
  }
  if (!value.startsWith('/') || value.startsWith('//') || /[?#]/.test(value)) {
    return { ok: false, error: 'invalid_pathname' };
  }
  if (/^https?:\/\//i.test(value) || HTML_TAG_RE.test(value)) {
    return { ok: false, error: 'invalid_pathname' };
  }
  return { ok: true, value };
}

function validateOptionalShort(value, field, max) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  return validateTextField(value, field, { required: false, max, trim: true });
}

function validateViewport(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > PORTAL_FEEDBACK_MAX_VIEWPORT) {
    return { ok: false, error: 'invalid_viewport_dimensions' };
  }
  return { ok: true, value: n };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

export function buildPortalFeedbackFingerprint(payload) {
  const canonical = JSON.stringify(canonicalize(payload));
  return createHash('sha256').update(canonical).digest('hex');
}

export function validatePortalFeedbackPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid_body' };
  }

  const allowed = new Set(PORTAL_FEEDBACK_ALLOWED_FIELDS);
  const unexpected = Object.keys(input).filter(key => !allowed.has(key));
  if (unexpected.length > 0) return { ok: false, error: 'unexpected_fields', fields: unexpected };

  if (typeof input.request_id !== 'string' || !REQUEST_ID_RE.test(input.request_id.trim())) {
    return { ok: false, error: 'invalid_request_id' };
  }
  const requestId = input.request_id.trim();

  if (!PORTAL_FEEDBACK_TYPES.includes(input.type)) {
    return { ok: false, error: 'invalid_report_type' };
  }
  const type = input.type;

  const message = validateTextField(input.message, 'message', { required: true });
  if (!message.ok) return message;

  const pathname = normalizePortalPathname(input.pathname);
  if (!pathname.ok) return pathname;

  const section = validateOptionalShort(input.section, 'section', PORTAL_FEEDBACK_MAX_SECTION_CHARS);
  if (!section.ok) return section;
  const buildSha = validateOptionalShort(input.build_sha, 'build_sha', PORTAL_FEEDBACK_MAX_BUILD_CHARS);
  if (!buildSha.ok) return buildSha;
  const environment = validateOptionalShort(input.environment, 'environment', PORTAL_FEEDBACK_MAX_ENV_CHARS);
  if (!environment.ok) return environment;

  const expected = validateTextField(input.expected_behavior, 'expected_behavior');
  if (!expected.ok) return expected;
  const actual = validateTextField(input.actual_behavior, 'actual_behavior');
  if (!actual.ok) return actual;
  const steps = validateTextField(input.reproduction_steps, 'reproduction_steps');
  if (!steps.ok) return steps;
  const width = validateViewport(input.viewport_width, 'viewport_width');
  if (!width.ok) return width;
  const height = validateViewport(input.viewport_height, 'viewport_height');
  if (!height.ok) return height;

  if (type === 'feedback') {
    for (const field of ['expected_behavior', 'actual_behavior', 'reproduction_steps', 'viewport_width', 'viewport_height']) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '') {
        return { ok: false, error: 'unexpected_fields', fields: [field] };
      }
    }
  }

  const normalized = {
    request_id: requestId,
    type,
    message: message.value,
    pathname: pathname.value,
    section: section.value,
    build_sha: buildSha.value,
    environment: environment.value,
    expected_behavior: type === 'bug' ? expected.value : null,
    actual_behavior: type === 'bug' ? actual.value : null,
    reproduction_steps: type === 'bug' ? steps.value : null,
    viewport_width: type === 'bug' ? width.value : null,
    viewport_height: type === 'bug' ? height.value : null,
  };

  return {
    ok: true,
    value: normalized,
    payloadFingerprint: buildPortalFeedbackFingerprint(normalized),
  };
}
