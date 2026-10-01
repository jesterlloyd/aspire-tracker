// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2: the self-check strip on Settings > Keith > Knowledge Center.
// It says when Keith last checked, what he read and filed, roughly what it cost, how many of his
// suggestions and unanswered questions are waiting, and (Owner, skill on) offers Check now. Every
// number comes from api/keith-knowledge-check.js; nothing is computed here but the wording.
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import SurfaceCard from '../ui/SurfaceCard'
import Button from '../ui/Button'
import { describeCheck, plural } from '../../lib/keith/knowledgeSelfCheckText'

async function postCheck(action) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/keith-knowledge-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action }),
  })
  const json = await res.json().catch(() => null)
  return { ok: res.ok, json }
}

export default function KnowledgeSelfCheckBar({ onChanged }) {
  const [status, setStatus] = useState(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState(null)

  const load = useCallback(async () => {
    try {
      const { ok, json } = await postCheck('status')
      setStatus(ok ? json : null)
    } catch { setStatus(null) }
  }, [])
  useEffect(() => { load() }, [load])

  const runNow = useCallback(async () => {
    setRunning(true); setMessage(null)
    try {
      const { ok, json } = await postCheck('run')
      if (ok) {
        const c = json?.check
        const n = (c?.suggestions || 0) + (c?.drafts || 0)
        setMessage({ tone: 'info', text: n ? `Done. ${plural(n, 'suggestion')} to review: they are marked Keith in the list below.` : 'Done. Nothing needed your attention.' })
        onChanged?.()
      } else {
        setMessage({ tone: 'error', text: json?.message || 'Keith could not finish the check. Try again.' })
      }
    } catch {
      setMessage({ tone: 'error', text: 'Keith could not finish the check. Try again.' })
    } finally {
      setRunning(false)
      load()
    }
  }, [load, onChanged])

  if (!status) return null
  if (status.enabled === false) {
    return (
      <SurfaceCard padding="10px 14px" style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--text-caption, #6b7280)' }}>
        Keith’s Knowledge Center check needs its database update before it can run.
      </SurfaceCard>
    )
  }

  const last = status.checks?.[0] || null
  const waiting = (status.edits_waiting || 0) + (status.drafts_waiting || 0)
  return (
    <SurfaceCard padding="12px 14px" style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.5 }} data-testid="knowledge-self-check">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-heading, #1f2937)' }}>Keith’s Knowledge Center Check</div>
          <div style={{ color: 'var(--text-caption, #6b7280)' }}>
            {running ? 'Keith is reading the app changes, the questions he could not answer and your entries. This takes a minute or two.' : describeCheck(last)}
          </div>
          <div style={{ color: 'var(--text-caption, #6b7280)' }}>
            {plural(waiting, 'suggestion')} waiting for review · {plural(status.questions_waiting || 0, 'unanswered question')} collected
            {!status.skill_on && status.can_run ? ' · Turn on Knowledge Self-Check in Settings > Keith > Skills to run a check.' : ''}
          </div>
        </div>
        {status.can_run && (
          <Button
            variant="quiet"
            icon={<RefreshCw size={14} strokeWidth={2.2} />}
            onClick={runNow}
            disabled={running || !status.skill_on || last?.status === 'running'}
          >
            {running ? 'Checking…' : 'Check now'}
          </Button>
        )}
      </div>
      {message && (
        <div role="status" style={{ marginTop: 8, color: message.tone === 'error' ? 'var(--aspire-bad, #b91c1c)' : 'var(--text-heading, #1f2937)' }}>
          {message.text}
        </div>
      )}
      {last?.findings?.length > 0 && !running && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-accent-primary, #1D2567)' }}>What Keith found last time ({last.findings.length})</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {last.findings.map((f, i) => (
              <li key={i}>
                <strong>{f.title}</strong>: {f.reason} <span style={{ color: 'var(--text-caption, #6b7280)' }}>({f.outcome})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </SurfaceCard>
  )
}
