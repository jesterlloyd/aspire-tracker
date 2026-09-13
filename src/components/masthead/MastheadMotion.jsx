// MASTHEAD-MOTION-1: subtle motion layered over the STILL city artwork, as the
// cheap alternative to shipping video frames.
//
// Nothing here is a media asset. Every effect is a positioned div plus a CSS
// keyframe, so the whole layer costs zero bytes of payload and zero video
// decode, on a card that renders on nearly every screen in the app and all
// four portals. That matters more than it looks: MastheadScenery keeps EVERY
// scene mounted at once and cross-fades them in CSS, so a video treatment
// would mean eight concurrent decoders per masthead.
//
// Scene gating is pure CSS. The host card carries .mast-scene-<scene>, so
// index.css decides which effects run, exactly the way the sky layers and the
// scene frames already work. This component never needs to know the scene.
//
// A city gets only the effects its own frame can carry, from CITY_MOTION.
// Nothing is defaulted: Los Angeles has no water and no bridge because its
// artwork has neither, and inventing either would put light on empty sky.
//
// MASTHEAD-HOLLYWOOD-2 added the daytime kinds: birds, haze, flare, a
// helicopter and rainfall, so a city can be alive in every scene and not only
// after dark. Each is gated to the scenes it belongs to in index.css.
//
// MASTHEAD-NEWYORK-2 added steam (rooftop plumes on measured roof edges), a
// second span (bridge may be a list), a ferry that sails either way in its
// own hull colour, and sceneShift: one measured vertical offset for a scene
// whose frame is the same drawing moved, applied to the anchored group.
//
// MASTHEAD-LASVEGAS-2 added neon (fast irregular flicker on measured
// saturated maxima, magenta or cyan), a wheel (a rim of cabin lights turning
// on a measured ring) and an orb (the Sphere's skin shifting hue).
//
// MASTHEAD-ATLANTA-2 added a police car: a span with police: true runs one
// more vehicle whose lights flip red and blue as it goes.
//
// MASTHEAD-SNOW-1 added snowfall (seeded flakes that fall and sway) and a
// swell (faint drifting crests on a measured patch of water).
import { CITY_MOTION, CARD_ASPECT } from '../../lib/mastheadCityScenes'
import { useSceneSweep } from '../../lib/mastheadSweep'
import { useSphereProjection, SPHERE_FADE_MS } from '../../lib/mastheadSphere'
import { useMastheadScene } from '../WeatherScene'

// Coprime-ish periods so a row of lights never visibly pulses in unison.
const PERIODS = [3.1, 4.3, 5.7, 3.7, 6.1, 4.9, 3.3, 5.3, 4.1, 6.7, 3.9, 5.9, 4.7]
const period = i => PERIODS[i % PERIODS.length]
const stagger = i => `${((i * 0.83) % 3.7).toFixed(2)}s`

// Traffic. Periods are deliberately not multiples of each other.
// MASTHEAD-STRIKE-1: where each bolt's tip sits INSIDE its own image, as a
// fraction of that image, measured off the alpha channel (the lowest strongly
// opaque pixel and the brightest column through it). bolt-2 is drawn mirrored,
// so its tip fraction is mirrored with it. The registry gives the point the
// lightning should hit; these turn that into a box for each shape.
const BOLT_RATIO = 256 / 414          // the assets' own aspect
const BOLTS = [
  { cls: 'a', tipX: 0.213, tipY: 0.805 },
  { cls: 'b', tipX: 1 - 0.891, tipY: 0.770 },
]

const CARS = [
  { dir: 'west', dur: 9, delay: 0 },
  { dir: 'west', dur: 14, delay: 5.5 },
  { dir: 'east', dur: 11, delay: 3 },
  { dir: 'east', dur: 17, delay: 8 },
]
// MASTHEAD-CAR-PACE-1 (2026-09-07, Owner: the Vegas traffic moved "at a speed
// of light"). A car animates `left` from one end of ITS SPAN to the other, so
// a fixed duration means the car's real speed is set by how wide that span is
// - and spans run from Los Angeles's 5% ramp to Las Vegas's 98% arterial. At
// one period for all of them Vegas's cars crossed the card NINETEEN TIMES
// faster than LA's (10.9 vs 0.56 percent of the card per second).
//
// The period now grows with the span. Not linearly: constant speed is the
// physically honest answer, but it would flick a car across LA's 5% ramp in
// two seconds and leave that road empty most of the time. The square root is
// the compromise - it leaves the short ramps exactly as they were tuned and
// pulls the long arterials down to something a distant freeway looks like.
// Las Vegas goes from 9s to 40s for a full crossing; nothing gets faster.
const CAR_REF_SPAN = 5
const carPace = w => Math.sqrt(Math.max(w, CAR_REF_SPAN) / CAR_REF_SPAN)

// A flock is a loose V. Offsets are percentages OF THE FLOCK BOX (a small
// sized span, see .mast-motion-flock), not of the card: a percentage inside a
// zero-size wrapper resolves to nothing and every bird lands on one point.
// The lead bird is at the right; the two arms trail left, up and down.
const FLOCK = [
  [100, 50], [74, 66], [50, 82], [26, 98],
  [72, 34], [48, 18], [24, 4], [0, 0],
]
const FLAP = [0.42, 0.47, 0.39, 0.51, 0.44, 0.49, 0.41, 0.46]

