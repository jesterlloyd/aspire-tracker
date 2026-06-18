import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';

// CATALOG-1 — Authenticated open/preview endpoint for ASPIRE Catalog INTERNAL files.
//
// Security model (Owner/Admin/Interviewer read; ACTIVE resources only):
//   - Verifies the caller's session bearer token AND a Catalog-read role ON THE SERVER
//     (reuses the WS1 verifyCaller → user_profiles pattern). UI button-hiding is NOT
//     the gate; a direct call by a non-Owner/Admin is refused here.
//   - Accepts a resource SLUG only — never a client-supplied storage path.
//   - Looks up storage_path server-side from catalog_resources, confirms is_active and
//     resource_type='internal_file', then mints a SHORT-LIVED signed URL for THAT ONE
//     object in the private 'aspire-catalog' bucket.
//   - The signed URL is per-open and is NEVER persisted (not in the table, not logged,
//     not returned with extra metadata). No public URLs anywhere.
// External_link resources are NOT handled here — the client navigates to external_url.

const BUCKET = 'aspire-catalog';
const SIGNED_URL_TTL_SECONDS = 120; // short-lived per-open window (addendum: 60–300s)

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' };

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
    if (error || !data?.user) return { authenticated: false, status: 401, reason: 'invalid_token' };
    user = data.user;
  } catch {
    return { authenticated: false, status: 401, reason: 'verify_threw' };
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' };
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' };
    return {
      authenticated: true,
      role: profile.role || '',
      isOwner: profile.is_owner === true,
    };
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' };
  }
}

// Read access (open/download): Owner/Admin AND Interviewer. The is_active check below limits
// every caller to ACTIVE resources, so Interviewers can never open an inactive/soft-removed file.
function canReadCatalog(role, isOwner) {
  return isOwner === true || role === 'owner' || role === 'admin' || role === 'interviewer';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1) Server-side authentication + Owner/Admin/Interviewer read authorization
  const auth = await verifyCaller(req);
  if (!auth.authenticated) {
    return res.status(auth.status || 401).json({ error: 'Unauthorized' });
  }
  if (!canReadCatalog(auth.role, auth.isOwner)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 2) Slug only — no client-supplied storage path is ever accepted
  const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' });
  }

  // mode controls ONLY the signed-URL disposition (inline view vs attachment download).
  // It never influences object selection — that is always the server-resolved storage_path.
  const mode = req.body?.mode === 'download' ? 'download' : 'open';

  // 3) Resolve the object server-side from catalog_resources (service role)
  const { data: row, error: lookupErr } = await supabaseAdmin
    .from('catalog_resources')
    .select('resource_type, storage_path, is_active')
    .eq('slug', slug)
    .maybeSingle();

  if (lookupErr) {
    return res.status(500).json({ error: 'Lookup failed' });
  }
  if (!row || row.is_active !== true) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (row.resource_type !== 'internal_file' || !row.storage_path) {
    return res.status(400).json({ error: 'Resource is not an internal file' });
  }

  // 4) Mint a short-lived signed URL for that one object in the PRIVATE bucket.
  //    For download mode, request attachment disposition (Supabase sets
  //    response-content-disposition: attachment). This only affects how the browser
  //    handles the same object — never which object is signed.
  const signOptions = mode === 'download' ? { download: true } : undefined;
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, signOptions);

  if (signErr || !signed?.signedUrl) {
    return res.status(502).json({ error: 'Could not open file' });
  }

  // 5) Return only the short-lived URL (never persisted/logged)
  return res.status(200).json({ signedUrl: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS, mode });
}
