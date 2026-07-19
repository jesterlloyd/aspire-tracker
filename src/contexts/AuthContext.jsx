import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { setStudentPhotoCacheScope, clearStudentPhotoCache } from '../lib/studentPhotoCache';

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
        // last_login_at is handled by the get_my_profile RPC - no separate update needed
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
          setUser(null);
          setUserProfile(null);
          setLoading(false);
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
    canViewStudentResume:  userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role),
    canManageStudentFiles: userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role),
    canGenerateBadge:      userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role),
    // WAVE F-2: an active interviewer's entitled cohorts, plus two per-cohort
    // file-view checks. Resume view is Owner/Admin or an entitled interviewer.
    // Photo view additionally includes an active Viewer (headshot only, matching
    // the Viewer matrix). Manage/badge stay Owner/Admin-only above.
    interviewerCohortIds,
    canViewStudentResumeInCohort: (cohortId) =>
      (userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role)) ||
      (userProfile?.is_active !== false && String(userProfile?.role || '').toLowerCase() === 'interviewer'
        && !!cohortId && interviewerCohortIds.includes(cohortId)),
    canViewStudentPhotoInCohort: (cohortId) =>
      (userProfile?.is_active !== false && ['owner', 'admin', 'viewer'].includes(userProfile?.role)) ||
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
