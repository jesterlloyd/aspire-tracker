// PRECEPTOR-MODEL-2, reframed by PRECEPTOR-INTEGRITY-1: Preceptor Assignment Integrity -
// a READ-ONLY Owner-only integrity monitor.
//
// students.preceptor_id is the CANONICAL primary-preceptor identity. The ACTIVE-PRIMARY row
// (role='primary' AND status='active') in student_preceptor_assignments is its SYNCHRONIZED
// MIRROR: the applied Phase 2C guard routes every application primary change through the audited
// assign_primary_preceptor RPC, and the applied Phase 2B trigger (sync_primary_preceptor_mirror)
// maintains the mirror on every accepted write. No application path can desynchronize the two
// sides, so this monitor exists to DETECT DRIFT from out-of-band changes: manual SQL sessions,
// restores, or a trigger regression. Over the UNION of (a) students with a current canonical
// primary and (b) students with an ACTIVE-PRIMARY row, it compares the two sides BY IDENTITY
// (preceptor_id vs preceptor_id) - including the reverse case where the current primary was
// cleared but an active-primary row remains.
//
// STRICT SCOPE (this surface only):
//   • READ-ONLY: only .select() calls. Writes NOTHING to any table - no backfill/sync/repair/fix.
//   • ID-BASED parity: names are display-only. A name-formatting difference with matching IDs is a
//     Match, never a Mismatch. A Mismatch means genuinely DIFFERENT preceptor_ids.
//   • DETECT-ONLY: any Mismatch or Missing row is a drift signal to investigate, never something
//     this surface repairs. The companion script db/audit/preceptor_parity_check.sql runs the same
//     identity-based check in SQL and is required after manual SQL sessions (see OWNER_SQL_GATE.md).
//   • REUSES resolvePreceptor (src/lib/preceptor.js) UNCHANGED for the current side's display name,
//     so the comparison reflects today's real resolution path. The parity ID is students.preceptor_id.
//   • Owner only (registry-gated); reads the assignment table via its existing Owner/Admin SELECT RLS.
//
// Nothing here changes routing, send, survey, automation, due-detection, writers, response storage,
// digest, check-in, Keith, schema, or RLS. students.preceptor_id remains authoritative everywhere.
//
// SETTINGS-UNIFIED-DESIGN-1: canonical chrome, diagnostic identity stays in the copy. The local Stat
// cards are replaced with the shared FilterKPICard primitive (now also filtering the table, not just
// summarizing it), and the hand-rolled table markup is replaced with the canonical DataTable
// primitive. The header paragraph and parity pill labels - where the diagnostic identity actually
// lives - are unchanged. This surface remains strictly READ-ONLY: only .select() calls, no writes.

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { resolvePreceptor } from '../../lib/preceptor'
import SurfaceCard from '../ui/SurfaceCard'
import { SETTINGS_HEADING_STYLE } from './settingsSections'
import DataTable from '../ui/DataTable'
import { FilterKPICard } from '../KPIBand'

const PARITY = {
  match:            { label: 'Match',                                                          short: 'Match',              color: '#2f6b34', bg: '#eef6ee', border: '#bcd9bf' },
  mismatch_changed: { label: 'Mismatch, current primary changed since assignment foundation', short: 'Mismatch, changed', color: '#8B5E1A', bg: '#FBF5E8', border: '#f0c9b0' },
  mismatch_cleared: { label: 'Mismatch, current primary cleared since assignment foundation', short: 'Mismatch, cleared', color: '#9A3412', bg: '#FDF0E6', border: '#f3c79f' },
  missing:          { label: 'Missing assignment, no active-primary row found',               short: 'Missing assignment', color: '#1D2567', bg: '#EEF2FB', border: '#c7d2fe' },
}
// Worklist ordering: surface drift first (both directions), matches last.
const PARITY_ORDER = { mismatch_changed: 0, mismatch_cleared: 1, missing: 2, match: 3 }

// SETTINGS-UNIFIED-DESIGN-1: filter-card metadata - value key into `counts`, the
// parityFilter value each card selects ('all' for the scope card), and its accent.
const PARITY_CARDS = [
  { key: 'total',           parity: 'all',               label: 'In Scope',           accent: 'nightfall' },
  { key: 'match',           parity: 'match',              label: 'Match',              accent: 'sage' },
  { key: 'mismatchChanged', parity: 'mismatch_changed',   label: 'Mismatch changed',   accent: 'dawn' },
  { key: 'mismatchCleared', parity: 'mismatch_cleared',   label: 'Mismatch cleared',   accent: 'chroma' },
  { key: 'missing',         parity: 'missing',            label: 'Missing assignment', accent: 'periwinkle' },
]

const PARITY_COLUMNS = [
  { key: 'student', label: 'Student', render: r => r.studentName },
  {
    key: 'current', label: 'Current primary',
    render: r => (
      <>
        <div>{r.currentName}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', marginTop: 2 }}>{r.currentId || '-'}</div>
      </>
    ),
  },
  {
    key: 'active', label: 'Active-primary',
    render: r => (
      <>
        <div>{r.activeName}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', marginTop: 2 }}>{r.activeId || '-'}</div>
      </>
    ),
  },
  { key: 'roleStatus', label: 'Role / Status', cellStyle: { whiteSpace: 'nowrap' }, render: r => `${r.role} / ${r.status}` },
  {
    key: 'parity', label: 'Parity',
    render: r => {
      const p = PARITY[r.parity]
      return (
        <span style={{
          display: 'inline-block', padding: '3px 9px', borderRadius: 999,
          fontSize: 11.5, fontWeight: 600, lineHeight: 1.4,
          color: p.color, background: p.bg, border: `1px solid ${p.border}`,
        }}>
          {p.label}
        </span>
      )
    },
  },
]

