// WS2.0: extracted verbatim from App.jsx header (Zone 1 - Brand).
// ASPIRE-CHART: styling moved to .chart-brand classes so the mark scales and
// the wordmark wraps on narrow screens instead of forcing header overflow.
import { useEffect, useState } from 'react'
import Tooltip from '../ui/Tooltip'
import { supabase } from '../../lib/supabase'

export default function HeaderBrand() {
  const [organization, setOrganization] = useState(null)
  const [organizationResolved, setOrganizationResolved] = useState(false)
  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) {
        if (live) setOrganizationResolved(true)
        return
      }
      fetch('/api/organization-settings', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(response => response.ok ? response.json() : null)
        .then(data => { if (live && data?.organization) setOrganization(data.organization) })
        .catch(() => {})
        .finally(() => { if (live) setOrganizationResolved(true) })
    }).catch(() => {
      if (live) setOrganizationResolved(true)
    })
    return () => { live = false }
  }, [])
  const applicationTitle = organization?.header_short_name?.trim() || 'ASPIRE Intelligence'
  return (
    <div className="chart-brand">
      <a
        href="/aggregate"
        className="chart-brand-logo-link"
        aria-label="Go to At a Glance and refresh the app"
      >
        {organizationResolved
          ? <img src={organization?.header_logo_url || '/cs-logo-large.png'} alt={organization?.logo_alt_text || 'Cedars-Sinai'} className="chart-brand-logo" />
          : <span className="chart-brand-logo-placeholder" aria-hidden="true" />}
      </a>
      <div className="chart-brand-divider" />
      <Tooltip label="Affiliate Students' Pathway from Internship to Residency Experience" placement="bottom">
        <div className="chart-brand-title">
          {applicationTitle}
        </div>
      </Tooltip>
    </div>
  )
}
