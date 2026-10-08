// NURSING-ACADEMICS-1: the Nursing Academics portal experience.
//
// Organization-wide, VIEW-ONLY portal for authorized BNI nursing education
// and leadership users: the shared greeting masthead plus three URL-driven
// sections (At a Glance, Community Benefit, and Contacts). Sections stay mounted and hide
// with display, matching the other portals, so month position, filters, and
// the loaded report survive navigation.
//
// Every read is a JWT-verified /api/portal/academics-* endpoint that
// re-checks the active nursing_academic grant server-side; nothing here
// writes anything, anywhere.

import { useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import SkylineCard from '../../components/SkylineCard'
import { useMastheadFeed } from '../shared/useMastheadFeed'
// The CANONICAL fiscal-year clock (pure, Pacific day boundary) - the same one
// the Community Benefit engine uses. Never a second FY definition.
import { currentFiscalYear } from '../../../lib/server/communityBenefit/compute'
import { EmptyState } from '../unit/UnitLeaderChrome'
import PortalMessagesWorkspace from '../messages/PortalMessagesWorkspace'
import ProgramBudgetView from '../../components/budget/ProgramBudgetView'
import { PORTAL_SOURCE } from '../../components/budget/budgetApi'
import AcademicsCalendarView from './AcademicsCalendarView'
import CommunityBenefitView from './CommunityBenefitView'
import AcademicsContactsView from './AcademicsContactsView'
import AcademicsEvaluationView from './AcademicsEvaluationView'
import { fetchAcademicsContacts } from './nursingAcademicsApi'
import { PortalConnectHeaderButton, PortalConnectPage } from '../connect/PortalConnect'

// NA-PORTAL-UTILITIES-1: Messages reuses the SAME canonical PortalMessagesWorkspace the other
// portals use (variant='nursing_academic'). Enablement is the SERVER capability passed as
// messagesEnabled (env flag AND applied DB migration), never a client constant; until the server
// reports enabled, a pasted /portal/academics/messages link shows an honest prepared state.
export default function NursingAcademicsPortal({ view = 'calendar', messagesEnabled = false, budgetEnabled = false, themesEnabled = false, threadId, onSelectThread, onBackToList, onCommandPeople, unread = 0, onOpenConnect, backPath, backLabel, onBack }) {
  // PORTAL-CONNECT-1: Contacts and Messages are this portal's ASPIRE Connect.
  const onConnect = view === 'contacts' || view === 'messages'
  const { userProfile, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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

  useEffect(() => {
    let live = true
    fetchAcademicsContacts().then(res => {
      if (!live || !res?.ok) return
      onCommandPeople?.((res.data?.contacts || []).filter(c => c.is_active !== false).map(c => ({
        id: `na-contact:${c.id}`, kind: 'person', name: c.preferred_name || c.full_name,
        qualifier: [c.category || 'Contact', c.organization || c.school_name || c.unit_name || null].filter(Boolean).join(' · '),
        to: `/portal/academics/connect/contacts?contactId=${encodeURIComponent(c.id)}`,
      })))
    }).catch(() => {})
    return () => { live = false }
  }, [onCommandPeople])

  useEffect(() => {
    const contactId = searchParams.get('contactId')
    if (contactId && view !== 'contacts') navigate(`/portal/academics/connect/contacts?contactId=${encodeURIComponent(contactId)}`, { replace: true })
  }, [navigate, searchParams, view])

  return (
    <div className="ptl-page ptl-na-page">
      <h1 className="ptl-visually-hidden">Nursing Education &amp; Leadership Portal</h1>
      <PortalConnectHeaderButton active={onConnect} unread={unread} messagesEnabled={messagesEnabled} onOpen={onOpenConnect} />
      {/* Owner: the masthead greets ONCE, on the landing section only - the
          same shape every other portal has (Student/Unit Leader Home,
          Academic Partner Students). It used to sit above the section switch
          and so repeated on Community Benefit, Contacts, and Messages, which
          pushed those dense views down and let its current-FY label
          contradict the fiscal year selected inside the benefit report. */}
      <div className="ptl-na-stack" style={{ display: view === 'calendar' ? 'flex' : 'none' }}>
        <SkylineCard
          flush
          userKey={user?.id}
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
      {/* PORTAL-CONNECT-1: Contacts and Messages under one picker, as the staff Connect page.
          Contacts stays mounted and hidden, as it always did. */}
      <div style={{ display: onConnect ? 'block' : 'none' }}>
        <PortalConnectPage
          active={onConnect}
          tab={view === 'messages' ? 'messages' : 'contacts'}
          onNavigate={onOpenConnect}
          unread={unread}
          messagesEnabled={messagesEnabled}
          backPath={backPath} backLabel={backLabel} onBack={onBack}
          contacts={<AcademicsContactsView active={view === 'contacts'} />}
          messages={messagesEnabled ? (
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
          )}
        />
      </div>
      {/* KEITH-THEMES-1: the Leadership view of Keith's comment themes, for a grant with
          evaluation_themes_access. Mounted only while open. */}
      {view === 'evaluation' && (themesEnabled
        ? <AcademicsEvaluationView active />
        : <EmptyState title="Evaluation" detail="Evaluation themes have not been shared with your account." />)}
      {/* PROGRAM-BUDGET (2026-09-27): read-only, for a grant with budget_access. Mounted only
          while open, so nothing is fetched for a grant that never opens it. */}
      {view === 'budget' && (budgetEnabled ? (
        <div className="bud-portal">
          {/* NA-BUDGET-BAND-1 (Owner, 2026-09-30): the year's line is the subtitle, as in
              Settings > Budget Tracker, in place of a sentence about the page and a second
              line under it. The slot is reserved while the year loads, so nothing shifts. */}
          <ProgramBudgetView source={PORTAL_SOURCE} yearLineInBand renderBand={(actions, _note, yearLine) => (
            <header className="bud-portal-head">
              <div><h2>Budget Tracker</h2><p className="bud-sub bud-portal-sub">{yearLine}</p></div>
              {actions}
            </header>
          )} />
        </div>
      ) : (
        <EmptyState title="Budget Tracker" detail="The Budget Tracker has not been shared with your account." />
      ))}
    </div>
  )
}
