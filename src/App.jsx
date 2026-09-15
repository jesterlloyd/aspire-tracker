import { Suspense } from 'react'
import { lazyReload } from './lib/lazyReload'
import { loadPortalApp } from './lib/portalAppLoader'
import { loadStaffApp } from './lib/staffAppLoader'
import { TAB_TO_PATH, PORTAL_STAFF_ROLES } from './lib/staffRoutes'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import LoginNew from './pages/Login'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ActivateAccountPage from './pages/ActivateAccountPage'
import SurveyTestModePage from './pages/SurveyTestModePage'
import DevDispositionModal from './pages/DevDispositionModal'
import EvaluationPage from './pages/EvaluationPage'
import PreceptorEvaluationPage from './pages/PreceptorEvaluationPage'
import StudentEvaluationPage from './pages/StudentEvaluationPage'
import PostRotationEvaluationPage from './pages/PostRotationEvaluationPage'
import NgrpTransitionFormPage from './pages/NgrpTransitionFormPage'
import NgrpReflectionPage from './pages/NgrpReflectionPage'
import UnitFormPage from './components/UnitFormPage'
import SchoolFormPage from './components/SchoolFormPage'
import StudentIntakeFormPage from './components/StudentIntakeFormPage'
import InterviewSchedulePage from './components/InterviewSchedulePage'
import ShiftLogPage from './components/ShiftLogPage'
import ShiftLogLifecycle from './components/shift-log-lifecycle/ShiftLogLifecycle'
// NGRP-WORKSPACE-1 (correction): the NGRP workspace. Its Applicants roster is
// served by /api/ngrp-workspace (cycle-scoped, multi-cohort), NOT by the
// cohort-scoped students state below - the ASPIRE cohort never constrains the
// NGRP roster. Imported STATICALLY on purpose: a lazy() chunk here made the
// bundler hoist the shared dependency graph (incl. Connect/TipTap) into the
// main entry (~585 KB → ~3 MB); the workspace itself is small, so a static
// import keeps the entry at its baseline.
import { lastTabKey } from './lib/sessionKeys'

// PHASE1-PUBLIC-SITE: the public marketing site is a lazy chunk so the staff
// bundle does not grow and public visitors do not download the staff app UI
// up front (data access was never in the public chunk; there is none).
// CHUNK-RELOAD-1: lazyReload, not lazy, so a chunk whose name changed under an
// open tab reloads the page once instead of leaving it blank.
const PublicSite = lazyReload(() => import('./public-site/PublicSite'), 'PublicSite')
// PHASE2-PORTAL: the portal app is its own lazy chunk for the same reason. The
// importer is shared with the profile menu, which warms it when the menu opens.
const PortalApp = lazyReload(loadPortalApp, 'PortalApp')
// PORTAL-SPLIT Phase 1: the staff app is its own chunk, so a portal visitor,
// a public visitor and the sign-in page never download it.
const StaffApp = lazyReload(loadStaffApp, 'StaffApp')



// WS2.0: header helpers, icons, and LastSyncedIndicator moved to src/components/Header/*

// ─────────────────────────────────────────────────────────────────────────────
// Tab ID ↔ URL path mapping (internal IDs never change; URLs are what's new)

// FRESH-LOGIN-HOME-1: the per-user storage keys moved to src/lib/sessionKeys.js so
// AuthContext can clear the right ones on sign-out without App exporting them. That
// module also documents WHICH are cleared and which are kept, and why.
//   lastTabKey / lastNgrpTabKey  AUTH-UX-1, NGRP-WORKSPACE-1: where you were.
//   aspireCohortKey              SCOPE-PICKER-1: what you work in. Not cleared.
//   LAST_AUTH_USER_KEY           AUTH-UX-1B: which account was last active here.
//
// SCOPE-PICKER-1: the legacy browser-global cohort key is deliberately NOT adopted into
// the per-user one: carrying it over would preserve continuity by perpetuating the
// shared-workstation leak the per-user key exists to close. Everyone's next sign-in
// falls back to the Active cohort, which is correct for them, and the stale key is
// removed once so it stops sitting in storage.
// ─────────────────────────────────────────────────────────────────────────────
function ShellSplash() {
  return (
    <div style={{
      minHeight: '100vh', background: '#F4F1EC',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: '14px', color: '#9ca3af' }}>
        Loading ASPIRE Intelligence...
      </div>
    </div>
  )
}

function LoginRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <ShellSplash />
  // ASPIRE-COMPASS: return the signed-in user to the portal path they were
  // originally heading to (set by PortalRoute below), so a deep link like
  // /portal/messages/:id survives the sign-in round trip. Only same-app
  // /portal paths are ever stored, so this can never redirect off-site.
  if (user) {
    const from = location.state?.from
    const target = typeof from === 'string' && from.startsWith('/portal') ? from : '/portal'
    return <Navigate to={target} replace />
  }
  return <LoginNew />
}

function PortalRoute() {
  const { user, userProfile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <ShellSplash />
  // ASPIRE-COMPASS: carry the intended portal path through the sign-in
  // round trip so deep links (e.g. /portal/messages/:id) are restored.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // Owner/Admin can deliberately enter one of the five portal preview routes
  // from their profile menu. Every other staff visit to /portal keeps the
  // existing behavior and returns to the staff app.
  const isStaff = !userProfile || userProfile.is_owner === true ||
    PORTAL_STAFF_ROLES.includes(userProfile.role)
  const isOwnerAdmin = userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role)
  const isStaffPreviewRoute = isOwnerAdmin && (
    location.pathname === '/portal/student' || location.pathname.startsWith('/portal/student/') ||
    location.pathname.startsWith('/portal/unit/') ||
    location.pathname.startsWith('/portal/ap/') ||
    location.pathname.startsWith('/portal/academics/') ||
    location.pathname.startsWith('/portal/residency/')
  )
  if (isStaff && !isStaffPreviewRoute) {
    let target = '/aggregate'
    try {
      const savedTab = localStorage.getItem(lastTabKey(user.id))
      if (savedTab && TAB_TO_PATH[savedTab]) target = TAB_TO_PATH[savedTab]
    } catch { /* storage unavailable: default target */ }
    return <Navigate to={target} replace />
  }

  // PHASE2-PORTAL: non-staff accounts and explicit Owner/Admin preview routes
  // enter the portal app (lazy chunk). It
  // resolves the caller's active role grants via get_my_portal_access() and
  // renders the matching portal (student now; unit leader and academic
  // partner in Phases 3 and 4).
  return (
    <Suspense fallback={<ShellSplash />}>
      <PortalApp />
    </Suspense>
  )
}

