// src/components/signatures/PdfPages.jsx
//
// SIGNATURES-PHASE2: draws real PDF pages (PDF.js, bundled in `unpdf`, loaded lazily so no
// other screen pays for it) and lays an overlay on each page. Fields are stored in page
// percent, so the overlay is a positioned box the same size as the page at any zoom.
//
//   <PdfPages source={{ url } | { bytes }} pageSizes={[{w,h}]} pages={[1]} overlay={(n) => ...} />
//
// With no source (a preview with no document yet) it draws blank pages of the right shape.
import { useEffect, useRef, useState } from 'react'

let pdfjsPromise = null
const loadPdf = async (source) => {
  pdfjsPromise ||= import('unpdf')
  const { getDocumentProxy } = await pdfjsPromise
  let bytes = source.bytes
  if (!bytes && source.url) bytes = new Uint8Array(await (await fetch(source.url)).arrayBuffer())
  return getDocumentProxy(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
}

function PageCanvas({ doc, number, size }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!doc || !ref.current) return undefined
    let cancelled = false
    let task = null
    ;(async () => {
      const page = await doc.getPage(number)
      if (cancelled) return
      const canvas = ref.current
      const cssWidth = canvas.parentElement.getBoundingClientRect().width || 612
      const base = page.getViewport({ scale: 1 })
      const scale = (cssWidth / base.width) * Math.min(2, window.devicePixelRatio || 1)
      const viewport = page.getViewport({ scale })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      try { await task.promise } catch { /* cancelled */ }
    })()
    return () => { cancelled = true; try { task?.cancel() } catch { /* already done */ } }
  }, [doc, number, size?.w])
  return <canvas ref={ref} className="sg-canvas" aria-hidden="true" />
}

export default function PdfPages({ source, pageSizes = [], pages, overlay, className = '', pageClassName = '', pageProps }) {
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState(null)
  const key = source?.url || (source?.bytes ? `bytes:${source.bytes.length}` : '')
  useEffect(() => {
    if (!key) { setDoc(null); return undefined }
    let live = true
    setError(null)
    loadPdf(source).then(d => { if (live) setDoc(d) }).catch(() => { if (live) setError('The document could not be drawn.') })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const count = doc?.numPages || pageSizes.length || 1
  const list = pages || Array.from({ length: count }, (_, i) => i + 1)
  return (
    <div className={`sg-pages ${className}`}>
      {error && <p className="sg-hint">{error}</p>}
      {list.map(n => {
        const size = pageSizes[n - 1] || { w: 612, h: 792 }
        return (
          <div key={n} className={`sg-page ${pageClassName}`} style={{ aspectRatio: `${size.w} / ${size.h}` }}
            data-page={n} {...(pageProps ? pageProps(n) : {})}>
            {doc && <PageCanvas doc={doc} number={n} size={size} />}
            {overlay && overlay(n)}
          </div>
        )
      })}
    </div>
  )
}
