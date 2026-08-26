// api/contacts-upsert.js
//
// Owner/admin-authenticated endpoint to create or update a contact record.
//
// CONTACTS-CANON-1: the canonical contacts vocabulary (categories, titles,
// affiliation rules) is enforced HERE, from the shared module
// src/lib/contactCategories.js, never only in the UI:
//   - category is normalized to the singular canonical form (legacy plural
//     values are accepted and rewritten, so pre-migration rows converge);
//   - the title must fit the category's dropdown, be free text where the
//     canon allows it (Academic Partner, Other), or be the row's UNCHANGED
//     legacy value (passthrough until corrected by hand);
//   - the affiliation is DERIVED: Academic Partner -> a school written to
//     both school_name and organization; Unit Leader / Preceptor / BNI Team /
//     Nursing Executive -> Cedars-Sinai Medical Center; Other -> school,
//     Cedars-Sinai, or free text;
//   - units (unit_name = primary + related_units = rest) are validated
//     against the unit catalog, with existing stored values passing through;
//   - services (Nursing Executive + Executive Director only) fails closed
//     with 503 until the 20260826 migration adds the column.
//
// POST /api/contacts-upsert
// Authorization: Bearer <session_access_token>
//
// Body (JSON):
//   id            - optional UUID; if present → UPDATE, if absent → INSERT
//   full_name     - required, non-empty string
//   preferred_name, email, phone, organization, role, role_qualifier,
//   school_name, program_type, unit_name, related_units, is_active,
//   notification_preferences, notes, linkedin_url, services,
//   avatar_url, category  - all optional
//
// Success response:
//   200 { contact: { id, full_name, email, ... } }
//
// Errors:
//   400 - validation failure
//   401 - missing or invalid session
//   403 - authenticated but not owner or admin
//   405 - wrong HTTP method
//   409 - duplicate email
//   500 - database error
//   503 - services column not yet in the live schema (Owner SQL gate)

import { createClient } from '@supabase/supabase-js';
import { INACTIVE_MESSAGE } from './lib/activeAccount.js';
import {
  canonicalCategory,
  isTitleAllowed,
  titleOptionsFor,
  affiliationKind,
  showsServicesField,
  CSMC_AFFILIATION,
} from '../src/lib/contactCategories.js';
import { getCanonicalUnitNames } from '../src/lib/unitCatalog.js';
import { resolveOperativeSchoolName } from '../src/lib/schoolIdentity.js';

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
  'services',
  'avatar_url',
  'category',
]);

