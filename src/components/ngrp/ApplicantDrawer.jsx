// NGRP-WORKSPACE-1: applicant detail drawer. Identity is the canonical ASPIRE
// student record; everything cycle-specific renders from the (optional)
// ngrp_candidates row with neutral defaults. Actions are declared here but
// stay disabled until the Phase-2 endpoints exist (see
// docs/product/NGRP-WORKSPACE-1.md) - the drawer never fabricates a write
// path. Raw preceptor survey answers are never surfaced here; only the
// approved recommendation summary will be (Phase 2, when authorized).
import DetailDrawer from '../ui/DetailDrawer'
import StudentAvatar from '../StudentAvatar'
import NgrpStatusPill from './NgrpStatusPill'
import {
  FORM_STATES, INTEREST_STATES, ELIGIBILITY_STATES, APPLICATION_STATES,
  INTERVIEW_STATES, effectiveEligibility, formTimestamp,
} from '../../lib/ngrp/ngrpStates'
import { displayName } from '../../lib/utils'

const fmt = ts => {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Section({ title, tint, children }) {
  return (
    <section style={{ background: tint, borderRadius: 12, padding: '13px 15px', marginBottom: 10 }}>
      <h3 style={{
        margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #6b7280)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        paddingBottom: 8, borderBottom: '1px solid rgba(0,0,0,0.045)',
      }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
      <span style={{ color: '#6B7785', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--raven, #191919)', textAlign: 'right', minWidth: 0 }}>{children}</span>
    </div>
  )
}

// Transition Form lifecycle: Sent → Opened → In Progress → Submitted, with
// Revised as a marker on the Submitted step. Reached steps are solid.
function FormLifecycle({ row }) {
  const steps = [
    { key: 'sent',        label: 'Sent',      at: row.form_sent_at },
    { key: 'opened',      label: 'Opened',    at: row.form_opened_at },
    { key: 'in_progress', label: 'Draft',     at: row.form_last_saved_at },
    { key: 'submitted',   label: 'Submitted', at: row.form_submitted_at },
  ]
  const orderIdx = { not_sent: -1, sent: 0, opened: 1, in_progress: 2, submitted: 3, revised: 3 }
  const reached = orderIdx[row.form_status] ?? -1
  return (
    <div style={{ display: 'flex', margin: '4px 0 6px' }} aria-hidden="true">
      {steps.map((s, i) => (
        <div key={s.key} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
          {i > 0 && (
            <div style={{
              position: 'absolute', top: 6, left: '-50%', width: '100%', height: 2,
              background: i <= reached ? '#2F7D5C' : '#E5E7EB',
            }} />
          )}
          <div style={{
            width: 14, height: 14, borderRadius: '50%', margin: '0 auto 5px',
            position: 'relative', zIndex: 1, border: '2px solid #fff',
            background: i <= reached ? '#2F7D5C' : '#E5E7EB',
            boxShadow: `0 0 0 1px ${i <= reached ? '#2F7D5C' : '#D1D5DB'}`,
          }} />
          <div style={{ fontSize: 10, fontWeight: 700, color: i <= reached ? '#1F3219' : '#9CA3AF' }}>{s.label}</div>
          <div style={{ fontSize: 9, color: '#9CA3AF' }}>{fmt(s.at) || '—'}</div>
        </div>
      ))}
    </div>
  )
}

export default function ApplicantDrawer({
  open, row, cycle, canEdit, provisioned, onClose,
}) {
  if (!open || !row) return null
  const s = row.student
  const elig = effectiveEligibility(row)
  const overridden = Boolean(row.eligibility_effective)
  const reasons = Array.isArray(row.eligibility_reasons) ? row.eligibility_reasons : []
  const prefs = [row.unit_preference_1, row.unit_preference_2, row.unit_preference_3]
  const gateNote = !provisioned
    ? 'Available after the NGRP foundation migration is applied'
    : 'Available with the Phase-2 NGRP endpoints'

  const gatedBtn = (label, primary = false) => (
    <button
      key={label}
      type="button"
      disabled
      title={gateNote}
      style={{
        height: 34, padding: '0 14px', borderRadius: 9, fontSize: 13, fontWeight: 600,
        fontFamily: 'DM Sans, sans-serif', cursor: 'not-allowed', opacity: 0.55,
        background: primary ? '#1D2567' : '#F3F4FF',
        color: primary ? '#fff' : '#1D2567',
        border: primary ? 'none' : '1px solid #E0E7FF',
      }}
    >
      {label}
    </button>
  )

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={`${displayName(s)} · NGRP`}
      footer={canEdit ? (
        <>
          <span style={{ marginRight: 'auto', fontSize: 11, color: '#9CA3AF' }}>{gateNote}</span>
          {gatedBtn(row.form_status === 'not_sent' ? 'Send Transition Form' : 'Resend Form', true)}
          {gatedBtn('Confirm Application')}
        </>
      ) : null}
    >
      {/* Identity hero - canonical ASPIRE student record */}
      <div style={{
        background: 'linear-gradient(160deg, #dceff8 0%, #f0f6fb 55%, #ffffff 100%)',
        borderRadius: 12, padding: '20px 16px 16px', textAlign: 'center', marginBottom: 12,
      }}>
        <StudentAvatar student={s} size={72} style={{ margin: '0 auto 10px', border: '4px solid #fff', boxShadow: '0 4px 18px rgba(29,37,103,0.16)' }} />
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1D2567', lineHeight: 1.2 }}>{displayName(s)}</div>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3 }}>
          {[s.school, s.program_type].filter(Boolean).join(' · ')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
          {s.aspire_cohort && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#EDF0F7', color: '#4A5D8F' }}>
              ASPIRE · {s.aspire_cohort}
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#f0fdf4', color: '#14532d', border: '1px solid #4ade80' }}>
            ASPIRE Completed
          </span>
          {cycle && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#EDEEF4', color: '#1D2567' }}>
              NGRP · {cycle.name}
            </span>
          )}
        </div>
      </div>

      <Section title="Transition Form" tint="rgba(96,120,170,0.055)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <NgrpStatusPill config={FORM_STATES} value={row.form_status} srPrefix="Transition Form" />
          {row.form_status === 'revised' && (row.form_revision_count || 0) > 0 && (
            <span style={{ fontSize: 11, color: '#6B7785' }}>
              Revision {row.form_revision_count} · latest {fmt(row.form_revised_at) || '—'}
            </span>
          )}
        </div>
        <FormLifecycle row={row} />
        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#9CA3AF' }}>
          Alumni can revise a submitted form until the cycle deadline
          {cycle?.application_deadline ? ` (${cycle.application_deadline})` : ''}. Sending the form
          records “Transition Form Sent” - it is not an invitation to apply.
        </p>
      </Section>

      <Section title="Residency Interest" tint="rgba(96,120,170,0.055)">
        <Row label="Interest"><NgrpStatusPill config={INTEREST_STATES} value={row.interest} /></Row>
        {row.interest === 'no_response' && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>
            No response yet - a neutral state, not a decline.
          </p>
        )}
      </Section>

      <Section title="Eligibility" tint="rgba(110,150,135,0.075)">
        <Row label="Calculated result">
          <NgrpStatusPill config={ELIGIBILITY_STATES} value={row.eligibility_calculated} />
        </Row>
        {overridden && (
          <>
            <Row label="Effective result (staff override)">
              <NgrpStatusPill config={ELIGIBILITY_STATES} value={elig} />
            </Row>
            <Row label="Override reason">
              <span style={{ fontWeight: 400, color: '#5A6170' }}>{row.eligibility_override_reason || '—'}</span>
            </Row>
            {row.eligibility_overridden_at && (
              <Row label="Overridden">{fmt(row.eligibility_overridden_at)}</Row>
            )}
          </>
        )}
        {reasons.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            {reasons.map((r, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12,
                padding: '5px 0', borderBottom: i < reasons.length - 1 ? '1px dashed rgba(0,0,0,0.06)' : 'none',
              }}>
                <span aria-hidden="true" style={{ flexShrink: 0, width: 14, textAlign: 'center', color: r.met ? '#166534' : '#92400e', fontWeight: 700 }}>
                  {r.met ? '✓' : '·'}
                </span>
                <span style={{ color: '#5A6170', flex: 1 }}>{r.label}</span>
                {r.deadline && <span style={{ color: '#92400E', fontWeight: 600, whiteSpace: 'nowrap' }}>due {r.deadline}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>
            Requirement detail appears once eligibility has been calculated for this cycle.
          </p>
        )}
        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9CA3AF' }}>
          Optional support participation never affects eligibility. An eligible result is not an
          official application.
        </p>
      </Section>

      <Section title="Unit Preferences & Assignment" tint="rgba(212,184,138,0.10)">
        {prefs.some(Boolean) ? prefs.map((u, i) => u && (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0' }}>
            <span style={{
              width: 20, height: 20, borderRadius: 6, background: '#EDEEF4', color: '#1D2567',
              fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>{i + 1}</span>
            <span style={{ fontWeight: 600 }}>{u}</span>
          </div>
        )) : (
          <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>Ranked preferences arrive with the submitted Transition Form.</p>
        )}
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)', marginTop: 8, paddingTop: 8 }}>
          <Row label="HR-assigned unit">
            {row.assigned_unit
              ? <span>{row.assigned_unit}{row.assigned_unit_changed_at ? <span style={{ fontWeight: 400, color: '#92400E' }}> · changed {fmt(row.assigned_unit_changed_at)}</span> : null}</span>
              : <span style={{ fontWeight: 400, color: '#6b7280' }}>No assignment</span>}
          </Row>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9CA3AF' }}>
            Ranked preferences are the alumnus’s request; HR selects the one assigned unit and interview.
          </p>
        </div>
      </Section>

      <Section title="Official Application" tint="rgba(150,120,150,0.06)">
        <Row label="Status"><NgrpStatusPill config={APPLICATION_STATES} value={row.application_status} /></Row>
        {row.application_confirmed_at && <Row label="Confirmed">{fmt(row.application_confirmed_at)}</Row>}
        {row.application_withdrawn_at && <Row label="Withdrawn">{fmt(row.application_withdrawn_at)}</Row>}
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>
          Only “Confirmed” means this alumnus appears on the official NGRP applicant list.
        </p>
      </Section>

      <Section title="Interview" tint="rgba(150,120,150,0.06)">
        <Row label="Status"><NgrpStatusPill config={INTERVIEW_STATES} value={row.interview_status} /></Row>
        {row.interview_at && <Row label="Scheduled for">{fmt(row.interview_at)}</Row>}
        {row.interviewer_name && <Row label="Interviewer">{row.interviewer_name}</Row>}
      </Section>

      {/* The legacy students.ngrp_cohort_target / ngrp_outcome fields are
          deliberately NOT shown: the cycle/candidate/outcome tables are the
          NGRP source of truth and the endpoint no longer returns them. */}
      <Section title="Activity" tint="rgba(120,124,134,0.05)">
        {row.candidate ? (
          <>
            {formTimestamp(row) && <Row label="Latest form activity">{fmt(formTimestamp(row))}</Row>}
            <Row label="Candidate record created">{fmt(row.candidate.created_at) || '—'}</Row>
            <Row label="Last updated">{fmt(row.candidate.updated_at) || '—'}</Row>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>
            No NGRP activity yet for this cycle. A candidate record is created with the first
            NGRP action (for example, sending the Transition Form).
          </p>
        )}
      </Section>
    </DetailDrawer>
  )
}
