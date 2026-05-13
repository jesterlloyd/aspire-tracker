import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server configuration error' })

  const db = createClient(supabaseUrl, serviceKey)
  const { action, user_id, ...payload } = req.body || {}

  if (!user_id) return res.status(400).json({ error: 'user_id is required' })

  try {
    if (action === 'update_role') {
      const { role } = payload
      if (!role) return res.status(400).json({ error: 'role is required' })
      const { error } = await db.from('user_profiles').update({ role }).eq('id', user_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'toggle_active') {
      const { is_active } = payload
      const { error } = await db.from('user_profiles').update({ is_active }).eq('id', user_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'toggle_interviewer') {
      const { can_conduct_interviews } = payload
      const { error } = await db.from('user_profiles').update({ can_conduct_interviews }).eq('id', user_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'update_interviewer_color') {
      const { interviewer_color } = payload
      const { error } = await db.from('user_profiles').update({ interviewer_color }).eq('id', user_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'update_avatar') {
      const { avatar_url } = payload
      const { error } = await db.from('user_profiles').update({ avatar_url: avatar_url || '' }).eq('id', user_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('admin-users error:', err)
    return res.status(500).json({ error: err.message })
  }
}
