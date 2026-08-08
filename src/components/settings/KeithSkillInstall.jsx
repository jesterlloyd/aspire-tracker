// KEITH-SKILL-INSTALL-1: Install Skill - upload → preview → install.
//
// A portable skill package is INSTRUCTIONS, never a trusted plugin. The
// browser does all binary handling: a .zip is opened client-side (zipLite,
// no dependencies) and ONLY markdown/text content is ever sent to the
// server - scripts, binaries, and anything else found in a package are
// surfaced as quarantined right here and never leave this component.
// The server (keith-skills-admin preview/import) is the authority on
// parsing, compatibility, conflicts, and the disabled-draft landing state.
import { useCallback, useRef, useState } from 'react'
import { Upload, PackageOpen, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import Button from '../ui/Button'
import SurfaceCard from '../ui/SurfaceCard'
import { readZip, sniffPackageKind } from '../../lib/zipLite'

const secondary = 'var(--color-text-secondary, #6b7280)'

// What may travel to the server as skill content. Everything else is shown
// as quarantined - by extension for well-known executable/script types, and
// by default for anything not on the allow list.
const TEXT_RE = /\.(md|markdown|txt)$/i
const EXECUTABLE_RE = /\.(js|mjs|cjs|ts|py|sh|bash|zsh|rb|pl|php|exe|dll|so|dylib|bin|bat|cmd|ps1|wasm|jar)$/i

const quarantineReason = (name) =>
  EXECUTABLE_RE.test(name) ? 'executable or script - never run, not imported' : 'unsupported file type - not imported'

async function dissectZip(arrayBuffer) {
  const { entries } = await readZip(arrayBuffer)
  const junk = (n) => /(^|\/)(__MACOSX|\.DS_Store)/.test(n)
  const skillEntry = entries
    .filter(e => !junk(e.name) && /(^|\/)SKILL\.md$/i.test(e.name) && e.bytes)
    .sort((a, b) => a.name.length - b.name.length)[0]
  if (!skillEntry) return { error: 'The archive has no SKILL.md.' }
  const baseDir = skillEntry.name.replace(/SKILL\.md$/i, '')
  const td = new TextDecoder()
  const references = []
  const quarantined = []
  for (const e of entries) {
    if (junk(e.name) || e === skillEntry) continue
    const rel = e.name.startsWith(baseDir) ? e.name.slice(baseDir.length) : e.name
    if (e.error) { quarantined.push({ name: rel, reason: 'unreadable entry' }); continue }
    if (TEXT_RE.test(rel)) {
      references.push({ name: rel.split('/').pop(), content: td.decode(e.bytes) })
    } else {
      quarantined.push({ name: rel, reason: quarantineReason(rel) })
    }
  }
  return { source: td.decode(skillEntry.bytes), references, quarantined }
}

export default function KeithSkillInstall({ postAdmin, onInstalled }) {
  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)       // { title, details[] }
  const [pkg, setPkg] = useState(null)               // { source, references, quarantined, filename }
  const [preview, setPreview] = useState(null)       // server preview response
  const [done, setDone] = useState(null)             // { slug, updated }
  const fileRef = useRef(null)

  const reset = () => { setProblem(null); setPkg(null); setPreview(null); setDone(null) }

  const handleFile = useCallback(async (file) => {
    if (!file) return
    reset(); setBusy(true)
    try {
      // KEITH-SKILL-NATIVE-1: the BYTES decide the parser path, never the
      // extension or MIME type (browsers report .skill as octet-stream or
      // nothing). A .skill from Claude is a ZIP; a hand-written one may be
      // bare Markdown; both flow through the same canonical pipeline.
      if (!/\.(zip|skill|md|markdown|txt)$/i.test(file.name)) {
        setProblem({ title: 'Unsupported file', details: ['Upload a Claude/Keith Skill (.skill), a SKILL.md, or a .zip skill package.'] })
        return
      }
      const buf = await file.arrayBuffer()
      const kind = sniffPackageKind(buf)
      let parsedPkg
      if (kind === 'zip') {
        const dissected = await dissectZip(buf)
        if (dissected.error) { setProblem({ title: 'Not a skill package', details: [`${file.name} is a ZIP archive, but ${dissected.error.replace(/^The archive /, 'it ')}`] }); return }
        parsedPkg = { ...dissected, filename: file.name }
      } else if (kind === 'text') {
        parsedPkg = { source: new TextDecoder().decode(buf), references: [], quarantined: [], filename: file.name }
      } else {
        setProblem({
          title: 'This file is not a skill package Keith understands',
          details: [`${file.name} is neither a ZIP archive nor readable text (binary content). A skill package is a SKILL.md, or a ZIP/.skill archive containing one.`],
        })
        return
      }
      setPkg(parsedPkg)
      const res = await postAdmin({
        action: 'preview_skill_package',
        source: parsedPkg.source,
        references: parsedPkg.references,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setProblem({ title: 'This package can’t be installed', details: json?.details || [json?.error || 'invalid package'] })
        return
      }
      setPreview(json)
    } catch {
      setProblem({ title: 'The file could not be read', details: ['Check the archive and try again.'] })
    } finally {
      setBusy(false)
    }
  }, [postAdmin])

  const install = useCallback(async (updateExisting) => {
    if (!pkg) return
    setBusy(true); setProblem(null)
    try {
      const res = await postAdmin({
        action: 'import_skill_package',
        source: pkg.source,
        references: pkg.references,
        ...(updateExisting ? { update_existing: true } : {}),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setProblem({
          title: json?.error === 'builtin_protected'
            ? 'This slug belongs to a built-in Skill'
            : 'Install failed',
          details: json?.details || [json?.error === 'builtin_protected'
            ? 'Built-in Skills are never overwritten by imported packages. Rename the package’s slug and re-upload.'
            : json?.error || 'Please try again.'],
        })
        return
      }
      setDone({ slug: json.skill?.slug, updated: json.updated === true })
      setPkg(null); setPreview(null)
      onInstalled?.()
    } finally {
      setBusy(false)
    }
  }, [pkg, postAdmin, onInstalled])

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    handleFile(e.dataTransfer?.files?.[0])
  }

  if (!open) {
    return (
      <Button variant="quiet" icon={<PackageOpen size={14} strokeWidth={2.2} />} onClick={() => { reset(); setOpen(true) }}>
        Install Skill
      </Button>
    )
  }

  const conflict = preview?.conflict
  const warnings = preview?.warnings || []
  const p = preview?.preview
  const compat = !preview ? null : warnings.length === 0 ? 'Compatible' : 'Compatible with warnings'

  return (
    <SurfaceCard padding="16px 18px" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <PackageOpen size={15} style={{ color: 'var(--color-accent-primary, #1D2567)' }} />
          Install Skill
        </span>
        <span style={{ fontSize: 12.5, color: secondary }}>
          Upload a Claude/Keith Skill (.skill), Markdown (.md), or Skill archive (.zip). Imported skills land as a disabled draft for your review; scripts and binaries in a package are never run.
        </span>
        <Button variant="quiet" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>Close</Button>
      </div>

      {/* Drop zone + picker */}
      {!preview && !done && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
          aria-label="Upload a skill package"
          style={{
            border: `2px dashed ${dragOver ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-border-default, #e5e7eb)'}`,
            background: dragOver ? 'var(--color-bg-elevated, #eef2fb)' : 'var(--color-bg-surface, #ffffff)',
            borderRadius: 12, padding: '26px 16px', textAlign: 'center', cursor: 'pointer',
            fontSize: 13, color: secondary, transition: 'all 0.15s ease',
          }}
        >
          <Upload size={18} style={{ marginBottom: 6, color: 'var(--color-accent-primary, #1D2567)' }} />
          <div>{busy ? 'Reading package…' : 'Drag a .skill, SKILL.md, or .zip here, or click to choose a file'}</div>
          <input
            ref={fileRef} type="file" accept=".md,.markdown,.zip,.skill" style={{ display: 'none' }}
            aria-hidden="true" tabIndex={-1}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; handleFile(f) }}
          />
        </div>
      )}

      {problem && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 9, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5 }}>
          <strong>{problem.title}.</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {problem.details.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      {/* Installation review */}
      {preview && p && !done && (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13 }}>
            <span style={{ color: secondary }}>Skill</span>
            <span style={{ fontWeight: 600 }}>{p.display_name} <code style={{ fontSize: 11.5, color: secondary, fontFamily: 'ui-monospace, monospace' }}>/{p.slug}</code></span>
            <span style={{ color: secondary }}>Description</span><span>{p.description}</span>
            <span style={{ color: secondary }}>Source</span><span>{pkg?.filename} ({p.source_label || 'imported package'})</span>
            <span style={{ color: secondary }}>Includes</span>
            <span>
              Instructions ({p.instruction_chars.toLocaleString()} chars)
              {p.references.length > 0 && <> · {p.references.length} reference file{p.references.length === 1 ? '' : 's'}</>}
              {p.trigger_phrases.length > 0 && <> · {p.trigger_phrases.length} trigger phrase{p.trigger_phrases.length === 1 ? '' : 's'}</>}
            </span>
            <span style={{ color: secondary }}>Roles</span><span>{p.allowed_roles.join(', ') || 'none declared'}</span>
            {p.required_data.length > 0 && (<><span style={{ color: secondary }}>Data access</span><span>{p.required_data.join(', ')} (granted only if your roles already allow it)</span></>)}
            <span style={{ color: secondary }}>Compatibility</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {compat === 'Compatible'
                ? <CheckCircle2 size={14} style={{ color: '#059669' }} />
                : <AlertTriangle size={14} style={{ color: '#d97706' }} />}
              {compat}
            </span>
          </div>

          {p.references.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: secondary }}>
              References (skill-local, used only when this Skill runs): {p.references.map(r => r.name).join(', ')}
            </div>
          )}

          {(warnings.length > 0 || pkg?.quarantined?.length > 0) && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 9, background: '#fffbeb', border: '1px solid #fcd34d', color: '#7c4a03', fontSize: 12.5 }}>
              {warnings.map((w, i) => <div key={`w${i}`}>· {w}</div>)}
              {(pkg?.quarantined || []).map((q, i) => (
                <div key={`q${i}`}><XCircle size={11} style={{ verticalAlign: -1 }} /> <code style={{ fontFamily: 'ui-monospace, monospace' }}>{q.name}</code> — {q.reason}</div>
              ))}
            </div>
          )}

          {conflict && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 9, background: 'var(--color-bg-elevated, #eef2fb)', border: '1px solid var(--color-border-default, #e5e7eb)', fontSize: 12.5 }}>
              <strong>Slug conflict.</strong> An existing {conflict.kind === 'builtin' ? 'built-in' : 'imported'} Skill uses <code style={{ fontFamily: 'ui-monospace, monospace' }}>/{conflict.slug}</code> (v{conflict.version}, {conflict.status}{conflict.enabled ? ', enabled' : ''}).
              {conflict.kind === 'builtin'
                ? ' Built-in Skills are never overwritten by imports; rename the package’s slug to install it.'
                : ' You can update it with this package; it will return to a disabled draft for review.'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {!conflict && <Button variant="primary" onClick={() => install(false)} disabled={busy}>{busy ? 'Installing…' : 'Install as disabled draft'}</Button>}
            {conflict?.updatable && <Button variant="primary" onClick={() => install(true)} disabled={busy}>{busy ? 'Updating…' : `Update /${conflict.slug} (v${conflict.version} → new draft)`}</Button>}
            <Button variant="quiet" onClick={reset} disabled={busy}>Choose a different file</Button>
          </div>
        </div>
      )}

      {done && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 9, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', fontSize: 12.5 }}>
          <CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> {done.updated ? 'Updated' : 'Installed'} <code style={{ fontFamily: 'ui-monospace, monospace' }}>/{done.slug}</code> as a <strong>disabled draft</strong>. Open it below to review, activate, and enable it; it then appears in Keith’s / menu for its allowed roles.
        </div>
      )}
    </SurfaceCard>
  )
}
