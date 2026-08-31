// NURSING-ACADEMICS-1: the Nursing Academics portal experience.
//
// Organization-wide, VIEW-ONLY portal for authorized BNI nursing education
// and leadership users: the shared greeting masthead plus three URL-driven
// sections (At A Glance, Community Benefit, and Contacts). Sections stay mounted and hide
// with display, matching the other portals, so month position, filters, and
// the loaded report survive navigation.
//
// Every read is a JWT-verified /api/portal/academics-* endpoint that
// re-checks the active nursing_academic grant server-side; nothing here
// writes anything, anywhere.

import { useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import GreetingMasthead from '../../components/masthead/GreetingMasthead'
import { EmptyState } from '../unit/UnitLeaderChrome'
import PortalMessagesWorkspace from '../messages/PortalMessagesWorkspace'
import AcademicsCalendarView from './AcademicsCalendarView'
import CommunityBenefitView from './CommunityBenefitView'
import AcademicsContactsView from './AcademicsContactsView'

// NA-PORTAL-UTILITIES-1: Messages reuses the SAME canonical PortalMessagesWorkspace the other
// portals use (variant='nursing_academic'). Enablement is the SERVER capability passed as
// messagesEnabled (env flag AND applied DB migration), never a client constant; until the server
// reports enabled, a pasted /portal/academics/messages link shows an honest prepared state.
export default function NursingAcademicsPortal({ view = 'calendar', messagesEnabled = false, threadId, onSelectThread, onBackToList }) {
  const { userProfile } = useAuth()
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  )

  return (
    <div className="ptl-page ptl-na-page">
      <h1 className="ptl-visually-hidden">Nursing Education &amp; Leadership Portal</h1>
      <GreetingMasthead
        fullName={userProfile?.full_name}
        dateLabel={dateLabel}
        contextLabel="Nursing Education & Leadership"
      />
      <div style={{ display: view === 'calendar' ? 'block' : 'none' }}>
        <AcademicsCalendarView active={view === 'calendar'} />
      </div>
      <div style={{ display: view === 'community-benefit' ? 'block' : 'none' }}>
        <CommunityBenefitView active={view === 'community-benefit'} />
      </div>
      <div style={{ display: view === 'contacts' ? 'block' : 'none' }}>
        <AcademicsContactsView active={view === 'contacts'} />
      </div>
      {view === 'messages' && (
        messagesEnabled ? (
          <PortalMessagesWorkspace
            active
            variant="nursing_academic"
            threadId={threadId}
            onSelectThread={onSelectThread}
            onBackToList={onBackToList}
          />
        ) : (
          <EmptyState
            title="Messages"
            detail="Secure messaging with the ASPIRE Team will live here. This section is being prepared and is not active yet."
          />
        )
      )}
    </div>
  )
}
