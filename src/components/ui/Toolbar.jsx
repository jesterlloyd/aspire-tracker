// UI-1: governance toolbar row — search (growing) + inline filters + a
// right-aligned primary action. Layout extracted pixel-for-pixel from the
// shipped Knowledge Center toolbar (KT-3a-1): the search slot grows
// (flex 1 1 220px, relative for an absolutely-positioned leading icon),
// filters sit inline, the primary action is pushed right.
export default function Toolbar({ search, filters, primaryAction }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
      {search && (
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          {search}
        </div>
      )}
      {filters}
      {primaryAction && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {primaryAction}
        </div>
      )}
    </div>
  )
}
