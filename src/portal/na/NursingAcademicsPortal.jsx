// NURSING-ACADEMICS-1: the Nursing Academics portal experience.
//
// Organization-wide, VIEW-ONLY portal for authorized BNI nursing academics
// and leadership: the shared greeting masthead plus two URL-driven sections
// (Academic Calendar and Community Benefit). Sections stay mounted and hide
// with display, matching the other portals, so month position, filters, and
// the loaded report survive navigation.
//
// Every read is a JWT-verified /api/portal/academics-* endpoint that
// re-checks the active nursing_academic grant server-side; nothing here
// writes anything, anywhere.

import { useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import GreetingMasthead from '../../components/masthead/GreetingMasthead'
import { useLastVisitLabel } from '../../lib/lastVisit'
import AcademicsCalendarView from './AcademicsCalendarView'
import CommunityBenefitView from './CommunityBenefitView'

export default function NursingAcademicsPortal({ view = 'calendar' }) {
  const { userProfile } = useAuth()
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  )
  const lastVisitLine = useLastVisitLabel(
    userProfile?.id ? `aspire:lastVisit:portal:na:${userProfile.id}` : null,
  )

  return (
    <div className="ptl-page ptl-na-page">
      <h1 className="ptl-visually-hidden">Nursing Academics Portal</h1>
      <GreetingMasthead
        fullName={userProfile?.full_name}
        dateLabel={dateLabel}
        contextLabel="Nursing Academics"
        lastVisitLine={lastVisitLine}
      />
      <div style={{ display: view === 'calendar' ? 'block' : 'none' }}>
        <AcademicsCalendarView />
      </div>
      <div style={{ display: view === 'community-benefit' ? 'block' : 'none' }}>
        <CommunityBenefitView />
      </div>
    </div>
  )
}
