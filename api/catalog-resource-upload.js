import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE } from './lib/activeAccount.js';

// CATALOG-2B - Owner/Admin upload of a NEW internal_file resource (first write phase).
//
// ADDITIVE-ONLY. Two server-gated phases over a signed-upload-URL transport:
//   phase 'sign'   → validate everything, refuse on slug/key collision, mint a ONE-TIME,
//                    per-path scoped upload token (createSignedUploadUrl). The browser then
//                    PUTs the bytes straight to Supabase Storage (bypasses Vercel's ~4.5 MB
//                    request limit). No broad bucket policy; the token authorizes one path.
//   phase 'commit' → verify the object now EXISTS and is within the size cap, THEN insert the
//                    catalog_resources row (FILE FIRST, ROW SECOND). If the insert fails, the
//                    just-uploaded orphan is best-effort removed (only that new file).
//
// Security: caller is verified + Owner/Admin on BOTH phases. The client never receives a broad
// Storage credential and never writes catalog_resources (the row insert is service-role only).
// Storage keys are server-derived from (category, slug) - never a client-supplied path. No
// overwrite of existing objects/rows; no modification/rename/delete of existing resources.

const BUCKET = 'aspire-catalog';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB hard cap, enforced server-side at commit

const CATEGORIES = [
  'orientation', 'forms', 'clinical_resources', 'unit_guides',
  'student_support', 'preceptor_resources', 'policies',
];

// Extension allowlist → file_type_label (icon hint). Anything not listed is rejected,
// which excludes exe/js/html/svg/zip/unknown binaries by construction.
const EXT_LABEL = {
  pdf: 'PDF',
  doc: 'DOC', docx: 'DOC',
  ppt: 'PPT', pptx: 'PPT',
  xls: 'XLS', xlsx: 'XLS',
  png: 'IMG', jpg: 'IMG', jpeg: 'IMG',
};

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

// Title → slug: lowercase, non-alphanumerics → hyphen, collapse/trim hyphens. The output
// charset (a–z, 0–9, '-') is inherently free of traversal/path characters.
function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function extOf(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(String(filename || '').trim());
  return m ? m[1].toLowerCase() : '';
}

function cleanStringArray(v, { maxItems = 20, maxLen = 40 } = {}) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(x => typeof x === 'string')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => x.slice(0, maxLen))
    .slice(0, maxItems);
}

// Deterministically validate + derive identity from client metadata. Returns either
// { ok:true, ...derived } or { ok:false, status, error }. Both phases call this so the
// storage key and slug are recomputed server-side and never trusted from the client.
function deriveAndValidate(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) return { ok: false, status: 400, error: 'Title is required' };
  if (title.length > 200) return { ok: false, status: 400, error: 'Title is too long' };

  const category = typeof body?.category === 'string' ? body.category.trim() : '';
  if (!CATEGORIES.includes(category)) return { ok: false, status: 400, error: 'Invalid category' };

  const ext = extOf(body?.filename);
  if (!ext || !Object.prototype.hasOwnProperty.call(EXT_LABEL, ext)) {
    return { ok: false, status: 400, error: 'Unsupported file type' };
  }

  const slug = slugify(title);
  if (!slug) return { ok: false, status: 400, error: 'Title must contain letters or numbers' };

  const key = `${category}/${slug}.${ext}`;
  // Defense-in-depth: the derived key must contain exactly one '/', no traversal/backslashes.
  if (key.includes('..') || key.includes('\\') || key.includes('//') || key.startsWith('/') || (key.match(/\//g) || []).length !== 1) {
    return { ok: false, status: 400, error: 'Invalid storage path' };
  }

  return {
    ok: true,
    title, category, ext, slug, key,
    fileTypeLabel: EXT_LABEL[ext],
    description: typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '',
    tags: cleanStringArray(body?.tags),
    audience: cleanStringArray(body?.audience),
    collection_keys: cleanStringArray(body?.collection_keys),
    sort_order: Number.isInteger(body?.sort_order) ? body.sort_order : 0,
    is_featured: body?.is_featured === true,
    is_pinned: body?.is_pinned === true,
  };
}

// Look up an object by exact key in the private bucket. Returns { exists, size }.
async function findObject(key) {
  const slash = key.lastIndexOf('/');
  const prefix = key.slice(0, slash);
  const name = key.slice(slash + 1);
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { search: name, limit: 100 });
  if (error) return { error };
  const found = (data || []).find(o => o.name === name);
  return { exists: !!found, size: found?.metadata?.size };
}

