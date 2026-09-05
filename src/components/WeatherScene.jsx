/* eslint-disable react-refresh/only-export-components */
// (Intentionally exports the WeatherScene component alongside the useWelcomeWeather hook so the band
//  background and the scene share ONE weather query. The disabled rule is a dev-only Fast-Refresh
//  hint with no runtime/production impact.)
// ASPIRE-WEATHER-4 / 4A: a LARGE, original HTML/SVG animated weather scene for the Aggregate welcome
// band - a signature "sky moment" living in its own center-left sky strip (not a status chip beside
// View Calendar). Fixed Cedars-Sinai / Los Angeles via Open-Meteo (NO key, NO geolocation, NO env
// var). Day/night aware via current.is_day (sun by day, moon+stars by night) - the visible label
// never says "night". Optional + non-blocking: returns null on any failure (silent hide, never throws,
// never blocks the welcome band). Pure CSS keyframes (prefixed, scoped inline <style>), auto-frozen
// under prefers-reduced-motion; a scoped media query shrinks the graphic on narrow screens.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { sceneAssets } from '../lib/weatherAssetMap'
import { useWeatherLocation } from '../lib/weatherLocation'
import { sceneForTime, sunTimesFrom, artSceneFor, ALL_SCENES, isNightScene } from '../lib/mastheadScene'
import { parseSceneFiles, injectedSceneFiles, resolvePack, skyPositionFor, CITY_COORDS } from '../lib/mastheadCityScenes'
import { cityOptions, cityWeatherLocation } from '../lib/mastheadCityPreference'
import { useCityPreference } from './masthead/useCityPreference'
import CityPickerDialog from './masthead/CityPickerDialog'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'

// WMO weather_code + is_day + wind → scene. Conservative; unrecognized → 'unknown' (calm cloud).
function mapScene(code, windKmh, isDay) {
  const day = isDay !== 0 // treat missing as day
  let scene = 'unknown'
  if (code === 0) scene = day ? 'clear_day' : 'clear_night'
  else if (code === 1 || code === 2) scene = day ? 'partly_cloudy_day' : 'partly_cloudy_night'
  else if (code === 3) scene = 'cloudy'
  else if (code === 45 || code === 48) scene = 'fog'
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) scene = 'rain'
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) scene = 'cloudy' // snow ~never LA
  const mild = ['clear_day', 'clear_night', 'partly_cloudy_day', 'partly_cloudy_night', 'cloudy']
  if (windKmh >= 32 && mild.includes(scene)) scene = 'windy'
  return scene
}

// Visible labels - simple; never contain the word "night".
const LABELS = {
  clear_day: 'Sunny', clear_night: 'Clear',
  partly_cloudy_day: 'Partly Cloudy', partly_cloudy_night: 'Partly Cloudy',
  cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog', windy: 'Windy', unknown: '',
}

