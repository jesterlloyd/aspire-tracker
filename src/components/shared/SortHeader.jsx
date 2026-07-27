// Canonical sortable table-column header, extracted from PreceptorDirectoryTable so the staff roster
// and the portal rosters share ONE sort-indicator treatment: a real <button> carrying the column
// label and a directional arrow (↑ ascending, ↓ descending, nothing when unsorted), with aria-sort on
// the <th> and a dynamic aria-label announcing the action the click performs. The arrow is a text
// glyph inheriting the button color (no SVG, no icon set), exactly as the staff app.
//
// Called with defaults, the output is byte-identical to the staff app's original header, so adopting
// it there changes nothing visible. Two optional props let a caller keep its own header-cell context
// without altering the indicator itself:
//   - thClassName: overrides the <th> class (default is the staff `am-th am-sortable`). A portal
//     roster passes its own so the cell keeps the portal table styling.
//   - after: adjacent content rendered inside the header cell, to the right of the sort button (used
//     for the Academic Partner ASPIRE status legend popover).

export default function SortHeader({
  sortKey,
  sortBy,
  sortDir,
  onSort,
  children,
  thClassName = 'am-th am-sortable',
  after = null,
}) {
  const active = sortBy === sortKey
  const next = active && sortDir === 'asc' ? 'descending' : 'ascending'
  const button = (
    <button
      type="button"
      className="preceptor-dir-sort"
      onClick={() => onSort?.(sortKey)}
      aria-label={`Sort by ${children} ${next}`}
    >
      <span>{children}</span>
      <span aria-hidden="true">{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
    </button>
  )
  return (
    <th
      scope="col"
      className={thClassName}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {after ? <span className="am-sort-th-inner">{button}{after}</span> : button}
    </th>
  )
}
