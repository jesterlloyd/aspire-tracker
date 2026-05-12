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

    // Check if a temp record already exists for this email
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, can_conduct_interviews, interviewer_color')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({ auth_user_id: data.user.id, login_enabled: true, full_name, role })
        .eq('id', existingProfile.id);
      if (profileError) console.error('Profile update error:', profileError.message);
    } else {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert({ auth_user_id: data.user.id, full_name, email, role, is_owner: false, is_active: true, login_enabled: true });
      if (profileError) console.error('Profile creation error:', profileError.message);
    }

    return res.status(200).json({ success: true, message: `Invitation sent to ${email}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
