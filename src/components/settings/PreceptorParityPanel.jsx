// PRECEPTOR-MODEL-2: Preceptor Assignment Parity — a READ-ONLY Owner/Admin diagnostic.
//
// Proves the new student_preceptor_assignments model matches current behavior in the LIVE app and
// surfaces drift (BOTH directions) as a neutral worklist. Over the UNION of (a) students with a
// current canonical primary (students.preceptor_id) and (b) students with an ACTIVE-PRIMARY row
// (role='primary' AND status='active') in student_preceptor_assignments, it compares the two sides
// BY IDENTITY (preceptor_id vs preceptor_id) — including the reverse case where the current primary
// was cleared but an active-primary row remains.
//
// STRICT SCOPE (this surface only):
//   • READ-ONLY: only .select() calls. Writes NOTHING to any table — no backfill/sync/repair/fix.
//   • ID-BASED parity: names are display-only. A name-formatting difference with matching IDs is a
//     Match, never a Mismatch. A Mismatch means genuinely DIFFERENT preceptor_ids.
//   • DETECT-ONLY: a post-backfill reassignment legitimately shows Mismatch — that is EXPECTED drift
//     for PRECEPTOR-MODEL-3 to cut over, NOT an error and NOT something this surface repairs.
//   • REUSES resolvePreceptor (src/lib/preceptor.js) UNCHANGED for the current side's display name,
//     so the comparison reflects today's real resolution path. The parity ID is students.preceptor_id.
//   • Owner/Admin only (registry-gated); reads the new table via its existing Owner/Admin SELECT RLS.
//
// Nothing here changes routing, send, survey, automation, due-detection, writers, response storage,
// digest, check-in, Keith, schema, or RLS. students.preceptor_id remains authoritative everywhere.

import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { resolvePreceptor } from '../../lib/preceptor'
import SurfaceCard from '../ui/SurfaceCard'

const PARITY = {
  match:            { label: 'Match',                                                          short: 'Match',              color: '#2f6b34', bg: '#eef6ee', border: '#bcd9bf' },
  mismatch_changed: { label: 'Mismatch — current primary changed since assignment foundation', short: 'Mismatch — changed', color: '#8B5E1A', bg: '#FBF5E8', border: '#f0c9b0' },
  mismatch_cleared: { label: 'Mismatch — current primary cleared since assignment foundation', short: 'Mismatch — cleared', color: '#9A3412', bg: '#FDF0E6', border: '#f3c79f' },
  missing:          { label: 'Missing assignment — no active-primary row found',               short: 'Missing assignment', color: '#1D2567', bg: '#EEF2FB', border: '#c7d2fe' },
}
// Worklist ordering: surface drift first (both directions), matches last.
const PARITY_ORDER = { mismatch_changed: 0, mismatch_cleared: 1, missing: 2, match: 3 }

