import { createClient } from '@supabase/supabase-js';
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js';

function allowedInstrumentSlugs() {
  // Owner/Admin-authenticated content loader. preceptor_progress is included so the
  // Owner/Admin response-detail view can render the preceptor survey labels. This is
  // NOT the Casey-Fink public token-validation path.
  const slugs = ['casey_fink_readiness_2024', 'preceptor_progress'];
  if (process.env.EVALUATION_QA_MODE === '1') {
    slugs.push('qa_test_instrument');
  }
  return slugs;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: bearer session token — session-only, no token-shaped credential accepted
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Verify session via anon-key client with caller's bearer token
  const userClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
  );

  let user;
  try {
    const { data: { user: u }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !u) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    user = u;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Role check: owner or admin only (mirrors send-midpoint-checkin.js pattern)
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('auth_user_id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Slug validation — same allowlist as evaluation-token-validate.js
  const { slug } = req.query;
  if (typeof slug !== 'string' || !slug.trim()) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (!allowedInstrumentSlugs().includes(slug)) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Storage fetch via admin client — mirrors token-validate Storage download pattern
  const { data: contentBlob, error: storageError } = await supabaseAdmin.storage
    .from('evaluation-instrument-content')
    .download(`${slug}.json`);

  if (storageError || !contentBlob) {
    return res.status(502).json({ error: 'Content unavailable' });
  }

  let content;
  try {
    const contentText = await contentBlob.text();
    content = JSON.parse(contentText);
  } catch {
    return res.status(502).json({ error: 'Content unavailable' });
  }

  // Mirror the 'content' sub-key shape from evaluation-token-validate.js success branch
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).json({ content });
}
