// UI-1: governance data table - extracted pixel-for-pixel from the shipped
// Knowledge Center entries table (KT-3a-1): SurfaceCard container, uppercase
// 11px headers, 13px cells, subtle row separators.
//
// columns: [{ key, label, align?: 'left'|'right', headerStyle?, cellStyle?, render?(row) }]
// rows + getRowKey(row) drive the body. `empty` (node) renders alone inside the
// container when rows is empty. onRowClick / rowSelected are accepted for the
// next governance phase (row → detail); when onRowClick is absent, rows render
// exactly as today (no cursor, no hover, no selected treatment).
import SurfaceCard from './SurfaceCard'

const TD_BASE = {
  padding: '10px 14px', fontSize: 13, color: 'var(--color-text-primary, #374151)', verticalAlign: 'middle',
}

export default function DataTable({ columns, rows, getRowKey, onRowClick, rowSelected, empty }) {
  return (
    <SurfaceCard style={{ overflow: 'hidden' }}>
      {(!rows || rows.length === 0) ? (
        empty || null
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border-subtle, #f3f4f6)' }}>
              {columns.map(c => (
                <th key={c.key} className={c.align === 'right' ? 'aspire-th aspire-th-right' : 'aspire-th'} style={c.headerStyle}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const selected = rowSelected ? rowSelected(row) : false
              return (
                <tr
                  key={getRowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{
                    borderTop: '1px solid var(--color-border-subtle, #f3f4f6)',
                    ...(onRowClick ? { cursor: 'pointer' } : {}),
                    ...(selected ? { background: 'var(--color-bg-elevated, #eef2fb)' } : {}),
                  }}
                >
                  {columns.map(c => (
                    <td key={c.key} style={{ ...TD_BASE, ...(c.align === 'right' ? { textAlign: 'right' } : {}), ...c.cellStyle }}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </SurfaceCard>
  )
}
