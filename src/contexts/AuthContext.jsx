import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUserProfile = async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_profile');
      if (!error && data && data.length > 0) {
        setUserProfile(data[0]);
        await supabase
          .from('user_profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('auth_user_id', data[0].id);
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        loadUserProfile();
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          await loadUserProfile();
        } else {
          setUser(null);
          setUserProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
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
