// KEITH-SKILLS-1: Settings → Keith → Skills detail drawer - read-only skill record
// inside the shared DetailDrawer, modeled on KnowledgeEntryDrawer's view mode.
// Owner/Admin see the record; ONLY the Owner sees the write controls, each behind
// the same two-step confirmation the Knowledge Center lifecycle uses:
//   • Lifecycle: Activate / Archive (draft), Deprecate (active), Reactivate /
//     Archive (deprecated); archived is terminal and shows a notice, no actions.
//   • Runtime kill switch: Enable / Disable, offered only while the skill is Active.
//     Disabling does NOT change the lifecycle state - it stops Keith from invoking
//     the skill, and the drawer says so in those words.
// There is no authoring here: no create/edit form, no version diff, no test runner,
// no import/export. instruction_body is displayed read-only. The backend
// (api/keith-skills-admin) authorizes every action regardless of this gating.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import DetailDrawer from '../ui/DetailDrawer'
import Button from '../ui/Button'
import StateBadge from './StateBadge'
import StatusBadge from '../ui/StatusBadge'
import {
  ENABLED_STYLES, CLASSIFICATION_STYLES, failureCount, formatList, fmtDate, fmtDateTime,
} from './keithSkillFields'

async function postAdmin(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return fetch('/api/keith-skills-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
}

// State → Owner lifecycle actions. Every action maps to an existing endpoint action,
// so invalid transitions are simply never offered:
//   • activate  (draft → active)              → activate_skill      (optional change note)
//   • archive   (draft/deprecated → archived) → change_skill_state target archived
//   • deprecate (active → deprecated)         → change_skill_state target deprecated
//   • reactivate(deprecated → active)         → change_skill_state target active
// archived is terminal (no actions). change_skill_state takes no note.
const LIFECYCLE_ACTIONS = {
  draft: [
    { key: 'activate', label: 'Activate', next: 'active', variant: 'primary', note: true, consequence: 'Keith can invoke this skill once it is also enabled.' },
    { key: 'archive', label: 'Archive', next: 'archived', variant: 'quiet', consequence: 'This is permanent. Archived skills cannot be restored.' },
  ],
  active: [
    { key: 'deprecate', label: 'Deprecate', next: 'deprecated', variant: 'secondary', consequence: 'Keith stops invoking this skill and it is no longer current.' },
  ],
  deprecated: [
    { key: 'reactivate', label: 'Reactivate', next: 'active', variant: 'secondary', consequence: 'This skill becomes current again.' },
    { key: 'archive', label: 'Archive', next: 'archived', variant: 'quiet', consequence: 'This is permanent. Archived skills cannot be restored.' },
  ],
  archived: [],
}

// Must match api/keith-skills-admin.js CAPS.change_note.
const NOTE_CAP = 2000

// The drawer spells the kill switch out ("Enabled"/"Disabled") where the table's
// Enabled column reads as a plain Yes/No; same colors either way.
const RUNTIME_STYLES = {
  yes: { ...ENABLED_STYLES.yes, label: 'Enabled' },
  no: { ...ENABLED_STYLES.no, label: 'Disabled' },
}

const sectionLabel = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 6 }
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 5 }
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 9,
  border: '1px solid var(--color-border-default, #e5e7eb)',
  background: 'var(--color-bg-surface, #ffffff)', color: 'var(--color-text-primary, #191919)',
  fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const noticeStyle = { padding: '8px 12px', marginBottom: 14, borderRadius: 8, background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-text-secondary, #6b7280)', fontSize: 12.5 }

function Detail({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={sectionLabel}>{label}</div>
      <div>{children}</div>
    </div>
  )
}

// One invocation-summary tile (30-day window).
function StatTile({ label, value, emphasis }) {
  return (
    <div style={{
      flex: '1 1 92px', minWidth: 88, padding: '10px 12px', borderRadius: 10,
      background: 'var(--color-bg-elevated, #eef2fb)',
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: emphasis || 'var(--color-text-primary, #191919)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function KeithSkillDrawer({ open, skill, isOwner = false, onClose, onChanged }) {
  // `pending` holds the in-progress confirmation: which skill it was raised FOR, the
  // action object (lifecycle OR the enable/disable switch), the optional note, and the
  // error state. Carrying forId lets the confirmation be DERIVED during render rather
  // than reset by a setState in an effect body (which this repo forbids,
  // react-hooks/set-state-in-effect): closing the drawer or opening a different skill
  // simply makes the pending confirmation stop applying, so a confirmation raised for
  // one skill can never be confirmed against another.
  const [pending, setPending] = useState({ forId: null, action: null, note: '', error: null, conflict: false })
  const [saving, setSaving] = useState(false)

  const pendingApplies = open && !!pending.forId && pending.forId === skill?.id
  const confirm = pendingApplies ? pending.action : null
  const note = pendingApplies ? pending.note : ''
  const error = pendingApplies ? pending.error : null
  const conflict = pendingApplies ? pending.conflict : false

  const stats = skill?.stats || {}
  const isActive = skill?.status === 'active'
  const enabled = skill?.enabled === true
  const confidential = skill?.data_classification === 'confidential'
  // "Not running" is the union of the two gates: a skill runs only while it is
  // Active AND enabled.
  const notRunning = !isActive || !enabled

  const CLEARED = { forId: null, action: null, note: '', error: null, conflict: false }
  function startConfirm(a) { setPending({ ...CLEARED, forId: skill?.id || null, action: a }) }
  function cancelConfirm() { setPending(CLEARED) }
  function setNoteValue(v) { setPending(p => ({ ...p, note: v })) }
  // Re-sync after a 409/404: the parent re-fetches the skill + reloads the list.
  function refreshFromConflict() { setPending(CLEARED); onChanged?.(skill?.id) }

  // The Owner-only runtime kill switch, offered only while the skill is Active.
  const enableAction = enabled
    ? { key: 'disable', label: 'Disable', kind: 'enabled', enabled: false, variant: 'destructive', consequence: 'Keith stops invoking this skill immediately. The skill stays Active and can be re-enabled at any time.' }
    : { key: 'enable', label: 'Enable', kind: 'enabled', enabled: true, variant: 'primary', consequence: 'Keith can invoke this skill again immediately.' }

  // Surface a failure on the pending confirmation only (never a raw backend code).
  function fail(message, isConflict = false) {
    setPending(p => ({ ...p, error: message, conflict: isConflict }))
  }

  async function runAction() {
    if (!confirm || saving || !skill?.id) return
    setSaving(true); setPending(p => ({ ...p, error: null, conflict: false }))
    try {
      let payload
      if (confirm.kind === 'enabled') {
        payload = { action: 'set_skill_enabled', skill_id: skill.id, enabled: confirm.enabled }
      } else if (confirm.key === 'activate') {
        payload = { action: 'activate_skill', skill_id: skill.id, ...(note.trim() !== '' ? { change_note: note } : {}) }
      } else {
        payload = { action: 'change_skill_state', skill_id: skill.id, target_state: confirm.next }
      }
      const res = await postAdmin(payload)
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.ok !== true) {
        // 409/404 mean the skill moved underneath us - offer a refresh, not a retry,
        // and never surface the raw backend error code.
        if (res.status === 409) fail('This skill changed since you opened it, so that action can’t be applied. Refresh to load the latest state.', true)
        else if (res.status === 404) fail('This skill no longer exists. Refresh to update the list.', true)
        else if (res.status === 403) fail('You don’t have permission to perform this action.')
        else fail('We couldn’t complete that action. Please try again.')
        return
      }
      // Success: clear the confirmation, then refresh the list and re-fetch this skill
      // into the open drawer so it shows the new state.
      setPending(CLEARED)
      onChanged?.(skill.id)
    } catch {
      fail('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // KEITH-SKILL-INSTALL-1: Download packages this skill in the portable format
  // (SKILL.md; a .zip with references/ beside it when the skill carries any),
  // so a Keith skill can be stored, shared, and re-installed faithfully.
  const downloadSkill = async () => {
    try {
      const res = await postAdmin({ action: 'export_skill_package', skill_id: skill.id })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.files) return
      // KEITH-SKILL-NATIVE-1: downloads use the .skill container - a ZIP with
      // slug/SKILL.md (+ references/) inside, byte-compatible with what Claude
      // exports and with Keith's own upload path. Same package format as
      // before; only the container/extension presentation changed.
      const { writeZip } = await import('../../lib/zipLite')
      const blob = new Blob([writeZip(json.files.map(f => ({ name: f.name, text: f.content })))], { type: 'application/zip' })
      const filename = `${skill.slug}.skill`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch { /* download is best-effort */ }
  }

  const footer = (
    <>
      <Button variant="quiet" onClick={downloadSkill} disabled={saving || !skill?.id}>Download</Button>
      <Button variant="quiet" onClick={onClose} disabled={saving}>Close</Button>
    </>
  )

  return (
    <DetailDrawer open={open} title={skill?.display_name || 'Keith Skill'} onClose={onClose} footer={footer}>
      <div style={{ fontSize: 13, color: 'var(--color-text-primary, #374151)' }}>
        {/* Identity row: lifecycle state, runtime state, classification, version, updated */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <StateBadge state={skill?.status} />
          <StatusBadge value={enabled ? 'yes' : 'no'} colorMap={RUNTIME_STYLES} />
          {skill?.data_classification && (
            <StatusBadge value={skill.data_classification} colorMap={CLASSIFICATION_STYLES} dot={false} />
          )}
          {/* KEITH-SKILL-INSTALL-1: provenance chip - Built-in vs Imported. */}
          <span style={{
            display: 'inline-flex', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600,
            background: String(skill?.provenance || '').startsWith('imported') ? 'var(--color-bg-elevated, #eef2fb)' : 'transparent',
            border: '1px solid var(--color-border-default, #dbe3f5)',
            color: String(skill?.provenance || '').startsWith('imported') ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-text-secondary, #9ca3af)',
          }}>
            {String(skill?.provenance || '').startsWith('imported') ? 'Imported' : 'Built-in'}
          </span>
          <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>v{skill?.version ?? '-'}</span>
          <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>·</span>
          <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>Updated {fmtDate(skill?.updated_at)}</span>
        </div>
        <div style={{
          fontSize: 12, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 14,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all',
        }}>
          {skill?.slug}
        </div>

        {/* Runtime status - a disabled or non-active skill must read as NOT RUNNING. */}
        {notRunning ? (
          <div style={{ padding: '10px 12px', marginBottom: 14, borderRadius: 8, background: '#FEF3C7', border: '1px solid #fde68a', color: '#78350F', fontSize: 12.5 }}>
            <strong>Not running.</strong>{' '}
            {isActive
              ? 'This skill is disabled, so Keith will not invoke it.'
              : `A skill runs only while it is Active and enabled. This one is ${skill?.status || 'not active'}.`}
          </div>
        ) : (
          <div style={{ padding: '10px 12px', marginBottom: 14, borderRadius: 8, background: '#EDF2E2', border: '1px solid #d5e3bb', color: '#166534', fontSize: 12.5 }}>
            <strong>Running.</strong> Keith can invoke this skill.
          </div>
        )}

        {/* Confidential handling is a governance fact, not a styling detail - call it out. */}
        {confidential && (
          <div style={{ padding: '10px 12px', marginBottom: 14, borderRadius: 8, background: '#F8EDF2', border: '1px solid #f0cfdd', color: '#930045', fontSize: 12.5 }}>
            <strong>Confidential.</strong> This skill is classified confidential. Its instructions and the data it reaches are restricted to the roles listed below.
          </div>
        )}

        <Detail label="Description">
          {skill?.description || <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>(none)</span>}
        </Detail>

        <Detail label="Allowed roles">
          {skill?.status === 'draft' && isOwner ? (
            /* KEITH-SKILL-NATIVE-2: an imported package carries no Keith roles,
               and a role-less skill cannot be activated (the endpoint refuses).
               The Owner assigns roles HERE, from the canonical vocabulary,
               through the existing update_skill_draft action. */
            <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
              {/* ROLE-GUIDE-1: what granting each role to a SKILL actually
                  means. Viewer is absent because Keith Skills deny Viewer at
                  the authorization layer and the endpoint refuses to store it. */}
              {[
                ['owner', 'always allowed, listed or not'],
                ['admin', 'full administration'],
                ['co-lead', 'student-record access'],
                ['interviewer', 'entitled cohorts only'],
              ].map(([r, meaning]) => (
                <label key={r} title={`${r}: ${meaning}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={(skill.allowed_roles || []).includes(r)}
                    onChange={async e => {
                      const next = e.target.checked
                        ? [...(skill.allowed_roles || []), r]
                        : (skill.allowed_roles || []).filter(x => x !== r)
                      const res = await postAdmin({ action: 'update_skill_draft', skill_id: skill.id, allowed_roles: next })
                      if (res.ok) onChanged?.(skill.id)
                    }}
                  />
                  <span>{r} <span style={{ color: 'var(--color-text-secondary, #9ca3af)', fontSize: 11 }}>({meaning})</span></span>
                </label>
              ))}
              {(skill.allowed_roles || []).length === 0 && (
                <span style={{ color: '#b45309', fontSize: 12 }}>Assign at least one role before activating</span>
              )}
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #9ca3af)', flexBasis: '100%' }}>
                Viewer cannot invoke Skills and cannot be granted here.
              </span>
            </span>
          ) : formatList(skill?.allowed_roles)}
        </Detail>
        <Detail label="Required tools">{formatList(skill?.required_tools)}</Detail>
        <Detail label="Required data">{formatList(skill?.required_data)}</Detail>

        <Detail label="Trigger phrases">
          {Array.isArray(skill?.trigger_phrases) && skill.trigger_phrases.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {skill.trigger_phrases.map((p, i) => (
                <span key={`${p}-${i}`} style={{
                  display: 'inline-flex', padding: '2px 9px', borderRadius: 999,
                  background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-accent-primary, #1D2567)',
                  fontSize: 11.5, fontWeight: 600,
                }}>
                  {p}
                </span>
              ))}
            </div>
          ) : '-'}
        </Detail>

        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={sectionLabel}>Model route</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }}>{skill?.model_route || '-'}</div>
          </div>
          <div>
            <div style={sectionLabel}>Version</div>
            <div style={{ fontVariantNumeric: 'tabular-nums' }}>{skill?.version ?? '-'}</div>
          </div>
        </div>

        {/* Instructions - read-only preview, same pre-wrap treatment the Knowledge
            Center uses for entry bodies. Never editable in this phase. */}
        <div style={sectionLabel}>Instructions</div>
        <div style={{
          whiteSpace: 'pre-wrap', lineHeight: 1.55, marginBottom: 18,
          padding: '12px 14px', borderRadius: 10, maxHeight: 320, overflowY: 'auto',
          background: 'var(--color-bg-elevated, #eef2fb)',
          border: '1px solid var(--color-border-subtle, #f3f4f6)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5,
          color: 'var(--color-text-primary, #374151)', wordBreak: 'break-word',
        }}>
          {skill?.instruction_body || <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>(empty)</span>}
        </div>

        {/* Invocation summary - last 30 days. */}
        <div style={sectionLabel}>Invocations · last 30 days</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <StatTile label="Total" value={Number(stats.total) || 0} />
          <StatTile label="Completed" value={Number(stats.completed) || 0} />
          <StatTile label="Denied" value={Number(stats.denied) || 0} />
          <StatTile label="Missing data" value={Number(stats.missing_data) || 0} />
          <StatTile label="Errors" value={failureCount(stats)} emphasis={failureCount(stats) > 0 ? '#dc2626' : undefined} />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 4 }}>
          Last invoked {fmtDateTime(stats.last_invoked_at)}
        </div>

        {/* Owner-only controls: the runtime kill switch and the lifecycle, both behind
            a confirmation step. Admins see the record above and nothing here. */}
        {isOwner && (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--color-border-subtle, #f3f4f6)' }}>
            {confirm ? (
              <div style={{ border: '1px solid var(--color-border-default, #e5e7eb)', borderRadius: 10, padding: '14px 16px', background: 'var(--color-bg-surface, #ffffff)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary, #191919)', marginBottom: 6 }}>{confirm.label} this skill?</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 10, wordBreak: 'break-word' }}>{skill?.display_name || skill?.slug}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {confirm.kind === 'enabled' ? (
                    <>
                      <StatusBadge value={enabled ? 'yes' : 'no'} colorMap={RUNTIME_STYLES} />
                      <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>→</span>
                      <StatusBadge value={confirm.enabled ? 'yes' : 'no'} colorMap={RUNTIME_STYLES} />
                    </>
                  ) : (
                    <>
                      <StateBadge state={skill?.status} />
                      <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>→</span>
                      <StateBadge state={confirm.next} />
                    </>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-primary, #374151)', marginBottom: 12 }}>{confirm.consequence}</div>

                {confirm.note && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Change note<span style={{ fontWeight: 500, color: 'var(--color-text-secondary, #9ca3af)' }}> · optional</span></label>
                    <textarea
                      style={{ ...inputStyle, minHeight: 64, resize: 'vertical', lineHeight: 1.5 }}
                      value={note}
                      maxLength={NOTE_CAP}
                      onChange={e => setNoteValue(e.target.value)}
                      placeholder="Why is this being activated? (optional)"
                    />
                  </div>
                )}

                {error && (
                  <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5 }}>
                    {error}
                    {conflict && (
                      <div style={{ marginTop: 8 }}>
                        <Button variant="secondary" onClick={refreshFromConflict}>Refresh</Button>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button variant="quiet" onClick={cancelConfirm} disabled={saving}>Cancel</Button>
                  {!conflict && (
                    <Button variant={confirm.variant} onClick={runAction} disabled={saving}>
                      {saving ? 'Working…' : `Confirm ${confirm.label}`}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Runtime kill switch - Active skills only. Separate from lifecycle. */}
                {isActive && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={sectionLabel}>Runtime</div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 10 }}>
                      Kill switch. {enabled
                        ? 'Disabling stops Keith from invoking this skill right away, without changing its lifecycle state.'
                        : 'This skill is Active but disabled, so Keith is not invoking it. Enable it to put it back in service.'}
                    </div>
                    <Button variant={enableAction.variant} onClick={() => startConfirm(enableAction)}>{enableAction.label}</Button>
                  </div>
                )}

                <div style={sectionLabel}>Lifecycle</div>
                {skill?.status === 'archived' ? (
                  <div style={noticeStyle}>
                    This skill is archived. Archived skills are permanent and can’t be changed.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(LIFECYCLE_ACTIONS[skill?.status] || []).map(a => (
                      <Button key={a.key} variant={a.variant} onClick={() => startConfirm(a)}>{a.label}</Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </DetailDrawer>
  )
}
