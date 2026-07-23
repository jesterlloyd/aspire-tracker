const ALLOWED_FIELDS = [
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

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const HTML_TAG_RE = /<\s*\/?\s*[a-z][^>]*>/i;

function text(value, field, { required = false, max = 5000 } = {}) {
  if (value == null || value === '') {
    return required ? { ok: false, error: `${field}_required` } : { ok: true, value: null };
  }
  if (typeof value !== 'string') return { ok: false, error: `${field}_required` };
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (required && normalized.trim().length === 0) return { ok: false, error: `${field}_required` };
  if (normalized.length > max) return { ok: false, error: `${field}_too_long` };
  if (HTML_TAG_RE.test(normalized)) return { ok: false, error: `${field}_html_not_allowed` };
  return { ok: true, value: normalized };
}

export function normalizePortalPathname(input) {
  if (typeof input !== 'string') return { ok: false, error: 'invalid_pathname' };
  const value = input.trim();
  if (!value || value.length > 240 || !value.startsWith('/') || value.startsWith('//') || /[?#]/.test(value)) {
    return { ok: false, error: 'invalid_pathname' };
  }
  return { ok: true, value };
}

function viewport(value) {
  if (value == null || value === '') return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10000) return { ok: false, error: 'invalid_viewport_dimensions' };
  return { ok: true, value: n };
}

export function validatePortalFeedbackClientPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_body' };
  const unexpected = Object.keys(input).filter(key => !ALLOWED_FIELDS.includes(key));
  if (unexpected.length > 0) return { ok: false, error: 'unexpected_fields', fields: unexpected };
  if (typeof input.request_id !== 'string' || !REQUEST_ID_RE.test(input.request_id.trim())) {
    return { ok: false, error: 'invalid_request_id' };
  }
  if (input.type !== 'feedback' && input.type !== 'bug') return { ok: false, error: 'invalid_report_type' };

  const message = text(input.message, 'message', { required: true });
  if (!message.ok) return message;
  const pathname = normalizePortalPathname(input.pathname);
  if (!pathname.ok) return pathname;

  if (input.type === 'feedback') {
    for (const field of ['expected_behavior', 'actual_behavior', 'reproduction_steps', 'viewport_width', 'viewport_height']) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '') {
        return { ok: false, error: 'unexpected_fields', fields: [field] };
      }
    }
  }

  for (const [field, max] of [['section', 120], ['build_sha', 80], ['environment', 40]]) {
    const checked = text(input[field], field, { max });
    if (!checked.ok) return checked;
  }
  if (input.type === 'bug') {
    for (const field of ['expected_behavior', 'actual_behavior', 'reproduction_steps']) {
      const checked = text(input[field], field);
      if (!checked.ok) return checked;
    }
    const width = viewport(input.viewport_width);
    if (!width.ok) return width;
    const height = viewport(input.viewport_height);
    if (!height.ok) return height;
  }

  return { ok: true };
}
