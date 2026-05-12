import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, name, email, id, color } = req.body || {}

  try {
    if (action === 'add') {
      if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
      const { data, error } = await supabaseAdmin
        .from('interviewers')
        .insert({ name: name.trim(), email: email?.trim() || '' })
        .select('id, name, email, color')
        .single()
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true, data })
    }

    if (action === 'update_email') {
      if (!id) return res.status(400).json({ error: 'ID is required' })
      const { error } = await supabaseAdmin
        .from('interviewers')
        .update({ email: email?.trim() || '' })
        .eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'update_color') {
      if (!id) return res.status(400).json({ error: 'ID is required' })
      const { error } = await supabaseAdmin
        .from('interviewers')
        .update({ color })
        .eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
