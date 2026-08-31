// src/components/masthead/GreetingMasthead.jsx
//
// Shared portal greeting masthead. It REUSES the exact visual system of the main-app "At a
// Glance" masthead; the deterministic greeting (src/lib/masthead.js), the compact HTC-style
// weather scene (WeatherMasthead from WeatherScene.jsx, with its own saved icon assets), and
// the .mast* card styling in src/index.css; so no parallel greeting art or design system is
// introduced.
//
// It is presentational and role-neutral: every role-specific value arrives as a prop, so the
// Unit Leader portal today (and the Academic Partner and Student portals later) render the
// identical card with their own data. The main app's own TodayMasthead is intentionally left
// untouched (its guard tests pin its internals); this is the smaller reusable wrapper the
// portal family shares. See docs/product/SHARED_PORTAL_HOME_PROFILE_CALENDAR_FOUNDATION.md.

import { greetingLine } from '../../lib/masthead'
import { WeatherMasthead, useMastheadScene } from '../WeatherScene'
import MastheadScenery from '../MastheadScenery'

export default function GreetingMasthead({
  fullName,
  dateLabel,
  contextLabel = null,      // e.g. active cohort name; omitted when null
  onCampusCount = 0,        // live occupancy; replaces the retired last-visit line
  showWeather = true,
  milestone = null,         // optional { label, name, when }
  todayItems = null,        // optional [{ key, dot, text }]
  calendar = null,          // optional { label, onClick }
  headingRef = null,        // lets the host make the greeting the focus-on-navigation target
}) {
  const { heading, wash } = greetingLine(fullName)
  // MASTHEAD-SCENE-3 parity (Owner): the browser-local "last visit" line is
  // retired across every masthead surface - the same control-room readout the
  // staff card uses takes its place, omitted at zero.
  const subParts = [
    dateLabel,
    contextLabel,
    onCampusCount > 0 ? `${onCampusCount} on campus now` : null,
  ].filter(Boolean)
  // MASTHEAD-SCENE-1: one unified clock drives the time-of-day artwork AND the
  // whole-card night treatment. Both stay gated on showWeather so a weatherless
  // masthead never darkens and never carries scenery.
  const { scene, night: sceneNight } = useMastheadScene()

  return (
    <div className={`mast mast-wash-${wash}${showWeather ? ` mast-scenic mast-scene-${scene}` : ''}${showWeather && sceneNight ? ' mast-night' : ''}`}>
      {showWeather && <MastheadScenery />}
      <div className="mast-row">
        {/* MASTHEAD-SCENE-3 hero layout: on scenic (weather-bearing) cards the
            weather caption and milestone stack in the LEFT column under the
            greeting, with the calendar button alone top-right; a weatherless
            masthead keeps the original right-cluster arrangement. */}
        <div className="mast-left">
          <h1 className="chart-route-title mast-greet" tabIndex={-1} ref={headingRef}>{heading}</h1>
          <div className="mast-sub">{subParts.join(' · ')}</div>
          {showWeather && <WeatherMasthead />}
          {showWeather && milestone && (
            <div className="mast-mile">
              <div className="mast-mile-label">{milestone.label}</div>
              <div className="mast-mile-name">{milestone.name}</div>
              <div className="mast-mile-when">{milestone.when}</div>
            </div>
          )}
        </div>
        <div className="mast-right">
          {!showWeather && milestone && (
            <div className="mast-mile-wrap">
              <span className="mast-vdiv" aria-hidden />
              <div className="mast-mile">
                <div className="mast-mile-label">{milestone.label}</div>
                <div className="mast-mile-name">{milestone.name}</div>
                <div className="mast-mile-when">{milestone.when}</div>
              </div>
            </div>
          )}
          {calendar && (
            <button type="button" className="mast-cal-btn" onClick={calendar.onClick}>
              {calendar.label}
            </button>
          )}
        </div>
      </div>

      {todayItems && todayItems.length > 0 && (
        <div className="mast-today-line">
          <span className="mast-today-label">Today in ASPIRE</span>
          {todayItems.map(it => (
            <span key={it.key} className="mast-evchip">
              <span className="mast-evdot" style={{ background: it.dot }} aria-hidden />
              {it.text}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
