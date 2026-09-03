// MASTHEAD-MOTION-1 (PROTOTYPE): subtle motion layered over the STILL city
// artwork, as the cheap alternative to shipping video frames.
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

export default function MastheadMotion({ city }) {
  const m = CITY_MOTION[city]
  if (!m) return null
  const { lights, beacons, aircraft, water, bridge, beam } = m
  return (
    <div className="mast-motion" aria-hidden>
      {/* Two bolts on different periods, so the storm does not tick like a
          metronome. Both sit right of centre: a flash over the greeting would
          fight the text, the same contract the artwork's left fade honours. */}
      <div className="mast-motion-bolt mast-motion-bolt-a" />
      <div className="mast-motion-bolt mast-motion-bolt-b" />

      {lights?.map(([x, y], i) => (
        <span key={`lt-${x}-${y}`} className="mast-motion-light"
          style={{ left: `${x}%`, top: `${y}%`, '--d': `${period(i)}s`, '--dl': stagger(i) }} />
      ))}

      {/* Aviation beacons blink, they do not breathe. Keeping them on a
          separate keyframe from the shimmer is what makes a tower read as a
          tower rather than as one more window. */}
      {beacons?.map(([x, y], i) => (
        <span key={`bc-${x}-${y}`} className="mast-motion-beacon"
          style={{ left: `${x}%`, top: `${y}%`, '--dl': `${(i * 0.9).toFixed(1)}s` }} />
      ))}

      {aircraft && (
        <span
          className="mast-motion-plane"
          style={{
            top: `${aircraft.y}%`,
            '--from': `${aircraft.from}%`,
            '--to': `${aircraft.to}%`,
            // The flight is a fraction of a much longer cycle, so the sky is
            // empty most of the time. One aircraft every 82s reads as a city;
            // a continuous stream reads as a screensaver.
            '--cycle': `${aircraft.cycle}s`,
            '--visible': `${((aircraft.flight / aircraft.cycle) * 100).toFixed(1)}%`,
          }}
        >
          <span className="mast-motion-plane-dot" />
        </span>
      )}

      {/* One landmark shaft, standing on the apex that projects it. Anchored at
          the bottom and grown upward, so it reads as light leaving the building
          rather than a bar dropped onto the sky. */}
      {beam && (
        <span
          className="mast-motion-beam"
          style={{
            left: `${beam.x}%`, top: `${beam.y}%`,
            width: `${beam.width}%`, height: `${beam.height}%`,
          }}
        />
      )}

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
