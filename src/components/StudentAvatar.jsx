import { useState } from 'react'
import { CS_COLORS } from '../lib/brand'
import { useStudentFileUrl } from '../lib/useStudentFile'
import { classifyStoredFileRef } from '../lib/studentFileClient'

const NIGHTFALL = CS_COLORS.nightfall || '#1D2567'

export default function StudentAvatar({ student, size = 34, style: extraStyle }) {
  // Track the url that failed to load rather than a boolean reset in an effect:
  // when a new signed url arrives it differs from erroredUrl, so the photo shows
  // again with no effect and no cascading render.
  const [erroredUrl, setErroredUrl] = useState(null)

  // WAVE F-2: the headshot is resolved through the server access endpoint, which
  // enforces the role matrix (a role without headshot access gets no url, so the
  // avatar falls back to initials). Only fetch when a headshot is actually stored
  // and we have the student id. A ?t= cache-buster on the stored value still
  // counts as stored.
  const hasStored = classifyStoredFileRef(student?.headshot_url) !== 'empty'
  const { url: signedUrl } = useStudentFileUrl({
    studentId: student?.id, kind: 'headshot',
    enabled: Boolean(student?.id) && hasStored,
    refreshKey: student?.headshot_url,
  })

  const first    = student?.first_name?.trim() || ''
  const last     = student?.last_name?.trim()  || ''
  const initials = `${first[0] || ''}${last[0] || ''}`.toUpperCase() || '?'
  const fontSize = Math.round(size * 0.35)
  const hasPhoto = !!(signedUrl && signedUrl !== erroredUrl)

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
      fontFamily:     'Plus Jakarta Sans, sans-serif',
      fontWeight:     700,
      fontSize:       `${fontSize}px`,
      color:          '#ffffff',
      userSelect:     'none',
      border:         '2px solid rgba(255,255,255,0.15)',
      ...extraStyle,
    }}>
      {hasPhoto ? (
        <img
          src={signedUrl}
          alt={`${first} ${last}`}
          onError={() => setErroredUrl(signedUrl)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : initials}
    </div>
  )
}