const KEYFRAMES = `
@keyframes wx-pulse { 0%,100%{opacity:.45;transform:scale(1)} 50%{opacity:.82;transform:scale(1.09)} }
@keyframes wx-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes wx-drift { 0%{transform:translateX(-4px)} 50%{transform:translateX(4px)} 100%{transform:translateX(-4px)} }
@keyframes wx-drift2 { 0%{transform:translateX(4px)} 50%{transform:translateX(-4px)} 100%{transform:translateX(4px)} }
@keyframes wx-rain { 0%{transform:translateY(-4px);opacity:0} 25%{opacity:.8} 100%{transform:translateY(22px);opacity:0} }
@keyframes wx-fog { 0%{transform:translateX(-7px)} 50%{transform:translateX(7px)} 100%{transform:translateX(-7px)} }
@keyframes wx-wind { 0%{transform:translateX(-12px);opacity:.2} 50%{opacity:.85} 100%{transform:translateX(16px);opacity:.2} }
@keyframes wx-twinkle { 0%,100%{opacity:.25} 50%{opacity:1} }
@keyframes wx-fall { 0%{transform:translateY(0);opacity:0} 15%{opacity:.9} 85%{opacity:.9} 100%{transform:translateY(360%);opacity:0} }
@keyframes wx-blow { 0%{transform:translateX(0) rotate(0deg);opacity:0} 12%{opacity:.95} 82%{opacity:.95} 100%{transform:translateX(1100%) rotate(300deg);opacity:0} }
/* Licensed-asset hero box - same responsive footprint as .wx-svg, fixed 19:12 aspect; layers are
   absolutely positioned % children. overflow:hidden crops the tall sun/moon source renders. */
.wx-assetbox{ position:relative; aspect-ratio: 19 / 12; overflow:hidden }
.wx-assetbox img{ position:absolute; display:block; user-select:none }
/* Weather HERO layer: the large graphic floats in the open center sky (between the narrow Today
   cards on the left and the Upcoming card on the right). Overlays without adding band height. On
   narrow it drops to static flow (stacked) so nothing overlaps. */
.wx-layer{ position:absolute; left:30%; top:2px; z-index:0 }
.wx-svg{ width:244px; height:auto; display:block }
/* Caption sits IN FRONT of the graphic (higher z-index), lower-left, with a text-shadow so it stays
   readable over clouds/moon. Anchored to the graphic's lower-left corner. */
.wx-caption{ position:absolute; left:6px; bottom:6px; z-index:2 }
@media (max-width:1100px){ .wx-layer{ left:26% } .wx-svg{ width:210px } }
@media (max-width:900px){ .wx-layer{ left:22% } .wx-svg{ width:176px } }
@media (max-width:760px){
  .wx-layer{ position:static; left:auto; top:auto; margin-top:8px }
  .wx-svg{ width:150px }
  .wx-caption{ position:static; left:auto; bottom:auto; margin-top:4px }   /* stacks normally on narrow */
}
@media (max-width:460px){ .wx-svg{ width:120px } }
@media (prefers-reduced-motion: reduce){ .wx-a{ animation:none !important } }
`

// Big puffy cloud centered near (x, y), scaled by s.
function Cloud({ x, y, s = 1, fill = '#ffffff', opacity = 1 }) {
  const r = v => v * s
  return (
    <g fill={fill} opacity={opacity}>
      <circle cx={x - r(18)} cy={y} r={r(15)} />
      <circle cx={x + r(18)} cy={y} r={r(17)} />
      <circle cx={x} cy={y - r(13)} r={r(21)} />
      <rect x={x - r(33)} y={y - r(2)} width={r(66)} height={r(22)} rx={r(11)} />
    </g>
  )
}

const Stars = ({ pts }) => (
  <g fill="#ffffff">
    {pts.map((p, i) => (
      <circle key={i} className="wx-a" cx={p[0]} cy={p[1]} r={p[2]} style={{ animation: `wx-twinkle ${2.4 + i * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.4}s` }} />
    ))}
  </g>
)

const anim = (name, dur, delay = 0) => ({ transformBox: 'fill-box', transformOrigin: 'center', animation: `${name} ${dur} ease-in-out infinite`, animationDelay: delay ? `${delay}s` : undefined })

const Sun = ({ cx, cy, r = 26 }) => (
  <>
    <g className="wx-a" style={{ ...anim('wx-spin', '48s'), transformOrigin: `${cx}px ${cy}px` }}>
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i * Math.PI) / 6
        return <line key={i} x1={cx + Math.cos(a) * (r + 6)} y1={cy + Math.sin(a) * (r + 6)} x2={cx + Math.cos(a) * (r + 15)} y2={cy + Math.sin(a) * (r + 15)} stroke="#FDE68A" strokeWidth={3} strokeLinecap="round" />
      })}
    </g>
    <circle className="wx-a" cx={cx} cy={cy} r={r + 12} fill="#FDE68A" style={anim('wx-pulse', '3.8s')} />
    <circle cx={cx} cy={cy} r={r} fill="#FCD34D" />
  </>
)

