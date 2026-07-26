// src/components/oncampus/OnCampusNow.jsx
//
// Shared, presentational "On Campus Now" live-shift card. It renders the canonical
// .mast-live-* card system (src/index.css) from already-normalized, ROLE-SAFE rows plus one
// avatar node per row. It holds no data, performs no authorization, and reads no clock; each
// caller (the staff At a Glance dashboard, the Unit Leader portal, and later Academic Partner
// / Student portals) builds its own scoped rows and supplies its own avatar component, so the
// identical card renders for every role and the main app stays visually unchanged.
//
// Each row: { key, avatar, name, subLabel, badge:{label,tone}|null, statusText, statusWarn,
//             onClick, ariaLabel }

export default function OnCampusNow({
  title = 'On Campus Now',
  sub = null,
  onViewAll = null,
  rows = [],
  emptyText = null,        // when set, an empty list shows this zero-state instead of nothing
}) {
  if (rows.length === 0 && !emptyText) return null
  return (
    <div className="mast-live">
      <div className="mast-live-head">
        <span className="mast-live-dot" aria-hidden />
        <span className="mast-live-title">{title}</span>
        {sub && <span className="mast-live-sub">{sub}</span>}
        {onViewAll && (
          <button type="button" className="mast-live-link" onClick={onViewAll}>View all activity →</button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mast-live-empty">{emptyText}</p>
      ) : (
        <div className="mast-live-grid">
          {rows.map(r => (
            <button key={r.key} type="button" className="mast-live-card"
              onClick={r.onClick} aria-label={r.ariaLabel}>
              {r.avatar}
              <span className="mast-live-info">
                <span className="mast-live-name">{r.name}</span>
                <span className="mast-live-unit">{r.subLabel}</span>
              </span>
              <span className="mast-live-right">
                {r.badge && <span className={`mast-live-shift mast-shift-${r.badge.tone}`}>{r.badge.label}</span>}
                {r.statusText && (
                  <span className={r.statusWarn ? 'mast-live-dur warn' : 'mast-live-dur'}>{r.statusText}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
