import React from 'react'

const nameToColor = (name = '') => {
  const colors = [
    '#1D2567', '#065f46', '#0e7490', '#5b21b6',
    '#92400e', '#3730a3', '#9f1239', '#1e40af',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export default function StudentAvatar({ student, size = 34 }) {
  const first    = student?.first_name?.trim() || ''
  const last     = student?.last_name?.trim()  || ''
  const initials = `${first[0] || ''}${last[0] || ''}`.toUpperCase() || '?'
  const bg       = nameToColor(`${first} ${last}`)
  const fontSize = Math.round(size * 0.35)

  return (
    <div style={{
      width:          `${size}px`,
      height:         `${size}px`,
      borderRadius:   '50%',
      background:     bg,
      flexShrink:     0,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      fontFamily:     'DM Sans, sans-serif',
      fontWeight:     700,
      fontSize:       `${fontSize}px`,
      color:          '#ffffff',
      userSelect:     'none',
      border:         '2px solid rgba(255,255,255,0.15)',
    }}>
      {initials}
    </div>
  )
}
