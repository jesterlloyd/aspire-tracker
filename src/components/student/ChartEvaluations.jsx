// STUDENT-CHART-1: the Evaluations sheet.
//
// The one sheet with no section behind it already. Everything the mockup drew here (the
// interview rubric's result, the midpoint, the final) exists in the database and was
// simply never read by the side panel, so this is a new READER over existing tables, not
// a new store and not a new field.
//
// It does not hard-code which instruments exist. EvaluationTab knows three slugs today
// and there is nothing stopping a fourth being seeded, so this lists whatever
// `evaluation_assignments` returns for the student and lets the instrument name itself.
// A hard-coded three-row list would silently hide the fourth.
//
// Read-only by design: an evaluation is completed by its respondent through their own
// invited form, and a coordinator correcting one here would be forging a response. The
// button at the bottom opens the interview rubric, which is the one thing on this sheet
// a staff member does author.

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

/** Prefer the moment the respondent actually submitted; fall back to the assignment. */
function rowDate(a) {
  const r = Array.isArray(a.evaluation_responses) ? a.evaluation_responses[0] : a.evaluation_responses
  return r?.submitted_at || a.completed_at || a.sent_at || null
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The chip a status earns. Revoked outranks everything: a withdrawn invitation is not
 *  "pending", and showing it as pending would have someone chase a response that can
 *  never arrive. */
function statusChip(a) {
  if (a.revoked_at) return { label: 'Revoked', bg: 'var(--aspire-th-bg-inset,#eef1f6)', color: 'var(--aspire-th-color-inset,#475467)' }
  const s = (a.status || '').toLowerCase()
  if (s === 'completed' || s === 'submitted') return { label: 'Submitted', bg: '#dcfce7', color: '#166534' }
  if (s === 'sent' || s === 'invited' || s === 'opened') return { label: 'Awaiting response', bg: '#fef3c7', color: '#92400e' }
  if (s === 'expired') return { label: 'Expired', bg: '#fbeaec', color: '#991b1b' }
  return { label: a.status || 'Not started', bg: '#f3f4f6', color: '#4b5563' }
}

function Chip({ label, bg, color }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 12,
      whiteSpace: 'nowrap', background: bg, color,
    }}>{label}</span>
  )
}

function Row({ name, date, chip, note }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: 10, flexWrap: 'wrap', fontSize: 13, padding: '7px 0',
      borderBottom: '1px solid var(--aspire-page-rule)',
    }}>
      <span>
        {name}
        {note && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--aspire-paper-ink-soft)' }}>{note}</span>}
      </span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--aspire-paper-ink-soft)' }}>{date}</span>
        <Chip {...chip} />
      </span>
    </div>
  )
}

export default function ChartEvaluations({ studentId, canRead }) {
  const navigate = useNavigate()

  // Both reads are RLS-governed exactly as their own tabs are; this adds no grant. When a
  // caller may not read them the sheet says so rather than rendering a misleading empty
  // list, because "no evaluations" and "not visible to you" are different facts.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student_chart_evaluations', studentId],
    queryFn: async () => {
      const [rubRes, asgRes] = await Promise.all([
        supabase.from('interview_rubrics')
          .select('id, composite_score, individual_recommendation, interviewer_name, status, created_at, updated_at')
          .eq('student_id', studentId),
        supabase.from('evaluation_assignments')
          .select('id, status, timepoint, sent_at, completed_at, revoked_at, evaluation_instruments ( slug, display_name ), evaluation_responses ( submitted_at )')
          .eq('student_id', studentId),
      ])
      if (rubRes.error) throw rubRes.error
      if (asgRes.error) throw asgRes.error
      return { rubrics: rubRes.data || [], assignments: asgRes.data || [] }
    },
    enabled: !!studentId && canRead,
  })

  if (!canRead) {
    return <div style={{ fontSize: 13, color: 'var(--aspire-paper-ink-soft)' }}>
      Evaluations are not visible with your access.
    </div>
  }
  if (isLoading) return <div style={{ fontSize: 13, color: 'var(--aspire-paper-ink-soft)' }}>Loading evaluations…</div>
  if (isError) return <div style={{ fontSize: 13, color: 'var(--aspire-paper-ink-soft)' }}>Evaluations could not be loaded.</div>

  const rubrics = data?.rubrics || []
  const assignments = [...(data?.assignments || [])].sort((a, b) => {
    const ta = Date.parse(rowDate(a) || 0) || 0
    const tb = Date.parse(rowDate(b) || 0) || 0
    return ta - tb
  })

  // One line for the interview rubric. Several interviewers may each score a candidate,
  // so the composite is averaged across the scored ones and the count is shown: a single
  // "13 / 15" that silently came from three different people would be a claim the data
  // does not make.
  const scored = rubrics.filter(r => (r.composite_score || 0) > 0)
  const avg = scored.length
    ? scored.reduce((s, r) => s + (r.composite_score || 0), 0) / scored.length
    : null
  const newest = rubrics.length
    ? rubrics.reduce((a, b) => (Date.parse(b.updated_at || b.created_at || 0) > Date.parse(a.updated_at || a.created_at || 0) ? b : a))
    : null
  const recommendation = scored.length === 1 ? scored[0].individual_recommendation : null

  return (
    <>
      <div className="sc-block">
        <div className="sp-section-hdr">Interview rubric</div>
        {rubrics.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--aspire-paper-ink-soft)', padding: '4px 0' }}>
            No rubric has been started for this student.
          </div>
        ) : (
          <Row
            name="Interview rubric"
            note={scored.length > 1 ? `Average of ${scored.length} interviewers` : (newest?.interviewer_name || null)}
            date={fmtDate(newest?.updated_at || newest?.created_at)}
            chip={avg === null
              ? { label: newest?.status || 'In progress', bg: '#fef3c7', color: '#92400e' }
              : {
                  label: `${avg % 1 === 0 ? avg : avg.toFixed(1)} / 15${recommendation ? ` · ${recommendation}` : ''}`,
                  bg: '#dcfce7', color: '#166534',
                }}
          />
        )}
      </div>

      <div className="sc-block">
        <div className="sp-section-hdr">Rotation evaluations</div>
        {assignments.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--aspire-paper-ink-soft)', padding: '4px 0' }}>
            No evaluations have been assigned yet.
          </div>
        ) : assignments.map(a => {
          const inst = Array.isArray(a.evaluation_instruments) ? a.evaluation_instruments[0] : a.evaluation_instruments
          return (
            <Row
              key={a.id}
              name={inst?.display_name || inst?.slug || 'Evaluation'}
              note={a.timepoint || null}
              date={fmtDate(rowDate(a))}
              chip={statusChip(a)}
            />
          )
        })}
      </div>

      <button
        type="button"
        className="sp-nav-btn"
        style={{ marginTop: 4 }}
        onClick={() => navigate(`/interviews?student=${encodeURIComponent(studentId)}`)}
      >
        Open interview rubric →
      </button>
    </>
  )
}
