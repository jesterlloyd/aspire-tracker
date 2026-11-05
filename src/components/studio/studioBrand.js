// src/components/studio/studioBrand.js
//
// STUDIO-1: what the canvas needs to draw the header logo and the signature the way the send will.
// The send resolves both on the server (organization settings and the sender's Connect signature);
// the canvas reads the public brand endpoint and the signed-in profile, the same sources.
import { useEffect, useState } from 'react'

let cached = null

export function useStudioBrand() {
  const [brand, setBrand] = useState(cached)
  useEffect(() => {
    if (cached) return
    let off = false
    fetch('/api/organization-brand')
      .then(r => (r.ok ? r.json() : null))
      .then(b => {
        if (off || !b) return
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const logoUrl = /^https:\/\//i.test(b.logoUrl || '') ? b.logoUrl : (b.logoUrl ? `${origin}${b.logoUrl}` : '')
        cached = { logoUrl, title: b.title || 'ASPIRE' }
        setBrand(cached)
      })
      .catch(() => {})
    return () => { off = true }
  }, [])
  return brand
}

/** The sender's Connect signature as the renderer reads it (the server's resolveSenderSignature, in short). */
export function signatureFromProfile(profile) {
  const cs = profile?.connect_signature && typeof profile.connect_signature === 'object' ? profile.connect_signature : null
  if (cs && cs.signature_enabled !== false && String(cs.display_name || '').trim()) {
    return {
      displayName: String(cs.display_name).trim(),
      credentials: String(cs.credentials || '').trim(),
      title: String(cs.title || '').trim(),
      affiliation: String(cs.department || '').trim(),
      email: String(profile?.email || '').trim(),
      phone: String(cs.phone || '').trim(),
    }
  }
  if (String(profile?.full_name || '').trim()) {
    return { displayName: String(profile.full_name).trim(), credentials: '', title: '', affiliation: '', email: String(profile?.email || '').trim(), phone: '' }
  }
  return null
}
