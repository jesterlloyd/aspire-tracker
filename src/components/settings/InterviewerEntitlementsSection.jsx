// INTERVIEWER-ENTITLEMENTS-UI-1: the Account Profile section that makes an
// interviewer's cohort access visible and manageable.
//
// WHY THIS EXISTS
// interviewer_cohort_entitlements decides three things at once for an
// interviewer: whether they can open a student's resume, whether headshots
// render instead of initials, and whether Keith's Resume Interview Questions
// will run. Until now the only way to grant one was to schedule the interviewer
// (api/availability.js grants the cohort when an availability block is created),
// and the only way to SEE one was SQL. An interviewer who had never been
// scheduled failed on all three surfaces silently, with nothing in the product
// explaining why. This section is that explanation, plus the direct grant.
//
// It writes only through /api/interviewer-entitlements (active Owner/Admin only,
// server-authoritative). It grants nothing implicitly: holding the Interviewer
// role still confers no cohort, which is deliberate - access follows a decision,
// not a role. The scheduling grant is untouched and shows up here like any other.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { activeCohortIds, grantableCohorts } from '../../lib/interviewerEntitlements'
import { useInterviewerEntitlements, postEntitlements, ENTITLEMENTS_KEY } from '../../lib/useInterviewerEntitlements'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

export default function InterviewerEntitlementsSection({ user, sectionTitle, onToast }) {
  const qc = useQueryClient()
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState('')      // cohort id being granted/revoked
  const [error, setError] = useState('')

  const { rows, cohorts, active, isLoading: rowsLoading, isError: rowsError, refetch } =
    useInterviewerEntitlements(user.id)

  const held = activeCohortIds(rows, user.id)
  const grantable = grantableCohorts(cohorts, held)

  const run = async (cohortId, action) => {
    setBusy(cohortId); setError('')
    try {
      await postEntitlements({ action, interviewer_profile_id: user.id, cohort_id: cohortId })
      await qc.invalidateQueries({ queryKey: ENTITLEMENTS_KEY(user.id) })
      if (action === 'grant') setPick('')
      onToast?.(action === 'grant' ? 'Cohort access granted.' : 'Cohort access revoked.')
    } catch (e) {
      setError(e.message === 'staff_role_required' || e.message === 'inactive_staff'
        ? 'Only an active Owner or Admin can change cohort access.'
        : 'Could not update cohort access. Nothing was changed.')
    } finally {
      setBusy('')
    }
  }

  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px',
    background: '#eef2ff', border: '1px solid #e0e7ff', borderRadius: 999,
    fontFamily: F, fontSize: 12, fontWeight: 600, color: NAVY,
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={sectionTitle}>
        Cohort Access{' '}
        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#9ca3af' }}>
          · resumes, headshots, and Keith
        </span>
      </div>

      <p style={{ margin: '0 0 12px', fontFamily: F, fontSize: 12, lineHeight: 1.55, color: '#6b7280' }}>
        An interviewer can open a student’s resume and headshot, and run Keith’s Resume Interview
        Questions, only for cohorts listed here. Scheduling an interview grants that cohort
        automatically; the Interviewer role on its own grants none.
      </p>

      {rowsLoading && (
        <div style={{ fontFamily: F, fontSize: 12, color: '#9ca3af' }}>Loading cohort access…</div>
      )}

      {rowsError && !rowsLoading && (
        <div style={{ fontFamily: F, fontSize: 12, color: '#b91c1c' }}>
          Could not load cohort access.{' '}
          <button type="button" onClick={() => refetch()}
            style={{ background: 'none', border: 'none', padding: 0, color: NAVY, fontFamily: F, fontSize: 12, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      )}

      {!rowsLoading && !rowsError && (
        active.length === 0 ? (
          // The state that makes the whole surface worth building: say exactly
          // what is blocked, so nobody has to guess why photos are initials.
          <div style={{
            padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 8, fontFamily: F, fontSize: 12, lineHeight: 1.55, color: '#92400e', marginBottom: 12,
          }}>
            <strong>No cohort access.</strong> This interviewer cannot open any student’s resume or
            headshot, photos show as initials, and Keith’s Resume Interview Questions will decline for
            every student. Grant a cohort below, or schedule them for an interview.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {active.map(e => (
              <span key={e.cohortId} style={chip}
                title={e.grantedAt ? `Granted ${new Date(e.grantedAt).toLocaleDateString()}` : undefined}>
                {e.cohortName}
                <button type="button"
                  onClick={() => run(e.cohortId, 'revoke')}
                  disabled={busy === e.cohortId}
                  aria-label={`Revoke ${e.cohortName} access`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18, borderRadius: '50%', border: 'none',
                    background: busy === e.cohortId ? '#e5e7eb' : 'transparent',
                    color: '#6b7280', fontSize: 14, lineHeight: 1,
                    cursor: busy === e.cohortId ? 'default' : 'pointer', padding: 0,
                  }}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )
      )}

      {!rowsLoading && !rowsError && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={pick}
            onChange={e => setPick(e.target.value)}
            disabled={!grantable.length || !!busy}
            aria-label="Cohort to grant"
            style={{
              flex: 1, height: 34, padding: '0 10px', border: '1px solid #e5e7eb', borderRadius: 8,
              fontFamily: F, fontSize: 12.5, outline: 'none', background: '#fff',
              cursor: grantable.length ? 'pointer' : 'not-allowed', opacity: grantable.length ? 1 : 0.6,
            }}>
            <option value="">
              {grantable.length ? 'Add a cohort…' : 'All cohorts already granted'}
            </option>
            {grantable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button"
            onClick={() => pick && run(pick, 'grant')}
            disabled={!pick || !!busy}
            style={{
              height: 34, padding: '0 14px', borderRadius: 8, border: 'none',
              background: pick && !busy ? NAVY : '#e5e7eb',
              color: pick && !busy ? '#fff' : '#9ca3af',
              fontFamily: F, fontSize: 12.5, fontWeight: 600,
              cursor: pick && !busy ? 'pointer' : 'not-allowed',
            }}>
            {busy && busy === pick ? 'Granting…' : 'Grant'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontFamily: F, fontSize: 12, color: '#b91c1c' }}>{error}</div>
      )}
    </div>
  )
}
