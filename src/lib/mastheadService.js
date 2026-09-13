// MASTHEAD-PHASE-2b: where the Masthead service lives, and the one loader.
//
// The card is served once at MASTHEAD_URL (docs/product/MASTHEAD_SERVICE_PLAN.md)
// and loaded live, so a new city or effect reaches this app on the next page
// load with no build. VITE_MASTHEAD_URL overrides the address for a preview
// deployment or a local build of the service.
export const MASTHEAD_HOST_KEY = import.meta.env.VITE_MASTHEAD_HOST_KEY || 'aspire-intelligence'
export const MASTHEAD_URL = (import.meta.env.VITE_MASTHEAD_URL || 'https://masthead-seven.vercel.app').replace(/\/+$/, '')

let loading = null
/** Load /v1/masthead.js once. Resolves when <masthead-card> is defined. */
export function ensureMasthead() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      if (typeof customElements !== 'undefined' && customElements.get('masthead-card')) return resolve()
      const s = document.createElement('script')
      s.type = 'module'
      // MASTHEAD-SETTINGS-1: the service admits only registered hosts, by key
      // and by page origin; this app is registered as aspire-intelligence.
      s.src = `${MASTHEAD_URL}/v1/masthead.js?host=${MASTHEAD_HOST_KEY}`
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('masthead failed to load'))
      document.head.appendChild(s)
    })
  }
  return loading
}