// Public pages are light-locked like the other public routes and render inside
// a Suspense boundary while the lazy public-site chunk loads.
function publicPage(page) {
  return (
    <div data-theme-lock="light">
      <Suspense fallback={<ShellSplash />}>
        <PublicSite page={page} />
      </Suspense>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* PHASE1-PUBLIC-SITE: public marketing site (no data access) */}
      <Route path="/"            element={publicPage('home')} />
      <Route path="/about"       element={publicPage('about')} />
      <Route path="/eligibility" element={publicPage('eligibility')} />
      <Route path="/apply"       element={publicPage('apply')} />
      <Route path="/experience"  element={publicPage('experience')} />
      <Route path="/preceptors"  element={publicPage('preceptors')} />
      <Route path="/faq"         element={publicPage('faq')} />
      <Route path="/contact"     element={publicPage('contact')} />
      {/* PHASE1-PUBLIC-SITE: explicit auth entry points */}
      <Route path="/login"       element={<LoginRoute />} />
      {/* ASPIRE-COMPASS: /portal/* so Messages and thread deep links resolve.
          URLs never grant access: every read remains server-authorized. */}
      <Route path="/portal/*"    element={<PortalRoute />} />
      {/* Public routes - no auth required, no app shell */}
      <Route path="/unit-form/*"          element={<div data-theme-lock="light"><UnitFormPage /></div>} />
      <Route path="/school-form/*"        element={<div data-theme-lock="light"><SchoolFormPage /></div>} />
      <Route path="/student-form/*"       element={<div data-theme-lock="light"><StudentIntakeFormPage /></div>} />
      <Route path="/interview-schedule/*" element={<div data-theme-lock="light"><InterviewSchedulePage /></div>} />
      <Route path="/shift-log/*"          element={<ShiftLogLifecycle />} />
      <Route path="/evaluation/readiness/*" element={<div data-theme-lock="light"><EvaluationPage /></div>} />
      <Route path="/evaluation/feedback/*"  element={<div data-theme-lock="light"><PreceptorEvaluationPage /></div>} />
      <Route path="/evaluation/experience/*" element={<div data-theme-lock="light"><StudentEvaluationPage /></div>} />
      <Route path="/evaluation/post-rotation/*" element={<div data-theme-lock="light"><PostRotationEvaluationPage /></div>} />
      {/* NGRP-RELEASE-2: the public tokenized Transition Form. Mounted ABOVE the
          /* wildcard like every public form, so an alumnus's secure link renders
          outside the authed shell; the raw token travels only in the fragment. */}
      <Route path="/ngrp/transition/*" element={<div data-theme-lock="light"><NgrpTransitionFormPage /></div>} />
      {/* RESIDENCY-REFLECTION-1: the resident's bi-weekly reflection, by personal link. */}
      <Route path="/ngrp/reflection/*" element={<div data-theme-lock="light"><NgrpReflectionPage /></div>} />
      {/* RECOVERY-PASSWORD-SCREEN-1: public password-recovery landing (Supabase reset link target).
          Must precede the /* wildcard so it renders outside AuthedShell even with a recovery session. */}
      <Route path="/auth/reset-password"   element={<div data-theme-lock="light"><ResetPasswordPage /></div>} />
      {/* First-time activation. Mounted ABOVE the /* wildcard for the same reason
          reset-password is: detectSessionInUrl establishes a session from the
          invite token, and without this the invitee would fall through to the
          authed shell with no password ever set. */}
      <Route path="/auth/activate"        element={<div data-theme-lock="light"><ActivateAccountPage /></div>} />
      {/* ASPIRE-EVAL-TEST-MODE-1: staff-only, non-persistent survey test renderer. Above
          the wildcard for the same reason as the auth routes, and light-locked because
          it renders a survey form. It writes nothing and has no submit endpoint. */}
      <Route path="/evaluation/test/:workflowKey" element={<div data-theme-lock="light"><SurveyTestModePage /></div>} />
      {/* Legacy URL redirects */}
      <Route path="/interview-room"        element={<Navigate to="/interviews" replace />} />
      <Route path="/embed"                 element={<Navigate to="/rotation/matrix" replace />} />
      {/* Retired: Rotation > Check-Ins. Midpoint auto-send now lives in Connect > Automation. */}
      <Route path="/rotation/checkins"     element={<Navigate to="/connect/broadcasts" replace />} />
      {/* Dev harness routes - excluded from production build */}
      {import.meta.env.DEV && <Route path="/dev/disposition-modal" element={<DevDispositionModal />} />}
      {/* Authenticated app - handles /aggregate, /students, /interviews, /rotation/*,
          /evaluation, /connect*, /catalog*, /settings*. ("/" is the public homepage
          above as of PHASE1-PUBLIC-SITE; deep links behave exactly as before.) */}
      <Route path="/*"                    element={<Suspense fallback={<ShellSplash />}><StaffApp /></Suspense>} />
    </Routes>
  )
}
