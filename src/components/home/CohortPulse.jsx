// HOME-1 (2026-09-24): Cohort pulse, for the cohort in scope.
//
// The pipeline is five stages in one row, the current phase's stage filled navy with
// aria-current="step". The two bars each carry an aria-label that states all three
// numbers. Every figure comes from src/lib/home/cohortPulseModel.js and cyclePhase.js.

import HomeCard, { CardLink } from './HomeCard'

function Bar({ label, headline, sub, ariaLabel, segments, subAccent }) {
  return (
    <div className="hm-metric">
      <div className="hm-metric-lbl"><span>{label}</span><b>{headline}</b></div>
      <div className="hm-bar" role="img" aria-label={ariaLabel}>
        {segments.map((s, i) => <i key={i} className={`hm-bar-${s.tone}`} style={{ width: `${s.pct}%` }} />)}
      </div>
      <div className="hm-metric-sub">{sub[0]} · <b className={subAccent ? 'hm-amber' : ''}>{sub[1]}</b></div>
    </div>
  )
}

export default function CohortPulse({ cohortName, pipeline = [], currentStage = 0, hours, midpoint, onNavigate, order }) {
  return (
    <HomeCard id="hm-pulse" title="Cohort Pulse" cap={cohortName} material="report" order={order} clip
      right={<CardLink label="Student Profiles" to="/students" onNavigate={onNavigate} />}
    >
      <ol className="hm-pipe" aria-label="Pipeline">
        {pipeline.map((s, i) => (
          <li key={s.key} className={`hm-stage${i === currentStage ? ' is-cur' : ''}`} aria-current={i === currentStage ? 'step' : undefined}
            style={{ '--hm-i': i }}>
            <b>{s.count}</b><span>{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="hm-metrics">
        {hours && (
          <Bar label="Clinical hours" headline={hours.headline} ariaLabel={hours.ariaLabel} segments={hours.segments}
            sub={[`${hours.onTrack} on track`, `${hours.behind} behind pace`]} subAccent={hours.behind > 0} />
        )}
        {midpoint && (
          <Bar label="Midpoint assessments" headline={midpoint.headline} ariaLabel={midpoint.ariaLabel} segments={midpoint.segments}
            sub={[`${midpoint.awaiting} awaiting preceptor`, `${midpoint.ready} ready to release`]} subAccent={midpoint.ready > 0} />
        )}
      </div>
    </HomeCard>
  )
}
