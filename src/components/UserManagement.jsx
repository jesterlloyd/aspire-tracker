import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { getAvatarUrl } from '../lib/getAvatar';
import { X, UserPlus, Shield, Clock, CheckCircle, XCircle, Mail } from 'lucide-react';

const ROLE_OPTIONS = [
  { value: 'admin',       label: 'Admin',       description: 'Full operational access' },
  { value: 'interviewer', label: 'Interviewer',  description: 'Rubric and student view' },
  { value: 'viewer',      label: 'Viewer',       description: 'Read-only dashboard' },
];

const ROLE_COLORS = {
  owner:       { bg: '#1D2567', text: '#ffffff' },
  admin:       { bg: '#065f46', text: '#ffffff' },
  interviewer: { bg: '#92400e', text: '#ffffff' },
  viewer:      { bg: '#6b7280', text: '#ffffff' },
};

export default function UserManagement({ isOpen, onClose }) {
  const { isOwner, userProfile } = useAuth();
  const [users,         setUsers]         = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [inviteMode,    setInviteMode]    = useState(false);
  const [inviteData,    setInviteData]    = useState({ email: '', full_name: '', role: 'interviewer' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult,  setInviteResult]  = useState(null);
  const [activityLogs,  setActivityLogs]  = useState([]);
  const [activeView,    setActiveView]    = useState('users');

  useEffect(() => {
    if (isOpen && isOwner) {
      fetchUsers();
      fetchActivityLogs();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_user_profiles');
      if (error) {
        console.error('UserManagement fetch error:', error.message);
        setUsers([]);
      } else {
        setUsers(data || []);
      }
    } catch (err) {
      console.error('UserManagement exception:', err.message);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchActivityLogs = async () => {
    const { data } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setActivityLogs(data || []);
  };

  const handleInvite = async () => {
    if (!inviteData.email || !inviteData.full_name || !inviteData.role) return;
    setInviteLoading(true);
    setInviteResult(null);
    try {
      const response = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteData),
      });
      const data = await response.json();
      if (response.ok) {
        setInviteResult({ success: true, message: `Invitation sent to ${inviteData.email}` });
        setInviteData({ email: '', full_name: '', role: 'interviewer' });
        fetchUsers();
      } else {
        setInviteResult({ success: false, message: data.error });
      }
    } catch (err) {
      setInviteResult({ success: false, message: err.message });
    }
    setInviteLoading(false);
  };

  const handleToggleActive = async (userId, currentActive) => {
    await supabase.from('user_profiles').update({ is_active: !currentActive }).eq('id', userId);
    fetchUsers();
  };

  const handleChangeRole = async (userId, newRole) => {
    await supabase.from('user_profiles').update({ role: newRole }).eq('id', userId);
    fetchUsers();
  };

  const handleToggleInterviewer = async (userId, currentValue) => {
    await supabase.from('user_profiles').update({ can_conduct_interviews: !currentValue }).eq('id', userId);
    fetchUsers();
  };

  const handleUpdateInterviewerColor = async (userId, color) => {
    await supabase.from('user_profiles').update({ interviewer_color: color }).eq('id', userId);
    fetchUsers();
  };

  if (!isOpen || !isOwner) return null;

  const inputStyle = {
    width: '100%', padding: '9px 12px',
    border: '1px solid #e5e7eb', borderRadius: '8px',
    fontFamily: 'DM Sans, sans-serif', fontSize: '13px', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1998 }} />
      <div style={{
        position:'fixed', top:0, right:0, bottom:0, width:'520px',
        background:'#ffffff', boxShadow:'-8px 0 32px rgba(29,37,103,0.18)',
        zIndex:1999, display:'flex', flexDirection:'column',
        fontFamily:'DM Sans, sans-serif',
      }}>

        {/* Header */}
        <div style={{
          background:'linear-gradient(180deg, #1c2452 0%, #141928 100%)',
          padding:'20px 24px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div>
            <div style={{ fontWeight:700, fontSize:'16px', color:'#ffffff' }}>User Management</div>
            <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.5)', marginTop:'2px' }}>Owner access only</div>
          </div>
          <button onClick={onClose} style={{
            background:'rgba(255,255,255,0.1)', border:'none', borderRadius:'8px',
            width:'32px', height:'32px', display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', color:'#ffffff',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* View tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid #f3f4f6', padding:'0 24px' }}>
          {['users', 'activity'].map(view => (
            <button key={view} onClick={() => setActiveView(view)} style={{
              padding:'12px 16px', background:'none', border:'none',
              borderBottom:`2px solid ${activeView === view ? '#1D2567' : 'transparent'}`,
              fontFamily:'DM Sans, sans-serif', fontWeight:activeView===view ? 700 : 400,
              fontSize:'13px', color:activeView===view ? '#1D2567' : '#6b7280',
              cursor:'pointer', marginBottom:'-1px',
            }}>
              {view === 'users' ? `Users (${users.length})` : 'Activity Log'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>

          {activeView === 'users' && (
            <>
              {!inviteMode ? (
                <button onClick={() => setInviteMode(true)} style={{
                  width:'100%', padding:'11px', background:'#1D2567', border:'none', borderRadius:'10px',
                  fontFamily:'DM Sans, sans-serif', fontWeight:700, fontSize:'13px', color:'#ffffff',
                  cursor:'pointer', marginBottom:'20px',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
                }}>
                  <UserPlus size={15} /> Invite New User
                </button>
              ) : (
                <div style={{ background:'#f8faff', border:'1px solid #e0e7ff', borderRadius:'12px', padding:'16px', marginBottom:'20px' }}>
                  <div style={{ fontWeight:700, fontSize:'13px', color:'#1D2567', marginBottom:'14px' }}>Invite New User</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                    <input placeholder="Full name" value={inviteData.full_name}
                      onChange={e => setInviteData(p => ({ ...p, full_name: e.target.value }))} style={inputStyle} />
                    <input placeholder="Email address" type="email" value={inviteData.email}
                      onChange={e => setInviteData(p => ({ ...p, email: e.target.value }))} style={inputStyle} />
                    <select value={inviteData.role}
                      onChange={e => setInviteData(p => ({ ...p, role: e.target.value }))} style={inputStyle}>
                      {ROLE_OPTIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label} — {r.description}</option>
                      ))}
                    </select>
                    {inviteResult && (
                      <div style={{
                        padding:'8px 12px', borderRadius:'8px', fontSize:'12px',
                        background:inviteResult.success ? '#f0fdf4' : '#fff1f2',
                        border:`1px solid ${inviteResult.success ? '#86efac' : '#fca5a5'}`,
                        color:inviteResult.success ? '#166534' : '#991b1b',
                      }}>
                        {inviteResult.message}
                      </div>
                    )}
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={() => { setInviteMode(false); setInviteResult(null); }} style={{
                        flex:1, padding:'9px', background:'#f9fafb', border:'1px solid #e5e7eb',
                        borderRadius:'8px', fontFamily:'DM Sans, sans-serif', fontSize:'13px', cursor:'pointer',
                      }}>Cancel</button>
                      <button onClick={handleInvite}
                        disabled={inviteLoading || !inviteData.email || !inviteData.full_name}
                        style={{
                          flex:2, padding:'9px', border:'none', borderRadius:'8px',
                          background:inviteLoading ? '#e5e7eb' : '#1D2567',
                          fontFamily:'DM Sans, sans-serif', fontWeight:700, fontSize:'13px', color:'#ffffff',
                          cursor:inviteLoading ? 'default' : 'pointer',
                          display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
                        }}>
                        <Mail size={13} /> {inviteLoading ? 'Sending...' : 'Send Invitation'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {loading ? (
                <div style={{ textAlign:'center', padding:'24px', color:'#9ca3af', fontSize:'13px' }}>Loading users...</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                  {users.map(u => {
                    const roleColor = ROLE_COLORS[u.role] || ROLE_COLORS.viewer;
                    const isCurrentUser = u.id === userProfile?.id;
                    const lastLogin = u.last_login_at
                      ? new Date(u.last_login_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
                      : 'Never logged in';
                    return (
                      <div key={u.id} style={{
                        border:'1px solid #f3f4f6', borderRadius:'12px', padding:'14px 16px',
                        background:u.is_active ? '#ffffff' : '#fafafa', opacity:u.is_active ? 1 : 0.65,
                      }}>
                        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px' }}>
                          <div style={{ width:'36px', height:'36px', borderRadius:'50%', overflow:'hidden', flexShrink:0 }}>
                            <img src={getAvatarUrl(u)} alt={u.full_name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                              <span style={{ fontWeight:700, fontSize:'13px', color:'#1D2567' }}>{u.full_name}</span>
                              {isCurrentUser && <span style={{ fontSize:'10px', color:'#9ca3af', fontStyle:'italic' }}>(you)</span>}
                              <span style={{ background:roleColor.bg, color:roleColor.text, fontSize:'10px', fontWeight:700, padding:'2px 7px', borderRadius:'20px' }}>
                                {u.is_owner ? 'Owner' : u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                              </span>
                              {!u.is_active && <span style={{ background:'#f3f4f6', color:'#9ca3af', fontSize:'10px', padding:'2px 7px', borderRadius:'20px' }}>Inactive</span>}
                            </div>
                            <div style={{ fontSize:'12px', color:'#9ca3af', marginTop:'3px' }}>{u.email}</div>
                            <div style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', color:'#9ca3af', marginTop:'4px' }}>
                              <Clock size={10} /> Last login: {lastLogin}
                            </div>
                          </div>
                          {!isCurrentUser && !u.is_owner && (
                            <div style={{ display:'flex', flexDirection:'column', gap:'6px', flexShrink:0 }}>
                              <select value={u.role} onChange={e => handleChangeRole(u.id, e.target.value)}
                                style={{ padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:'6px', fontFamily:'DM Sans, sans-serif', fontSize:'11px', outline:'none', cursor:'pointer' }}>
                                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </select>
                              <button onClick={() => handleToggleActive(u.id, u.is_active)} style={{
                                padding:'4px 8px', border:'none', borderRadius:'6px',
                                background:u.is_active ? '#fee2e2' : '#dcfce7',
                                fontFamily:'DM Sans, sans-serif', fontSize:'11px', fontWeight:600,
                                color:u.is_active ? '#991b1b' : '#166534', cursor:'pointer',
                              }}>
                                {u.is_active ? 'Deactivate' : 'Reactivate'}
                              </button>
                            </div>
                          )}
                        </div>
                        {!isCurrentUser && !u.is_owner && (
                          <div style={{ borderTop:'1px solid #f3f4f6', marginTop:'10px', paddingTop:'10px', display:'flex', flexDirection:'column', gap:'8px' }}>
                            {/* Can Conduct Interviews toggle */}
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                              <div>
                                <div style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#374151' }}>Can Conduct Interviews</div>
                                <div style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#9ca3af' }}>Appears in scheduling dropdowns</div>
                              </div>
                              <button onClick={() => handleToggleInterviewer(u.id, u.can_conduct_interviews)} style={{
                                width:'40px', height:'22px', borderRadius:'11px', border:'none',
                                background: u.can_conduct_interviews ? '#1D2567' : '#e5e7eb',
                                position:'relative', cursor:'pointer', transition:'background 0.2s ease', flexShrink:0,
                              }}>
                                <div style={{
                                  position:'absolute', top:'3px', left: u.can_conduct_interviews ? '21px' : '3px',
                                  width:'16px', height:'16px', borderRadius:'50%', background:'#ffffff',
                                  transition:'left 0.2s ease', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
                                }} />
                              </button>
                            </div>
                            {/* Color picker — only when can conduct interviews */}
                            {u.can_conduct_interviews && (
                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                <span style={{ fontFamily:'DM Sans', fontSize:'12px', color:'#374151' }}>Interview Color</span>
                                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                                  <div style={{ width:'20px', height:'20px', borderRadius:'50%', background: u.interviewer_color || '#1D2567', border:'2px solid rgba(0,0,0,0.1)' }} />
                                  <input type="color" value={u.interviewer_color || '#1D2567'}
                                    onChange={e => handleUpdateInterviewerColor(u.id, e.target.value)}
                                    style={{ width:'28px', height:'28px', border:'none', borderRadius:'6px', cursor:'pointer', padding:'2px', background:'none' }} />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeView === 'activity' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              {activityLogs.length === 0 ? (
                <div style={{ textAlign:'center', padding:'48px 24px', color:'#9ca3af', fontSize:'13px' }}>No activity logged yet.</div>
              ) : activityLogs.map(log => (
                <div key={log.id} style={{ padding:'10px 14px', background:'#f9fafb', borderRadius:'10px', border:'1px solid #f3f4f6' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
                    <span style={{ fontWeight:600, fontSize:'12px', color:'#374151' }}>{log.user_name || 'System'}</span>
                    <span style={{ fontSize:'10px', color:'#9ca3af', whiteSpace:'nowrap' }}>
                      {new Date(log.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize:'12px', color:'#6b7280', marginTop:'2px' }}>{log.description}</div>
                  {log.user_role && <span style={{ fontSize:'10px', color:'#9ca3af', fontStyle:'italic' }}>{log.user_role}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