const Moon = ({ cx, cy, r = 24 }) => (
  <>
    <defs>
      <mask id="wx-crescent">
        <rect x="0" y="0" width="190" height="120" fill="white" />
        <circle cx={cx + r * 0.55} cy={cy - r * 0.35} r={r} fill="black" />
      </mask>
    </defs>
    <circle className="wx-a" cx={cx} cy={cy} r={r + 8} fill="#dbe3f4" opacity={0.5} style={anim('wx-pulse', '5s')} />
    <circle cx={cx} cy={cy} r={r} fill="#eef2fb" mask="url(#wx-crescent)" />
  </>
)

function SceneSvg({ scene }) {
  const svg = { className: 'wx-svg', viewBox: '0 0 190 120', 'aria-hidden': true }

  if (scene === 'clear_day') return <svg {...svg}><Sun cx={95} cy={60} r={28} /></svg>
  if (scene === 'clear_night') return <svg {...svg}><Stars pts={[[40, 34, 2], [150, 40, 2.4], [64, 82, 1.8], [140, 86, 2], [110, 26, 1.6]]} /><Moon cx={95} cy={58} r={26} /></svg>
  if (scene === 'partly_cloudy_day') return <svg {...svg}><Sun cx={66} cy={46} r={22} /><g className="wx-a" style={anim('wx-drift', '7s')}><Cloud x={116} y={74} s={1.15} /></g></svg>
  if (scene === 'partly_cloudy_night') return <svg {...svg}><Stars pts={[[36, 30, 2], [156, 34, 2.2], [150, 88, 1.8]]} /><Moon cx={62} cy={46} r={20} /><g className="wx-a" style={anim('wx-drift', '7s')}><Cloud x={116} y={74} s={1.15} /></g></svg>
  if (scene === 'cloudy') return <svg {...svg}><g className="wx-a" style={anim('wx-drift2', '9s')}><Cloud x={78} y={50} s={1.1} fill="#eef2f7" /></g><g className="wx-a" style={anim('wx-drift', '7s')}><Cloud x={112} y={70} s={1.25} /></g></svg>
  if (scene === 'rain') return (
    <svg {...svg}>
      <Cloud x={95} y={46} s={1.3} fill="#d7dfea" />
      {[52, 70, 88, 106, 124, 138].map((cx, i) => (
        <line key={cx} className="wx-a" x1={cx} y1={72} x2={cx - 5} y2={90} stroke="#7DA0C4" strokeWidth={3} strokeLinecap="round" style={anim('wx-rain', '1.2s', i * 0.18)} />
      ))}
    </svg>
  )
  if (scene === 'fog') return (
    <svg {...svg}>
      <Cloud x={95} y={40} s={1.2} fill="#ffffff" opacity={0.85} />
      {[70, 82, 94, 106].map((y, i) => (
        <rect key={y} className="wx-a" x={30} y={y} width={130} height={5} rx={2.5} fill="#c7d2de" opacity={0.72} style={anim(i % 2 ? 'wx-drift2' : 'wx-fog', '5.5s', i * 0.4)} />
      ))}
    </svg>
  )
  if (scene === 'windy') return (
    <svg {...svg}>
      <g className="wx-a" style={anim('wx-drift', '8s')}><Cloud x={92} y={44} s={1.15} fill="#f0f4f9" /></g>
      {[68, 84, 100].map((y, i) => (
        <path key={y} className="wx-a" d={`M24 ${y} h${70 + i * 16} a5 5 0 1 0 -5 -5`} fill="none" stroke="#9fb3c8" strokeWidth={3.5} strokeLinecap="round" style={anim('wx-wind', '2.6s', i * 0.3)} />
      ))}
    </svg>
  )
  // unknown → one calm drifting cloud
  return <svg {...svg}><g className="wx-a" style={anim('wx-drift', '9s')}><Cloud x={95} y={60} s={1.3} /></g></svg>
}

