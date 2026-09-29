/* global process */

// Temporary production diagnostic for the Outreach email function. It imports
// the same startup modules one at a time but never reads application data and
// never sends email. Remove this endpoint after the startup failure is fixed.

const CHECKS = [
  ['supabase-client', () => import('@supabase/supabase-js')],
  ['mailer', () => import('../lib/server/email/mailer.js')],
  ['supabase-admin', () => import('../lib/server/evaluation/supabase_admin.js')],
  ['email-template', () => import('../lib/server/connect/emailTemplates.js')],
  ['message-archive', () => import('./lib/messageArchive.js')],
  ['outreach-attachments', () => import('./lib/outreachAttachments.js')],
  ['student-recipient', () => import('../src/lib/notifications/studentRecipient.js')],
  ['email-utils', () => import('../src/lib/emailUtils.js')],
  ['placement-send-guard', () => import('./lib/placementSendGuard.js')],
  ['signatures', () => import('../src/lib/notifications/templates/signatures.js')],
  ['active-account', () => import('./lib/activeAccount.js')],
  ['organization-settings', () => import('../lib/server/organizationSettings.js')],
  ['node-crypto', () => import('node:crypto')],
  ['outreach-buttons', () => import('../lib/server/forms/outreachButtons.js')],
]

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const loaded = []
  for (const [name, load] of CHECKS) {
    try {
      await load()
      loaded.push(name)
    } catch (error) {
      console.error(`[connect-email-runtime-probe] ${name}:`, error)
      return res.status(500).json({
        success: false,
        failed: name,
        error: error?.message || 'Module initialization failed',
        loaded,
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      })
    }
  }

  return res.status(200).json({
    success: true,
    loaded,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
  })
}
