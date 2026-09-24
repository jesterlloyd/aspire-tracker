import { createClient } from '@supabase/supabase-js';
import process from 'node:process';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE } from './lib/activeAccount.js';

// CATALOG-3 - Owner/Admin category metadata management. Owners may also create and
// permanently delete empty categories; Admins retain rename and reorder access.
//
// Four actions on catalog_categories:
//   action 'rename'  → update a category's display_name and/or description (located BY slug).
//   action 'reorder' → accept the FULL ordered slug list, validate it matches the existing set
//                      exactly, and assign sort_order by position in ONE atomic upsert.
//   action 'create'  → Owner-only insert with a stable slug derived from the display name.
//   action 'delete'  → Owner-only permanent delete, blocked while any item uses the category.
//
// HARD limits: 'rename' writes ONLY display_name / description. sort_order is writable ONLY via
// 'reorder' (which requires the full ordered slug list) - so sort_order sent to 'rename' is
// rejected as unsupported, closing the partial-reorder bypass. It NEVER edits slug (the stable
// anchor), is_active (archive is CATALOG-3B), id, or actor/timestamp columns - those are
// rejected with 400. It performs NO Storage operation and NEVER touches catalog_resources, so
// Rename/reorder never touch resource rows or storage_path, and existing slugs stay stable.