export default function PreceptorParityPanel() {
  const { isAdmin } = useAuth() // owner/admin; the section is registry-hidden otherwise
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        // READ-ONLY: SELECTs only. Students with a current canonical primary; the full preceptor
        // roster (for resolvePreceptor + active-primary name display); the active-primary rows.
        const [studentsRes, preceptorsRes, assignmentsRes] = await Promise.all([
          supabase
            .from('students')
            .select('id, first_name, last_name, preceptor_id, cohort_id, matched_preceptor, preceptor_email')
            .not('preceptor_id', 'is', null),
          supabase
            .from('preceptors')
            .select('id, full_name, email, unit_name, shift_type'),
          supabase
            .from('student_preceptor_assignments')
            .select('student_id, cohort_id, preceptor_id, role, status, created_at, updated_at')
            .eq('role', 'primary')
            .eq('status', 'active'),
        ])

        const firstErr = studentsRes.error || preceptorsRes.error || assignmentsRes.error
        if (firstErr) throw firstErr

        const studentsWithPrimary = studentsRes.data || []
        const preceptors          = preceptorsRes.data || []
        const assignments         = assignmentsRes.data || []

        // UNION: also include students that have an ACTIVE-PRIMARY row but no longer have a current
        // primary (preceptor_id cleared since the Phase-1 backfill = reverse drift). Fetch ONLY those
        // student records not already in the current-primary set — still READ-ONLY.
        const haveIds = new Set(studentsWithPrimary.map(s => s.id))
        const assignmentOnlyIds = [...new Set(assignments.map(a => a.student_id))].filter(id => !haveIds.has(id))
        let assignmentOnlyStudents = []
        if (assignmentOnlyIds.length) {
          const extraRes = await supabase
            .from('students')
            .select('id, first_name, last_name, preceptor_id, cohort_id, matched_preceptor, preceptor_email')
            .in('id', assignmentOnlyIds)
          if (extraRes.error) throw extraRes.error
          assignmentOnlyStudents = extraRes.data || []
        }

        const allStudents = [...studentsWithPrimary, ...assignmentOnlyStudents]
        const apByStudent = new Map(assignments.map(a => [a.student_id, a]))
        const precById    = new Map(preceptors.map(p => [p.id, p]))

        const computed = allStudents.map(s => {
          // CURRENT side: identity is students.preceptor_id (authoritative; may be null for the
          // reverse-drift case); display name via today's resolvePreceptor path.
          const currentId   = s.preceptor_id || null
          const currentName = resolvePreceptor(s, preceptors).name || '—'

          // ACTIVE-PRIMARY side from the new table.
          const a        = apByStudent.get(s.id) || null
          const activeId = a ? a.preceptor_id : null
          const activeName = activeId
            ? (precById.get(activeId)?.full_name || '(preceptor not found)')
            : '—'

          // Parity by IDENTITY only — both directions of drift.
          let parity
          if (currentId && a)       parity = (activeId === currentId) ? 'match' : 'mismatch_changed'
          else if (currentId && !a) parity = 'missing'
          else if (!currentId && a) parity = 'mismatch_cleared'   // reverse drift: primary cleared, assignment remains
          else                      parity = null                 // neither side — not in scope (defensive)

          const last = (s.last_name || '').trim()
          const first = (s.first_name || '').trim()
          const studentName = (last || first) ? `${last}${last && first ? ', ' : ''}${first}` : s.id

          return {
            studentId: s.id,
            studentName,
            currentName,
            currentId,
            activeName,
            activeId,
            role:   a ? a.role : '—',
            status: a ? a.status : '—',
            updatedAt: a ? a.updated_at : null,
            parity,
          }
        }).filter(r => r.parity !== null)

        computed.sort((x, y) =>
          (PARITY_ORDER[x.parity] - PARITY_ORDER[y.parity]) ||
          x.studentName.localeCompare(y.studentName)
        )

        if (!cancelled) setRows(computed)
      } catch (err) {
        if (!cancelled) setLoadError(err?.message || 'Unable to load parity data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isAdmin])

  const counts = {
    total:           rows.length,
    match:           rows.filter(r => r.parity === 'match').length,
    mismatchChanged: rows.filter(r => r.parity === 'mismatch_changed').length,
    mismatchCleared: rows.filter(r => r.parity === 'mismatch_cleared').length,
    missing:         rows.filter(r => r.parity === 'missing').length,
  }

  const F = 'DM Sans, sans-serif'
  const th = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', fontSize: 13, color: '#191919', borderBottom: '1px solid #f1efe9', verticalAlign: 'top' }

  return (
    <div style={{ fontFamily: F }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#191919' }}>Preceptor Assignment Parity</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.55 }}>
          Read-only diagnostic over the <strong>union</strong> of students with a current primary
          (<code style={{ fontSize: 12 }}>students.preceptor_id</code>, the authoritative field) and students with an
          active-primary row in the new assignment model. Parity is computed <strong>by preceptor identity (ID)</strong>,
          both directions — names are display-only. A “Mismatch” means a genuinely different (or cleared) preceptor_id
          since the assignment foundation; it is an expected worklist item for a later cutover, not an error. This view
          writes nothing.
        </p>
      </div>

      {loading && <SurfaceCard padding={16}><span style={{ fontSize: 13, color: '#6b7280' }}>Loading parity…</span></SurfaceCard>}

      {!loading && loadError && (
        <SurfaceCard padding={16}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Unable to load parity data: {loadError}</span>
        </SurfaceCard>
      )}

      {!loading && !loadError && (
        <>
          {/* Summary counts */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <Stat label="In scope (union)" value={counts.total} color="#374151" bg="#f4f1ec" border="#e5e7eb" />
            <Stat label="Match" value={counts.match} color={PARITY.match.color} bg={PARITY.match.bg} border={PARITY.match.border} />
            <Stat label="Mismatch — changed" value={counts.mismatchChanged} color={PARITY.mismatch_changed.color} bg={PARITY.mismatch_changed.bg} border={PARITY.mismatch_changed.border} />
            <Stat label="Mismatch — cleared" value={counts.mismatchCleared} color={PARITY.mismatch_cleared.color} bg={PARITY.mismatch_cleared.bg} border={PARITY.mismatch_cleared.border} />
            <Stat label="Missing assignment" value={counts.missing} color={PARITY.missing.color} bg={PARITY.missing.bg} border={PARITY.missing.border} />
          </div>

          <SurfaceCard padding={0} radius={12} style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={th}>Student</th>
                    <th style={th}>Current primary (preceptor_id)</th>
                    <th style={th}>Active-primary (assignment)</th>
                    <th style={th}>Role / Status</th>
                    <th style={th}>Parity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td style={{ ...td, color: '#6b7280' }} colSpan={5}>No students with a current primary or an active-primary assignment.</td></tr>
                  )}
                  {rows.map(r => {
                    const p = PARITY[r.parity]
                    return (
                      <tr key={r.studentId}>
                        <td style={td}>{r.studentName}</td>
                        <td style={td}>
                          <div>{r.currentName}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', marginTop: 2 }}>{r.currentId || '—'}</div>
                        </td>
                        <td style={td}>
                          <div>{r.activeName}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', marginTop: 2 }}>{r.activeId || '—'}</div>
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.role} / {r.status}</td>
                        <td style={td}>
                          <span style={{
                            display: 'inline-block', padding: '3px 9px', borderRadius: 999,
                            fontSize: 11.5, fontWeight: 600, lineHeight: 1.4,
                            color: p.color, background: p.bg, border: `1px solid ${p.border}`,
                          }}>
                            {p.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color, bg, border }) {
  return (
    <div style={{
      minWidth: 120, padding: '10px 14px', borderRadius: 10,
      background: bg, border: `1px solid ${border}`,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  )
}
