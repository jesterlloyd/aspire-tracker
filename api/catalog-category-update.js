import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';

// CATALOG-3 — Owner/Admin category metadata management (rename + reorder).
//
// Two actions, both metadata-only on catalog_categories:
//   action 'rename'  → update a category's display_name and/or description (located BY slug).
//   action 'reorder' → accept the FULL ordered slug list, validate it matches the existing set
//                      exactly, and assign sort_order by position in ONE atomic upsert.
//
// HARD limits: 'rename' writes ONLY display_name / description. sort_order is writable ONLY via
// 'reorder' (which requires the full ordered slug list) — so sort_order sent to 'rename' is
// rejected as unsupported, closing the partial-reorder bypass. It NEVER edits slug (the stable
// anchor), is_active (archive is CATALOG-3B), id, or actor/timestamp columns — those are
// rejected with 400. It performs NO Storage operation and NEVER touches catalog_resources, so
// resource rows and storage_path are untouched and slugs/links stay stable.

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
      .select('id, role, is_owner')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) return { authenticated: false, status: 401 };
    if (!profile) return { authenticated: false, status: 403 };
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
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: 'Unauthorized' });
  if (!isOwnerAdmin(auth.role, auth.isOwner)) return res.status(403).json({ error: 'Forbidden' });

  const body = req.body || {};
  const action = body.action === 'rename' ? 'rename' : body.action === 'reorder' ? 'reorder' : null;
  if (!action) return res.status(400).json({ error: 'Missing or invalid action' });

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
  // no extra). This guarantees we reassign the whole set coherently — never a partial order.
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
