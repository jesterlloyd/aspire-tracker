// ASPIRE-WEATHER-4: a compact, original HTML/SVG animated weather scene for the Aggregate welcome
// band. Fixed Cedars-Sinai / Los Angeles location via Open-Meteo (NO key, NO geolocation, NO env
// var). Optional + non-blocking: on any failure the query returns null and the component renders
// nothing (hidden) — it never throws and never blocks the welcome band's events. Animations are pure
// CSS keyframes (prefixed, scoped in an inline <style>) and auto-disable under prefers-reduced-motion.
import { useQuery } from '@tanstack/react-query'

const LAT = 34.076
const LON = -118.380
const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// WMO weather_code → scene. Conservative; anything unrecognized → 'unknown' (calm cloud). A strong
// wind overrides otherwise-mild conditions.
function mapScene(code, windKmh) {
  let scene = 'unknown'
  if (code === 0) scene = 'sunny'
  else if (code === 1 || code === 2) scene = 'partly_cloudy'
  else if (code === 3) scene = 'cloudy'
  else if (code === 45 || code === 48) scene = 'fog'
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) scene = 'rain'
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) scene = 'cloudy' // snow is ~never LA
  if (windKmh >= 32 && (scene === 'sunny' || scene === 'partly_cloudy' || scene === 'cloudy')) scene = 'windy'
  return scene
}

