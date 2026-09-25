// HOME-1 (2026-09-24): Recent activity, "finished without you".
//
// Up to eight events from the last 24 hours that completed without the viewer: a signed
// copy returned, a form submitted, a thread resolved by a teammate, an assessment
// submitted, outreach delivered. The server (api/home-activity.js) gathers them inside
// the population boundary; this module decides what is shown. Events the viewer caused
// are left out where the source records an actor (a profile id, or the viewer's name for
// sources that store only a name). Pure.

export const ACTIVITY_WINDOW_MS = 24 * 3600000
export const ACTIVITY_LIMIT = 8

const ICONS = { signed: 'check', form: 'form', resolved: 'msg', assessment: 'rel', outreach: 'out', shift: 'clock' }
const TONES = { signed: 'green', form: 'navy', resolved: 'green', assessment: 'navy', outreach: 'muted', shift: 'navy' }

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/**
 * @param events [{ id, kind, at, actor, actorProfileId, actorName, sentence: { pre, actor, post }, detail }]
 * @param viewer { id, name }
 */
export function activityRows(events = [], viewer = {}, now = Date.now()) {
  const me = String(viewer?.id || '')
  const myName = String(viewer?.name || '').trim().toLowerCase()
  return (events || [])
    .filter(e => e && e.at && now - new Date(e.at).getTime() <= ACTIVITY_WINDOW_MS)
    .filter(e => !(me && e.actorProfileId && String(e.actorProfileId) === me))
    .filter(e => !(myName && e.actorName && String(e.actorName).trim().toLowerCase() === myName))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, ACTIVITY_LIMIT)
    .map(e => ({
      id: e.id, kind: e.kind, icon: ICONS[e.kind] || 'check', tone: TONES[e.kind] || 'navy',
      pre: e.sentence?.pre || '', actor: e.sentence?.actor || e.actorName || '', post: e.sentence?.post || '',
      detail: e.detail || '', time: fmtTime(e.at), at: e.at, to: e.to || null,
    }))
}
