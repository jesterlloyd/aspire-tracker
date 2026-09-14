// Contact photo upload, shared by ASPIRE Connect Contacts and the Rotation >
// Preceptors form so both write the same bucket with the same limits.
// Returns { url } on success or { error } with a message fit for the form.

export const CONTACT_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const CONTACT_AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const CONTACT_AVATAR_HINT = 'JPEG, PNG, or WebP · max 2 MB'

export function validateContactAvatar(file) {
  if (!file) return 'Choose an image.'
  if (!CONTACT_AVATAR_TYPES.includes(file.type)) return 'Only JPEG, PNG, and WebP images are supported.'
  if (file.size > CONTACT_AVATAR_MAX_BYTES) return 'Image must be under 2 MB.'
  return null
}

export async function uploadContactAvatar(supabase, file, idHint) {
  const invalid = validateContactAvatar(file)
  if (invalid) return { error: invalid }
  try {
    const ext  = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${idHint || `new-${Date.now()}`}-${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('contact-avatars')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (error) return { error: `Upload failed: ${error.message}` }
    const { data: { publicUrl } } = supabase.storage.from('contact-avatars').getPublicUrl(path)
    return { url: publicUrl }
  } catch (err) {
    return { error: `Upload error: ${err.message}` }
  }
}