// ASPIRE-WEATHER-ASSETS-1: licensed-asset scene renderer. Renders the manifest's image layers from
// public/weather/aspire-licensed/ inside the same hero footprint as the SVG scene. Every animated
// layer carries wx-a (frozen under prefers-reduced-motion; layers stay visible statically). If ANY
// image fails to load, onBroken() flips WeatherScene back to the built-in SVG scene - no broken
// image is ever shown. Stars stay CSS dots (the package has no star asset).
function AssetScene({ manifest, onBroken }) {
  return (
    <div className="wx-svg wx-assetbox" aria-hidden>
      {/* MASTHEAD-WEATHER-1c: stars stay in the box's upper sky - on narrow layouts the box
          overlaps the right cluster, and a mid-box star used to land on the calendar button. */}
      {manifest.stars && [[14, 14, 3], [78, 10, 4], [92, 20, 3], [8, 40, 3], [64, 6, 3]].map((s, i) => (
        <span key={`s${i}`} className="wx-a" style={{
          position: 'absolute', left: `${s[0]}%`, top: `${s[1]}%`, width: s[2], height: s[2],
          borderRadius: '50%', background: '#fff',
          animation: `wx-twinkle ${2.4 + i * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.4}s`,
        }} />
      ))}
      {manifest.layers.map((l, i) => (
        <img
          key={i}
          className="wx-a"
          src={l.src}
          alt=""
          draggable={false}
          onError={onBroken}
          style={{
            left: l.left, top: l.top, width: l.width,
            opacity: l.opacity ?? 1, zIndex: l.z ?? 0,
            mixBlendMode: l.blend,
            WebkitMaskImage: l.mask, maskImage: l.mask,
            animationName: l.anim, animationDuration: l.dur,
            animationDelay: l.delay, animationIterationCount: 'infinite',
            animationTimingFunction: l.anim === 'wx-fall' || l.anim === 'wx-blow' ? 'linear' : 'ease-in-out',
          }}
        />
      ))}
    </div>
  )
}

