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
      const { data, error } = await supabase.rpc('get_my_profile');
      if (error) {
        console.error('Profile load error:', error.message);
        return;
      }
      if (data && data.length > 0) {
        setUserProfile(data[0]);
        // Update last login without blocking
        supabase
          .from('user_profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('auth_user_id', data[0].auth_user_id)
          .then(() => {});
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
      async (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          await loadUserProfile();
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

  const value = {
    user,
    userProfile,
    loading,
    signOut,
    isOwner:           userProfile?.is_owner === true,
    isAdmin:           ['owner', 'admin'].includes(userProfile?.role),
    isInterviewer:     userProfile?.role === 'interviewer',
    isViewer:          userProfile?.role === 'viewer',
    canEdit:           ['owner', 'admin'].includes(userProfile?.role),
    canInterview:      ['owner', 'admin', 'interviewer'].includes(userProfile?.role),
    canViewActivityLog: userProfile?.is_owner === true,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
