// src/components/studio/StudioWorkspace.jsx
//
// STUDIO-1 (2026-11-05): ASPIRE Connect > Studio. The home (layouts, drafts, recent sends) and the
// editor for one design. Which one shows is the URL's ?design= (an id, or 'new:<layout>'), so Back
// and Forward work and a refresh keeps the open design. Owner and Admin only; the Connect page
// mounts this only for them.
//
// Where designs are kept is decided once per mount by /api/studio status: the server after
// 20261128000000_studio_designs.sql, this browser before it (studioClient.js says why).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import StudioHome from './StudioHome'
import StudioEditor from './StudioEditor'
import StudioKeithDrawer from './StudioKeithDrawer'
import { studioApi, studioStore, localDesignsToCopy, clearLocalDesigns } from '../../lib/studio/studioClient'
import { layoutFor } from '../../lib/studio/studioLayouts'
import { blankDesign } from '../../lib/studio/studioBlocks'
import { useAuth } from '../../contexts/AuthContext'
import './studio.css'

export default function StudioWorkspace({ active = true, cohortId, toast, refreshKey }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState(null)          // 'server' | 'local' | null while asking
  const [images, setImages] = useState(false)
  const [audiences, setAudiences] = useState(false)
  // STUDIO-3: Keith is offered only when both Studio Skills are on (status.keith) and designs live on
  // the server. His design opens in the editor as ?design=keith:<n>; it is held here, not in the URL,
  // so a refresh of that address returns to the home rather than to a design nobody has saved.
  const [keith, setKeith] = useState(false)
  const [keithAsk, setKeithAsk] = useState('')
  const [keithDrafts, setKeithDrafts] = useState({})
  const [designs, setDesigns] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [copyOffer, setCopyOffer] = useState(0)
  // STUDIO-FLICKER-1: when a new design's first save gives it an id, the URL moves from 'new:<layout>'
  // to that id. Keying the editor on the URL remounted it and reloaded the design from the server, which
  // flashed the screen; the editor keeps the key it opened with instead.
  const [keyFor, setKeyFor] = useState({})

  const { userProfile } = useAuth()
  const userKey = userProfile?.id || ''
  const param = new URLSearchParams(location.search).get('design') || ''
  const store = useMemo(() => (mode ? studioStore(mode, userKey) : null), [mode, userKey])

  useEffect(() => {
    if (!active || mode) return
    let off = false
    studioApi('status')
      .then(s => { if (!off) { setMode(s.provisioned ? 'server' : 'local'); setImages(!!s.images); setAudiences(!!s.audiences); setKeith(!!s.keith && !!s.provisioned) } })
      .catch(() => { if (!off) setMode('local') })
    return () => { off = true }
  }, [active, mode])

  const reload = useCallback(async () => {
    if (!store) return
    try {
      const rows = await store.list()
      setLoadError('')
      setDesigns(rows)
      if (store.mode === 'server') setCopyOffer(localDesignsToCopy(userKey).length)
    } catch (e) {
      setLoadError(e?.message || 'Designs could not be loaded.')
      setDesigns([])
    }
  }, [store, userKey])

  // The list is fetched here, not through reload(), so no state is set until the answer arrives.
  useEffect(() => {
    if (!active || !store || param) return undefined
    let off = false
    store.list()
      .then(rows => { if (off) return; setLoadError(''); setDesigns(rows); if (store.mode === 'server') setCopyOffer(localDesignsToCopy(userKey).length) })
      .catch(e => { if (off) return; setLoadError(e?.message || 'Designs could not be loaded.'); setDesigns([]) })
    return () => { off = true }
  }, [active, store, param, refreshKey, userKey])

  const open = useCallback((value) => {
    const q = new URLSearchParams(location.search)
    if (value) q.set('design', value); else q.delete('design')
    navigate({ pathname: location.pathname, search: q.toString() ? `?${q}` : '' })
  }, [location.pathname, location.search, navigate])

  const copyLocalUp = useCallback(async () => {
    const rows = localDesignsToCopy(userKey)
    const done = []
    for (const r of rows) {
      try { await store.save({ name: r.name, design: r.design }); done.push(r.id) } catch { /* left in the browser */ }
    }
    clearLocalDesigns(userKey, done)
    setCopyOffer(rows.length - done.length)
    toast?.success?.('Designs copied', `${done.length} design${done.length === 1 ? '' : 's'} from this browser now live in Studio for the team.`)
    reload()
  }, [store, toast, reload, userKey])

  // A Keith draft that was never saved does not survive a refresh: back to the home.
  const staleKeith = param.startsWith('keith:') && !keithDrafts[param]
  useEffect(() => { if (staleKeith) open('') }, [staleKeith, open])

  // STUDIO-FLICKER-1: the home draws at once (the layouts need nothing from the server), and only its
  // drafts list waits for the answer; a placeholder card swapped for the page read as a reload.
  if (!mode && !param) {
    return (
      <div className="st-page">
        <StudioHome mode={null} designs={null} loadError="" copyOffer={0} onCopyLocal={() => {}}
          onOpen={(id) => open(id)} onNew={(layoutKey) => open(`new:${layoutKey}`)} onDuplicate={() => {}} onArchive={() => {}} />
      </div>
    )
  }
  if (!mode) return <div className="st-page"><div className="st-card"><p className="st-sub">Opening Studio…</p></div></div>

  if (staleKeith) return null

  if (param) {
    const fromKeith = keithDrafts[param] || null
    const isNew = param.startsWith('new:') || Boolean(fromKeith)
    const initial = fromKeith
      ? fromKeith.design
      : isNew ? (layoutFor(param.slice(4))?.build() || blankDesign()) : null
    return (
      <div className="st-page">
        <StudioEditor
          key={keyFor[param] || param}
          store={store}
          designId={isNew ? null : param}
          initialDesign={initial}
          initialName={fromKeith ? fromKeith.name : isNew ? (layoutFor(param.slice(4))?.label || 'Untitled design') : ''}
          initialUnsaved={Boolean(fromKeith)}
          onCreated={(id) => {
            setKeyFor({ [id]: keyFor[param] || param })
            const q = new URLSearchParams(location.search); q.set('design', id)
            navigate({ pathname: location.pathname, search: `?${q}` }, { replace: true })
          }}
          onClose={() => open('')}
          imagesEnabled={images && mode === 'server'}
          audiencesEnabled={audiences && mode === 'server'}
          keithEnabled={keith}
          cohortId={cohortId}
          toast={toast}
        />
      </div>
    )
  }

  return (
    <div className="st-page">
      <StudioHome
        mode={mode}
        designs={designs}
        loadError={loadError}
        copyOffer={copyOffer}
        onCopyLocal={copyLocalUp}
        onOpen={(id) => open(id)}
        onNew={(layoutKey) => open(`new:${layoutKey}`)}
        onDuplicate={async (id) => { try { const d = await store.duplicate(id); open(d.id) } catch (e) { toast?.error?.('Not duplicated', e.message) } }}
        onArchive={async (id) => { try { await store.archive(id); reload() } catch (e) { toast?.error?.('Not archived', e.message) } }}
        keith={keith}
        onAskKeith={setKeithAsk}
      />
      {keithAsk && (
        <StudioKeithDrawer
          request={keithAsk}
          onClose={() => setKeithAsk('')}
          onDesigned={(design, name) => {
            const key = `keith:${Date.now().toString(36)}`
            setKeithDrafts(d => ({ ...d, [key]: { design, name } }))
            setKeithAsk('')
            open(key)
          }}
        />
      )}
    </div>
  )
}
