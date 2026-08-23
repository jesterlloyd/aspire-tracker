import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { CASEY_FINK_SECTION_GROUPS } from '../../lib/evaluation/caseyFinkComparison'

function scorePosition(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, ((value - 1) / 3) * 100))
}

function ScoreRow({ metric }) {
  const prePosition = scorePosition(metric.preMean)
  const postPosition = scorePosition(metric.postMean)
  const connectorLeft = Math.min(prePosition, postPosition)
  const connectorWidth = Math.abs(postPosition - prePosition)
  const deltaLabel = metric.delta == null
    ? '-'
    : `${metric.delta >= 0 ? '+' : ''}${metric.delta.toFixed(2)}`

  return (
    <div className="casey-compare-row">
      <div className="casey-compare-label">
        <strong>{metric.label}</strong>
        <span>{metric.itemCodes.length}-item subscale</span>
      </div>

      <div className="casey-compare-track" aria-label={`${metric.label}: pre-rotation ${metric.preMean.toFixed(2)}, post-rotation ${metric.postMean.toFixed(2)}, change ${deltaLabel}`}>
        <div className="casey-compare-gridlines" aria-hidden="true">
          <i /><i /><i /><i />
        </div>
        <div className="casey-compare-axis-line" aria-hidden="true" />
        <div
          className={`casey-compare-connector ${metric.delta < 0 ? 'is-negative' : ''}`}
          style={{ left: `${connectorLeft}%`, width: `${connectorWidth}%` }}
          aria-hidden="true"
        />
        <div className="casey-compare-marker casey-compare-marker-pre" style={{ left: `${prePosition}%` }}>
          <span>{metric.preMean.toFixed(2)}</span>
        </div>
        <div className="casey-compare-marker casey-compare-marker-post" style={{ left: `${postPosition}%` }}>
          <span>{metric.postMean.toFixed(2)}</span>
        </div>
      </div>

      <div className={`casey-compare-delta ${metric.delta < 0 ? 'is-negative' : ''}`}>
        {deltaLabel}
      </div>
    </div>
  )
}

function LikertBar({ distribution, label }) {
  const total = distribution.total
  return (
    <div
      className="casey-likert-bar"
      role="img"
      aria-label={`${label}: ${distribution.counts.map((count, index) => `response ${index + 1}, ${count}`).join('; ')}`}
    >
      {distribution.counts.map((count, index) => (
        <i
          key={index}
          className={`casey-likert-level-${index + 1}`}
          style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
        />
      ))}
    </div>
  )
}

function QuestionLevelDetails({ distributions }) {
  return (
    <div className="casey-question-details">
      <div className="casey-question-heading">
        <div>
          <strong>Question-level response shift</strong>
          <span>Matched students only · cumulative response distribution</span>
        </div>
        <div className="casey-likert-legend" aria-label="Response level legend">
          {[1, 2, 3, 4].map(level => (
            <span key={level}><i className={`casey-likert-level-${level}`} />{level}</span>
          ))}
        </div>
      </div>

      {CASEY_FINK_SECTION_GROUPS.map(section => {
        const rows = distributions.filter(item => item.sectionKey === section.key)
        return (
          <section key={section.key} className="casey-question-section">
            <h4>{section.label}</h4>
            {rows.map(item => (
              <div key={item.itemCode} className="casey-question-row">
                <span className="casey-question-code">{item.itemCode.replace('S1_Q', 'Item ')}</span>
                <div className="casey-question-bars">
                  <span>Pre</span><LikertBar distribution={item.pre} label={`${item.itemCode} pre-rotation`} />
                  <span>Post</span><LikertBar distribution={item.post} label={`${item.itemCode} post-rotation`} />
                </div>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export default function CaseyFinkComparisonPanel({ comparison }) {
  const [showDetails, setShowDetails] = useState(false)
  const hasPairs = comparison.matchedCount > 0

  return (
    <section className="casey-compare-panel" aria-labelledby="casey-compare-title">
      <header className="casey-compare-header">
        <div>
          <div className="casey-compare-eyebrow">CASEY-FINK</div>
          <h3 id="casey-compare-title">Readiness: Pre-to-Post Change</h3>
          <p>
            Matched student responses · <strong>{comparison.matchedCount} paired {comparison.matchedCount === 1 ? 'student' : 'students'}</strong>
          </p>
        </div>
        {hasPairs && (
          <div className="casey-compare-legend" aria-label="Chart legend">
            <span><i className="casey-legend-pre" />Pre-rotation</span>
            <span><i className="casey-legend-post" />Post-rotation</span>
          </div>
        )}
      </header>

      {hasPairs ? (
        <>
          <div className="casey-compare-axis" aria-hidden="true">
            <span>1</span><span>2</span><span>3</span><span>4</span>
          </div>
          <div className="casey-compare-chart">
            {comparison.metrics.map(metric => <ScoreRow key={metric.key} metric={metric} />)}
          </div>
          <div className="casey-compare-scale-label">Section I mean score (1–4)</div>
        </>
      ) : (
        <div className="casey-compare-empty">
          The pre-to-post comparison will appear after at least one student completes both a baseline and post-rotation survey.
        </div>
      )}

      <div className="casey-compare-completeness">
        <span><strong>{comparison.matchedCount}</strong> matched pairs</span>
        <span><strong>{comparison.postOnlyCount}</strong> post-only</span>
        <span><strong>{comparison.baselineOnlyCount}</strong> baseline-only</span>
      </div>

      <footer className="casey-compare-footer">
        <p>
          Observed change in student-reported readiness. This does not independently measure retention, objective competence, or financial savings.
        </p>
        {hasPairs && (
          <button
            type="button"
            className="casey-compare-detail-button"
            aria-expanded={showDetails}
            onClick={() => setShowDetails(value => !value)}
          >
            {showDetails ? 'Hide question-level changes' : 'View question-level changes'}
            {showDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}
      </footer>

      {hasPairs && showDetails && (
        <QuestionLevelDetails distributions={comparison.itemDistributions} />
      )}
    </section>
  )
}
