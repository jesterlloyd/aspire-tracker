// MASTHEAD-SCENE-1: the masthead's time-of-day background artwork - layered
// San Gabriel-style mountain ridges, a barely-visible LA skyline, sparse city
// lights, and palm silhouettes, all original inline SVG plus CSS-gradient
// skies. Subtle and atmospheric by design, never photographic.
// MASTHEAD-SCENE-2 layers city scene packs (prepared images) on top; the SVG
// below is the always-available fallback.
//
import { useMemo, useState } from 'react'
import { useWelcomeWeather } from './WeatherScene'
import { SCENES } from '../lib/mastheadScene'
import { parseSceneFiles, choosePack, injectedSceneFiles } from '../lib/mastheadCityScenes'
import { useCityPreference } from './masthead/useCityPreference'
//
// The component is purely presentational and state-free: the host card carries
// .mast-scene-{dawn|day|sunset|night} (from useMastheadScene) and index.css
// maps that class to CSS variables (ridge/city/palm fills, light/star opacity)
// and to which sky layer is visible. Scene changes therefore CROSS-FADE in CSS
// (fill/opacity transitions) instead of remounting artwork; reduced motion
// drops the transitions. Everything is aria-hidden and pointer-events:none -
// the card's text, chips, and View calendar sit above and stay interactive.
//
// Composition contract: the LEFT side stays quiet behind the greeting (the art
// svg and every sky carry a left-fading mask); ridge peaks, the skyline, and
// the palms weight toward the CENTER-RIGHT near the weather module.

// Skyline block: [x, roofY, width, height]. Bases sink behind the front ridge.
const BUILDINGS = [
  [612, 104, 10, 26], [626, 98, 8, 32], [638, 108, 12, 22], [654, 94, 9, 36],
  [667, 102, 7, 28], [678, 96, 10, 34], [692, 106, 8, 24], [704, 90, 11, 40],
  [719, 100, 8, 30], [731, 107, 10, 23], [745, 97, 8, 33], [757, 104, 12, 26],
  [773, 100, 7, 30], [784, 108, 9, 22], [797, 102, 8, 28],
]

// Sparse lit windows - visible only when the scene's --scn-lights is up.
const LIGHTS = [
  [628, 104], [646, 112], [657, 100], [659, 108], [680, 101], [694, 110],
  [707, 96], [707, 102], [709, 110], [715, 120], [722, 104], [733, 111],
  [748, 102], [760, 108], [775, 105], [787, 112],
]

const STARS = [
  [150, 18, 1.4], [310, 30, 1.1], [430, 40, 0.9], [520, 14, 1.5],
  [700, 26, 1.1], [880, 12, 1.3], [1010, 30, 1.0],
]

// One palm silhouette drawn around (1067,102)..(1081,150); reused via <use>.
const PALM = `
M1075,150 C1073,132 1071,118 1066,104 L1070,103 C1075,118 1078,132 1081,150 Z
M1067,103 C1055,92 1040,88 1026,90 C1042,94 1054,98 1064,105 Z
M1067,102 C1060,88 1048,80 1035,78 C1049,84 1059,92 1064,103 Z
M1068,101 C1068,86 1074,74 1084,68 C1077,80 1073,92 1072,102 Z
M1069,102 C1078,90 1092,84 1106,86 C1092,90 1080,96 1072,105 Z
M1069,104 C1082,98 1098,98 1110,104 C1096,102 1082,104 1072,108 Z
M1066,104 C1052,100 1038,102 1028,108 C1040,104 1054,106 1064,108 Z`

