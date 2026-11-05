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
  const [designs, setDesigns] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [copyOffer, setCopyOffer] = useState(0)

  const { userProfile } = useAuth()
  const userKey = userProfile?.id || ''
  const param = new URLSearchParams(location.search).get('design') || ''
  const store = useMemo(() => (mode ? studioStore(mode, userKey) : null), [mode, userKey])

  useEffect(() => {
    if (!active || mode) return
    let off = false
    studioApi('status')
      .then(s => { if (!off) { setMode(s.provisioned ? 'server' : 'local'); setImages(!!s.images) } })
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

  if (!mode) return <div className="st-page"><div className="st-card"><p className="st-sub">Opening Studio…</p></div></div>

  if (param) {
    const isNew = param.startsWith('new:')
    const initial = isNew
      ? (layoutFor(param.slice(4))?.build() || blankDesign())
      : null
    return (
      <div className="st-page">
        <StudioEditor
          key={param}
          store={store}
          designId={isNew ? null : param}
          initialDesign={initial}
          initialName={isNew ? (layoutFor(param.slice(4))?.label || 'Untitled design') : ''}
          onCreated={(id) => {
            const q = new URLSearchParams(location.search); q.set('design', id)
            navigate({ pathname: location.pathname, search: `?${q}` }, { replace: true })
          }}
          onClose={() => open('')}
          imagesEnabled={images && mode === 'server'}
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
      />
    </div>
  )
}
