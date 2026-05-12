import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Create client inside handler so env vars are guaranteed available
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing env vars:', { supabaseUrl: !!supabaseUrl, serviceKey: !!serviceKey })
    return res.status(500).json({ error: 'Server configuration error. Check Vercel environment variables.' })
  }

  const db = createClient(supabaseUrl, serviceKey)

  const { action, name, email, id, color } = req.body || {}

  try {
    if (action === 'add') {
      if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })

      const { data, error } = await db
        .from('interviewers')
        .insert({ name: name.trim(), email: email?.trim() || '' })
        .select('id, name, email, color')
        .single()

      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true, data })
    }

    if (action === 'update_email') {
      if (!id) return res.status(400).json({ error: 'ID is required' })

      const { error } = await db
        .from('interviewers')
        .update({ email: email?.trim() || '' })
        .eq('id', id)

      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'update_color') {
      if (!id) return res.status(400).json({ error: 'ID is required' })

      const { error } = await db
        .from('interviewers')
        .update({ color })
        .eq('id', id)

      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (err) {
    console.error('manage-interviewers error:', err)
    return res.status(500).json({ error: err.message })
  }
}
