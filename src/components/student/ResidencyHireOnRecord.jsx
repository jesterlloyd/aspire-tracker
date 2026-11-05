// STUDENT-HIRE-READ-1 (Owner, 2026-11-05): Student Profiles > Placement shows the residency hire
// READ-ONLY. The record is kept in one place, the Residency binder's Hiring sheet; this section
// reads it and links there, so the two screens cannot disagree.
//
// Shown only for a Completed student and only to a viewer with Residency access: anyone else gets
// a refusal from the endpoint and this draws nothing. Markup is the chart's own (sp-section,
// sp-field, sp-readonly), so it is part of the sheet and needs no new style.
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchStudentHires } from '../../lib/ngrp/useNgrpData'
import { residentRecordPath } from '../../lib/ngrp/ngrpResidents'
import { hireLines } from '../../lib/ngrp/studentHireModel'

export default function ResidencyHireOnRecord({ student }) {
  const navigate = useNavigate()
  const completed = student?.status === 'Completed'
  const q = useQuery({
    queryKey: ['ngrp-student-hire', student?.id],
    queryFn: () => fetchStudentHires(student.id),
    enabled: Boolean(student?.id) && completed,
    staleTime: 60_000,
  })
  if (!completed || !q.data?.ok || q.data.provisioned === false) return null
  const hires = q.data.hires
  return (
    <div className="sp-section sp-card" data-testid="residency-hire-on-record">
      <div className="sp-section-hdr" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', rowGap: 6 }}>
        <span style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11 }}>Residency</span>
      </div>
      {hires.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-caption)' }}>No residency hire is on record.</p>
      ) : hires.map(h => (
        <div key={h.candidate_id} style={{ marginBottom: 8 }}>
          <div className="sp-grid-2">
            {hireLines(h).map(([label, value]) => (
              <div className="sp-field" key={label}>
                <label className="sp-field-lbl">{label}</label>
                <div className="sp-readonly">{value}</div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => navigate(residentRecordPath('/ngrp', h.candidate_id))}
            style={{ marginTop: 8, fontSize: 12, color: 'var(--color-accent-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            Open the Hiring sheet in Residency →
          </button>
        </div>
      ))}
    </div>
  )
}
