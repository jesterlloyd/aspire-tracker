// HOME-1 (2026-09-24): Placement, demoted to one line and a collapsed panel.
//
// One summary line replaces the five snapshot tiles (src/lib/home/placementSummaryModel.js
// builds every clause from data and omits one it cannot). Below it, a <details> labelled
// "Capacity and requests", collapsed by default, holding two tables that mirror each other
// (Owner, 2026-09-25): both DataSheet PLAIN sheets, the same three columns at the same
// weights (a name, then two right-aligned figures), the same toolbar height above each so
// their heads line up. This departs on purpose from table canon section 8, which drew
// capacity as inline rows. A school's View response now opens from its expanded row, so the
// two sheets keep the same columns.
//
// What sits inside an expanded row is the caller's: the unit rows of a service line
// (with their pills, Remind and View response, exactly as before), and the students of a
// school (with Send Form, which opens Connect and writes nothing here).

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import HomeCard, { CardLink } from './HomeCard'
import DataSheet from '../shared/DataSheet'
import { SummaryLine } from './PhaseCards'

// One grid for both sheets: a name, then two figures. Mirrored columns line up.
const mirror = (nameKey, nameLabel, aKey, aLabel, bKey, bLabel) => [
  { key: nameKey, label: nameLabel, min: 120, grow: 2.2, priority: 1 },
  { key: aKey, label: aLabel, min: 64, grow: 0.7, align: 'right', priority: 1, render: r => <b>{r[aKey]}</b> },
  { key: bKey, label: bLabel, min: 64, grow: 0.7, align: 'right', priority: 1 },
]
const CAPACITY_COLUMNS = mirror('serviceLine', 'Service line', 'filled', 'Filled', 'slots', 'Slots')
const REQUEST_COLUMNS = mirror('school', 'School', 'placed', 'Placed', 'students', 'Students')

export default function PlacementCard({
  summary, cap, capacityRows = [], requestRows = [], capacityToolbar = null, requestsToolbar = null,
  renderCapacityDetail, renderRequestDetail, onViewResponse, onNavigate, order, notices = null,
}) {
  const [openCap, setOpenCap] = useState(() => new Set())
  const [openReq, setOpenReq] = useState(() => new Set())
  const toggle = (setter) => (key) => setter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })


  const clauses = (summary?.clauses || []).map(c => ({ key: c.key, strong: c.strong, tone: c.tone, post: c.strong != null ? c.text.replace(c.strong, '') : c.text }))

  return (
    <HomeCard id="hm-placement" title="Placement" cap={cap} material="sheet" className="material-pagestack" order={order}
      right={<CardLink label="Placement Board" to="/rotation/matrix" onNavigate={onNavigate} />}>
      {notices}
      <SummaryLine clauses={clauses} />
      <details className="hm-pl">
        <summary><ChevronRight size={14} className="hm-chev" aria-hidden="true" /> Capacity and requests</summary>
        <div className="hm-pl-body">
          <div className="hm-pl-col">
            <div className="hm-pl-bar">{capacityToolbar}</div>
            <DataSheet
              level="plain"
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
            <div className="hm-pl-bar">{requestsToolbar}</div>
            <DataSheet
              level="plain"
              title="Requests by school"
              columns={REQUEST_COLUMNS}
              rows={requestRows}
              rowKey={r => r.id}
              defaultSort={{ key: 'school', dir: 'asc' }}
              expandable={!!renderRequestDetail}
              expandedKeys={openReq}
              onToggleExpand={toggle(setOpenReq)}
              renderExpanded={(r) => (
                <>
                  <div className="hm-pl-detail-head">
                    <button type="button" className="hm-link hm-link-sm" onClick={() => onViewResponse?.(r.school)}>
                      View response
                    </button>
                  </div>
                  {renderRequestDetail?.(r)}
                </>
              )}
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