const ALLOWED_RENAME_FIELDS = ['display_name', 'description'];

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await verifyCaller(req);
  if (auth.reason === INACTIVE_REASON) return res.status(INACTIVE_STATUS).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: 'Unauthorized' });
  if (!isOwnerAdmin(auth.role, auth.isOwner)) return res.status(403).json({ error: 'Forbidden' });

  const body = req.body || {};
  const action = ['rename', 'reorder', 'create', 'delete'].includes(body.action) ? body.action : null;
  if (!action) return res.status(400).json({ error: 'Missing or invalid action' });

  if ((action === 'create' || action === 'delete') && !(auth.isOwner === true || auth.role === 'owner')) {
    return res.status(403).json({ error: 'Only the Owner can add or delete categories.' });
  }

  if (action === 'create') {
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (!displayName) return res.status(400).json({ error: 'Category name is required' });
    if (displayName.length > 200) return res.status(400).json({ error: 'Category name is too long' });
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    if (!slug) return res.status(400).json({ error: 'Use at least one letter or number in the category name.' });

    const { data: last, error: lastErr } = await supabaseAdmin
      .from('catalog_categories').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
    if (lastErr) return res.status(500).json({ error: 'Could not add category' });
    const now = new Date().toISOString();
    const { data: created, error: createErr } = await supabaseAdmin.from('catalog_categories').insert({
      slug,
      display_name: displayName,
      description: description || null,
      sort_order: (last?.sort_order || 0) + 10,
      is_active: true,
      created_by: auth.profileId || null,
      updated_by: auth.profileId || null,
      created_at: now,
      updated_at: now,
    }).select('slug, display_name, description, sort_order, retired_at').single();
    if (createErr?.code === '23505') return res.status(409).json({ error: 'A category with that name already exists.' });
    if (createErr) return res.status(500).json({ error: 'Could not add category' });
    return res.status(201).json({ category: created });
  }

  if (action === 'delete') {
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug || body.confirm !== true) return res.status(400).json({ error: 'Confirm the category to delete.' });
    const { count, error: countErr } = await supabaseAdmin
      .from('catalog_resources').select('id', { count: 'exact', head: true }).eq('category', slug);
    if (countErr) return res.status(500).json({ error: 'Could not check category items' });
    if ((count || 0) > 0) {
      return res.status(409).json({ error: `Move or delete the ${count} Catalog item${count === 1 ? '' : 's'} in this category first.` });
    }
    const { data: removed, error: delErr } = await supabaseAdmin
      .from('catalog_categories').delete().eq('slug', slug).select('slug').maybeSingle();
    if (delErr?.code === '23503') return res.status(409).json({ error: 'This category still has Catalog items.' });
    if (delErr) return res.status(500).json({ error: 'Could not delete category' });
    if (!removed) return res.status(404).json({ error: 'Category not found' });
    return res.status(200).json({ deleted: slug });
  }

  // ── Rename: located BY slug; sets only display_name/description (NOT sort_order) ──
  if (action === 'rename') {
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) return res.status(400).json({ error: 'Missing slug' });

    // Everything in the body except action+slug is a "set" field. Reject any key outside the
    // allowlist (this rejects slug-as-a-value, is_active, id, created_by/at, updated_by/at, …).
    const setKeys = Object.keys(body).filter(k => k !== 'action' && k !== 'slug');
    const unknown = setKeys.filter(k => !ALLOWED_RENAME_FIELDS.includes(k));
    if (unknown.length) {
      return res.status(400).json({ error: `Unsupported field(s): ${unknown.join(', ')}` });
    }

    const patch = {};
    if ('display_name' in body) {
      if (typeof body.display_name !== 'string' || !body.display_name.trim()) {
        return res.status(400).json({ error: 'display_name is required' });
      }
      if (body.display_name.trim().length > 200) return res.status(400).json({ error: 'display_name is too long' });
      patch.display_name = body.display_name.trim();
    }
    if ('description' in body) {
      if (body.description != null && typeof body.description !== 'string') return res.status(400).json({ error: 'Invalid description' });
      const d = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
      patch.description = d || null;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });

    patch.updated_by = auth.profileId || null;
    patch.updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('catalog_categories')
      .update(patch)
      .eq('slug', slug)
      .select('slug, display_name, description, sort_order')
      .single();

    if (updErr) return res.status(500).json({ error: 'Could not update category' });
    if (!updated) return res.status(404).json({ error: 'Category not found' });
    return res.status(200).json({ category: updated });
  }

  // ── Reorder: full ordered slug set → sort_order by position, in one upsert ──────
  const order = Array.isArray(body.order) ? body.order : null;
  if (!order || order.length === 0 || !order.every(s => typeof s === 'string' && s.trim())) {
    return res.status(400).json({ error: 'order must be a non-empty array of slugs' });
  }
  if (new Set(order).size !== order.length) {
    return res.status(400).json({ error: 'order contains duplicate slugs' });
  }

  // Load the existing categories and confirm the submitted list matches EXACTLY (no missing,
  // no extra). This guarantees we reassign the whole set coherently - never a partial order.
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('catalog_categories')
    .select('slug, display_name, description');
  if (exErr) return res.status(500).json({ error: 'Lookup failed' });

  const existingSlugs = new Set((existing || []).map(c => c.slug));
  if (existingSlugs.size !== order.length || !order.every(s => existingSlugs.has(s))) {
    return res.status(400).json({ error: 'order must list every existing category exactly once' });
  }

  // Build full rows (carry the unchanged display_name/description so the upsert insert-shape
  // satisfies NOT NULL; only sort_order changes) with positional sort_order 10, 20, 30, …
  const bySlug = Object.fromEntries((existing || []).map(c => [c.slug, c]));
  const now = new Date().toISOString();
  const payload = order.map((slug, i) => ({
    slug,
    display_name: bySlug[slug].display_name,
    description: bySlug[slug].description ?? null,
    sort_order: (i + 1) * 10,
    updated_by: auth.profileId || null,
    updated_at: now,
  }));

  const { error: upErr } = await supabaseAdmin
    .from('catalog_categories')
    .upsert(payload, { onConflict: 'slug' });
  if (upErr) return res.status(500).json({ error: 'Could not save order' });

  const { data: fresh } = await supabaseAdmin
    .from('catalog_categories')
    .select('slug, display_name, description, sort_order')
    .order('sort_order', { ascending: true });
  return res.status(200).json({ categories: fresh || [] });
}
