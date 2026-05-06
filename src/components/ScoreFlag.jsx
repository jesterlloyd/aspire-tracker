import { useState } from 'react'

export default function ScoreFlag({ message }) {
  const [show, setShow] = useState(false)
  if (!message) return null
  return (
    <span
      style={{ position:'relative', display:'inline-block', marginLeft:5, cursor:'pointer', verticalAlign:'middle' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={e => { e.stopPropagation(); setShow(p => !p) }}>
      ⚠️
      {show && (
        <span style={{
          position:'absolute', bottom:'calc(100% + 6px)', left:'50%', transform:'translateX(-50%)',
          background:'var(--pearl)', border:'1px solid #d1d5db', borderRadius:8,
          padding:'12px', fontSize:13, fontWeight:400, color:'var(--nightfall)',
          maxWidth:280, width:'max-content', whiteSpace:'normal',
          zIndex:200, boxShadow:'0 4px 12px rgba(0,0,0,0.12)',
          lineHeight:1.5, display:'block', pointerEvents:'none',
        }}>
          {message}
        </span>
      )}
    </span>
  )
}
