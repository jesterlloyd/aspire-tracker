import Launcher from '../components/home/Launcher'
import '../components/home/home.css'

export default function PortalCommandBar({ actions = [], people = [], canAskKeith = false, onRun, onOpenPerson, onQuery }) {
  return (
    <div className="ptl-command-bar" aria-label="Portal command search">
      <Launcher
        actions={actions}
        people={people}
        canAskKeith={canAskKeith}
        onRun={onRun}
        onOpenPerson={onOpenPerson}
        onQuery={onQuery}
        compact
        placeholder="Search"
      />
    </div>
  )
}