const CANONICAL_UNIT_NAMES = new Set(getCanonicalUnitNames());

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
    .select('id, role, is_active')
    .eq('auth_user_id', user.id)
    .single();

  // S-05: a deactivated account keeps a valid access token until it expires.
  // Refuse it before any work is performed, so deactivation ends access at once.
  if (profile && profile.is_active === false) {
    return res.status(403).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
  }
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

  // 10. Load the existing row on UPDATE. The canon allows a row's UNCHANGED
  //     legacy title, units, and school to pass through until corrected by
  //     hand, which requires knowing what is currently stored.
  let existing = null;
  if (isUpdate) {
    const { data: existingRow, error: exErr } = await supabaseAdmin
      .from('contacts')
      .select('id, category, role, unit_name, related_units, school_name, organization')
      .eq('id', body.id)
      .maybeSingle();
    if (exErr) {
      console.error('[contacts-upsert] existing-row fetch error:', exErr.message);
      return res.status(500).json({ error: 'Failed to load the contact' });
    }
    if (!existingRow) {
      return res.status(400).json({ error: 'No contact with that id' });
    }
    existing = existingRow;
  }

  // 11. Category: normalize to the canonical singular form. Legacy plural
  //     values are accepted and REWRITTEN, so pre-migration rows converge on
  //     every save; anything else is refused.
  if (payload.category !== undefined && payload.category !== null) {
    const canon = canonicalCategory(payload.category);
    if (!canon) {
      return res.status(400).json({ error: 'Invalid category.' });
    }
    payload.category = canon;
  }
  const effectiveCategory = canonicalCategory(
    payload.category !== undefined ? payload.category : existing?.category,
  );

  // 12. Title per the category canon: the category's dropdown, free text only
  //     where the canon allows it, or the row's unchanged stored value.
  if (payload.role !== undefined && payload.role !== null && effectiveCategory) {
    if (!isTitleAllowed(effectiveCategory, payload.role, existing?.role)) {
      return res.status(400).json({
        error: `Role must be one of: ${titleOptionsFor(effectiveCategory).join(', ')} for ${effectiveCategory}.`,
      });
    }
  }

  // 13. Validate and normalize related_units (optional), then validate every
  //     submitted unit against the canonical unit catalog. A unit the row
  //     ALREADY stores passes through; a new unknown unit is refused.
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
  {
    const storedUnits = new Set(
      [existing?.unit_name, ...(existing?.related_units || [])].filter(Boolean),
    );
    const submitted = [];
    if (payload.unit_name !== undefined && payload.unit_name !== null) submitted.push(payload.unit_name);
    if (Array.isArray(payload.related_units)) submitted.push(...payload.related_units);
    const unknown = submitted.find(u => !CANONICAL_UNIT_NAMES.has(u) && !storedUnits.has(u));
    if (unknown) {
      return res.status(400).json({ error: `Unknown unit: ${unknown}` });
    }
  }

  // 14. Derived affiliation, whenever the request touches it. Academic
  //     Partner -> a catalog school on BOTH school_name and organization;
  //     Unit Leader / Preceptor / BNI Team / Nursing Executive -> Cedars-Sinai
  //     Medical Center; Other -> school, Cedars-Sinai, or free text.
  const touchesAffiliation = ['category', 'school_name', 'organization']
    .some(k => payload[k] !== undefined);
  if (effectiveCategory && touchesAffiliation) {
    const kind = affiliationKind(effectiveCategory);
    if (kind === 'school') {
      const raw = payload.school_name !== undefined ? payload.school_name : existing?.school_name;
      if (!raw) {
        return res.status(400).json({ error: 'A school is required for an Academic Partner contact.' });
      }
      const resolved = resolveOperativeSchoolName(raw);
      const school = resolved?.displayName
        || (existing?.school_name && raw === existing.school_name ? raw : null);
      if (!school) {
        return res.status(400).json({ error: `Unknown school: ${raw}` });
      }
      payload.school_name = school;
      payload.organization = school;
    } else if (kind === 'csmc') {
      payload.organization = CSMC_AFFILIATION;
      payload.school_name = null;
    } else {
      // 'Other': a school (resolved when known), Cedars-Sinai, or free text.
      if (payload.school_name) {
        const resolved = resolveOperativeSchoolName(payload.school_name);
        if (resolved) payload.school_name = resolved.displayName;
        if (payload.organization === undefined || payload.organization === null) {
          payload.organization = payload.school_name;
        }
      }
      const orgFinal = payload.organization !== undefined ? payload.organization : existing?.organization;
      if (!orgFinal) {
        return res.status(400).json({ error: 'An affiliation (school, Cedars-Sinai, or organization) is required.' });
      }
    }
  }

  // 15. Services: Nursing Executive with the Executive Director title only.
  //     Fails closed with 503 until the 20260826 migration adds the column.
  if (payload.services !== undefined && payload.services !== null) {
    if (typeof payload.services !== 'string' || payload.services.length > 200) {
      return res.status(400).json({ error: 'services must be a string of 200 characters or fewer' });
    }
    const effRole = payload.role !== undefined ? payload.role : existing?.role;
    if (!showsServicesField(effectiveCategory, effRole)) {
      return res.status(400).json({
        error: 'services applies only to a Nursing Executive contact with the Executive Director title.',
      });
    }
    const { error: probeErr } = await supabaseAdmin.from('contacts').select('services').limit(1);
    if (probeErr) {
      return res.status(503).json({
        error: 'The services field is not available until the contacts canonicalization migration is applied.',
      });
    }
  } else if (Object.prototype.hasOwnProperty.call(payload, 'services')) {
    // Clearing services (null) against a pre-migration schema is a no-op:
    // drop the key rather than write to a column that may not exist yet.
    const { error: probeErr } = await supabaseAdmin.from('contacts').select('services').limit(1);
    if (probeErr) delete payload.services;
  }

  // 16. Validate is_active (boolean, default true on create)
  if (!isUpdate && payload.is_active === undefined) {
    payload.is_active = true;
  }
  if (payload.is_active !== undefined && payload.is_active !== null) {
    if (typeof payload.is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }
  }

  // 17. Duplicate email check
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

  // Pre-migration compatibility: contacts.role is NOT NULL until the
  // 20260826 migration relaxes it, and the canonical model allows "no title"
  // (auto-synced preceptors). An INSERT without a title writes '' so it
  // succeeds either way; the migration itself normalizes stored placeholders.
  if (!isUpdate && (payload.role === undefined || payload.role === null)) {
    payload.role = '';
  }

  // 18. Perform INSERT or UPDATE
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
