// KEITH-KNOWLEDGE-SELFCHECK-1: what changed in the app, for Keith's Knowledge Center self-check.
//
// The evidence is the repository's commit history on main: this repository's messages already say
// in plain words what changed and why ("Rotation > Activity is labelled Shift Log"). Keith's server has
// no git at runtime and the deploy does not carry history, so the history is read from GitHub's API.
// The repository is public, so no token is needed; GITHUB_TOKEN, when set, only raises the rate limit
// (60 requests an hour without one, which a twice-monthly check and a few "Check now" presses never reach).
//
// Only what a knowledge reviewer needs is kept: the short sha, the date, the subject, and the body
// without its trailers (Co-Authored-By and the like), capped. Merge commits are skipped.

export const APP_REPO = process.env.APP_REPO || 'jesterlloyd/aspire-tracker'
export const APP_BRANCH = 'main'
export const MAX_BODY_CHARS = 1500
const PER_PAGE = 100
const TRAILER = /^(co-authored-by|signed-off-by|reviewed-by|🤖 generated with)\b/i

/** One commit message as { subject, body }, trailers removed and the body capped. Pure. */
export function summarizeCommitMessage(message) {
  const lines = String(message || '').replace(/\r\n/g, '\n').split('\n')
  const subject = (lines.shift() || '').trim()
  const body = lines.filter(l => !TRAILER.test(l.trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { subject, body: body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS).trimEnd()} …` : body }
}

/**
 * The commits on main after `since` (an ISO date or Date), newest first, at most `max`.
 * Returns { ok: true, commits: [{ sha, date, subject, body }], truncated } or { ok: false, error, status }.
 * Never throws.
 */
export async function fetchAppChanges({ since, max = 200, fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN } = {}) {
  const sinceIso = since ? new Date(since).toISOString() : null
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'aspire-intelligence-keith', 'x-github-api-version': '2022-11-28' }
  if (token) headers.authorization = `Bearer ${token}`
  const commits = []
  try {
    for (let page = 1; commits.length < max; page++) {
      const qs = new URLSearchParams({ sha: APP_BRANCH, per_page: String(PER_PAGE), page: String(page) })
      if (sinceIso) qs.set('since', sinceIso)
      const res = await fetchImpl(`https://api.github.com/repos/${APP_REPO}/commits?${qs}`, { headers, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return { ok: false, error: res.status === 403 || res.status === 429 ? 'rate_limited' : 'github_error', status: res.status }
      const rows = await res.json()
      if (!Array.isArray(rows) || rows.length === 0) break
      for (const r of rows) {
        if (Array.isArray(r?.parents) && r.parents.length > 1) continue
        const { subject, body } = summarizeCommitMessage(r?.commit?.message)
        if (!subject) continue
        commits.push({ sha: String(r.sha || '').slice(0, 8), date: r?.commit?.committer?.date || r?.commit?.author?.date || null, subject, body })
        if (commits.length >= max) break
      }
      if (rows.length < PER_PAGE) break
    }
    return { ok: true, commits, truncated: commits.length >= max }
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network', status: 0 }
  }
}
