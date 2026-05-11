import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Users, ChevronDown } from 'lucide-react';

const ROLE_LABELS = {
  owner:       { label: 'Owner',       bg: '#1D2567', color: '#ffffff' },
  admin:       { label: 'Admin',       bg: '#065f46', color: '#ffffff' },
  interviewer: { label: 'Interviewer', bg: '#92400e', color: '#ffffff' },
  viewer:      { label: 'Viewer',      bg: '#6b7280', color: '#ffffff' },
};

export default function UserMenu({ onOpenUserManagement }) {
  const { userProfile, signOut, isOwner } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

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

      {/* User Management icon — Owner only */}
      {isOwner && (
        <button
          onClick={onOpenUserManagement}
          title="Manage users"
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
        {/* Avatar */}
        <div style={{
          width: '26px', height: '26px', borderRadius: '50%',
          background: roleStyle.bg,
          border: '1.5px solid rgba(255,255,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'DM Sans', fontWeight: 700, fontSize: '10px',
          color: '#ffffff', flexShrink: 0,
        }}>
          {initials}
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
            background: '#ffffff', borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(29,37,103,0.18)',
            minWidth: '200px', zIndex: 999, overflow: 'hidden',
          }}>
            {/* Profile info */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', color: '#1D2567' }}>
                {userProfile.full_name}
              </div>
              <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                {userProfile.email}
              </div>
              <span style={{
                display: 'inline-block', marginTop: '6px',
                background: roleStyle.bg, color: roleStyle.color,
                fontFamily: 'DM Sans', fontWeight: 700, fontSize: '10px',
                padding: '2px 8px', borderRadius: '20px',
              }}>
                {roleStyle.label}
              </span>
            </div>

            {/* Sign out */}
            <button
              onClick={() => { setIsOpen(false); signOut(); }}
              style={{
                width: '100%', padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: '10px',
                background: 'none', border: 'none',
                fontFamily: 'DM Sans', fontSize: '13px', color: '#374151',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
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
