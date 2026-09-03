// src/public-site/PublicIcons.jsx
//
// PHASE1-PUBLIC-SITE (elevated): original, line-style SVG icons drawn in-house
// for the public site. No external icon library, no third-party or AI imagery.
// currentColor lets CSS control stroke color; decorative by default
// (aria-hidden), so labels come from surrounding text.

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }

function Svg({ children, size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

const PATHS = {
  cap: <><path {...P} d="M12 4 2.5 9 12 14l9.5-5L12 4Z" /><path {...P} d="M6.5 11v4.2c0 1 2.5 2.3 5.5 2.3s5.5-1.3 5.5-2.3V11" /><path {...P} d="M21.5 9v4.5" /></>,
  mentor: <><circle {...P} cx="8.5" cy="8" r="2.6" /><circle {...P} cx="16" cy="9.3" r="2.1" /><path {...P} d="M4 19v-.7c0-2.2 2-3.8 4.5-3.8s4.5 1.6 4.5 3.8V19" /><path {...P} d="M14.5 19v-.4c0-1.9 1.6-3.2 3.6-3.2 1.2 0 2.3.5 3 1.2" /></>,
  hospital: <><path {...P} d="M4 20V6.5L12 3l8 3.5V20" /><path {...P} d="M2.5 20h19" /><path {...P} d="M12 7.5v4M10 9.5h4" /><path {...P} d="M9.5 20v-3.5h5V20" /></>,
  handshake: <><path {...P} d="m11 7 2-1.4c.5-.4 1.2-.4 1.7.1l4.3 4.3" /><path {...P} d="m3 10 3.5-3.5c.5-.5 1.2-.5 1.7-.1L11 8.2 9 10a1.4 1.4 0 0 0 0 2 1.4 1.4 0 0 0 2 0" /><path {...P} d="m11 12 1.8 1.8M13.5 10.3l2 2M15.8 8.6l2.2 2.2" /><path {...P} d="M20 9v5l-2 2M4 10v4l2 2" /></>,
  clock: <><circle {...P} cx="12" cy="12" r="8.3" /><path {...P} d="M12 7.5V12l3 1.8" /></>,
  compass: <><circle {...P} cx="12" cy="12" r="8.3" /><path {...P} d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>,
  stethoscope: <><path {...P} d="M6 3v4a3.5 3.5 0 0 0 7 0V3" /><path {...P} d="M4.5 3h1.5M13 3h1.5" /><path {...P} d="M9.5 10.5v3.3a4.7 4.7 0 0 0 9.4 0v-1.1" /><circle {...P} cx="18.9" cy="11" r="1.8" /></>,
  heart: <><path {...P} d="M12 20s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7-2.4c0 5.1-7 9.4-7 9.4Z" /></>,
  school: <><path {...P} d="M4 20V8.5L12 4l8 4.5V20" /><path {...P} d="M2.5 20h19" /><path {...P} d="M9 20v-4h6v4" /><path {...P} d="M8 11h2M14 11h2" /></>,
  form: <><rect {...P} x="5.5" y="3.5" width="13" height="17" rx="2" /><path {...P} d="M9 8h6M9 11.5h6M9 15h3.5" /></>,
  chat: <><path {...P} d="M4 5.5h11a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9l-3.5 3v-3H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" /><path {...P} d="M20 9.5h.5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H20v2.5l-2.5-2.5" /></>,
  match: <><circle {...P} cx="7" cy="8" r="2.4" /><circle {...P} cx="17" cy="8" r="2.4" /><path {...P} d="M3.5 18v-.8c0-2 1.6-3.4 3.5-3.4s3.5 1.4 3.5 3.4V18" /><path {...P} d="M13.5 18v-.8c0-2 1.6-3.4 3.5-3.4s3.5 1.4 3.5 3.4V18" /><path {...P} d="M10.5 8h3" /></>,
  pulse: <><path {...P} d="M2.5 12h4l2-4 3 8 2.5-5 1.5 1h6" /></>,
}

export default function Icon({ name, size = 24 }) {
  const glyph = PATHS[name]
  if (!glyph) return null
  return <Svg size={size}>{glyph}</Svg>
}

// The Cedars-Sinai infinity-loop motif, redrawn as an original decorative
// mark for large surfaces (hero backdrop, preceptor band). Abstract, not a
// logo reproduction. Inherits color via currentColor + opacity from CSS.
export function LoopMotif({ className }) {
  return (
    <svg className={className} viewBox="0 0 240 140" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round"
        d="M70 70c0-26 22-46 48-46s48 20 48 46-22 46-48 46-48-20-48-46Z" opacity="0.5" />
      <path fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round"
        d="M170 70c0-26-22-46-48-46S74 44 74 70s22 46 48 46 48-20 48-46Z" opacity="0.25" />
    </svg>
  )
}

// An original, warm hero illustration: layered "care" composition built from
// abstract cards (a mentorship pairing, an hours ring, a growth arc). No
// photography, no faces. Clearly a concept graphic; a Cedars-Sinai approved
// photograph can replace it later (see approval list). Retained as the source
// of the social preview card even though the live hero now uses the approved
// vector illustration set.
export function HeroArt({ className }) {
  return (
    <svg className={className} viewBox="0 0 480 420" role="img"
      aria-label="Illustration of two nurses learning together, a clinical hours ring, and a growth arc">
      <defs>
        <linearGradient id="ps-g-navy" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#26307a" />
          <stop offset="1" stopColor="#1D2567" />
        </linearGradient>
        <linearGradient id="ps-g-cream" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f6f2ea" />
        </linearGradient>
      </defs>

      {/* soft backdrop blob */}
      <path fill="#eef0f8" d="M120 30C220 0 400 20 452 120c40 78-8 190-110 232C220 396 60 372 26 268-8 168 40 58 120 30Z" />

      {/* mentorship card */}
      <g>
        <rect x="54" y="96" width="250" height="150" rx="20" fill="url(#ps-g-cream)" stroke="#e3ded4" />
        <circle cx="120" cy="150" r="26" fill="#dfe3f4" />
        <path d="M120 150a12 12 0 1 0-.1 0Z" fill="#26307a" opacity="0.9" />
        <path d="M98 186c0-14 10-22 22-22s22 8 22 22Z" fill="#26307a" opacity="0.9" />
        <circle cx="196" cy="160" r="22" fill="#f4d7d8" />
        <path d="M196 160a10 10 0 1 0-.1 0Z" fill="#B3282D" opacity="0.85" />
        <path d="M178 190c0-12 8-19 18-19s18 7 18 19Z" fill="#B3282D" opacity="0.85" />
        <rect x="150" y="206" width="120" height="10" rx="5" fill="#e7e2d8" />
        <rect x="150" y="224" width="86" height="9" rx="4.5" fill="#eceadf" />
      </g>

      {/* hours ring */}
      <g transform="translate(330,206)">
        <circle r="64" fill="#fff" stroke="#e3ded4" />
        <circle r="52" fill="none" stroke="#eceadf" strokeWidth="12" />
        <circle r="52" fill="none" stroke="url(#ps-g-navy)" strokeWidth="12"
          strokeLinecap="round" strokeDasharray="245 327" transform="rotate(-90)" />
        <text x="0" y="-2" textAnchor="middle" fontFamily="Plus Jakarta Sans, sans-serif"
          fontSize="30" fontWeight="700" fill="#1D2567">90+</text>
        <text x="0" y="20" textAnchor="middle" fontFamily="Plus Jakarta Sans, sans-serif"
          fontSize="12" fontWeight="600" fill="#4b5265">hours</text>
      </g>

      {/* growth arc with nodes */}
      <g fill="none" stroke="#B3282D" strokeWidth="4" strokeLinecap="round" opacity="0.9">
        <path d="M70 322c70-46 150-46 226-8" strokeDasharray="2 14" />
      </g>
      <g>
        <circle cx="82" cy="316" r="9" fill="#1D2567" />
        <circle cx="180" cy="300" r="9" fill="#B3282D" />
        <circle cx="286" cy="316" r="11" fill="#1D2567" />
        <path d="M282 316l3 3 6-7" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
