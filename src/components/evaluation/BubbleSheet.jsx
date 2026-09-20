// src/components/evaluation/BubbleSheet.jsx
//
// RESPONSES-PACKET-1: the content of a roster row's expansion panel. One person's answer
// pattern item by item: the stem (or its number, when the text is licensed), one bubble
// per scale point, and the shift at the right. Before is a hollow navy ring, after is
// filled navy, unchanged is filled with a ring offset by a paper gap, so the two states
// read as one mark. A single-timepoint instrument has only an answer, drawn filled.
//
// The data comes from buildBubbleSheet in responsesPacketModel.js; this file only draws.

const bubbleClass = (v, pre, post) => {
  if (pre === v && post === v) return 'rp-bub rp-bub-both'
  if (pre === v) return 'rp-bub rp-bub-pre'
  if (post === v) return 'rp-bub rp-bub-post'
  return 'rp-bub'
}

function Legend({ paired }) {
  return (
    <span className="rp-bs-legend" aria-label="Legend">
      {paired ? (
        <>
          <span><span className="rp-bub rp-bub-pre" aria-hidden="true" />before</span>
          <span><span className="rp-bub rp-bub-post" aria-hidden="true" />after</span>
          <span><span className="rp-bub rp-bub-both" aria-hidden="true" style={{ marginLeft: 3 }} />unchanged</span>
        </>
      ) : (
        <span><span className="rp-bub rp-bub-post" aria-hidden="true" />answer</span>
      )}
    </span>
  )
}

function ItemRow({ item, scaleMax, paired }) {
  const points = Array.from({ length: scaleMax }, (_, i) => i + 1)
  const spoken = item.na
    ? 'not applicable'
    : paired
      ? `before ${item.pre ?? 'no answer'}, after ${item.post ?? 'no answer'}`
      : `answer ${item.post ?? item.pre ?? 'none'}`
  const shiftClass = item.shift == null ? 'same' : item.shift > 0 ? 'up' : item.shift < 0 ? 'down' : 'same'
  const shiftText = item.na ? 'n/a' : item.shift == null ? '' : `${item.shift > 0 ? '+' : ''}${item.shift}`
  return (
    <div className="rp-item">
      <span className="rp-q">{item.label}</span>
      <span className="rp-bubs" role="img" aria-label={spoken}>
        {points.map(v => (
          <span key={v} className={bubbleClass(v, item.pre, item.post)}><span aria-hidden="true">{v}</span></span>
        ))}
      </span>
      <span className={`rp-shift rp-shift-${shiftClass}`} aria-hidden={shiftText === '' ? 'true' : undefined}>{shiftText}</span>
    </div>
  )
}

export default function BubbleSheet({ sheet, name, onViewResponse }) {
  return (
    <div className="rp-bs">
      <div className="rp-bs-head">
        <b>{name}</b>
        <span>{sheet.subtitle}</span>
        {!sheet.empty && <Legend paired={sheet.paired} />}
      </div>
      {sheet.empty && <p className="rp-bs-note">{sheet.message}</p>}
      {sheet.note && <p className="rp-bs-note">{sheet.note}</p>}
      {sheet.groups.map(g => (
        <div key={g.key} className="rp-bs-grp">
          <span className="rp-t">{g.label}</span>
          {g.items.map(item => (
            <ItemRow key={item.code} item={item} scaleMax={sheet.scaleMax} paired={sheet.paired} />
          ))}
        </div>
      ))}
      {onViewResponse && (
        <div className="rp-bs-acts">
          <button type="button" className="ds-btn" onClick={onViewResponse}>View response</button>
        </div>
      )}
    </div>
  )
}
