// TOPBAR-PROFILE-1 (2026-10-02): the staff photo controls, moved out of the profile menu
// onto Settings > General > Profile. The handlers are the menu's, unchanged: the same
// S-16 server writer (/api/my-avatar), the same type and size checks, the same alerts, and
// the same full reload afterwards so every avatar on the page re-signs.
import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useMyAvatar() {
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  // S-16: one call shape for set and remove, against the server-side writer.
  const postMyAvatar = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/my-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, body }
  }
  const readFileAsBase64 = (f) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('Could not read that file.'))
    r.readAsDataURL(f)
  })

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) { alert('Please upload a JPG, PNG, or WebP image.'); return }
    if (file.size > 2 * 1024 * 1024)    { alert('Image must be under 2MB.'); return }

    setUploading(true)
    try {
      // S-16: the browser never touches Storage. /api/my-avatar validates the bytes,
      // uploads with the service role to a path derived from the verified identity,
      // and writes avatar_url itself.
      const data_base64 = await readFileAsBase64(file)
      const { ok, body } = await postMyAvatar({ content_type: file.type, data_base64 })
      if (!ok) { alert(body.message || 'Could not update your photo. Please try again.'); return }
      window.location.reload()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleAvatarRemove = async () => {
    const { ok, body } = await postMyAvatar({ action: 'remove' })
    if (!ok) { alert(body.message || 'Could not remove your photo. Please try again.'); return }
    window.location.reload()
  }

  return { uploading, fileInputRef, handleAvatarUpload, handleAvatarRemove }
}