// Shared query - the band background (day/night theming) and this scene both read it. Both call this
// hook, which shares one geolocation resolution (module singleton) → same coords → same query key →
// React Query dedupes to a single fetch. Same Open-Meteo source/params/mapping as before; only the
// latitude/longitude (and the label) now come from the browser location when granted, else LA/Cedars.
export function useWelcomeWeather() {
  const resolved = useWeatherLocation()
  // MASTHEAD-SCENE-5: an explicitly chosen city moves the whole masthead -
  // temperature, condition, AND (through this query's sunrise/sunset) the
  // scene clock, so the artwork's time of day matches the city on screen.
  // Automatic leaves the viewer's own resolved location untouched.
  const { city: preferredCity } = useCityPreference()
  const location = cityWeatherLocation(preferredCity, CITY_COORDS) || resolved
  const q = useQuery({
    queryKey: ['welcome_weather', location.chosen ? `city:${preferredCity}` : location.geo ? `geo:${location.lat},${location.lon}` : 'los_angeles'],
    queryFn: async () => {
      // MASTHEAD-SCENE-1: sunrise/sunset ride the same daily request (no extra fetch).
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=kmh&timezone=auto&forecast_days=1`
      const res = await fetch(url)
      if (!res.ok) return null
      const j = await res.json().catch(() => null)
      if (!j?.current) return null
      return {
        temp: Math.round(j.current.temperature_2m),
        code: j.current.weather_code,
        wind: j.current.wind_speed_10m,
        isDay: j.current.is_day,
        hi: j.daily?.temperature_2m_max?.[0] != null ? Math.round(j.daily.temperature_2m_max[0]) : null,
        lo: j.daily?.temperature_2m_min?.[0] != null ? Math.round(j.daily.temperature_2m_min[0]) : null,
        sunrise: j.daily?.sunrise?.[0] ?? null,
        sunset: j.daily?.sunset?.[0] ?? null,
      }
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
  return { ...q, location }
}

// MASTHEAD-SCENE-1/3: ONE unified clock for the masthead's time-of-day
// artwork AND its whole-card night treatment. Anchored to the real
// sunrise/sunset from the shared weather query when available, fixed
// local-time windows otherwise - never the app theme, never the greeting
// wash, and never the weather's is_day flag (the old split let the dark card
// and the artwork disagree at dawn/dusk). SCENE-3: six clock states (dawn,
// morning, day, goldenhour, sunset, night) plus the weather-driven 'rain'
// artwork override (rain/overcast/fog swap the daytime scene; night keeps
// its city-lights artwork). A minute-tick keeps a long-open tab crossing
// scene boundaries without a reload. The localStorage override
// (aspire_scene_override_v1 = any SCENES value, including rain) is QA-only.
export function useMastheadScene() {
  const { data } = useWelcomeWeather()
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60 * 1000)
    return () => clearInterval(id)
  }, [])
  let scene = artSceneFor(sceneForTime(new Date(), sunTimesFrom(data)), data?.code)
  try {
    const o = localStorage.getItem('aspire_scene_override_v1')
    if (ALL_SCENES.includes(o)) scene = o
  } catch { /* storage unavailable: the live clock wins */ }
  // Night treatment follows every night scene, clear or clouded.
  return { scene, night: isNightScene(scene) }
}

// MASTHEAD-NIGHT-1 → MASTHEAD-SCENE-1: night now follows the unified scene
// clock above. Kept as a named export so the night contract stays one symbol.
export function useMastheadNight() {
  return useMastheadScene().night
}

// ASPIRE-MASTHEAD: compact in-flow variant for the At a Glance masthead card.
// Same scenes, same animations, same shared weather query - only resized and
// laid out horizontally (graphic beside a caption column) so it sits in the
// masthead's right cluster instead of floating over the old welcome band.
// Caption ink comes from the chart tokens so light/dark both read on the card
// (the old absolute night-sky caption colors assumed the dark band behind it).
// Reduced-motion, asset-fallback, and silent-failure behavior are inherited.
export function WeatherMasthead() {
  const { data, location } = useWelcomeWeather()
  const [assetsBroken, setAssetsBroken] = useState(false)
  // MASTHEAD-SCENE-4: the temperature opens the scenery city picker. The hooks
  // sit ABOVE the data guard so the hook order never changes between the
  // no-weather and weather renders.
  const [pickerOpen, setPickerOpen] = useState(false)
  const { city: preferredCity, raw: rawCity, choose } = useCityPreference()
  const packs = useMemo(() => parseSceneFiles(injectedSceneFiles()), [])
  const cityOpts = useMemo(() => cityOptions(packs), [packs])
  // The animated sun/moon floats where the CURRENT city's sky is clear - the
  // same resolved pack the scenery renders, so the two can never disagree.
  const skyX = skyPositionFor(resolvePack(packs, preferredCity, location)?.city)
  if (!data) return null // silent, non-blocking - the masthead simply has no weather module

  const scene = mapScene(data.code, data.wind, data.isDay)
  const label = LABELS[scene]
  const night = data.isDay === 0
  const manifest = assetsBroken ? null : sceneAssets(scene, night)
  const hiLo = data.hi != null && data.lo != null ? `H ${data.hi}° · L ${data.lo}°` : ''
  const readout = `${label || 'Weather'}, ${data.temp} degrees${hiLo ? `, high ${data.hi}, low ${data.lo}` : ''}, ${location.label}`
  // Only offer the picker where there is a real choice to make (more than the
  // Automatic entry); a single-pack deployment keeps a plain, inert readout.
  const pickable = cityOpts.length > 1
  return (
    // MASTHEAD-WEATHER-1c: wx-mast-night keys the scene-state night backdrop in
    // index.css (a soft dark radial behind the art so the stars read); the class
    // follows the WEATHER's is_day, not the greeting's time-of-day wash, and the
    // backdrop cross-fades so scene changes never hard-jump.
    <div className={`wx-mast${night ? ' wx-mast-night' : ''}`} style={{ fontFamily: F }}>
      <style>{KEYFRAMES}</style>
      <div className="wx-mast-art" style={{ '--scn-sky-x': skyX }} aria-hidden>
        {manifest
          ? <AssetScene manifest={manifest} onBroken={() => setAssetsBroken(true)} />
          : <SceneSvg scene={scene} />}
      </div>
      {pickable ? (
        <button
          type="button"
          className="wx-mast-caption wx-mast-trigger"
          onClick={() => setPickerOpen(true)}
          title={`${location.label} · Choose masthead scenery`}
          aria-label={`${readout}. Choose masthead scenery.`}
          aria-haspopup="dialog"
        >
          {/* MASTHEAD-LOCKSCREEN-1 (Owner): temperature and condition only.
              The H/L and the city moved out of the card and into this hover
              and the accessible readout, one click from the full reading. */}
          <span className="wx-mast-temp" aria-hidden>{data.temp}°</span>
          {label && <span className="wx-mast-cond" aria-hidden>{label}</span>}
        </button>
      ) : (
        <div className="wx-mast-caption" title={`${location.label} weather`} role="img" aria-label={readout}>
          <div className="wx-mast-temp" aria-hidden>{data.temp}°</div>
          {label && <div className="wx-mast-cond" aria-hidden>{label}</div>}
        </div>
      )}
      <CityPickerDialog
        open={pickerOpen}
        options={cityOpts}
        value={rawCity}
        autoResolvedLabel={location.label}
        onSelect={choose}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}

export default function WeatherScene() {
  const { data, location } = useWelcomeWeather()
  // Licensed-asset renderer is preferred; any image load failure flips to the built-in SVG scene
  // for the rest of the session (no broken images, no retry loops).
  const [assetsBroken, setAssetsBroken] = useState(false)
  if (!data) return null // silent, non-blocking: hidden until data arrives, and hidden on failure

  const scene = mapScene(data.code, data.wind, data.isDay)
  const label = LABELS[scene]
  const night = data.isDay === 0
  const manifest = assetsBroken ? null : sceneAssets(scene, night)
  // Caption IN FRONT of the graphic - light over the dark night sky, dark over the light day sky,
  // each with a soft shadow so it reads over clouds/moon/sun. Restrained sizes.
  const cTemp = night ? '#ffffff' : NAVY
  const cCond = night ? 'rgba(255,255,255,0.92)' : '#334155'
  const cLoc = night ? 'rgba(255,255,255,0.72)' : '#6b7280'
  const shadow = night ? '0 1px 8px rgba(0,0,0,0.5)' : '0 1px 4px rgba(255,255,255,0.7)'
  return (
    // Absolute hero layer in the open center sky (parent band is position:relative). Large graphic
    // behind; caption in front (higher z-index). pointer-events:none so View Calendar stays clickable.
    <div className="wx-layer" style={{ pointerEvents: 'none', fontFamily: F }} title={`${location.label} weather`}>
      <style>{KEYFRAMES}</style>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative', zIndex: 0 }}>
          {manifest
            ? <AssetScene manifest={manifest} onBroken={() => setAssetsBroken(true)} />
            : <SceneSvg scene={scene} />}
        </div>
        <div className="wx-caption" style={{ textAlign: 'left', lineHeight: 1.15, whiteSpace: 'nowrap', textShadow: shadow }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: cTemp, letterSpacing: '-0.01em' }}>{data.temp}°</div>
          {label && <div style={{ fontSize: 14, fontWeight: 600, color: cCond, marginTop: 1 }}>{label}</div>}
          <div style={{ fontSize: 11.5, color: cLoc, marginTop: 2 }}>
            {location.label}{data.hi != null && data.lo != null ? ` · H ${data.hi}° L ${data.lo}°` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
