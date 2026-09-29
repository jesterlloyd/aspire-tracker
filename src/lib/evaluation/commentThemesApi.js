// src/lib/evaluation/commentThemesApi.js
//
// KEITH-THEMES-1: the browser's calls to /api/keith-comment-themes. The session's access token goes as a
// bearer token; the server decides everything else.
import { supabase } from '../supabase'

export class CommentThemesApiError extends Error {
  constructor(status, code, message) { super(message || 'The themes request failed.'); this.status = status; this.code = code }
}

export async function commentThemes(action, params = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/keith-comment-themes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...params }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new CommentThemesApiError(res.status, json?.error, json?.message)
  return json
}
