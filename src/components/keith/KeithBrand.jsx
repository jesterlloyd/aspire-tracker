// src/components/keith/KeithBrand.jsx
//
// KEITH-FOUNDATION-1 (Owner, 2026-09-28): Keith's own artwork where the app names Keith.
//
//   KeithIcon    the K (public/brand/keith-icon.png), drawn as a MASK in the current text colour, so it
//                is navy where Settings' icons are navy, white on a selected rail row, and light in
//                dark mode, with no second file. It takes the same props as a lucide icon, so it drops
//                into an icon map.
//   KeithLockup  the orb, then "Keith" and "AI" SET AS TEXT, for the title line of Settings > Keith.
//                KEITH-LOCKUP-2 (Owner, 2026-10-01): the PNG wordmark carried its own padding, so the
//                title never lined up with the subtitle under it, and its letters sat tight against
//                the orb. Text in the heading's own font and ink lines up, reads in both themes, and
//                leaves room between the orb, the name and AI. public/brand/keith-lockup.png is no
//                longer drawn.
import './keithBrand.css'

export function KeithIcon({ size = 16, className = '' }) {
  return <span className={`keith-icon ${className}`} style={{ width: size, height: size }} aria-hidden="true" />
}

export function KeithLockup() {
  return (
    <span className="keith-lockup">
      <img className="keith-lockup-orb" src="/brand/keith-orb-160.png" alt="" draggable="false" />
      <span className="keith-lockup-name">Keith</span>
      <span className="keith-lockup-ai" aria-hidden="true">AI</span>
    </span>
  )
}
