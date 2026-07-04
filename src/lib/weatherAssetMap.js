// ASPIRE-WEATHER-ASSETS-1: maps the existing weather scene keys (from WeatherScene's mapScene —
// WMO code + is_day + wind, unchanged) to the licensed image layers under
// public/weather/aspire-licensed/. Pure config — no fetch, no JSX, no data-mechanism changes.
//
// Layers render inside a fixed-aspect hero box (same footprint as the SVG scene). Positions/sizes
// are PERCENTAGES of that box. `anim` names map to the wx-* keyframes in WeatherScene.jsx and all
// carry the wx-a class, so prefers-reduced-motion freezes them. Assets live in public/ and load by
// path — only the ACTIVE scene's images are requested by the browser; nothing is bundled into JS.
//
// Returning null for a scene (e.g. 'unknown') tells WeatherScene to use its built-in SVG fallback.

const BASE = '/weather/aspire-licensed'

const SUN  = `${BASE}/clear-day/sun.png`     // midday sun render, transparent bg (element in top third)
const MOON = `${BASE}/clear-night/moon.png`  // full-moon render, transparent bg (element at top)
const CLOUD_DAY   = (n) => `${BASE}/cloudy/cloud-day-${n}.png`
const CLOUD_NIGHT = (n) => `${BASE}/cloudy/cloud-night-${n}.png`
const DROP = (n) => `${BASE}/rain/drop-${n}.png`
const FOG  = (n) => `${BASE}/fog/fog-${n}.png`
const LEAF = (n) => `${BASE}/windy/leaf-${n}.png`

// The sun/moon source renders are tall (2:3) with the celestial body in the top portion; the hero
// box (19:12, overflow hidden) naturally crops the empty lower area. The sun render's glow fades to
// WHITE (not alpha), so it multiplies onto the light day band — the white halo disappears and the
// disc/rays tint naturally into the sky. The moon render has clean alpha and needs no blend.
const sunLayer  = {
  src: SUN, left: '14%', top: '-10%', width: '68%', anim: 'wx-pulse', dur: '5s', z: 0,
  blend: 'multiply',
  // Feathered radial mask centered on the sun disc — removes the residual rectangular edge left by
  // the not-quite-pure-white glow fade.
  mask: 'radial-gradient(closest-side at 50% 26%, #000 48%, transparent 74%)',
}
const moonLayer = { src: MOON, left: '24%', top: '-6%', width: '50%', anim: 'wx-pulse', dur: '6s', z: 0 }

const drops = [
  { src: DROP(1), left: '20%', top: '-10%', width: '6%', anim: 'wx-fall', dur: '1.3s', delay: '0s' },
  { src: DROP(2), left: '34%', top: '-14%', width: '5%', anim: 'wx-fall', dur: '1.1s', delay: '0.35s' },
  { src: DROP(3), left: '48%', top: '-10%', width: '6%', anim: 'wx-fall', dur: '1.5s', delay: '0.7s' },
  { src: DROP(1), left: '62%', top: '-12%', width: '5%', anim: 'wx-fall', dur: '1.2s', delay: '0.2s' },
  { src: DROP(2), left: '76%', top: '-10%', width: '6%', anim: 'wx-fall', dur: '1.4s', delay: '0.55s' },
  { src: DROP(3), left: '28%', top: '-16%', width: '5%', anim: 'wx-fall', dur: '1.6s', delay: '0.9s' },
  { src: DROP(1), left: '55%', top: '-14%', width: '5%', anim: 'wx-fall', dur: '1.35s', delay: '1.1s' },
  { src: DROP(2), left: '42%', top: '-12%', width: '6%', anim: 'wx-fall', dur: '1.25s', delay: '0.85s' },
]

export function sceneAssets(scene, night) {
  const cloud = night ? CLOUD_NIGHT : CLOUD_DAY
  switch (scene) {
    case 'clear_day':
      return { layers: [sunLayer] }
    case 'clear_night':
      return { stars: true, layers: [moonLayer] }
    case 'partly_cloudy_day':
      return {
        layers: [
          { ...sunLayer, left: '2%', width: '60%' },
          { src: CLOUD_DAY(1), left: '32%', top: '26%', width: '62%', anim: 'wx-drift', dur: '9s', z: 1 },
          { src: CLOUD_DAY(2), left: '8%',  top: '50%', width: '46%', anim: 'wx-drift2', dur: '11s', opacity: 0.92, z: 1 },
        ],
      }
    case 'partly_cloudy_night':
      return {
        stars: true,
        layers: [
          { ...moonLayer, left: '8%', width: '44%' },
          { src: CLOUD_NIGHT(1), left: '32%', top: '26%', width: '60%', anim: 'wx-drift', dur: '9s', z: 1 },
          { src: CLOUD_NIGHT(2), left: '8%',  top: '52%', width: '42%', anim: 'wx-drift2', dur: '11s', opacity: 0.9, z: 1 },
        ],
      }
    case 'cloudy':
      return {
        layers: [
          { src: cloud(1), left: '-2%', top: '8%',  width: '62%', anim: 'wx-drift2', dur: '11s' },
          { src: cloud(3), left: '36%', top: '22%', width: '68%', anim: 'wx-drift', dur: '9s' },
          { src: cloud(2), left: '14%', top: '48%', width: '52%', anim: 'wx-drift', dur: '13s', opacity: 0.9 },
        ],
      }
    case 'rain':
      return {
        layers: [
          { src: CLOUD_NIGHT(3), left: '8%',  top: '-2%', width: '70%', anim: 'wx-drift', dur: '12s' },
          { src: CLOUD_NIGHT(1), left: '40%', top: '12%', width: '52%', anim: 'wx-drift2', dur: '10s', opacity: 0.88 },
          ...drops,
        ],
      }
    case 'fog':
      return {
        layers: [
          { src: FOG(3), left: '4%',  top: '8%',  width: '84%', anim: 'wx-fog', dur: '8s' },
          { src: FOG(1), left: '0%',  top: '36%', width: '88%', anim: 'wx-drift2', dur: '10s' },
          { src: FOG(2), left: '10%', top: '58%', width: '80%', anim: 'wx-fog', dur: '9s', opacity: 0.85 },
        ],
      }
    case 'windy':
      return {
        layers: [
          { src: cloud(1), left: '24%', top: '2%', width: '64%', anim: 'wx-drift', dur: '8s' },
          { src: LEAF(1), left: '-6%', top: '40%', width: '9%', anim: 'wx-blow', dur: '3.4s', delay: '0s', z: 1 },
          { src: LEAF(2), left: '-6%', top: '60%', width: '8%', anim: 'wx-blow', dur: '4.2s', delay: '1.1s', z: 1 },
          { src: LEAF(3), left: '-6%', top: '26%', width: '7%', anim: 'wx-blow', dur: '3.8s', delay: '2.2s', z: 1 },
        ],
      }
    default:
      return null // 'unknown' (or anything unmapped) → WeatherScene's built-in SVG fallback
  }
}
