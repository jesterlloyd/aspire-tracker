// Contact photo upload, shared by ASPIRE Connect Contacts and the Rotation >
// Preceptors form so both write the same bucket with the same limits.
// Returns { url } on success or { error } with a message fit for the form.
//
// S-16: the browser no longer touches Storage. The file is read as base64 and sent
// to /api/contact-avatar-upload, which validates the bytes (fixed type map, size
// cap, magic-byte sniff), uploads with the service role, and, when a contact id is
// given, persists contacts.avatar_url itself. The signature is unchanged for the
// two callers; the supabase client is used only for the session token.

export const CONTACT_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const CONTACT_AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const CONTACT_AVATAR_HINT = 'JPEG, PNG, or WebP · max 2 MB'

export function validateContactAvatar(file) {
  if (!file) return 'Choose an image.'
  if (!CONTACT_AVATAR_TYPES.includes(file.type)) return 'Only JPEG, PNG, and WebP images are supported.'
  if (file.size > CONTACT_AVATAR_MAX_BYTES) return 'Image must be under 2 MB.'
  return null
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

export async function uploadContactAvatar(supabase, file, idHint) {
  const invalid = validateContactAvatar(file)
  if (invalid) return { error: invalid }
  try {
    const data_base64 = await readAsBase64(file)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { error: 'Session expired. Please refresh and try again.' }
    const res = await fetch('/api/contact-avatar-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contact_id: idHint || null, content_type: file.type, data_base64 }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.avatar_url) {
      if (res.status === 413) return { error: 'Image must be under 2 MB.' }
      if (res.status === 403) return { error: 'You do not have permission to upload a contact photo.' }
      return { error: body.message || 'Upload failed. Please try again.' }
    }
    return { url: body.avatar_url }
  } catch (err) {
    return { error: `Upload error: ${err.message}` }
  }
}
