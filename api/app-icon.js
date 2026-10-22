// api/app-icon.js
//
// APP-ICON-PROBE-1 (2026-10-22), TEMPORARY DIAGNOSTIC. On the Owner's iPhone, Safari's
// Add to Home Screen installs the letter A for this site (and for the aspire-tracker.vercel.app
// alias), while the iOS 27 Simulator installs the real icon from the same live files. Static
// files leave no request log on Vercel, so this serves the SAME home-screen PNGs through a
// function and logs each request: which size, the user agent, and the fetch headers that say
// who asked. Nothing personal is logged. Remove it, and point index.html and the manifest back
// at /app-icon/*.png, once the cause is known.

import { readFileSync } from 'node:fs'

const FILES = {
  '180': 'aspire-180.png',
  '192': 'aspire-192.png',
  '512': 'aspire-512.png',
  maskable: 'aspire-maskable-512.png',
}

export default function handler(req, res) {
  const size = String(req.query?.size || '180')
  const file = FILES[size]
  const h = req.headers || {}
  console.log(JSON.stringify({
    probe: 'app-icon',
    method: req.method,
    size,
    ua: h['user-agent'] || null,
    accept: h.accept || null,
    secFetchDest: h['sec-fetch-dest'] || null,
    secFetchMode: h['sec-fetch-mode'] || null,
    secFetchSite: h['sec-fetch-site'] || null,
    referer: h.referer || null,
    found: Boolean(file),
  }))
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end()
  if (!file) return res.status(404).end()
  const body = readFileSync(new URL(`../public/app-icon/${file}`, import.meta.url))
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Content-Length', String(body.length))
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send(req.method === 'HEAD' ? '' : body)
}
