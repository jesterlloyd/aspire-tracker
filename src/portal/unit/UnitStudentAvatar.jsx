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
// Matches the staff avatar look exactly: a nightfall circle, white initials, a faint
// white ring, and object-fit cover for the photo. The footprint is fixed at `size`
// whether or not a photo is present, so a late-arriving photo never shifts the layout.

const NIGHTFALL = '#1D2567'

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export default function UnitStudentAvatar({ url, name, size = 44, style }) {
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    background: NIGHTFALL, overflow: 'hidden', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center',
    border: '2px solid rgba(255,255,255,0.15)', boxSizing: 'border-box',
    ...style,
  }
  if (url) {
    return (
      <span style={base} aria-hidden="true">
        <img
          src={url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          // A photo that fails to load falls back to initials rather than a broken
          // image, by clearing itself; the parent re-renders on the next peek anyway.
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </span>
    )
  }
  return (
    <span
      style={{
        ...base,
        color: '#fff', fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
        fontSize: Math.round(size * 0.35),
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
