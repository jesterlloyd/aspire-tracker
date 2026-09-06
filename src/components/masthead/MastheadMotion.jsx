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
import { CITY_MOTION } from '../../lib/mastheadCityScenes'
import { useMastheadScene } from '../WeatherScene'

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
  const m = CITY_MOTION[city]
  if (!m) return null
  const { lights, beacons, beaconTone, aircraft, water, bridge, beam,
    birds, haze, hazeTone, flare, helicopter, rainfall, ferry, ferryTone, glints, steam,
    neon, wheel, orb, snowfall, swell, surf, sceneOverrides, sceneShift } = m
  const spans = Array.isArray(bridge) ? bridge : bridge ? [bridge] : []
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
  const renderBeacons = (pts, tag) => pts?.map(([x, y], i) => (
    <span key={`bc-${tag}-${x}-${y}`} className={beaconClass}
      style={{ left: `${x}%`, top: `${y}%`, '--dl': `${(i * 0.9).toFixed(1)}s` }} />
  ))
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
    <div className={`mast-motion${wet ? ' mast-motion-wet' : ''}`} aria-hidden>
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
          across it. Card percentages are not square (the card is 5.9:1), so
          the rise is divided through that before the angle is taken - the same
          correction the bridge deck makes. Delays run along the beach, which
          is what makes a set of waves read as arriving rather than blinking. */}
      {surf?.map(([x, y, w, rise], i) => (
        <span key={`sf-${x}-${y}`} className="mast-motion-surf"
          style={{
            left: `${x}%`, top: `${y}%`, width: `${w}%`,
            '--angle': `${(Math.atan((rise / 5.9) / w) * 180 / Math.PI).toFixed(3)}deg`,
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

      {/* Neon flickers: a fast, irregular step pattern, nothing like the slow
          breath of the shimmer, on the Strip's saturated signage. */}
      {neon?.map(([x, y, tone], i) => (
        <span key={`ne-${x}-${y}`} className={`mast-motion-neon${tone === 'cyan' ? ' mast-motion-neon-cyan' : ''}`}
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${(2.3 + (period(i) % 2.1)).toFixed(2)}s`, '--dl': stagger(i) }} />
      ))}

      {/* A wheel is a rim of cabin lights turning slowly. The box is square
          in pixels (width as a share of the card width, aspect-ratio 1), so
          the ring stays round on a card that is not. */}
      {wheel && (
        <span className="mast-motion-wheel"
          style={{ left: `${wheel.x}%`, top: `${wheel.y}%`, width: `${wheel.d}%` }} />
      )}

      {/* The orb's skin drifts through the hues, masked off below the line
          where the skyline in front of it begins. */}
      {orb && (
        <span className="mast-motion-orb"
          style={{ left: `${orb.x}%`, top: `${orb.y}%`, width: `${orb.d}%`, '--cut': `${orb.cut}%` }} />
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
              // Card percentages are not square: the card is 5.9:1, so a 1%
              // rise is 5.9x smaller in pixels than a 1% run. The angle has to
              // be computed through that or the rail tilts far too steeply.
              '--angle': `${(Math.atan((span.deck.rise / 5.9) / span.deck.w) * 180 / Math.PI).toFixed(3)}deg`,
            }}
          >
            {/* Two each way on periods that do not divide into one another, so
                the roadway never empties and never falls into lockstep. */}
            {CARS.map(c => (
              <span key={`${c.dir}-${c.dur}`}
                className={`mast-motion-car mast-motion-car-${c.dir}`}
                style={{ '--dur': `${c.dur + si * 1.7}s`, '--dl': `${c.delay + si * 2.3}s` }} />
            ))}
            {/* One police car on a long period, so it is an event, not traffic. */}
            {span.police && (
              <span className="mast-motion-car mast-motion-car-west mast-motion-car-police"
                style={{ '--dur': '23s', '--dl': '11s' }} />
            )}
          </span>
        </span>
      ))}
      </div>

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
          <span className="mast-motion-ferry-wake" />
          <span className="mast-motion-ferry-hull" />
          <span className="mast-motion-ferry-lamp" />
        </span>
      )}
    </div>
  )
}
