import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, full_name, role } = req.body || {};

  if (!email || !full_name || !role) {
    return res.status(400).json({ error: 'email, full_name, and role are required' });
  }

  const validRoles = ['admin', 'interviewer', 'viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be admin, interviewer, or viewer.' });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.VITE_SUPABASE_URL) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role },
      redirectTo: 'https://aspire-tracker.vercel.app',
    });

    if (error) return res.status(400).json({ error: error.message });

    // Pre-create the user profile with the assigned role
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        auth_user_id: data.user.id,
        full_name,
        email,
        role,
        is_owner: false,
        is_active: true,
      }, { onConflict: 'auth_user_id' });

    if (profileError) console.error('Profile pre-creation error:', profileError.message);

    return res.status(200).json({ success: true, message: `Invitation sent to ${email}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