// Lens ghosts along the sun-to-centre line, as fractions of that line.
// t < 1 lands on the greeting side and is mostly masked; t > 1 lands on the
// hills, which is where a photograph puts them when the sun is at the edge.
const GHOSTS = [
  { t: 0.62, size: 3.2, alpha: 0.30 },
  { t: 0.86, size: 1.6, alpha: 0.42 },
  // The three past the centre are the ones actually seen (the two before it
  // sit in the greeting's fade), so they carry the weight of the effect.
  { t: 1.14, size: 5.4, alpha: 0.28 },
  { t: 1.38, size: 2.2, alpha: 0.48 },
  { t: 1.66, size: 7.8, alpha: 0.19 },
]

// Rain is individual streaks, not a repeating pattern: a repeating gradient
// puts every dash in the same phase and the eye reads a lattice, not weather.
// Positions and timings come from a seeded generator so the streaks are random
// to the eye but identical on every render (no churn, no hydration drift).
// Two depths: far streaks are short, faint and slower; near ones longer,
// brighter and faster, which is the parallax one sheet of rain lacks.
const DROPS = (() => {
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const out = []
  for (let i = 0; i < 54; i++) {
    const near = i % 3 === 0
    out.push({
      x: (rnd() * 118 - 6).toFixed(1),         // may start just outside either edge
      len: near ? 16 + rnd() * 12 : 9 + rnd() * 7,
      dur: near ? 0.62 + rnd() * 0.22 : 0.9 + rnd() * 0.35,
      dl: (rnd() * 1.4).toFixed(2),
      op: near ? 0.34 + rnd() * 0.2 : 0.16 + rnd() * 0.14,
    })
  }
  return out
})()

// Snow, like rain, is individual flakes from a seeded generator. Slower and
// wider apart than the rain, each with its own sway period and amplitude.
// Two depths again: near flakes larger and quicker, far ones small and slow.
const SNOWFLAKES = (() => {
  let seed = 19
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const out = []
  for (let i = 0; i < 64; i++) {
    const near = i % 3 === 0
    out.push({
      x: (rnd() * 112 - 6).toFixed(1),
      size: near ? 3 + rnd() * 2 : 1.6 + rnd() * 1.2,
      dur: near ? 6.5 + rnd() * 2.5 : 9 + rnd() * 4,
      dl: (rnd() * 9).toFixed(2),
      sw: (2.2 + rnd() * 2.4).toFixed(2),
      sway: (8 + rnd() * 16).toFixed(0),
      op: near ? 0.75 + rnd() * 0.2 : 0.4 + rnd() * 0.25,
    })
  }
  return out
})()

// Fraction of a crossing's cycle during which it is on screen. The keyframes
// in index.css are written against this number, so it is a constant here and
// not a per-city knob: a per-city value would silently disagree with the CSS.
const VISIBLE = 0.41
// MASTHEAD-PLANE-RELAY-1: the on-screen share of a RELAY lane's cycle, written
// against @keyframes mast-fly-relay (gone by 23.5%). Under a quarter, so four
// lanes offset by a quarter each never put two aircraft in the sky at once.
const RELAY_VISIBLE = 0.235
// MASTHEAD-PLANE-DEPTH-1: sizes for the second, third and fourth lanes, as a
// share of the first. Distinct, so a four-lane sky holds four distances.
const PLANE_DEPTHS = [0.62, 0.8, 0.5]

// MASTHEAD-STARS-1: a star field is not a row of lights. Lights breathe on
// coprime periods so a street never pulses in unison; stars want the same
// treatment but slower and wider apart, and they want SIZES - a sky where
// every point is the same magnitude reads as a grid, not as a sky.
const STAR_PERIODS = [3.4, 5.2, 4.1, 6.3, 3.8, 5.7, 4.6, 6.9, 3.2, 5.0, 4.4, 6.1]
const STAR_SIZES = [2, 1.6, 2.6, 1.8, 2.2, 1.6, 3.2, 2, 1.8, 2.4, 1.6, 2.8]
const starPeriod = i => STAR_PERIODS[i % STAR_PERIODS.length]
const starSize = i => STAR_SIZES[i % STAR_SIZES.length]

// Fraction of the comet's cycle during which it is falling. The keyframes in
// index.css are written against this number, exactly as VISIBLE is, so it is a
// constant here and not a per-city knob. A shooting star you can watch is not
// a shooting star: at 3.2% a 1.1s fall means one every 34 seconds.
const COMET_VISIBLE = 0.032

function crossing(c) {
  return {
    top: `${c.y}%`,
    '--from': `${c.from}%`,
    '--to': `${c.to}%`,
    // The flight is a fraction of a much longer cycle, so the sky is empty
    // most of the time. One aircraft every 90s reads as a city; a continuous
    // stream reads as a screensaver.
    '--cycle': `${(c.flight / VISIBLE).toFixed(1)}s`,
  }
}

