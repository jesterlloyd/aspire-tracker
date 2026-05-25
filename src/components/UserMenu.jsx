import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { safeWrite } from '../lib/safeWrite';
import { getAvatarUrl } from '../lib/getAvatar';
import { LogOut, Users, ChevronDown } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const ROLE_LABELS = {
  owner:       { label: 'Owner',       bg: '#1D2567', color: '#ffffff' },
  admin:       { label: 'Admin',       bg: '#065f46', color: '#ffffff' },
  interviewer: { label: 'Interviewer', bg: '#92400e', color: '#ffffff' },
  viewer:      { label: 'Viewer',      bg: '#6b7280', color: '#ffffff' },
};

export default function UserMenu({ onOpenUserManagement, onRestartTour }) {
  const { userProfile, signOut, isOwner, isAdmin } = useAuth();
  const [isOpen,    setIsOpen]    = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) { alert('Please upload a JPG, PNG, or WebP image.'); return; }
    if (file.size > 2 * 1024 * 1024)    { alert('Image must be under 2MB.'); return; }

    setUploading(true);
    try {
      const ext  = file.name.split('.').pop();
      const path = `${userProfile.auth_user_id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars').upload(path, file, { upsert: true });
      if (uploadError) { alert(`Upload failed: ${uploadError.message}`); return; }

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);

      const { error: saveError } = await supabase.rpc('update_my_avatar', { p_url: publicUrl });
      if (saveError) {
        await safeWrite(
          () => supabase.from('user_profiles').update({ avatar_url: publicUrl }).eq('id', userProfile.id),
          { name: 'update avatar url' }
        );
      }
      window.location.reload();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!userProfile) return null;

  const roleStyle = ROLE_LABELS[userProfile.role] || ROLE_LABELS.viewer;
  const initials = userProfile.full_name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>

      {/* People & Access icon — Owner and Admin */}
      {isAdmin && (
        <button
          data-tour="people-access"
          onClick={onOpenUserManagement}
          title="People & Access"
          style={{
            background: 'rgba(255,255,255,0.10)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '8px',
            width: '34px', height: '34px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.18)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.10)'}
        >
          <Users size={15} color="#ffffff" strokeWidth={2} />
        </button>
      )}

      {/* User button */}
      <button
        data-tour="user-profile"
        title="My Profile"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '10px',
          padding: '5px 10px 5px 6px',
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.18)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.10)'}
      >
        {/* Avatar — DiceBear or custom photo */}
        <div style={{ width:'26px', height:'26px', borderRadius:'50%', overflow:'hidden', flexShrink:0, border:'1.5px solid rgba(255,255,255,0.3)' }}>
          <img src={getAvatarUrl(userProfile)} alt={userProfile.full_name}
            style={{ width:'100%', height:'100%', objectFit:'cover' }}
            onError={e => { e.target.style.display='none'; e.target.parentNode.style.background=roleStyle.bg; e.target.parentNode.style.display='flex'; e.target.parentNode.style.alignItems='center'; e.target.parentNode.style.justifyContent='center'; e.target.parentNode.innerHTML=`<span style="font-family:DM Sans;font-weight:700;font-size:10px;color:#fff">${initials}</span>` }} />
        </div>

        {/* Name + role */}
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#ffffff', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            {userProfile.full_name.split(' ')[0]}
          </div>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '10px', color: 'rgba(255,255,255,0.55)', lineHeight: 1 }}>
            {roleStyle.label}
          </div>
        </div>

        <ChevronDown
          size={12} color="rgba(255,255,255,0.5)"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div onClick={() => setIsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '6px',
            background: 'var(--color-bg-surface, #ffffff)', borderRadius: '12px',
            boxShadow: 'var(--shadow-elevated, 0 8px 32px rgba(29,37,103,0.18))',
            border: '1px solid var(--color-border-default, transparent)',
            minWidth: '200px', zIndex: 999, overflow: 'hidden',
          }}>
            {/* Profile info */}
            <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--color-border-subtle,#f3f4f6)', display:'flex', alignItems:'center', gap:'12px' }}>
              <div style={{ width:'40px', height:'40px', borderRadius:'50%', overflow:'hidden', flexShrink:0 }}>
                <img src={getAvatarUrl(userProfile)} alt={userProfile.full_name}
                  style={{ width:'100%', height:'100%', objectFit:'cover' }} />
              </div>
              <div>
                <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'13px', color:'var(--color-text-primary,#1D2567)' }}>{userProfile.full_name}</div>
                <div style={{ fontFamily:'DM Sans', fontSize:'11px', color:'var(--color-text-muted,#9ca3af)', marginTop:'2px' }}>{userProfile.email}</div>
                <span style={{ display:'inline-block', marginTop:'5px', background:roleStyle.bg, color:roleStyle.color, fontFamily:'DM Sans', fontWeight:700, fontSize:'10px', padding:'2px 8px', borderRadius:'20px' }}>
                  {userProfile.is_owner ? 'Owner' : roleStyle.label}
                </span>
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarUpload}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ background:'none', border:'none', fontFamily:'DM Sans', fontSize:'11px', color:'#6b7280', cursor: uploading ? 'default' : 'pointer', padding:0, marginTop:'4px', display:'flex', alignItems:'center', gap:'5px' }}
                >
                  {uploading ? (
                    <>
                      <div style={{ width:'10px', height:'10px', borderRadius:'50%', border:'2px solid #e5e7eb', borderTopColor:'#1D2567', animation:'spin 0.8s linear infinite', flexShrink:0 }} />
                      Uploading...
                    </>
                  ) : (
                    <>{userProfile?.avatar_url ? 'Change Photo' : 'Upload Photo'}</>
                  )}
                </button>
                {userProfile?.avatar_url && !uploading && (
                  <button
                    onClick={async () => {
                      await supabase.rpc('update_my_avatar', { p_url: '' });
                      window.location.reload();
                    }}
                    style={{ background:'none', border:'none', fontFamily:'DM Sans', fontSize:'10px', color:'#9ca3af', cursor:'pointer', padding:0, marginTop:'2px', display:'block' }}
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>

            {/* Restart tour */}
            {onRestartTour && (
              <button
                onClick={() => { setIsOpen(false); onRestartTour(); }}
                style={{ width: '100%', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', fontFamily: 'DM Sans', fontSize: '13px', color: 'var(--color-text-primary,#374151)', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid var(--color-border-subtle,#f3f4f6)', transition: 'background 0.15s ease' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover,#f9fafb)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                Restart Welcome Tour
              </button>
            )}

            {/* Theme toggle */}
            <div style={{ padding:'10px 16px', borderTop:'1px solid var(--color-border-subtle, #f3f4f6)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
              <span style={{ fontFamily:'DM Sans', fontSize:12, color:'var(--color-text-secondary, #6b7280)', fontWeight:500 }}>Appearance</span>
              <ThemeToggle />
            </div>

            {/* Sign out */}
            <button
              onClick={() => { setIsOpen(false); signOut(); }}
              style={{
                width: '100%', padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: '10px',
                background: 'none', border: 'none',
                fontFamily: 'DM Sans', fontSize: '13px', color: 'var(--color-text-primary,#374151)',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover,#f9fafb)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <LogOut size={14} color="#6b7280" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
