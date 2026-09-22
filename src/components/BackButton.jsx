// BackButton - the canonical back-navigation affordance for ASPIRE Intelligence.
// Use this component for every "go back" action in the app. Do not create
// custom back buttons; if a new context needs different behavior, extend
// this component with a new variant rather than forking it.
//
import { BackPill } from './ui/NavigationPill'

export default function BackButton({ label, onClick, className, style, disabled = false }) {
  return <BackPill label={label} onClick={onClick} className={className} style={style} disabled={disabled} />
}
