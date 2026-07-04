/* eslint-disable react-refresh/only-export-components */
// (Intentionally exports the WeatherScene component alongside the useWelcomeWeather hook so the band
//  background and the scene share ONE weather query. The disabled rule is a dev-only Fast-Refresh
//  hint with no runtime/production impact.)
// ASPIRE-WEATHER-4 / 4A: a LARGE, original HTML/SVG animated weather scene for the Aggregate welcome
// band — a signature "sky moment" living in its own center-left sky strip (not a status chip beside
// View Calendar). Fixed Cedars-Sinai / Los Angeles via Open-Meteo (NO key, NO geolocation, NO env
// var). Day/night aware via current.is_day (sun by day, moon+stars by night) — the visible label
// never says "night". Optional + non-blocking: returns null on any failure (silent hide, never throws,
// never blocks the welcome band). Pure CSS keyframes (prefixed, scoped inline <style>), auto-frozen
// under prefers-reduced-motion; a scoped media query shrinks the graphic on narrow screens.
import { useQuery } from '@tanstack/react-query'

const LAT = 34.076
const LON = -118.380
const F = 'DM Sans, sans-serif'
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

// Visible labels — simple; never contain the word "night".
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

// Shared query — the band background (day/night theming) and this scene both read it. React Query
// dedupes by key, so it's a single fetch. Same Open-Meteo source/params/mapping as before.
export function useWelcomeWeather() {
  return useQuery({
    queryKey: ['welcome_weather', 'los_angeles'],
    queryFn: async () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=kmh&timezone=America%2FLos_Angeles&forecast_days=1`
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
      }
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export default function WeatherScene() {
  const { data } = useWelcomeWeather()
  if (!data) return null // silent, non-blocking: hidden until data arrives, and hidden on failure

  const scene = mapScene(data.code, data.wind, data.isDay)
  const label = LABELS[scene]
  const night = data.isDay === 0
  // Caption IN FRONT of the graphic — light over the dark night sky, dark over the light day sky,
  // each with a soft shadow so it reads over clouds/moon/sun. Restrained sizes.
  const cTemp = night ? '#ffffff' : NAVY
  const cCond = night ? 'rgba(255,255,255,0.92)' : '#334155'
  const cLoc = night ? 'rgba(255,255,255,0.72)' : '#6b7280'
  const shadow = night ? '0 1px 8px rgba(0,0,0,0.5)' : '0 1px 4px rgba(255,255,255,0.7)'
  return (
    // Absolute hero layer in the open center sky (parent band is position:relative). Large graphic
    // behind; caption in front (higher z-index). pointer-events:none so View Calendar stays clickable.
    <div className="wx-layer" style={{ pointerEvents: 'none', fontFamily: F }} title="Los Angeles weather">
      <style>{KEYFRAMES}</style>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative', zIndex: 0 }}><SceneSvg scene={scene} /></div>
        <div className="wx-caption" style={{ textAlign: 'left', lineHeight: 1.15, whiteSpace: 'nowrap', textShadow: shadow }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: cTemp, letterSpacing: '-0.01em' }}>{data.temp}°</div>
          {label && <div style={{ fontSize: 14, fontWeight: 600, color: cCond, marginTop: 1 }}>{label}</div>}
          <div style={{ fontSize: 11.5, color: cLoc, marginTop: 2 }}>
            Los Angeles{data.hi != null && data.lo != null ? ` · H ${data.hi}° L ${data.lo}°` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
