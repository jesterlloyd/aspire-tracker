import { useState, useEffect } from 'react'
import { CS_COLORS } from '../lib/brand'

const NIGHTFALL = CS_COLORS.nightfall || '#1D2567'

export default function StudentAvatar({ student, size = 34, style: extraStyle }) {
  const [imgError, setImgError] = useState(false)

  // Reset when headshot_url changes (upload, cohort switch, etc.)
  useEffect(() => { setImgError(false) }, [student?.headshot_url])

  const first    = student?.first_name?.trim() || ''
  const last     = student?.last_name?.trim()  || ''
  const initials = `${first[0] || ''}${last[0] || ''}`.toUpperCase() || '?'
  const fontSize = Math.round(size * 0.35)
  const hasPhoto = !!(student?.headshot_url && student.headshot_url.trim() !== '' && !imgError)

  return (
    <div style={{
      width:          `${size}px`,
      height:         `${size}px`,
      borderRadius:   '50%',
      background:     NIGHTFALL,
      flexShrink:     0,
      overflow:       'hidden',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      fontFamily:     'DM Sans, sans-serif',
      fontWeight:     700,
      fontSize:       `${fontSize}px`,
      color:          '#ffffff',
      userSelect:     'none',
      border:         '2px solid rgba(255,255,255,0.15)',
      ...extraStyle,
    }}>
      {hasPhoto ? (
        <img
          src={student.headshot_url}
          alt={`${first} ${last}`}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : initials}
    </div>
  )
}
