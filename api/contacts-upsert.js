// api/contacts-upsert.js
//
// Owner/admin-authenticated endpoint to create or update a contact record.
//
// POST /api/contacts-upsert
// Authorization: Bearer <session_access_token>
//
// Body (JSON):
//   id            — optional UUID; if present → UPDATE, if absent → INSERT
//   full_name     — required, non-empty string
//   preferred_name, email, phone, organization, role, role_qualifier,
//   school_name, program_type, unit_name, related_units, is_active,
//   notification_preferences, notes, linkedin_url,
//   preferred_contact_method, avatar_url, category  — all optional
//
// Success response:
//   200 { contact: { id, full_name, email, ... } }
//
// Errors:
//   400 — validation failure
//   401 — missing or invalid session
//   403 — authenticated but not owner or admin
//   405 — wrong HTTP method
//   409 — duplicate email
//   500 — database error

import { createClient } from '@supabase/supabase-js';

const ALLOWED_FIELDS = new Set([
  'full_name',
  'preferred_name',
  'email',
  'phone',
  'organization',
  'role',
  'role_qualifier',
  'school_name',
  'program_type',
  'unit_name',
  'related_units',
  'is_active',
  'notification_preferences',
  'notes',
  'linkedin_url',
  'preferred_contact_method',
  'avatar_url',
  'category',
]);

const VALID_PREFERRED_CONTACT_METHODS = new Set([
  'email',
  'phone',
  'text',
  'teams',
  'no_preference',
]);

const VALID_CATEGORIES = new Set([
  'Academic Partners',
  'Unit Leadership',
  'Preceptors',
  'BNI Team',
  'Nursing Executives',
  'Other',
]);

const EMAIL_PATTERN = /^[^@]+@[^@]+\.[^@]+$/;
const UUID_PATTERN  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_PATTERN.test(v);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[contacts-upsert] unhandled exception:', err?.message || err);
    return res.status(500).json({ error: `Server error: ${err?.message || 'unknown'}` });
  }
}

async function _handler(req, res) {

  // 1. Auth: Bearer session token
  const authHeader  = req.headers['authorization'] || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl  = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL;
  const anonKey      = process.env.SUPABASE_ANON_KEY  || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });

  let user;
  try {
    const { data: { user: u }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !u) return res.status(401).json({ error: 'Unauthorized' });
    user = u;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Role check via user_profiles
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 3. Parse body
  let body;
  try {
    const raw = req.body;
    body = (raw && typeof raw === 'object') ? raw : JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const isUpdate = Boolean(body.id);

  // 4. Validate id on update
  if (isUpdate && !isUuid(body.id)) {
    return res.status(400).json({ error: 'id must be a valid UUID' });
  }

  // 5. Strip to allowed fields only
  const payload = {};
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      payload[key] = body[key];
    }
  }

  // 6. Normalize string fields: trim and convert empty strings to null
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'related_units' || key === 'notification_preferences') continue; // handle separately
    if (key === 'is_active') continue; // boolean
    if (typeof value === 'string') {
      const trimmed = value.trim();
      payload[key] = trimmed === '' ? null : trimmed;
    }
  }

  // 7. Validate full_name (required)
  const fullName = payload.full_name;
  if (!fullName || (typeof fullName === 'string' && fullName.trim() === '') || fullName === null) {
    return res.status(400).json({ error: 'full_name is required and must be non-empty' });
  }

  // 8. Validate email (optional)
  if (payload.email !== undefined && payload.email !== null) {
    if (!EMAIL_PATTERN.test(payload.email)) {
      return res.status(400).json({ error: 'email is not valid' });
    }
  }

  // 9. Validate linkedin_url (optional)
  if (payload.linkedin_url !== undefined && payload.linkedin_url !== null) {
    const url = payload.linkedin_url;
    if (!(url.startsWith('http://') || url.startsWith('https://')) || !url.includes('linkedin.com')) {
      return res.status(400).json({
        error: 'linkedin_url must start with http:// or https:// and include linkedin.com',
      });
    }
  }

  // 10. Validate preferred_contact_method (optional)
  if (payload.preferred_contact_method !== undefined && payload.preferred_contact_method !== null) {
    if (!VALID_PREFERRED_CONTACT_METHODS.has(payload.preferred_contact_method)) {
      return res.status(400).json({
        error: `preferred_contact_method must be one of: ${[...VALID_PREFERRED_CONTACT_METHODS].join(', ')}`,
      });
    }
  }

  // 11. Validate category (optional enum)
  // Absent and null are accepted (nullable column). Empty string is already null after step 6.
  if (payload.category !== undefined && payload.category !== null) {
    if (!VALID_CATEGORIES.has(payload.category)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${[...VALID_CATEGORIES].join(', ')}`,
      });
    }
  }

  // 12. Validate and normalize related_units (optional)
  if (payload.related_units !== undefined && payload.related_units !== null) {
    if (typeof payload.related_units === 'string') {
      // Accept comma-separated string and split to array
      payload.related_units = payload.related_units
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    }
    if (!Array.isArray(payload.related_units)) {
      return res.status(400).json({ error: 'related_units must be an array of strings or a comma-separated string' });
    }
    if (!payload.related_units.every(item => typeof item === 'string')) {
      return res.status(400).json({ error: 'related_units must contain only strings' });
    }
  }

  // 13. Validate is_active (boolean, default true on create)
  if (!isUpdate && payload.is_active === undefined) {
    payload.is_active = true;
  }
  if (payload.is_active !== undefined && payload.is_active !== null) {
    if (typeof payload.is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }
  }

  // 14. Duplicate email check
  if (payload.email) {
    const emailLower = payload.email.toLowerCase();
    let dupQuery = supabaseAdmin
      .from('contacts')
      .select('id')
      .ilike('email', emailLower)
      .limit(1);

    if (isUpdate) {
      dupQuery = dupQuery.neq('id', body.id);
    }

    const { data: dupRows, error: dupErr } = await dupQuery;
    if (dupErr) {
      console.error('[contacts-upsert] duplicate check error:', dupErr.message);
      return res.status(500).json({ error: 'Failed to check for duplicate email' });
    }
    if (dupRows && dupRows.length > 0) {
      return res.status(409).json({ error: 'A contact with this email already exists.' });
    }
  }

  // 15. Perform INSERT or UPDATE
  let contact;
  const operation = isUpdate ? 'updated' : 'created';

  if (isUpdate) {
    // Only update fields that were provided in the payload
    const { data, error: updateErr } = await supabaseAdmin
      .from('contacts')
      .update(payload)
      .eq('id', body.id)
      .select()
      .single();

    if (updateErr || !data) {
      console.error('[contacts-upsert] update error:', updateErr?.message);
      return res.status(500).json({ error: 'Failed to update contact' });
    }
    contact = data;
  } else {
    const { data, error: insertErr } = await supabaseAdmin
      .from('contacts')
      .insert(payload)
      .select()
      .single();

    if (insertErr || !data) {
      console.error('[contacts-upsert] insert error:', insertErr?.message);
      return res.status(500).json({ error: 'Failed to create contact' });
    }
    contact = data;
  }

  console.log('[contacts-upsert] contact', operation, contact.id);

  return res.status(200).json({ contact });
}
