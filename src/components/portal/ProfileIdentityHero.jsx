// Shared portal identity hero: a pastel sky-blue header with a circular photo (or an initials
// fallback), the person's name, and an optional subtitle. It is presentational and role-neutral,
// reproducing the approved Unit Leader student-profile hero language (light-blue gradient, circular
// photo, centred identity) as a REUSABLE primitive that owns its own .ptl-idhero-* classes. The
// Student Edit Profile drawer uses it now; the Unit Leader and Academic Partner surfaces can adopt
// the same primitive later so the portal family keeps one identity treatment.
import { useState } from 'react'

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

export default function ProfileIdentityHero({ name, photoUrl = null, subtitle = null, children = null }) {
  const [broken, setBroken] = useState(false)
  const showPhoto = Boolean(photoUrl && !broken)
  return (
    <div className="ptl-idhero">
      <div className="ptl-idhero-photo" aria-hidden="true">
        {showPhoto
          ? <img src={photoUrl} alt="" onError={() => setBroken(true)} />
          : <span className="ptl-idhero-initials">{initials(name)}</span>}
      </div>
      {name && <p className="ptl-idhero-name">{name}</p>}
      {subtitle && <p className="ptl-idhero-sub">{subtitle}</p>}
      {children}
    </div>
  )
}
