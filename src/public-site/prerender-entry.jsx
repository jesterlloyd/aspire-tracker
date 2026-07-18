// src/public-site/prerender-entry.jsx
//
// ASPIRE-PUBLIC-SEO: build-time server entry for prerendering the PUBLIC
// pages only. scripts/prerender-public.mjs builds this with `vite build
// --ssr` and calls render() for each public route, so crawlers receive full
// route-specific HTML without executing JavaScript. This is the same React
// tree visitors get (no bot-only content): the client bundle mounts over it
// after load.
//
// MemoryRouter (not BrowserRouter) supplies routing without a DOM; the real
// AuthProvider supplies auth context with its initial signed-out state, which
// is exactly what an anonymous visitor's first paint uses.

import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../contexts/AuthContext'
import PublicSite from './PublicSite'

export function render(page, path) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <PublicSite page={page} />
      </AuthProvider>
    </MemoryRouter>,
  )
}