// Cleanup invariant: NEVER remove a Storage object that any catalog_resources row references.
// In a race, another request could insert a valid row for this storage_path after our sign but
// before our cleanup; deleting the file would then break that valid resource. So we check for a
// referencing row first and skip deletion if one exists. Returns:
//   { referenced: true }            → a row references this key; file preserved (do not delete)
//   { removed: true }               → no row references it; the orphan was deleted
//   { removed: false, error }       → reference-check or delete failed; treat as not-removed
async function safeRemoveOrphan(key) {
  const { data: ref, error: refErr } = await supabaseAdmin
    .from('catalog_resources').select('id').eq('storage_path', key).maybeSingle();
  if (refErr) return { removed: false, error: refErr };
  if (ref) return { referenced: true, removed: false };
  const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove([key]);
  if (rmErr) return { removed: false, error: rmErr };
  return { removed: true };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Server-side authentication + Owner/Admin authorization (both phases)
  const auth = await verifyCaller(req);
  if (auth.reason === INACTIVE_REASON) return res.status(INACTIVE_STATUS).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: 'Unauthorized' });
  if (!isOwnerAdmin(auth.role, auth.isOwner)) return res.status(403).json({ error: 'Forbidden' });

  const phase = req.body?.phase === 'commit' ? 'commit' : req.body?.phase === 'sign' ? 'sign' : null;
  if (!phase) return res.status(400).json({ error: 'Missing phase' });

  const v = deriveAndValidate(req.body);
  if (!v.ok) return res.status(v.status).json({ error: v.error });

  // ── Phase 1: sign ───────────────────────────────────────────────────────────
  if (phase === 'sign') {
    // Early size reject from the declared size (authoritative check is at commit).
    const declared = Number(req.body?.size);
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'File exceeds the 10 MB limit' });
    }

    // Slug uniqueness (DB) - the unique constraint is the backstop.
    const { data: existingRow, error: rowErr } = await supabaseAdmin
      .from('catalog_resources').select('id').eq('slug', v.slug).maybeSingle();
    if (rowErr) return res.status(500).json({ error: 'Lookup failed' });
    if (existingRow) return res.status(409).json({ error: 'A resource with this title already exists' });

    // Storage key collision - never overwrite an existing object.
    const obj = await findObject(v.key);
    if (obj.error) return res.status(500).json({ error: 'Storage check failed' });
    if (obj.exists) return res.status(409).json({ error: 'A file with this name already exists' });

    // Mint a one-time, per-path upload token (no upsert → cannot overwrite).
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET).createSignedUploadUrl(v.key);
    if (signErr || !signed?.token) return res.status(502).json({ error: 'Could not start upload' });

    // path + token are required by the client's uploadToSignedUrl call (transport-necessary).
    return res.status(200).json({ token: signed.token, path: signed.path || v.key, slug: v.slug });
  }

  // ── Phase 2: commit ──────────────────────────────────────────────────────────
  // FILE FIRST, ROW SECOND: confirm the object exists (and is within the size cap) before insert.
  const obj = await findObject(v.key);
  if (obj.error) return res.status(500).json({ error: 'Storage check failed' });
  if (!obj.exists) return res.status(409).json({ error: 'File was not uploaded; please retry' });
  if (obj.size != null && obj.size > MAX_FILE_BYTES) {
    // Remove only if no row references this key (preserve any valid resource).
    await safeRemoveOrphan(v.key);
    return res.status(413).json({ error: 'File exceeds the 10 MB limit' });
  }

  // Backstop slug re-check (unique constraint still authoritative).
  const { data: dupe } = await supabaseAdmin
    .from('catalog_resources').select('id').eq('slug', v.slug).maybeSingle();
  if (dupe) {
    // Another row claimed this slug after sign. Remove our upload ONLY if no row references the
    // key - if that racing row points at this same key, the file belongs to it and must be kept.
    await safeRemoveOrphan(v.key);
    return res.status(409).json({ error: 'A resource with this title already exists' });
  }

  const { data: created, error: insErr } = await supabaseAdmin
    .from('catalog_resources')
    .insert({
      slug: v.slug,
      title: v.title,
      description: v.description || null,
      category: v.category,
      resource_type: 'internal_file',
      storage_path: v.key,
      file_type_label: v.fileTypeLabel,
      tags: v.tags,
      audience: v.audience,
      collection_keys: v.collection_keys,
      sort_order: v.sort_order,
      is_featured: v.is_featured,
      is_pinned: v.is_pinned,
      is_active: true,
      created_by: auth.profileId || null,
      updated_by: auth.profileId || null,
    })
    .select('id, slug, title, category, resource_type, file_type_label, is_featured, is_pinned, updated_at')
    .single();

  if (insErr || !created) {
    // Row insert failed - never leave a visible row pointing at a file. Remove the file we just
    // uploaded, but ONLY if no catalog_resources row references it (a racing valid row must be
    // preserved). If cleanup is skipped/fails, surface the path for the Owner.
    const cleanup = await safeRemoveOrphan(v.key);
    if (cleanup.referenced) {
      console.error('[catalog-upload] insert failed; key already referenced by a row, file preserved', { key: v.key });
      return res.status(409).json({ error: 'A resource with this file already exists' });
    }
    if (!cleanup.removed) {
      console.error('[catalog-upload] insert failed AND orphan cleanup failed', { key: v.key });
      return res.status(500).json({ error: 'Could not save resource; an orphan file was left for cleanup', orphanPath: v.key });
    }
    console.error('[catalog-upload] insert failed; orphan file cleaned up', { key: v.key });
    return res.status(500).json({ error: 'Could not save resource (no file was left behind)' });
  }

  // Created metadata only - no storage_path, no URL.
  return res.status(200).json({ resource: created });
}
