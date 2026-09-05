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
import { useMastheadFeed } from '../shared/useMastheadFeed'
// The CANONICAL fiscal-year clock (pure, Pacific day boundary) - the same one
// the Community Benefit engine uses. Never a second FY definition.
import { currentFiscalYear } from '../../../lib/server/communityBenefit/compute'
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
  // EVENT-AUDIENCE-2: flagged events ticked for Nursing Education & Leadership.
  const mastheadItems = useMastheadFeed('nursing_academic')
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  )
  // Owner: NE&L doesn't live in a cohort the way the other portals do - its
  // masthead context is the FISCAL YEAR (spanning form, "FY 2026-2027"; the
  // canonical fy value is the ENDING year, Jul-Jun on the Pacific boundary).
  const fyLabel = useMemo(() => {
    const fy = currentFiscalYear()
    return `FY ${fy - 1}-${fy}`
  }, [])

  return (
    <div className="ptl-page ptl-na-page">
      <h1 className="ptl-visually-hidden">Nursing Education &amp; Leadership Portal</h1>
      {/* Owner: the masthead greets ONCE, on the landing section only - the
          same shape every other portal has (Student/Unit Leader Home,
          Academic Partner Students). It used to sit above the section switch
          and so repeated on Community Benefit, Contacts, and Messages, which
          pushed those dense views down and let its current-FY label
          contradict the fiscal year selected inside the benefit report. */}
      <div className="ptl-na-stack" style={{ display: view === 'calendar' ? 'flex' : 'none' }}>
        <GreetingMasthead
          fullName={userProfile?.full_name}
          dateLabel={dateLabel}
          contextLabel={fyLabel}
          items={mastheadItems}
        />
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
