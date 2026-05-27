import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading]         = useState(true);
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
        // last_login_at is handled by the get_my_profile RPC — no separate update needed
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
          // further Supabase calls — prevents the auth-lock deadlock documented at
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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // Exposed so components can force a context refresh after writing to user_profiles.
  // Bypasses the concurrent-load guard so it always runs.
  const refreshUserProfile = async () => {
    const { data, error } = await supabase.rpc('get_my_profile');
    if (error) { console.error('refreshUserProfile error:', error.message); return; }
    if (data?.length > 0) setUserProfile(data[0]);
  };

  const value = {
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
    canViewActivityLog: userProfile?.is_owner === true,
    iAmInterviewer:     userProfile?.can_conduct_interviews === true,
    myInterviewerColor: userProfile?.interviewer_color || '#1D2567',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
