// api/organization-brand.js
//
// OUTREACH-FORM-BUTTON-1 (2026-09-24): the public pages a person reaches from an email (the
// form page /form and the signing page /sign) have no account, so they cannot read
// /api/organization-settings. This returns ONLY what those pages show in their header: the
// application title, the document logo and its alt text, all of which are already public (the
// logo is in the public organization-branding bucket). Nothing else about the organization.

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { getOrganizationSettings, organizationAssetUrl, DEFAULT_ORGANIZATION } from '../lib/server/organizationSettings.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  let org = DEFAULT_ORGANIZATION
  try { org = await getOrganizationSettings(supabaseAdmin) } catch { /* the defaults below still brand the page */ }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
  return res.status(200).json({
    title: org.header_short_name || 'ASPIRE Intelligence',
    logoUrl: organizationAssetUrl(supabaseAdmin, org.document_logo_path) || '/Cedars-Sinai.png',
    logoAlt: org.logo_alt_text || `${org.display_name || 'Cedars-Sinai'} logo`,
  })
}
