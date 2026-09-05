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
import { CITY_MOTION } from '../../lib/mastheadCityScenes'

// Coprime-ish periods so a row of lights never visibly pulses in unison.
const PERIODS = [3.1, 4.3, 5.7, 3.7, 6.1, 4.9, 3.3, 5.3, 4.1, 6.7, 3.9, 5.9, 4.7]
const period = i => PERIODS[i % PERIODS.length]
const stagger = i => `${((i * 0.83) % 3.7).toFixed(2)}s`

// Traffic. Periods are deliberately not multiples of each other.
const CARS = [
  { dir: 'west', dur: 9, delay: 0 },
  { dir: 'west', dur: 14, delay: 5.5 },
  { dir: 'east', dur: 11, delay: 3 },
  { dir: 'east', dur: 17, delay: 8 },
]

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

// Fraction of a crossing's cycle during which it is on screen. The keyframes
// in index.css are written against this number, so it is a constant here and
// not a per-city knob: a per-city value would silently disagree with the CSS.
const VISIBLE = 0.41

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
  const m = CITY_MOTION[city]
  if (!m) return null
  const { lights, beacons, beaconTone, aircraft, water, bridge, beam,
    birds, haze, hazeTone, flare, helicopter, rainfall, ferry, glints } = m
  const beaconClass = `mast-motion-beacon${beaconTone === 'red' ? ' mast-motion-beacon-red' : ''}`
  // MASTHEAD-SANFRANCISCO-2: a sun off-frame RIGHT. The flare geometry is
  // written for a sun at left, so the layer is mirrored and the sun's x is
  // reflected before the ghosts are placed; everything else is unchanged.
  const flareRight = !!flare && flare.x > 50
  const flareX = flareRight ? 100 - flare.x : flare?.x
  return (
    <div className="mast-motion" aria-hidden>
      {/* Two bolts on different periods, so the storm does not tick like a
          metronome. Both sit right of centre: a flash over the greeting would
          fight the text, the same contract the artwork's left fade honours. */}
      <div className="mast-motion-bolt mast-motion-bolt-a" />
      <div className="mast-motion-bolt mast-motion-bolt-b" />

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

      {haze && (
        <div className={`mast-motion-haze${hazeTone === 'fog' ? ' mast-motion-haze-fog' : ''}`}
          style={{ top: `${haze.y}%`, height: `${haze.height}%` }} />
      )}

      {lights?.map(([x, y], i) => (
        <span key={`lt-${x}-${y}`} className="mast-motion-light"
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${period(i)}s`, '--dl': stagger(i) }} />
      ))}

      {/* Aviation beacons blink, they do not breathe. Keeping them on a
          separate keyframe from the shimmer is what makes a tower read as a
          tower rather than as one more window. */}
      {beacons?.map(([x, y], i) => (
        <span key={`bc-${x}-${y}`} className={beaconClass}
          style={{ left: `${x}%`, top: `${y}%`, '--dl': `${(i * 0.9).toFixed(1)}s` }} />
      ))}

      {aircraft && (
        <span className="mast-motion-plane" style={crossing(aircraft)}>
          <span className="mast-motion-plane-dot" />
        </span>
      )}

      {/* Low, slow, and strobing. A helicopter differs from an aircraft in
          exactly those three things, and the eye knows it from a long way off. */}
      {helicopter && (
        <span className="mast-motion-heli" style={crossing(helicopter)}>
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

      {/* One landmark shaft, standing on the apex that projects it. Anchored at
          the bottom and grown upward, so it reads as light leaving the building
          rather than a bar dropped onto the sky. */}
      {beam && (
        <span className="mast-motion-beam"
          style={{ left: `${beam.x}%`, top: `${beam.y}%`, width: `${beam.width}%`, height: `${beam.height}%` }} />
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
          the aircraft), because a ferry route is never empty for long. */}
      {ferry && (
        <span className="mast-motion-ferry"
          style={{ top: `${ferry.y}%`, '--from': `${ferry.from}%`, '--to': `${ferry.to}%`, '--cycle': `${ferry.flight}s` }}>
          <span className="mast-motion-ferry-wake" />
          <span className="mast-motion-ferry-hull" />
          <span className="mast-motion-ferry-lamp" />
        </span>
      )}

      {/* Sun glitter: each speck sits on a measured pale maximum of the water
          and twinkles on its own short period, stretching sideways as it
          brightens, which is what a facet of swell does as it turns. */}
      {glints?.map(([x, y], i) => (
        <span key={`gl-${x}-${y}`} className="mast-motion-glint"
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${(period(i) * 0.45).toFixed(2)}s`, '--dl': stagger(i) }} />
      ))}

      {water?.map(([x, y], i) => (
        <span key={`wt-${x}-${y}`} className="mast-motion-water"
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${period(i) * 1.4}s`, '--dl': stagger(i) }} />
      ))}

      {bridge && (
        <>
          {bridge.lights.map(([x, y]) => (
            <span key={`br-${x}-${y}`} className="mast-motion-decklight"
              style={{
                left: `${x}%`, top: `${y}%`,
                // Delay rises with position along the span, so the shimmer
                // travels the deck slowly instead of chasing like a marquee.
                '--dl': `${(((x - bridge.deck.x) / bridge.deck.w) * 4.2).toFixed(2)}s`,
              }} />
          ))}
          {/* The deck as a rotated rail. Traffic rides it rather than a flat
              row, which matters: the span rises 4.4% of the card across its
              length, several pixels of drift off the roadway at the ends. */}
          <span
            className="mast-motion-deck"
            style={{
              left: `${bridge.deck.x}%`, top: `${bridge.deck.y}%`,
              width: `${bridge.deck.w}%`,
              // Card percentages are not square: the card is 5.9:1, so a 1%
              // rise is 5.9x smaller in pixels than a 1% run. The angle has to
              // be computed through that or the rail tilts far too steeply.
              '--angle': `${(Math.atan((bridge.deck.rise / 5.9) / bridge.deck.w) * 180 / Math.PI).toFixed(3)}deg`,
            }}
          >
            {/* Two each way on periods that do not divide into one another, so
                the roadway never empties and never falls into lockstep. */}
            {CARS.map(c => (
              <span key={`${c.dir}-${c.dur}`}
                className={`mast-motion-car mast-motion-car-${c.dir}`}
                style={{ '--dur': `${c.dur}s`, '--dl': `${c.delay}s` }} />
            ))}
          </span>
        </>
      )}
    </div>
  )
}