const LABELS = { sunny: 'Sunny', partly_cloudy: 'Partly Cloudy', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog', windy: 'Windy', unknown: '' }

const KEYFRAMES = `
@keyframes wx-pulse { 0%,100%{opacity:.45;transform:scale(1)} 50%{opacity:.8;transform:scale(1.1)} }
@keyframes wx-drift { 0%{transform:translateX(-2px)} 50%{transform:translateX(2px)} 100%{transform:translateX(-2px)} }
@keyframes wx-drift2 { 0%{transform:translateX(2px)} 50%{transform:translateX(-2px)} 100%{transform:translateX(2px)} }
@keyframes wx-rain { 0%{transform:translateY(-2px);opacity:0} 25%{opacity:.75} 100%{transform:translateY(11px);opacity:0} }
@keyframes wx-fog { 0%{transform:translateX(-3px)} 50%{transform:translateX(3px)} 100%{transform:translateX(-3px)} }
@keyframes wx-wind { 0%{transform:translateX(-5px);opacity:.25} 50%{opacity:.8} 100%{transform:translateX(7px);opacity:.25} }
@media (prefers-reduced-motion: reduce){ .wx-a{animation:none !important} }
`

// Reusable puffy cloud centered near (x, y).
function Cloud({ x, y, fill = '#ffffff', opacity = 1 }) {
  return (
    <g fill={fill} opacity={opacity}>
      <circle cx={x - 7} cy={y} r={6} />
      <circle cx={x + 7} cy={y} r={7} />
      <circle cx={x} cy={y - 5} r={8} />
      <rect x={x - 13} y={y - 1} width={26} height={9} rx={4.5} />
    </g>
  )
}

function SceneSvg({ scene }) {
  const anim = (name, dur, delay = 0) => ({ transformBox: 'fill-box', transformOrigin: 'center', animation: `${name} ${dur} ease-in-out infinite`, animationDelay: delay ? `${delay}s` : undefined })
  const svgProps = { width: 52, height: 40, viewBox: '0 0 56 40', 'aria-hidden': true, style: { flexShrink: 0 } }

  if (scene === 'sunny') {
    return (
      <svg {...svgProps}>
        <circle className="wx-a" cx={28} cy={20} r={13} fill="#FDE68A" style={anim('wx-pulse', '3.6s')} />
        <circle cx={28} cy={20} r={9} fill="#FCD34D" />
      </svg>
    )
  }
  if (scene === 'partly_cloudy') {
    return (
      <svg {...svgProps}>
        <circle className="wx-a" cx={20} cy={15} r={9} fill="#FDE68A" style={anim('wx-pulse', '3.6s')} />
        <circle cx={20} cy={15} r={6.5} fill="#FCD34D" />
        <g className="wx-a" style={anim('wx-drift', '6s')}><Cloud x={34} y={24} /></g>
      </svg>
    )
  }
  if (scene === 'cloudy') {
    return (
      <svg {...svgProps}>
        <g className="wx-a" style={anim('wx-drift2', '7s')}><Cloud x={22} y={16} fill="#eef2f7" /></g>
        <g className="wx-a" style={anim('wx-drift', '5.5s')}><Cloud x={33} y={23} /></g>
      </svg>
    )
  }
  if (scene === 'rain') {
    return (
      <svg {...svgProps}>
        <Cloud x={28} y={15} fill="#dbe2ec" />
        {[16, 24, 32, 40].map((cx, i) => (
          <line key={cx} className="wx-a" x1={cx} y1={24} x2={cx - 2} y2={30} stroke="#7DA0C4" strokeWidth={2} strokeLinecap="round" style={anim('wx-rain', '1.1s', i * 0.22)} />
        ))}
      </svg>
    )
  }
  if (scene === 'fog') {
    return (
      <svg {...svgProps}>
        <Cloud x={28} y={13} fill="#ffffff" opacity={0.85} />
        {[24, 30, 36].map((y, i) => (
          <rect key={y} className="wx-a" x={10} y={y} width={36} height={3} rx={1.5} fill="#c7d2de" opacity={0.7} style={anim(i % 2 ? 'wx-drift2' : 'wx-fog', '5s', i * 0.4)} />
        ))}
      </svg>
    )
  }
  if (scene === 'windy') {
    return (
      <svg {...svgProps}>
        <Cloud x={26} y={14} fill="#f0f4f9" />
        {[24, 30, 36].map((y, i) => (
          <path key={y} className="wx-a" d={`M8 ${y} h${20 + i * 6} a3 3 0 1 0 -3 -3`} fill="none" stroke="#9fb3c8" strokeWidth={2} strokeLinecap="round" style={anim('wx-wind', '2.4s', i * 0.3)} />
        ))}
      </svg>
    )
  }
  // unknown → one calm drifting cloud
  return (
    <svg {...svgProps}>
      <g className="wx-a" style={anim('wx-drift', '7s')}><Cloud x={28} y={19} /></g>
    </svg>
  )
}

export default function WeatherScene() {
  const { data } = useQuery({
    queryKey: ['welcome_weather', 'los_angeles'],
    queryFn: async () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=kmh&timezone=America%2FLos_Angeles&forecast_days=1`
      const res = await fetch(url)
      if (!res.ok) return null
      const j = await res.json().catch(() => null)
      if (!j?.current) return null
      return {
        temp: Math.round(j.current.temperature_2m),
        code: j.current.weather_code,
        wind: j.current.wind_speed_10m,
        hi: j.daily?.temperature_2m_max?.[0] != null ? Math.round(j.daily.temperature_2m_max[0]) : null,
        lo: j.daily?.temperature_2m_min?.[0] != null ? Math.round(j.daily.temperature_2m_min[0]) : null,
      }
    },
    staleTime: 30 * 60 * 1000,  // 30 min — weather changes slowly; avoid frequent refetches
    gcTime: 60 * 60 * 1000,
    retry: 1,                    // not aggressive
    refetchOnWindowFocus: false,
  })

  if (!data) return null // silent, non-blocking: hidden until data arrives, and hidden on failure

  const scene = mapScene(data.code, data.wind)
  const label = LABELS[scene]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: F }} title="Los Angeles weather">
      <style>{KEYFRAMES}</style>
      <SceneSvg scene={scene} />
      <div style={{ lineHeight: 1.25 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{data.temp}°{label ? ` · ${label}` : ''}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          Los Angeles{data.hi != null && data.lo != null ? ` · H ${data.hi}° L ${data.lo}°` : ''}
        </div>
      </div>
    </div>
  )
}
