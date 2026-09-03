// src/portal/unit/UnitStudentAvatar.jsx
//
// UL-PHASE1-VISUAL: the circular student avatar for the Unit Leader Portal.
//
// PRESENTATIONAL, and never fetches. It takes an already-resolved signed URL (or
// null) and a name for the initials fallback. The staff StudentAvatar cannot be
// reused here because it signs its own URL through the STAFF file endpoint, which a
// Unit Leader is not authorized to call; this reproduces its visual treatment while
// leaving photo resolution to useUnitStudentPhotos, which uses the unit-scoped
// endpoint.
//
// FAILURE IS RENDER-DRIVEN, on purpose. An earlier version set the img to
// display:none in its onError handler. React reconciles style per PROPERTY and never
// re-asserts an unchanged value, so that imperative display:none was never reverted:
// one transient load error hid the photo permanently and, because the initials branch
// only rendered for a missing url, left an empty navy circle. Any re-render of the row
// (such as opening the kebab) then made the blank circle visible. The failure is now a
// React STATE flag, so an error falls back to INITIALS and a new url clears the flag
// and tries again. Nothing is mutated behind React's back.
//
// The footprint is fixed at `size` whether or not a photo is present, so a
// late-arriving photo never shifts the layout.

import { useState } from 'react'

const NIGHTFALL = '#1D2567'

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export default function UnitStudentAvatar({ url, name, size = 44, style }) {
  // Remember WHICH url failed, so a new url is automatically a fresh chance without a
  // setState-in-effect (which this repo forbids): `failed` is derived, not synced.
  const [failedUrl, setFailedUrl] = useState(null)
  const failed = !!url && failedUrl === url

  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    background: NIGHTFALL, overflow: 'hidden', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center',
    border: '2px solid rgba(255,255,255,0.15)', boxSizing: 'border-box',
    ...style,
  }

  const showPhoto = url && !failed
  if (showPhoto) {
    return (
      <span style={base} aria-hidden="true">
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          decoding="async"
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          // Render-driven: a load error flips to initials on the next render rather
          // than hiding the element behind React's back.
          onError={() => setFailedUrl(url)}
        />
      </span>
    )
  }
  return (
    <span
      style={{
        ...base,
        color: '#fff', fontWeight: 700, fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: Math.round(size * 0.35),
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
