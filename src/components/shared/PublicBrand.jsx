// src/components/shared/PublicBrand.jsx
//
// OUTREACH-FORM-BUTTON-1 (2026-09-24): the header of the pages people reach from an email
// without an account (the form page and the signing page). It shows the organization's
// document logo and application title from Settings > Organization (Owner), read through the
// public /api/organization-brand. Until that answers, the space is held, so nothing jumps.
import { useEffect, useState } from 'react'
import './publicBrand.css'

let cached = null
function usePublicBrand() {
  const [brand, setBrand] = useState(cached)
  useEffect(() => {
    if (cached) return undefined
    let live = true
    fetch('/api/organization-brand').then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(b => {
        cached = b?.title ? b : { title: 'ASPIRE Intelligence', logoUrl: '/Cedars-Sinai.png', logoAlt: 'Cedars-Sinai logo' }
        if (live) setBrand(cached)
      })
    return () => { live = false }
  }, [])
  return brand
}

/** className styles the row; children sit after the title (the signing page's "from"). */
export default function PublicBrand({ className, children }) {
  const brand = usePublicBrand()
  return (
    <header className={`pbrand ${className || ''}`.trim()}>
      <span className="pbrand-mark">
        {brand && <img src={brand.logoUrl} alt={brand.logoAlt} className="pbrand-logo" />}
        {brand && <span className="pbrand-sep" aria-hidden="true" />}
        <span className="pbrand-title">{brand?.title || ' '}</span>
      </span>
      {children}
    </header>
  )
}
