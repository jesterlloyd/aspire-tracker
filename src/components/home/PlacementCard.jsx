// HOME-1 (2026-09-24): Placement, demoted to one line and a collapsed panel.
//
// One summary line replaces the five snapshot tiles (src/lib/home/placementSummaryModel.js
// builds every clause from data and omits one it cannot). Below it, a <details> labelled
// "Capacity and requests", collapsed by default: capacity by service line as DataSheet
// INLINE rows on the left, requests by school as a DataSheet PLAIN sheet on the right,
// with the existing expand and collapse by school and the View response links (table
// canon §8: Placement Requests is a plain sheet, Placement Capacity is inline rows).
//
// What sits inside an expanded row is the caller's: the unit rows of a service line
// (with their pills, Remind and View response, exactly as before), and the students of a
// school (with Send Form, which opens Connect and writes nothing here).

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import HomeCard, { CardLink } from './HomeCard'
import DataSheet from '../shared/DataSheet'
import { SummaryLine } from './PhaseCards'

const CAPACITY_COLUMNS = [
  { key: 'serviceLine', label: 'Service line', min: 120, grow: 2, priority: 1 },
  { key: 'filled', label: 'Filled', min: 56, grow: 0.6, align: 'right', priority: 1, render: r => <b>{r.filled}</b> },
  { key: 'slots', label: 'Slots', min: 56, grow: 0.6, align: 'right', priority: 1 },
]

export default function PlacementCard({
  summary, cap, capacityRows = [], requestRows = [], capacityToolbar = null, requestsToolbar = null,
  renderCapacityDetail, renderRequestDetail, onViewResponse, onNavigate, order, notices = null,
}) {
  const [openCap, setOpenCap] = useState(() => new Set())
  const [openReq, setOpenReq] = useState(() => new Set())
  const toggle = (setter) => (key) => setter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  const requestColumns = [
    { key: 'school', label: 'School', min: 160, grow: 2.2, priority: 1 },
    { key: 'placed', label: 'Placed', min: 56, grow: 0.6, align: 'right', priority: 1, render: r => <b>{r.placed}</b> },
    { key: 'students', label: 'Students', min: 64, grow: 0.6, align: 'right', priority: 1 },
    {
      key: 'response', label: 'Response', min: 104, grow: 0.8, priority: 2, sortable: false,
      render: r => (
        <button type="button" className="hm-link hm-link-sm" onClick={(e) => { e.stopPropagation(); onViewResponse?.(r.school) }}>
          View response
        </button>
      ),
    },
  ]

  const clauses = (summary?.clauses || []).map(c => ({ key: c.key, strong: c.strong, tone: c.tone, post: c.strong != null ? c.text.replace(c.strong, '') : c.text }))

  return (
    <HomeCard id="hm-placement" title="Placement" cap={cap} material="sheet" order={order}
      right={<CardLink label="Placement Board" to="/rotation/matrix" onNavigate={onNavigate} />}>
      {notices}
      <SummaryLine clauses={clauses} />
      <details className="hm-pl">
        <summary><ChevronRight size={14} className="hm-chev" aria-hidden="true" /> Capacity and requests</summary>
        <div className="hm-pl-body">
          <div className="hm-pl-col">
            {capacityToolbar}
            <DataSheet
              level="inline"
              title="Capacity by service line"
              columns={CAPACITY_COLUMNS}
              rows={capacityRows}
              rowKey={r => r.id}
              defaultSort={null}
              expandable={!!renderCapacityDetail}
              expandedKeys={openCap}
              onToggleExpand={toggle(setOpenCap)}
              renderExpanded={renderCapacityDetail}
              expandLabel={r => `${r.serviceLine} units`}
              emptyMessage="No hosting units yet"
              aria-label="Capacity by service line"
            />
          </div>
          <div className="hm-pl-col">
            {requestsToolbar}
            <DataSheet
              level="plain"
              title="Requests by school"
              columns={requestColumns}
              rows={requestRows}
              rowKey={r => r.id}
              defaultSort={{ key: 'school', dir: 'asc' }}
              expandable={!!renderRequestDetail}
              expandedKeys={openReq}
              onToggleExpand={toggle(setOpenReq)}
              renderExpanded={renderRequestDetail}
              expandLabel={r => `${r.school} students`}
              emptyMessage="No student requests yet"
              aria-label="Requests by school"
            />
          </div>
        </div>
      </details>
    </HomeCard>
  )
}
