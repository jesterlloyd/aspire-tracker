// api/send-notification.js
// Admin endpoint for manual notification triggering and testing.
// Requires x-admin-token header matching ADMIN_NOTIFICATION_TOKEN env var.
// Generate a 32-char random token and add it to Vercel environment variables.

import { sendNotification } from '../src/lib/notifications/index.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminToken = req.headers['x-admin-token']
  if (!process.env.ADMIN_NOTIFICATION_TOKEN || adminToken !== process.env.ADMIN_NOTIFICATION_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { type, context } = req.body || {}
  if (!type) return res.status(400).json({ error: 'Missing type' })

  try {
    const results = await sendNotification(type, context || {})
    return res.status(200).json({ success: true, results })
  } catch (err) {
    console.error('[send-notification] error:', err)
    return res.status(500).json({ error: err.message })
  }
}
