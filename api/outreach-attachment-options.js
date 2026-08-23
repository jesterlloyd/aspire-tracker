import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';
import { extensionOf, ALLOWED_TYPES } from './lib/outreachAttachments.js';
import { isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE } from './lib/activeAccount.js';

// OUTREACH-ATTACHMENTS-1 - the ASPIRE Catalog files that may be emailed.
//
// WHY THIS EXISTS. The picker needs to know which Catalog resources can be
// attached, and that depends on the file's real extension - which lives in
// storage_path. Letting the browser read storage_path would leak private
// object keys into client state for no benefit, so the decision is made here
// and only safe display fields go back:
//
//     { slug, title, category, type_label }
//
// No storage_path, no filename, no signed URL, no bytes. The slug is the only
// value the client ever sends back, and api/lib/outreachAttachments.js
// re-resolves everything from it at preview and at send. This endpoint is a
// convenience for the picker, never an authorisation step.
//
// Legacy .doc/.xls/.ppt are absent because the resolver no longer accepts
// them: one OLE signature cannot distinguish them, so they are not offered
// rather than being offered and then refused.

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
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!profile) return { authenticated: false, status: 403 };
    // S-05: a deactivated account keeps a valid access token until it expires.
    // Refuse it before any work is performed, so deactivation ends access at once.
    if (!isActiveProfile(profile)) return { authenticated: false, status: INACTIVE_STATUS, reason: INACTIVE_REASON };
    return { authenticated: true, role: profile.role || '', isOwner: profile.is_owner === true };
  } catch {
    return { authenticated: false, status: 401 };
  }
}

// Sending Outreach is an Owner/Admin action, so listing what can be attached
// is too. Deliberately narrower than catalog-resource-open.js, which also
// allows Interviewers to READ the Catalog.
function canAttach(role, isOwner) {
  return isOwner === true || role === 'owner' || role === 'admin';
}

/** Short display label derived from the real extension, safe to expose. */
export function labelForExtension(ext) {
  if (ext === 'pdf') return 'PDF';
  if (ext === 'docx') return 'DOCX';
  if (ext === 'xlsx') return 'XLSX';
  if (ext === 'pptx') return 'PPTX';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'IMAGE';
  return '';
}

/**
 * Pure projection: rows in, safe options out. Exported so tests can prove no
 * storage_path escapes without standing up the whole handler.
 */
export function toAttachableOptions(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.is_active !== true) continue;
    if (r.resource_type !== 'internal_file' || !r.storage_path) continue;
    const ext = extensionOf(r.storage_path);
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, ext)) continue;
    out.push({
      slug: r.slug,
      title: r.title || r.slug,
      category: r.category || '',
      type_label: labelForExtension(ext),
    });
  }
  return out.sort((a, b) => String(a.title).localeCompare(String(b.title), 'en', { sensitivity: 'base' }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await verifyCaller(req);
  if (auth.reason === INACTIVE_REASON) return res.status(INACTIVE_STATUS).json({ error: 'Forbidden', message: INACTIVE_MESSAGE });
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: 'Unauthorized' });
  if (!canAttach(auth.role, auth.isOwner)) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('catalog_resources')
    .select('slug, title, category, resource_type, storage_path, is_active')
    .eq('is_active', true)
    .eq('resource_type', 'internal_file')
    .order('title');

  if (error) return res.status(500).json({ error: 'Could not load the ASPIRE Catalog.' });

  return res.status(200).json({ success: true, options: toAttachableOptions(data) });
}