export default function PreceptorParityPanel() {
  const { isAdmin } = useAuth() // owner/admin; the section is registry-hidden otherwise
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [rows, setRows] = useState([])
  const [parityFilter, setParityFilter] = useState('all')

  // Extracted so the canonical error state can offer a Retry that re-runs the exact same
  // READ-ONLY load. Still only .select() calls - no writes of any kind.
  const loadParity = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // READ-ONLY: SELECTs only. Students with a current canonical primary; the full preceptor
      // roster (for resolvePreceptor + active-primary name display); the active-primary rows.
      const [studentsRes, preceptorsRes, assignmentsRes] = await Promise.all([
        supabase
          .from('students')
          .select('id, first_name, preferred_first_name, last_name, preceptor_id, cohort_id, matched_preceptor, preceptor_email')
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
      // student records not already in the current-primary set - still READ-ONLY.
      const haveIds = new Set(studentsWithPrimary.map(s => s.id))
      const assignmentOnlyIds = [...new Set(assignments.map(a => a.student_id))].filter(id => !haveIds.has(id))
      let assignmentOnlyStudents = []
      if (assignmentOnlyIds.length) {
        const extraRes = await supabase
          .from('students')
          .select('id, first_name, preferred_first_name, last_name, preceptor_id, cohort_id, matched_preceptor, preceptor_email')
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
        const currentName = resolvePreceptor(s, preceptors).name || '-'

        // ACTIVE-PRIMARY side from the new table.
        const a        = apByStudent.get(s.id) || null
        const activeId = a ? a.preceptor_id : null
        const activeName = activeId
          ? (precById.get(activeId)?.full_name || '(preceptor not found)')
          : '-'

        // Parity by IDENTITY only - both directions of drift.
        let parity
        if (currentId && a)       parity = (activeId === currentId) ? 'match' : 'mismatch_changed'
        else if (currentId && !a) parity = 'missing'
        else if (!currentId && a) parity = 'mismatch_cleared'   // reverse drift: primary cleared, assignment remains
        else                      parity = null                 // neither side - not in scope (defensive)

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
          role:   a ? a.role : '-',
          status: a ? a.status : '-',
          updatedAt: a ? a.updated_at : null,
          parity,
        }
      }).filter(r => r.parity !== null)

      computed.sort((x, y) =>
        (PARITY_ORDER[x.parity] - PARITY_ORDER[y.parity]) ||
        x.studentName.localeCompare(y.studentName)
      )

      setRows(computed)
    } catch (err) {
      setLoadError(err?.message || 'Unable to load parity data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    ;(async () => { await loadParity() })()
  }, [isAdmin, loadParity])

  const counts = {
    total:           rows.length,
    match:           rows.filter(r => r.parity === 'match').length,
    mismatchChanged: rows.filter(r => r.parity === 'mismatch_changed').length,
    mismatchCleared: rows.filter(r => r.parity === 'mismatch_cleared').length,
    missing:         rows.filter(r => r.parity === 'missing').length,
  }

  // Card-driven filter: clicking a card filters the table to that parity; clicking the
  // already-active card resets to 'all'. Filtering a pre-sorted array preserves worklist order.
  const filteredRows = parityFilter === 'all' ? rows : rows.filter(r => r.parity === parityFilter)

  const F = 'Plus Jakarta Sans, sans-serif'

  return (
    <div style={{ fontFamily: F }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ ...SETTINGS_HEADING_STYLE, margin: 0 }}>Preceptor Assignment Integrity</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.55 }}>
          Read-only diagnostic over the <strong>union</strong> of students with a current primary
          (<code style={{ fontSize: 12 }}>students.preceptor_id</code>, the canonical primary-preceptor identity) and
          students with an active-primary row in the assignment model (its synchronized mirror, maintained by a
          database trigger on every application write). Parity is computed <strong>by preceptor identity (ID)</strong>,
          both directions, names are display-only. Because every in-app assignment routes through the audited
          workflow, a “Mismatch” or “Missing” row signals drift from out-of-band changes, most likely a manual SQL
          session, and warrants investigation. This view writes nothing.
        </p>
      </div>

      {loading && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-text-secondary, #6b7280)', fontSize: 13 }}>
          Loading parity…
        </div>
      )}

      {!loading && loadError && (
        <SurfaceCard padding="16px 18px" style={{ color: 'var(--color-text-secondary, #6b7280)', fontSize: 13 }}>
          <div>Unable to load parity data: {loadError}</div>
          <button
            type="button"
            onClick={loadParity}
            style={{ marginTop: 10, padding: '7px 16px', border: 'none', borderRadius: 8, background: '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            Retry
          </button>
        </SurfaceCard>
      )}

      {!loading && !loadError && (
        <>
          {/* SETTINGS-UNIFIED-DESIGN-1: FilterKPICard cards filter the table below - clicking the
              active card resets to 'all'. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            {PARITY_CARDS.map(c => (
              <FilterKPICard
                key={c.key}
                value={counts[c.key]}
                label={c.label}
                accent={c.accent}
                active={parityFilter === c.parity}
                onClick={() => setParityFilter(f => (f === c.parity ? 'all' : c.parity))}
              />
            ))}
          </div>

          <DataTable
            columns={PARITY_COLUMNS}
            rows={filteredRows}
            getRowKey={r => r.studentId}
            empty={(
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--color-text-secondary, #6b7280)', fontSize: 13, fontFamily: F }}>
                {rows.length === 0
                  ? 'No students with a current primary or an active-primary assignment.'
                  : 'No students match this parity filter.'}
              </div>
            )}
          />
        </>
      )}
    </div>
  )
}
