// PAGE-TITLE-1 (Owner, 2026-11-08): one rule for a page that a section nav opens, in the
// staff app and every portal. The tab already names the page, so the page draws no title
// of its own: `name` is a heading read by screen readers only, `meta` is the page's one
// line of context (left) and `actions` its controls (right). With neither, only the
// heading renders and nothing takes space.
import './pageBar.css'

export function PageName({ as: Tag = 'h1', id, children, ...rest }) {
  return <Tag id={id} className="aspire-page-name" {...rest}>{children}</Tag>
}

export default function PageBar({ name, as = 'h1', id, meta, actions, className = '' }) {
  const heading = name ? <PageName as={as} id={id}>{name}</PageName> : null
  if (!meta && !actions) return heading
  return (
    <div className={`aspire-page-bar${className ? ` ${className}` : ''}`}>
      {heading}
      {meta ? <div className="aspire-page-bar-meta">{meta}</div> : <span />}
      {actions ? <div className="aspire-page-bar-actions">{actions}</div> : null}
    </div>
  )
}
