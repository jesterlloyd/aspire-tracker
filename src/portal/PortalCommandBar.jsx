import Launcher from '../components/home/Launcher'
import '../components/home/home.css'

// STUDENT-HEADER-1 (Owner, 2026-10-04): desktopOnly hides the bar below 760px. A student's search
// only offers the four tabs and the email shortcuts on My Placement, which the phone's bottom bar
// and My Placement already show, so on a phone it only crowded the logo.
export default function PortalCommandBar({ actions = [], people = [], canAskKeith = false, onRun, onOpenPerson, desktopOnly = false }) {
  return (
    <div className={`ptl-command-bar${desktopOnly ? ' ptl-command-bar-desktop' : ''}`} aria-label="Portal command search">
      <Launcher
        actions={actions}
        people={people}
        canAskKeith={canAskKeith}
        onRun={onRun}
        onOpenPerson={onOpenPerson}
        compact
        placeholder="Search"
      />
    </div>
  )
}
