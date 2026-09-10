import { ExternalLink } from 'lucide-react'

// CSLINK-SERVICENOW-1: opens a ServiceNow item in a new tab. It never ticks anything: opening
// the form is not the same as sending the request, so the tickbox beside it records that.
export default function ServiceNowLink({ href, children }) {
  return (
    <a className="sn-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink size={11} aria-hidden="true" />
      <span className="sr-only"> (opens ServiceNow in a new tab)</span>
    </a>
  )
}
