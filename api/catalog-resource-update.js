import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE } from './lib/activeAccount.js';

// CATALOG-2C - Owner/Admin METADATA-ONLY edit of an existing catalog_resources row.
//
// This endpoint updates ONLY a strict whitelist of metadata columns. It performs NO Storage
// operation of any kind (no upload, move, copy, delete, signing) and CANNOT touch storage_path,
// slug, resource_type, external_url, file_type_label, or actor/created fields. Unknown keys are
// REJECTED (not silently ignored). "Move to category" is just a category-field update; the file
// stays at its original storage key. "Remove from catalog" is is_active=false (reversible).

const CATEGORIES = [
  'orientation', 'forms', 'clinical_resources', 'unit_guides',
  'student_support', 'preceptor_resources', 'policies',
];

// The ONLY columns this endpoint may write. Anything else → 400.
const ALLOWED_FIELDS = ['title', 'description', 'tags', 'category', 'is_featured', 'is_pinned', 'is_active'];

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { authenticated: false, status: 401 };

  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let user;
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user) return { authenticated: false, status: 401 };
    user = data.user;
  } catch {
    return { authenticated: false, status: 401 };
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) return { authenticated: false, status: 401 };
    if (!profile) return { authenticated: false, status: 403 };
    // S-05: a deactivated account keeps a valid access token until it expires.
    // Refuse it before any work is performed, so deactivation ends access at once.
    if (!isActiveProfile(profile)) return { authenticated: false, status: INACTIVE_STATUS, reason: INACTIVE_REASON };
    return { authenticated: true, profileId: profile.id, role: profile.role || '', isOwner: profile.is_owner === true };
  } catch {
    return { authenticated: false, status: 401 };
  }
}

function isOwnerAdmin(role, isOwner) {
  return isOwner === true || role === 'owner' || role === 'admin';
}

function cleanStringArray(v, { maxItems = 20, maxLen = 40 } = {}) {
  if (!Array.isArray(v)) return null;
  return v
    .filter(x => typeof x === 'string')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => x.slice(0, maxLen))
    .slice(0, maxItems);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Server-side authentication + Owner/Admin authorization
  const auth = await verifyCaller(req);
  if (auth.reason === INACTIVE_REASON) return res.status(INACTIVE_STATUS).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: 'Unauthorized' });
  if (!isOwnerAdmin(auth.role, auth.isOwner)) return res.status(403).json({ error: 'Forbidden' });

  const body = req.body || {};
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id || id.length > 64) return res.status(400).json({ error: 'Missing or invalid id' });

  // Reject ANY field outside the metadata whitelist (e.g. storage_path, slug, resource_type,
  // external_url, file_type_label, created_by) - never silently ignore.
  const provided = Object.keys(body).filter(k => k !== 'id');
  const unknown = provided.filter(k => !ALLOWED_FIELDS.includes(k));
  if (unknown.length) {
    return res.status(400).json({ error: `Unsupported field(s): ${unknown.join(', ')}` });
  }

  // Build a validated patch from only the provided whitelist keys.
  const patch = {};
  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (body.title.trim().length > 200) return res.status(400).json({ error: 'Title is too long' });
    patch.title = body.title.trim();
  }
  if ('description' in body) {
    if (body.description != null && typeof body.description !== 'string') return res.status(400).json({ error: 'Invalid description' });
    const d = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    patch.description = d || null;
  }
  if ('tags' in body) {
    const tags = cleanStringArray(body.tags);
    if (tags === null) return res.status(400).json({ error: 'Invalid tags' });
    patch.tags = tags;
  }
  if ('category' in body) {
    if (!CATEGORIES.includes(body.category)) return res.status(400).json({ error: 'Invalid category' });
    patch.category = body.category;
  }
  for (const flag of ['is_featured', 'is_pinned', 'is_active']) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') return res.status(400).json({ error: `Invalid ${flag}` });
      patch[flag] = body[flag];
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  // Server-controlled audit columns (not part of the client whitelist).
  patch.updated_by = auth.profileId || null;
  patch.updated_at = new Date().toISOString();

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('catalog_resources')
    .update(patch)
    .eq('id', id)
    .select('id, slug, title, description, category, tags, is_featured, is_pinned, is_active, updated_at')
    .single();

  if (updErr) return res.status(500).json({ error: 'Could not update resource' });
  if (!updated) return res.status(404).json({ error: 'Resource not found' });

  return res.status(200).json({ resource: updated });
}
