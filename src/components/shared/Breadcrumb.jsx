// NAV-POLISH-1 (Owner, 2026-10-02): the one breadcrumb. Settings drill-ins, Settings'
// full-screen pages, and the Catalog's Forms and Signatures screens all read
// "Parent / Parent / Here": every parent is a link (a button that navigates), the page you
// are on is plain text marked aria-current, and the "/" is decoration in an AA ink. A
// breadcrumb is a path, not a row of buttons; the white BackButton pill is kept only for
// LEAVING an area ("Back to At a Glance"). Layout: breadcrumb.css.
//
//   <Breadcrumb items={[{ label: 'Settings', onClick }, { label: 'General', onClick }, { label: 'Profile' }]} />
//
// The last item is the current page whatever it carries; every other item needs onClick.
import { Fragment } from 'react'
import './breadcrumb.css'

export default function Breadcrumb({ items, className = '' }) {
  const list = (items || []).filter(Boolean)
  return (
    <nav className={`aspire-crumb${className ? ` ${className}` : ''}`} aria-label="Breadcrumb">
      <ol>
        {list.map((item, i) => {
          const last = i === list.length - 1
          return (
            <Fragment key={`${i}-${item.label}`}>
              {i > 0 && <li className="aspire-crumb-sep" aria-hidden="true">/</li>}
              <li>
                {last
                  ? <span className="aspire-crumb-here" aria-current="page">{item.label}</span>
                  : <button type="button" className="aspire-crumb-link" onClick={item.onClick}>{item.label}</button>}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
