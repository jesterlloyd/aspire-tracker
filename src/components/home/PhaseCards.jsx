// HOME-1 (2026-09-24): the two phase-specific lead cards.
//
// Applications and outreach (Recruitment and Interviewing only) and Surveys and results
// (Evaluation only). One summary line each, every figure from data, a figure that is
// not available left out.

import HomeCard, { CardLink } from './HomeCard'

function Line({ clauses }) {
  const live = clauses.filter(Boolean)
  if (!live.length) return <p className="hm-sum hm-sum-empty">Nothing to report yet.</p>
  return (
    <p className="hm-sum">
      {live.map((c, i) => (
        <span key={c.key || i} className="hm-sum-clause">
          {i > 0 && <span className="hm-dot" aria-hidden="true" />}
          <span>{c.pre}{c.strong != null && <b className={c.tone ? `hm-${c.tone}` : ''}>{c.strong}</b>}{c.post}</span>
        </span>
      ))}
    </p>
  )
}

export function ApplicationsOutreach({ cohortName, received, thisWeek, missingDocs, openRate, onNavigate, order }) {
  const clauses = [
    received != null && { key: 'received', strong: String(received), post: ` application${received === 1 ? '' : 's'}` },
    thisWeek != null && { key: 'week', strong: String(thisWeek), post: ' this week' },
    missingDocs != null && { key: 'docs', strong: String(missingDocs), post: ' missing documents', tone: missingDocs > 0 ? 'amber' : null },
    openRate && { key: 'open', pre: `${openRate.subject}: `, strong: `${openRate.pct}%`, post: ' opened' },
  ]
  return (
    <HomeCard id="hm-recruit" title="Applications and Outreach" cap={cohortName} material="sheet" order={order}
      right={<CardLink label="Outreach" to="/connect/outreach" onNavigate={onNavigate} />}>
      <Line clauses={clauses} />
    </HomeCard>
  )
}

export function SurveysResults({ ready, needReminder, pairs, certificates, onNavigate, order }) {
  const clauses = [
    ready != null && { key: 'ready', strong: String(ready), post: ' ready to release' },
    needReminder != null && { key: 'remind', strong: String(needReminder), post: ' need a reminder', tone: needReminder > 0 ? 'amber' : null },
    pairs != null && { key: 'pairs', pre: 'Casey-Fink matched pairs: ', strong: String(pairs) },
    certificates != null && { key: 'certs', pre: 'Certificates issued: ', strong: String(certificates) },
  ]
  return (
    <HomeCard id="hm-evals" title="Surveys and Results" cap="End of rotation" material="sheet" order={order}
      right={<CardLink label="Review & Release" to="/evaluation?workflow=caseyFinkPostRotation" onNavigate={onNavigate} />}>
      <Line clauses={clauses} />
    </HomeCard>
  )
}

export { Line as SummaryLine }
