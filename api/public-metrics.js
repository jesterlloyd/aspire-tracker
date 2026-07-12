// api/public-metrics.js
//
// PHASE5-GOVERNANCE: PUBLIC read of APPROVED public metrics only.
//
// The public site never touches the database directly (its design principle
// since Phase 1); this endpoint is its only data source, and it exposes
// exactly four display fields for rows whose status is 'approved'. All the
// provenance machinery (verification, approval, review dates) stays
// server-side. Returns an empty list until leadership approves a metric, so
// the public site's metrics section stays hidden until then.

import { createClient } from '@supabase/supabase-js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  if (!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'internal_error' })
  }

  try {
    const db = getDb()
    const { data, error } = await db
      .from('public_metrics')
      .select('metric_key, label, value_display, reporting_period')
      .eq('status', 'approved')
      .order('sort_order', { ascending: true })
    if (error) {
      // Table absent (migration not applied) or query failure: the public
      // site treats this as "no metrics", never as an error.
      return res.status(200).json({ metrics: [] })
    }
    // Approved public content is stable; let the CDN cache it briefly.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600')
    return res.status(200).json({ metrics: data || [] })
  } catch {
    return res.status(200).json({ metrics: [] })
  }
}
