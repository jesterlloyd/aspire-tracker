// src/components/masthead/GreetingMasthead.jsx
//
// Shared portal greeting masthead. It REUSES the exact visual system of the main-app "At a
// Glance" masthead; the deterministic greeting (src/lib/masthead.js), the compact HTC-style
// weather scene (WeatherMasthead from WeatherScene.jsx, with its own saved icon assets), the
// clock and events row (masthead/MastheadClock, masthead/MastheadEventsRow), and the .mast*
// card styling in src/index.css; so no parallel greeting art or design system is introduced.
//
// It is presentational and role-neutral: every role-specific value arrives as a prop, so the
// Unit Leader, Academic Partner, Student and Nursing Academics portals and the Residency At a
// Glance render the identical card with their own data. The main app's own TodayMasthead is
// intentionally left independent (its guard tests pin its internals); this is the smaller
// reusable wrapper the portal family shares.
//
// MASTHEAD-LOCKSCREEN-1 (Owner, 2026-09-04): the card is a lock screen now. Greeting left,
// date over a live clock in the centre, weather right, an events row along the bottom, and
// nothing else: no date-and-context line, no milestone block. dateLabel, contextLabel,
// onCampusCount and milestone are still ACCEPTED so no host has to change its call, but they
// are not rendered. A host that has calendar items passes them as `items` (the shape
// src/lib/mastheadEvents.js produces), and a calendar handler as `calendar`.

import { greetingLine } from '../../lib/masthead'
import { WeatherMasthead, useMastheadScene } from '../WeatherScene'
import MastheadScenery from '../MastheadScenery'
import MastheadClock from './MastheadClock'
import MastheadEventsRow from './MastheadEventsRow'

export default function GreetingMasthead({
  fullName,
  dateLabel = null,         // accepted, not rendered: the clock owns the date now
  contextLabel = null,      // accepted, not rendered: the cohort lives in the scope picker
  onCampusCount = 0,        // accepted, not rendered
  showWeather = true,
  milestone = null,         // accepted, not rendered: a near milestone arrives as an item instead
  todayItems = null,        // legacy name for `items`
  items = null,             // [{ key, dot, text, milestone }], see src/lib/mastheadEvents.js
  calendar = null,          // optional { label, onClick }
  headingRef = null,        // lets the host make the greeting the focus-on-navigation target
  // NGRP-ACTIVITY-PARITY-1: hosts that already sit in a padded page column cancel
  // the card's own 20px inset, exactly as OnCampusNow's `flush` does. Without it
  // the masthead sits 20px inside every sibling AND, because the card is
  // aspect-ratio sized, comes out shorter than the same masthead elsewhere:
  // measured 1264/5.9 = 214px against the app's 1304/5.9 = 221px.
  flush = false,
}) {
  const { heading, wash } = greetingLine(fullName)
  // MASTHEAD-SCENE-1: one unified clock drives the time-of-day artwork AND the
  // whole-card night treatment. Both stay gated on showWeather so a weatherless
  // masthead never darkens and never carries scenery.
  const { scene, night: sceneNight } = useMastheadScene()
  void dateLabel; void contextLabel; void onCampusCount; void milestone

  return (
    <div className={`mast mast-wash-${wash}${showWeather ? ` mast-scenic mast-scene-${scene}` : ''}${showWeather && sceneNight ? ' mast-night' : ''}${flush ? ' mast-flush' : ''}`}>
      {showWeather && <MastheadScenery />}
      <div className="mast-row">
        <div className="mast-left">
          <h1 className="chart-route-title mast-greet" tabIndex={-1} ref={headingRef}>{heading}</h1>
        </div>
        <MastheadClock />
        <div className="mast-right">
          {showWeather && <WeatherMasthead />}
        </div>
      </div>
      <MastheadEventsRow items={items ?? todayItems ?? []} calendar={calendar} />
    </div>
  )
}
