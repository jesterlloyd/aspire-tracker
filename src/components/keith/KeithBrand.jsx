// src/components/keith/KeithBrand.jsx
//
// KEITH-FOUNDATION-1 (Owner, 2026-09-28): Keith's own artwork where the app names Keith.
//
//   KeithIcon    the K (public/brand/keith-icon.png), drawn as a MASK in the current text colour, so it
//                is navy where Settings' icons are navy, white on a selected rail row, and light in
//                dark mode, with no second file. It takes the same props as a lucide icon, so it drops
//                into an icon map.
//   KeithLockup  the orb and the "Keith AI" wordmark (public/brand/keith-lockup.png) for the title line
//                of Settings > Keith. Its lettering is navy, which would vanish on a dark page, so in
//                dark mode the orb stays and the wordmark is set as text in the heading ink.
import './keithBrand.css'

export function KeithIcon({ size = 16, className = '' }) {
  return <span className={`keith-icon ${className}`} style={{ width: size, height: size }} aria-hidden="true" />
}

export function KeithLockup() {
  return (
    <span className="keith-lockup">
      <img className="keith-lockup-art" src="/brand/keith-lockup.png" alt="Keith" draggable="false" />
      <span className="keith-lockup-dark">
        <img src="/brand/keith-orb-160.png" alt="" draggable="false" />
        <span className="keith-lockup-name">Keith</span>
        <span className="keith-lockup-ai" aria-hidden="true">AI</span>
      </span>
    </span>
  )
}