export default function MastheadMotion({ city }) {
  // MASTHEAD-CLOUDY-1: the one weather fact this component reads. The scene
  // class says which frame is up; this says whether anything is falling, so
  // a dry overcast night keeps its cloudy frame without rain or lightning.
  const { wet } = useMastheadScene()
  // MASTHEAD-TIMELAPSE-1: the motion layer sits out a sweep. Its gates are on
  // the host's scene class, which a sweep deliberately does NOT change, so the
  // lights and birds would otherwise carry on at the destination scene while
  // the artwork under them ran through the whole day - the one arrangement
  // that looks broken rather than either still or moving.
  // MASTHEAD-SWEEP-NATURAL-1: the motion comes back DURING the final dissolve
  // rather than after it. It used to wait for the sweep to end, so the card
  // arrived, paused, and then the lights came on - two events where there
  // should be one. The lights each carry their own delay, so they surface at
  // different points of their own breath rather than together.
  // MASTHEAD-SPHERE-CYCLE-1: the face belongs to the PROJECTION, not to the
  // scene. The Owner asked for the emoji to come along when the Sphere shows
  // its night projection, and the other half of that is that it must LEAVE when
  // the Sphere shows something else on a night card - a face drawn on the Earth
  // or on the eye would be two pictures on one screen.
  const sphereProjection = useSphereProjection()
  const sweepState = useSceneSweep()
  const sweeping = !!sweepState && !sweepState.last
  const m = CITY_MOTION[city]
  if (!m) return null
  const { lights, beacons, beaconTone, aircraft, water, bridge, beam,
    birds, haze, hazeTone, flare, helicopter, rainfall, ferry, ferryTone, glints, steam,
    neon, wheel, orb, emoji, torch, clock, facade, strike, snowfall, swell, surf, rainbow, cable,
    stars, comet, butterflies, screen, fountain, searchlights, tablecloth, sceneOverrides, sceneShift } = m
  const spans = Array.isArray(bridge) ? bridge : bridge ? [bridge] : []
  // MASTHEAD-PLANES-1 (Owner, of Porter Ranch: "i see a lot of planes at
  // night"). A city may name SEVERAL lanes, the way it may name several bridge
  // spans. One aircraft reads as a city; four reads as a flight path, which is
  // what living under one actually looks like.
  const planes = Array.isArray(aircraft) ? aircraft : aircraft ? [aircraft] : []
  // MASTHEAD-PLANE-RELAY-1 (Owner: "not too many planes at the same time").
  // Three or more lanes share ONE cycle, sized so the slowest lane keeps its
  // flight, and each starts an equal share of it after the last: one aircraft
  // crosses at a time, and a new one appears as the last leaves.
  const relay = planes.length >= 3
  const relayCycle = relay ? Math.max(...planes.map(p => p.flight)) / RELAY_VISIBLE : 0
  // MASTHEAD-SCENE-SHIFT: everything measured against the frame (points, decks,
  // beam, steam) sits in one anchored box, and a scene whose frame is the same
  // drawing moved by a measured amount shifts that box, by CSS on the scene
  // class. Crossings, weather and the flare are not anchored to anything.
  const shiftVars = Object.fromEntries(Object.entries(sceneShift || {}).map(([scene, y]) => [`--shift-${scene}`, `${y}%`]))
  // MASTHEAD-SCENE-OVERRIDES: a scene whose frame is a different drawing gets
  // its own measured point sets. The default set hides in that scene and the
  // override shows, both by CSS on the host's scene class.
  const overrides = sceneOverrides || {}
  const defaultSetClass = ['mast-motion-set', ...Object.keys(overrides).map(s => `mast-motion-not-${s}`)].join(' ')
  const renderLights = (pts, tag) => pts?.map(([x, y], i) => (
    <span key={`lt-${tag}-${x}-${y}`} className="mast-motion-light"
      style={{ left: `${x}%`, top: `${y}%`, '--d': `${period(i)}s`, '--dl': stagger(i) }} />
  ))
  // A beacon may name a variant as its third element, the way a neon does its
  // tone. 'glow' is the landmark lamp: bigger, and breathing rather than
  // blinking, because an aviation flash spends most of its cycle dark and the
  // one light that names a building has to be lit while you look at it.
  const renderBeacons = (pts, tag) => pts?.map(([x, y, variant], i) => (
    <span key={`bc-${tag}-${x}-${y}`}
      className={`${beaconClass}${variant === 'glow' ? ' mast-motion-beacon-glow' : ''}`}
      style={{ left: `${x}%`, top: `${y}%`, '--dl': `${(i * 0.9).toFixed(1)}s` }} />
  ))
  // MASTHEAD-CHICAGO-1: where a bridgehouse stands in front of the deck, the
  // lane is masked out across it, so traffic passes behind the stone. Each
  // [from, to] is a card x range; the stops are that range along the rail.
  const laneMask = span => {
    const at = gx => (((gx - span.deck.x) / span.deck.w) * 100).toFixed(2)
    const stops = ['#000 0%']
    for (const [a, b] of span.behind) {
      stops.push(`#000 ${at(a)}%`, `transparent ${at(a)}%`, `transparent ${at(b)}%`, `#000 ${at(b)}%`)
    }
    stops.push('#000 100%')
    const g = `linear-gradient(90deg, ${stops.join(', ')})`
    return { WebkitMaskImage: g, maskImage: g }
  }
  const renderTraffic = (span, si) => (
    <>
      {/* Two each way on periods that do not divide into one another, so
          the roadway never empties and never falls into lockstep. */}
      {CARS.map(c => (
        <span key={`${c.dir}-${c.dur}`}
          className={`mast-motion-car mast-motion-car-${c.dir}`}
          style={{
            '--dur': `${(c.dur * carPace(span.deck.w) + si * 1.7).toFixed(1)}s`,
            '--dl': `${c.delay + si * 2.3}s`,
          }} />
      ))}
      {/* One police car on a long period, so it is an event, not traffic. */}
      {span.police && (
        <span className="mast-motion-car mast-motion-car-west mast-motion-car-police"
          style={{ '--dur': `${(23 * carPace(span.deck.w)).toFixed(1)}s`, '--dl': '11s' }} />
      )}
    </>
  )
  const renderWater = (pts, tag) => pts?.map(([x, y], i) => (
    <span key={`wt-${tag}-${x}-${y}`} className="mast-motion-water"
      style={{ left: `${x}%`, top: `${y}%`, '--d': `${period(i) * 1.4}s`, '--dl': stagger(i) }} />
  ))
  const beaconClass = `mast-motion-beacon${beaconTone === 'red' ? ' mast-motion-beacon-red' : ''}`
  // MASTHEAD-SANFRANCISCO-2: a sun off-frame RIGHT. The flare geometry is
  // written for a sun at left, so the layer is mirrored and the sun's x is
  // reflected before the ghosts are placed; everything else is unchanged.
  const flareRight = !!flare && flare.x > 50
  const flareX = flareRight ? 100 - flare.x : flare?.x
  return (
    <div
      className={`mast-motion${wet ? ' mast-motion-wet' : ''}${sweeping ? ' mast-motion-hushed' : ''}`}
      // Only while a projection is actually up: with the cycle off (reduced
      // motion, or a QA override of 0) this is absent and the face keeps its
      // original scene gate untouched.
      data-sphere-face={screen && sphereProjection ? (sphereProjection === 'night' ? '1' : '0') : undefined}
      // One source for the fade: the face's entry is delayed by exactly the
      // time the projection takes to arrive, so it can never appear on a
      // sphere that is still turning yellow.
      style={screen ? { '--sphere-fade': `${(SPHERE_FADE_MS / 1000).toFixed(2)}s` } : undefined}
      aria-hidden
    >
      {/* MASTHEAD-BUTTERFLY-1 (Owner: "maybe butterflies?"). Each one works a
          MEASURED flowering canopy and stays there - the only thing in this
          layer that moves without crossing the card. The wander is on the
          wrapper and the wing-beat on the child, because one element cannot
          animate transform twice. Daytime only. */}
      {butterflies?.map(([x, y, pale], i) => (
        <span key={`bf-${x}-${y}`}
          className={`mast-motion-fly${pale ? ' mast-motion-fly-pale' : ''}`}
          style={{
            left: `${x}%`, top: `${y}%`,
            '--dx': `${(7 + (i % 4) * 3)}px`,
            '--dy': `${(4 + (i % 3) * 2)}px`,
            '--d': `${(11 + (i % 5) * 2.3).toFixed(1)}s`,
            '--fd': `${(0.26 + (i % 4) * 0.05).toFixed(2)}s`,
            '--dl': `${(i * 0.9).toFixed(1)}s`,
          }}>
          <span className="mast-motion-fly-wing" />
        </span>
      ))}

      {/* MASTHEAD-STARS-1 (Owner). FIRST, so everything else on the card is in
          front of them: a star is the furthest thing in the frame, and a plane
          or a bird that passed BEHIND one would be the tell. They sit outside
          the anchored box on purpose - the box exists to carry a scene's
          vertical shift, and the only scene stars appear on is `night`, which
          is never shifted. Each position was measured to be open sky on this
          city's own night frame; the CSS gates them to that frame alone. */}
      {stars?.map(([x, y], i) => (
        <span key={`st-${x}-${y}`} className="mast-motion-star"
          style={{
            left: `${x}%`, top: `${y}%`,
            '--sz': `${starSize(i)}px`,
            '--d': `${starPeriod(i)}s`,
            '--dl': `${((i * 1.27) % 5.3).toFixed(2)}s`,
          }} />
      ))}

      {/* The falling star. The container IS the measured path: laid along the
          travel and rotated to the fall, with the streak sliding down it. The
          angle is taken in PIXEL space (a vertical percentage is CARD_ASPECT
          times fewer pixels than a horizontal one), which is the same
          correction the bridge deck and the surf crest make. */}
      {comet && (
        <span className="mast-motion-comet" style={{
          '--cx': `${comet.x}%`,
          '--cy': `${comet.y}%`,
          '--dist': `${Math.hypot(comet.run, comet.drop / CARD_ASPECT).toFixed(3)}%`,
          '--angle': `${(Math.atan2(comet.drop / CARD_ASPECT, comet.run) * 180 / Math.PI).toFixed(3)}deg`,
          '--cycle': `${(comet.flight / COMET_VISIBLE).toFixed(1)}s`,
          '--dl': `${comet.delay ?? 0}s`,
        }}>
          <span className="mast-motion-comet-streak" />
        </span>
      )}

      {/* Two bolts on different periods, so the storm does not tick like a
          metronome. Both sit right of centre: a flash over the greeting would
          fight the text, the same contract the artwork's left fade honours. */}
      <div className="mast-motion-bolt mast-motion-bolt-a" />
      <div className="mast-motion-bolt mast-motion-bolt-b" />

      {/* MASTHEAD-STRIKE-1: the FORK, over the bolts' sky flash. Two shapes on
          different periods so the storm never repeats itself, drawn from the
          assets under public/masthead/fx. Rendered only when the weather is
          WET - an <img> loads whether or not CSS has hidden it, and every dry
          scene should still cost the motion layer nothing. */}
      {strike && wet && BOLTS.map(bolt => {
        // The registry says where the TIP lands. Each shape's tip sits at a
        // different place inside its own image, so the box is derived from it
        // rather than declared - otherwise "strike the tower" means "put a
        // rectangle near the tower" and the fork lands beside it.
        const h = strike.w * (BOLT_RATIO * CARD_ASPECT)
        return (
          <span key={bolt.cls} className={`mast-motion-strike mast-motion-strike-${bolt.cls}`}
            style={{
              left: `${(strike.x + (0.5 - bolt.tipX) * strike.w).toFixed(2)}%`,
              top: `${(strike.y - bolt.tipY * h).toFixed(2)}%`,
              width: `${strike.w}%`,
            }} />
        )
      })}

      {/* Rain sits UNDER the lights so a lit window still reads through it. Two
          layers at different densities and speeds give the parallax that one
          layer of streaks does not have. */}
      {rainfall && (
        <div className="mast-motion-rain">
          {DROPS.map((d, i) => (
            <span key={i} className="mast-motion-drop"
              style={{ left: `${d.x}%`, height: `${d.len.toFixed(0)}px`, opacity: d.op.toFixed(2),
                '--dur': `${d.dur.toFixed(2)}s`, '--dl': `${d.dl}s` }} />
          ))}
        </div>
      )}

      {/* Snow sits where the rain does, under the lights. */}
      {snowfall && (
        <div className="mast-motion-snow">
          {SNOWFLAKES.map((f, i) => (
            <span key={i} className="mast-motion-flake"
              style={{ left: `${f.x}%`, width: `${f.size.toFixed(1)}px`, height: `${f.size.toFixed(1)}px`, opacity: f.op.toFixed(2),
                '--dur': `${f.dur.toFixed(2)}s`, '--dl': `${f.dl}s`, '--sw': `${f.sw}s`, '--sway': `${f.sway}px` }} />
          ))}
        </div>
      )}

      {/* MASTHEAD-RAINBOW-1: one arc, on the half of the sky opposite the sun.
          It is an EVENT, not a texture: it fades up, holds, and is gone for
          most of its cycle, the way a trade shower's rainbow actually behaves.
          The box is the arc's bounding box and the arc is drawn from its
          bottom centre, so x/y/w/h place the apex and both feet at once. */}
      {/* MASTHEAD-TABLECLOTH-1: the cloud the south-easter pours over Table
          Mountain, placed where the pack's own Cloudy and Rain frames paint it. */}
      {tablecloth && (
        <span className="mast-motion-tablecloth"
          style={{ left: `${tablecloth.x}%`, top: `${tablecloth.y}%`, width: `${tablecloth.w}%`, height: `${tablecloth.h}%` }} />
      )}

      {rainbow && (
        <span className="mast-motion-rainbow"
          style={{ left: `${rainbow.x}%`, top: `${rainbow.y}%`, width: `${rainbow.w}%`, height: `${rainbow.h}%` }} />
      )}

      {/* MASTHEAD-FOUNTAIN-1 (Owner: the fountain should "look like it's
          flowing/alive"). Each jet was measured off the night frame, where the
          water is lit and its silhouette is crisp: x by peak-finding the top
          edge, height from that peak down to the plaza at y 77. They grow from
          the base and breathe on periods that never coincide. */}
      {fountain?.jets?.map(([x, h], i) => (
        <span key={`jt-${x}`} className="mast-motion-jet"
          style={{
            left: `${x}%`,
            top: `${(fountain.y - h).toFixed(2)}%`,
            height: `${h}%`,
            '--d': `${(2.3 + (i % 5) * 0.41).toFixed(2)}s`,
            '--dl': `${((i * 0.37) % 2.6).toFixed(2)}s`,
          }} />
      ))}

      {/* A measured patch of water that carries a light chop. */}
      {swell && (
        <span className="mast-motion-swell"
          style={{ left: `${swell.x}%`, top: `${swell.y}%`, width: `${swell.w}%`, height: `${swell.height}%` }} />
      )}

      {haze && (
        <div className={`mast-motion-haze${hazeTone === 'fog' ? ' mast-motion-haze-fog' : ''}`}
          style={{ top: `${haze.y}%`, height: `${haze.height}%` }} />
      )}

      <div className="mast-motion-anchored" style={shiftVars}>
      {/* MASTHEAD-SURF-1: the break along a beach. Each crest is a soft bar
          laid on the measured waterline and rotated to the slope of the shore
          under it, so a curved bay's foam follows the sand instead of cutting
          across it. Card percentages are not square (the card is CARD_ASPECT:1), so
          the rise is divided through that before the angle is taken - the same
          correction the bridge deck makes. Delays run along the beach, which
          is what makes a set of waves read as arriving rather than blinking. */}
      {surf?.map(([x, y, w, rise], i) => (
        <span key={`sf-${x}-${y}`} className="mast-motion-surf"
          style={{
            left: `${x}%`, top: `${y}%`, width: `${w}%`,
            '--angle': `${(Math.atan((rise / CARD_ASPECT) / w) * 180 / Math.PI).toFixed(3)}deg`,
            '--dl': `${(i * 0.85).toFixed(2)}s`,
          }} />
      ))}
      {/* Aviation beacons blink, they do not breathe. Keeping them on a
          separate keyframe from the shimmer is what makes a tower read as a
          tower rather than as one more window. */}
      <span className={defaultSetClass}>
        {renderLights(lights, 'd')}
        {renderBeacons(beacons, 'd')}
        {renderWater(water, 'd')}
      </span>
      {Object.entries(overrides).map(([scene, o]) => (
        <span key={scene} className={`mast-motion-set mast-motion-only-${scene}`}>
          {renderLights(o.lights, scene)}
          {renderBeacons(o.beacons, scene)}
          {renderWater(o.water, scene)}
        </span>
      ))}

      {/* One landmark shaft, standing on the apex that projects it. Anchored at
          the bottom and grown upward, so it reads as light leaving the building
          rather than a bar dropped onto the sky. */}
      {beam && (
        <span className="mast-motion-beam"
          style={{ left: `${beam.x}%`, top: `${beam.y}%`, width: `${beam.width}%`, height: `${beam.height}%` }} />
      )}

      {/* MASTHEAD-SEARCHLIGHT-1: a shaft planted on a measured crown that
          swings across the sky. The wrapper turns about its own bottom centre
          (the lamp); the child is the light. Each one is phased a fraction of
          its own period off the last, and the periods differ, so two lights
          on one skyline cross, part and cross again instead of swinging as a
          pair. */}
      {searchlights?.map(({ x, y, reach, sweep, period }, i) => (
        <span key={`sl-${x}-${y}`} className="mast-motion-searchlight"
          style={{
            left: `${x}%`, top: `${y}%`, height: `${reach}%`,
            '--sweep': `${sweep}deg`, '--d': `${period}s`,
            '--dl': `${(-i * period * 0.61).toFixed(2)}s`,
          }}>
          <span className="mast-motion-searchlight-beam" />
        </span>
      ))}

      {/* Neon flickers: a fast, irregular step pattern, nothing like the slow
          breath of the shimmer, on the Strip's saturated signage. */}
      {neon?.map(([x, y, tone], i) => (
        <span key={`ne-${x}-${y}`} className={`mast-motion-neon${tone === 'cyan' ? ' mast-motion-neon-cyan' : ''}`}
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${(2.3 + (period(i) % 2.1)).toFixed(2)}s`, '--dl': stagger(i) }} />
      ))}

      {/* A wheel is a rim of cabin lights turning slowly. The box is square
          in pixels (width as a share of the card width, aspect-ratio 1), so
          the ring stays round on a card that is not. */}
      {/* MASTHEAD-FACADE-1 (Owner: "these are dramatic buildings and I think
          they deserve this feel"). A floodlit building, as a whole. Every
          other light kind on these cards is a POINT - a window, a lamp, a
          beacon - and a floodlit facade is not a point, it is a wall with
          light thrown across it. So this is a soft warm ellipse over the
          measured mass of the building, breathing slowly, drawn UNDER the
          window shimmer that already sits on it. Night only: floodlights come
          on at dusk, and by day a warm blob over a building is a smudge. */}
      {facade?.map(([x, y, w, h, tone], i) => (
        <span key={`fa-${x}-${y}`}
          className={`mast-motion-facade${tone === 'cool' ? ' mast-motion-facade-cool' : ''}`}
          style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, '--dl': `${(i * 1.7).toFixed(1)}s` }} />
      ))}

      {/* MASTHEAD-CLOCK-1 (Owner: Big Ben is the other landmark on this card).
          A lit clock face is not a window and not a beacon: it does not
          twinkle and it does not blink, it just burns, all day and all night,
          and the only thing it does is breathe a little. Each face carries its
          own diameter because the two visible on the tower are at different
          angles to us - the near one measures 11px across, the far one 9. */}
      {clock?.map(([x, y, d]) => (
        <span key={`ck-${x}-${y}`} className="mast-motion-clock"
          style={{ left: `${x}%`, top: `${y}%`, width: `${d}%` }} />
      ))}

      {/* MASTHEAD-WHEEL-2: a wheel is measured as an ELLIPSE, because both of
          the ones this registry carries are drawn as one - London's Eye is
          1.36 times taller than it is wide in pixels. The box stays SQUARE and
          the ellipse comes from a vertical scale on the parent, so the child
          that spins is spinning a circle: scale a rotating ellipse and it
          tumbles, rotate inside a scaled box and it turns. --wr is that
          scale, the wheel's pixel height over its pixel width. */}
      {wheel && (
        <span className="mast-motion-wheel"
          style={{
            left: `${wheel.x}%`, top: `${wheel.y}%`, width: `${wheel.d}%`,
            '--wr': (wheel.h ? wheel.h / (wheel.d * CARD_ASPECT) : 1).toFixed(4),
          }}>
          <span className="mast-motion-wheel-turn">
          {/* The rim carries the capsule lights; the cabin is ONE of them, lit
              brighter, and it is the whole reason the wheel reads as turning.
              A ring of evenly spaced identical lights has 28-fold rotational
              symmetry, so rotating it is very nearly a no-op to the eye: there
              is no feature to follow. The cabin is that feature. Both ride the
              same rotating box, so they cannot drift apart. */}
            <span className="mast-motion-wheel-rim" />
            <span className="mast-motion-wheel-cabin" />
          </span>
        </span>
      )}

      {/* The orb's skin drifts through the hues, masked off below the line
          where the skyline in front of it begins. */}
      {/* MASTHEAD-TORCH-1: a flame, not a window. It breathes deeper and far
          slower than `lights` do, and it burns in every scene rather than
          only after dark, because the torch is lit by day too. */}
      {torch && (
        <span className="mast-motion-torch" style={{ left: `${torch.x}%`, top: `${torch.y}%` }} />
      )}

      {orb && (
        <span className="mast-motion-orb"
          style={{ left: `${orb.x}%`, top: `${orb.y}%`, width: `${orb.d}%`, '--cut': `${orb.cut}%` }} />
      )}

      {/* MASTHEAD-SPHERE-FACE-1: the Sphere is a SCREEN, so the one landmark on
          any of these cards that can honestly be given an expression. The
          Owner left it blank in emoji yellow for exactly this. Geometry is the
          orb's disc, and every feature is a percentage OF THAT DISC, so the
          face cannot drift off the sphere when the card resizes. The eyes
          wander on a long loop with real pauses - a pupil that slides
          continuously reads as a machine, one that darts and then holds reads
          as something looking around. */}
      {emoji && (
        <span className="mast-motion-emoji"
          style={{ left: `${emoji.x}%`, top: `${emoji.y}%`, width: `${emoji.d}%` }}>
          <span className="mast-motion-emoji-brow mast-motion-emoji-brow-l" />
          <span className="mast-motion-emoji-brow mast-motion-emoji-brow-r" />
          <span className="mast-motion-emoji-eye mast-motion-emoji-eye-l">
            <span className="mast-motion-emoji-pupil" />
          </span>
          <span className="mast-motion-emoji-eye mast-motion-emoji-eye-r">
            <span className="mast-motion-emoji-pupil" />
          </span>
          <span className="mast-motion-emoji-mouth" />
        </span>
      )}

      {/* Steam off a rooftop: three puffs per stack, a third of a cycle apart
          so the plume never empties, each rising, spreading and thinning from
          the measured roof edge. */}
      {steam?.map(([x, y], i) => [0, 1 / 3, 2 / 3].map(phase => (
        <span key={`st-${x}-${y}-${phase}`} className="mast-motion-steam"
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${(6.2 + period(i)).toFixed(1)}s`,
            '--dl': `${(phase * (6.2 + period(i)) + i * 1.3).toFixed(2)}s` }} />
      )))}

      {/* Sun glitter: each speck sits on a measured pale maximum of the water
          and twinkles on its own short period, stretching sideways as it
          brightens, which is what a facet of swell does as it turns. */}
      {glints?.map(([x, y], i) => (
        <span key={`gl-${x}-${y}`} className="mast-motion-glint"
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${(period(i) * 0.45).toFixed(2)}s`, '--dl': stagger(i) }} />
      ))}

      {/* MASTHEAD-CABLE-1: a cableway. The rail is the chord between the two
          stations, rotated through the same aspect correction the bridge deck
          uses, and one cabin rides it from end to end and back - `alternate`
          gives the dwell at each station for free, which is what a cable car
          actually does. The cabin hangs BELOW the wire on a short arm, because
          that is where a gondola is relative to the cable carrying it. */}
      {cable && (
        <span className="mast-motion-cable"
          style={{
            left: `${cable.x}%`, top: `${cable.y}%`,
            // The rail's WIDTH is the chord's length, not its horizontal run.
            // Rotating about the left end shortens the run by cos(angle), and
            // at a cableway's 34 degrees that is 17%: declaring w=8 landed the
            // cabin at x 89.6 instead of the lower station at 91, and 5% of
            // the card short of it vertically. The bridge deck has the same
            // geometry but runs at 4 degrees, where the correction is 0.2%.
            width: `${Math.hypot(cable.w, cable.rise / CARD_ASPECT).toFixed(3)}%`,
            '--angle': `${(Math.atan((cable.rise / CARD_ASPECT) / cable.w) * 180 / Math.PI).toFixed(3)}deg`,
            '--cycle': `${cable.flight}s`,
          }}>
          <span className="mast-motion-cabin" />
        </span>
      )}

      {spans.map((span, si) => (
        <span key={`span-${si}`} className="mast-motion-set">
          {span.lights.map(([x, y]) => (
            <span key={`br-${x}-${y}`} className="mast-motion-decklight"
              style={{
                left: `${x}%`, top: `${y}%`,
                // Delay rises with position along the span, so the shimmer
                // travels the deck slowly instead of chasing like a marquee.
                '--dl': `${(((x - span.deck.x) / span.deck.w) * 4.2).toFixed(2)}s`,
              }} />
          ))}
          {/* The deck as a rotated rail. Traffic rides it rather than a flat
              row, which matters: a span rises several percent of the card
              across its length, pixels of drift off the roadway at the ends. */}
          <span
            className="mast-motion-deck"
            style={{
              left: `${span.deck.x}%`, top: `${span.deck.y}%`,
              width: `${span.deck.w}%`,
              // Card percentages are not square: the card is CARD_ASPECT:1, so a 1%
              // rise is CARD_ASPECT times smaller in pixels than a 1% run. The angle has to
              // be computed through that or the rail tilts far too steeply.
              '--angle': `${(Math.atan((span.deck.rise / CARD_ASPECT) / span.deck.w) * 180 / Math.PI).toFixed(3)}deg`,
            }}
          >
            {span.behind
              ? <span className="mast-motion-deck-lane" style={laneMask(span)}>{renderTraffic(span, si)}</span>
              : renderTraffic(span, si)}
          </span>
        </span>
      ))}
      </div>

      {planes.map((p, i) => (
        <span key={`ac-${p.y}-${p.from}`}
          className={`mast-motion-plane${p.from > p.to ? ' mast-motion-plane-west' : ''}${relay ? ' mast-motion-plane-relay' : ''}${i ? ' mast-motion-plane-far' : ''}`}
          style={{
            ...crossing(p),
            // MASTHEAD-PLANE-DEPTH-1: the first lane is the near one; each
            // later lane is smaller, on a short table so no two are alike.
            ...(i ? { '--depth': PLANE_DEPTHS[(i - 1) % PLANE_DEPTHS.length] } : null),
            ...(relay
              ? { '--cycle': `${relayCycle.toFixed(1)}s`, '--dl': `${((i * relayCycle) / planes.length).toFixed(1)}s` }
              : { '--dl': `${(i * 6.7).toFixed(1)}s` }),
          }}>
          {/* MASTHEAD-PLANE-SHAPE-1: a silhouette, with the light on its belly. */}
          <span className="mast-motion-plane-body" />
          <span className="mast-motion-plane-dot" />
        </span>
      ))}

      {/* Low, slow, and strobing. A helicopter differs from an aircraft in
          exactly those three things, and the eye knows it from a long way off. */}
      {helicopter && (
        <span className={`mast-motion-heli${helicopter.from > helicopter.to ? ' mast-motion-heli-west' : ''}`}
          style={crossing(helicopter)}>
          <span className="mast-motion-heli-body" />
          <span className="mast-motion-heli-strobe" />
        </span>
      )}

      {birds && (
        <span className="mast-motion-flock" style={crossing(birds)}>
          {FLOCK.slice(0, birds.count ?? FLOCK.length).map(([dx, dy], i) => (
            <span key={i} className="mast-motion-bird"
              style={{ left: `${dx}%`, top: `${dy}%`, '--flap': `${FLAP[i % FLAP.length]}s`,
                '--bob': `${(2.3 + (i % 3) * 0.6).toFixed(1)}s` }} />
          ))}
        </span>
      )}

      {/* Ghosts are placed on the line from the sun through the card's centre,
          which is the one thing about a lens flare that is not decorative: it
          is where the optics put them. The streak is anamorphic, horizontal
          from the sun, and fades with distance from it. */}
      {flare && (
        <span className={`mast-motion-flare${flareRight ? ' mast-motion-flare-right' : ''}`}>
          <span className="mast-motion-flare-streak" style={{ top: `${flare.y}%` }} />
          {GHOSTS.map(({ t, size, alpha }) => (
            <span key={t} className="mast-motion-ghost"
              style={{
                left: `${(flareX + (50 - flareX) * t).toFixed(1)}%`,
                top: `${(flare.y + (50 - flare.y) * t).toFixed(1)}%`,
                width: `${size}%`,
                '--ghost-alpha': alpha,
                '--dl': `${(t * 3.1).toFixed(2)}s`,
              }} />
          ))}
        </span>
      )}

      {/* A ferry: a dark hull with a white wake by day, two warm lights by
          night. It runs its whole crossing on screen (no long empty gap like
          the aircraft), because a ferry route is never empty for long. One
          sailing left is the same ferry mirrored, so its wake still trails. */}
      {ferry && (
        <span className={`mast-motion-ferry${ferry.from > ferry.to ? ' mast-motion-ferry-west' : ''}${ferryTone ? ` mast-motion-ferry-${ferryTone}` : ''}`}
          style={{ top: `${ferry.y}%`, '--from': `${ferry.from}%`, '--to': `${ferry.to}%`, '--cycle': `${ferry.flight}s` }}>
          <span className="mast-motion-ferry-boat">
            <span className="mast-motion-ferry-wake" />
            <span className="mast-motion-ferry-hull" />
            <span className="mast-motion-ferry-lamp" />
          </span>
        </span>
      )}
    </div>
  )
}