// MASTHEAD-SCENE-2: preferred rendering is a CITY SCENE PACK - prepared
// artwork from public/masthead/ (see scripts/prepare-masthead-scenes.mjs),
// chosen for the viewer's resolved weather location (granted geolocation
// city, else LA) so the scenery follows the person the way the temperature
// already does. All of the pack's scene images stay mounted and cross-fade
// via the same .mast-scene-* classes. The hand-built SVG scenery below
// remains the fallback: no pack for this location, a scene missing from the
// pack, or any image failing to load (one broken image drops the whole pack
// for the session - the AssetScene pattern - so a half-loaded card never
// shows) all land back on the SVG.
export default function MastheadScenery() {
  const { location } = useWelcomeWeather()
  const [imagesBroken, setImagesBroken] = useState(false)
  // MASTHEAD-SCENE-4: an explicit city choice wins over location matching; a
  // choice naming a pack that is no longer installed falls back to automatic
  // rather than dropping the viewer to the SVG scenery.
  const { city: preferredCity } = useCityPreference()
  const pack = useMemo(() => {
    const packs = parseSceneFiles(injectedSceneFiles())
    if (preferredCity && packs[preferredCity]) return { city: preferredCity, scenes: packs[preferredCity] }
    return choosePack(packs, location)
  }, [location, preferredCity])
  const scenes = pack && !imagesBroken ? pack.scenes : null
  const complete = scenes && SCENES.every(s => scenes[s])
  return (
    <div className="mast-scenery" aria-hidden>
      {/* The state-keyed sky gradients always render: in city mode the art's
          left fade lands on them. SCENE-3 added morning/goldenhour/rain. */}
      <div className="mast-sky mast-sky-dawn" />
      <div className="mast-sky mast-sky-morning" />
      <div className="mast-sky mast-sky-day" />
      <div className="mast-sky mast-sky-goldenhour" />
      <div className="mast-sky mast-sky-sunset" />
      <div className="mast-sky mast-sky-night" />
      <div className="mast-sky mast-sky-rain" />
      {/* The SVG ridge art renders beneath a PARTIAL pack so a missing scene
          still shows artwork; a complete pack replaces it. */}
      {!complete && <SvgScenery />}
      {scenes && SCENES.map(s => scenes[s] && (
        <img
          key={s}
          className={`mast-scn-img mast-scn-img-${s}`}
          src={scenes[s]}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setImagesBroken(true)}
        />
      ))}
    </div>
  )
}

function SvgScenery() {
  return (
    <svg className="mast-scenery-art" viewBox="0 0 1200 150" preserveAspectRatio="none">
        <defs>
          <path id="scnPalm" d={PALM} />
        </defs>
        <g className="scn-stars" fill="#fff">
          {STARS.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
        </g>
        {/* Back ridge - the palest, most distant layer. */}
        <path
          fill="var(--scn-r1)"
          d="M0,150 L0,100 C120,96 220,88 340,92 C460,96 540,78 660,72 C740,68 800,58 880,66 C980,76 1080,84 1200,80 L1200,150 Z"
        />
        {/* Mid ridge - low and quiet on the left, peaks center-right. */}
        <path
          fill="var(--scn-r2)"
          d="M0,150 L0,122 C150,120 260,114 380,116 C500,118 580,100 690,96 C800,92 880,86 960,92 C1060,99 1130,104 1200,100 L1200,150 Z"
        />
        {/* Skyline between the ridges; bases hidden behind the front ridge. */}
        <g fill="var(--scn-city)">
          {BUILDINGS.map(([x, y, w, h]) => <rect key={x} x={x} y={y} width={w} height={h} />)}
        </g>
        <g className="scn-lights" fill="#FFD98A">
          {LIGHTS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1.6} height={1.6} />)}
        </g>
        {/* Front ridge - the boldest layer, weighted right. */}
        <path
          fill="var(--scn-r3)"
          d="M0,150 L0,140 C140,138 260,136 400,132 C520,128 620,118 740,116 C860,114 960,106 1060,110 C1120,113 1170,112 1200,110 L1200,150 Z"
        />
        <g className="scn-palms" fill="var(--scn-palm)">
          {/* The tall palm sits lower so its fronds stay beneath the weather
              caption's H/L line instead of muddying it. */}
          <use href="#scnPalm" transform="translate(0,26)" />
          <use href="#scnPalm" transform="translate(374,42) scale(0.72)" />
        </g>
      </svg>
  )
}
