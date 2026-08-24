import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { setStudentPhotoCacheScope, clearStudentPhotoCache } from '../lib/studentPhotoCache';
import { normalizeStaffRole } from '../lib/permissions';
import { clearPortalCohortHintSession } from '../lib/portalCohortHint';

// Roles that READ student files across every cohort, with no entitlement needed.
// Co-Lead joined Owner/Admin here on 2026-08-05: near-Owner for student access.
// Deliberately NOT the same list as file management or badge generation, which
// stay Owner/Admin - reading a student's file is access, replacing it is not.
const STUDENT_READ_ROLES = ['owner', 'admin', 'co-lead'];

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading]         = useState(true);
  // WAVE F-2 (interviewer file access): the cohorts this caller is actively
  // entitled to as an interviewer (server-resolved by identity). Empty for
  // owner/admin/viewer, and empty for an unentitled interviewer. Drives which
  // file controls are shown; the server access endpoint stays authoritative.
  const [interviewerCohortIds, setInterviewerCohortIds] = useState([]);
  const loadingRef = useRef(false); // Prevent concurrent profile loads
  // ACCOUNTS-ACCESS-DIRECTORY-2: last_login_at is stamped once per session (staff
  // and portal alike), including a resumed session on app open. Holds the
  // user.id that has already been stamped this session so a re-render, a
  // refreshUserProfile call, or a TOKEN_REFRESHED tick never re-stamps it.
  // Reset to null on SIGNED_OUT so the next sign-in stamps again.
  const touchedLoginRef = useRef(null);

  const loadUserProfile = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setLoading(false);
        loadingRef.current = false;
        return;
      }

      const { data, error } = await supabase.rpc('get_my_profile');
      if (error) {
        console.error('Profile load error:', error.message);
        setLoading(false);
        loadingRef.current = false;
        return;
      }

      if (data && data.length > 0) {
        setUserProfile(data[0]);
        // ACCOUNTS-ACCESS-DIRECTORY-2: get_my_profile is a dashboard-created RPC,
        // untracked in this repo, and may or may not also stamp last_login_at -
        // that behavior is not under our control and not something we rely on.
        // touch_my_last_login (supabase/migrations/20260730000000_touch_my_last_login.sql)
        // is the tracked, deterministic once-per-session stamp: guarded here by
        // touchedLoginRef so it fires exactly once per authenticated session,
        // including a resumed session on app open, for staff and portal users
        // alike. Fire-and-forget; every error is swallowed because the function
        // does not exist until the Owner applies the migration (see
        // docs/security/OWNER_SQL_GATE.md), and a missing function must never
        // break login or add console noise.
        if (touchedLoginRef.current !== user.id) {
          touchedLoginRef.current = user.id;
          supabase.rpc('touch_my_last_login').then(({ error: touchError }) => {
            if (touchError) console.debug('touch_my_last_login skipped:', touchError.message);
          });
        }
      }
    } catch (err) {
      console.error('Profile load exception:', err.message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          console.error('Session error:', error.message);
          setLoading(false);
          return;
        }

        if (session?.user) {
          setUser(session.user);
          await loadUserProfile();
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('Auth init error:', err.message);
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          // Defer profile load so the callback returns synchronously before making
          // further Supabase calls - prevents the auth-lock deadlock documented at
          // https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0
          setTimeout(() => { void loadUserProfile() }, 0)
        } else if (event === 'SIGNED_OUT') {
          clearPortalCohortHintSession();
          setUser(null);
          setUserProfile(null);
          setLoading(false);
          // ACCOUNTS-ACCESS-DIRECTORY-2: clear the once-per-session guard so the
          // next sign-in (a different user, or the same user again) stamps again.
          touchedLoginRef.current = null;
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          setUser(session.user);
          // Don't reload profile on token refresh, just update user
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    clearStudentPhotoCache(); // drop every signed photo URL immediately on sign-out
    clearPortalCohortHintSession(); // show the cohort switch hint on the next portal login
    await supabase.auth.signOut();
  }, []);

  // Exposed so components can force a context refresh after writing to user_profiles.
  // Bypasses the concurrent-load guard so it always runs.
  const refreshUserProfile = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_my_profile');
    if (error) { console.error('refreshUserProfile error:', error.message); return; }
    if (data?.length > 0) setUserProfile(data[0]);
  }, []);

  // WAVE F-2 (photo performance): scope the shared signed-photo cache to the current
  // authorization context. Any change to the user, profile, role, or active state
  // clears the cache, so a signed photo URL is never reused across users or after a
  // role/account change, and sign-out (user -> null) drops every cached URL.
  useEffect(() => {
    const authScope = user?.id
      ? `${user.id}:${userProfile?.id || ''}:${userProfile?.role || ''}:${userProfile?.is_active === false ? 'inactive' : 'active'}`
      : null;
    setStudentPhotoCacheScope(authScope);
  }, [user?.id, userProfile?.id, userProfile?.role, userProfile?.is_active]);

  // WAVE F-2: resolve the interviewer's entitled cohorts once per profile. Only an
  // active interviewer can hold entitlements; everyone else keeps an empty set.
  useEffect(() => {
    let cancelled = false;
    const role = String(userProfile?.role || '').toLowerCase();
    const isEntitledRole = role === 'interviewer' && userProfile?.is_active !== false;
    // Both branches resolve through a promise, so no setState runs synchronously
    // in the effect body. Non-interviewers resolve to an empty set.
    const p = isEntitledRole
      ? (async () => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return [];
          const res = await fetch('/api/my-interviewer-cohorts', { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return [];
          const j = await res.json();
          return Array.isArray(j?.cohort_ids) ? j.cohort_ids : [];
        })()
      : Promise.resolve([]);
    p.then((ids) => { if (!cancelled) setInterviewerCohortIds(ids); })
      .catch(() => { if (!cancelled) setInterviewerCohortIds([]); });
    return () => { cancelled = true; };
  }, [userProfile?.id, userProfile?.role, userProfile?.is_active]);

  // ASPIRE-CHART performance: the context value is memoized so every provider
  // render no longer hands consumers a brand-new object (which re-rendered
  // the entire always-mounted tab forest on each auth tick). Values are
  // byte-identical to before; only the identity is stable.
  const value = useMemo(() => ({
    user,
    userProfile,
    loading,
    signOut,
    refreshUserProfile,
    isOwner:            userProfile?.is_owner === true,
    isAdmin:            ['owner', 'admin'].includes(userProfile?.role),
    isInterviewer:      userProfile?.role === 'interviewer',
    isViewer:           userProfile?.role === 'viewer',
    canEdit:            ['owner', 'admin'].includes(userProfile?.role),
    canInterview:       ['owner', 'admin', 'interviewer'].includes(userProfile?.role),
    // WAVE F-2: explicit active-role student-file capabilities. These are the
    // privacy gates for file controls, NOT the broad canEdit (which omits the
    // is_active check). A user is active only when is_active !== false. The server
    // access/upload/cleanup endpoints remain authoritative even when controls are
    // hidden. An entitled interviewer may VIEW/DOWNLOAD resume+photo for their
    // entitled cohorts (see canViewStudentFilesInCohort), but never manage files
    // or badges.
    //   canViewStudentResume  - see/open/download a resume (active Owner/Admin)
    //   canManageStudentFiles - upload/replace/delete student files (active Owner/Admin)
    //   canGenerateBadge      - generate a student badge (active Owner/Admin)
    // APPROVED 2026-08-05: a Co-Lead reads student resumes across ALL cohorts
    // (near-Owner for student ACCESS). Manage and badge below stay Owner/Admin:
    // reading a student's file is access, replacing or deleting it is not.
    canViewStudentResume:  userProfile?.is_active !== false && STUDENT_READ_ROLES.includes(normalizeStaffRole(userProfile?.role)),
    canManageStudentFiles: userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role),
    canGenerateBadge:      userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role),
    // WAVE F-2: an active interviewer's entitled cohorts, plus two per-cohort
    // file-view checks. Resume view is Owner/Admin or an entitled interviewer.
    // Photo view additionally includes an active Viewer (headshot only, matching
    // the Viewer matrix). Manage/badge stay Owner/Admin-only above.
    interviewerCohortIds,
    canViewStudentResumeInCohort: (cohortId) =>
      (userProfile?.is_active !== false && STUDENT_READ_ROLES.includes(normalizeStaffRole(userProfile?.role))) ||
      (userProfile?.is_active !== false && String(userProfile?.role || '').toLowerCase() === 'interviewer'
        && !!cohortId && interviewerCohortIds.includes(cohortId)),
    canViewStudentPhotoInCohort: (cohortId) =>
      (userProfile?.is_active !== false && [...STUDENT_READ_ROLES, 'viewer'].includes(normalizeStaffRole(userProfile?.role))) ||
      (userProfile?.is_active !== false && String(userProfile?.role || '').toLowerCase() === 'interviewer'
        && !!cohortId && interviewerCohortIds.includes(cohortId)),
    canViewActivityLog: userProfile?.is_owner === true,
    iAmInterviewer:     userProfile?.can_conduct_interviews === true,
    myInterviewerColor: userProfile?.interviewer_color || '#1D2567',
  }), [user, userProfile, loading, signOut, refreshUserProfile, interviewerCohortIds]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
