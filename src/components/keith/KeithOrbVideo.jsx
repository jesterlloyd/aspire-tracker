// src/components/keith/KeithOrbVideo.jsx
//
// KEITH-FOUNDATION-1 (2026-09-28): the animated Keith orb, for the chat launcher and the chat header.
// Reference: the launcher in docs/mockups/keith-workflow.html. It must not loop all day:
//
//   replay    each time this number changes, the animation plays ONCE, then rests on its first frame
//             (the poster). Keith.jsx bumps it on the first load of a session and on hover or focus.
//   working   while true it loops (from a sent message until the reply has finished).
//   otherwise it rests on the poster.
//
// It pauses in a hidden tab, and under prefers-reduced-motion it never plays: the poster image is all
// that renders and the video is never fetched. Nor is it fetched until the orb is on screen.
// Files (public/brand/): keith-orb-anim.webm (VP9) first, keith-orb-anim.mp4 (H.264, for Safari)
// second, keith-orb-poster.png, all 256px. The 2 MB source video is not shipped.

import { useEffect, useRef, useState } from 'react'

const ORB_ANIM = Object.freeze({
  webm: '/brand/keith-orb-anim.webm',
  mp4: '/brand/keith-orb-anim.mp4',
  poster: '/brand/keith-orb-poster.png',
})

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function KeithOrbVideo({ size, working = false, replay = 0, className = '' }) {
  const wrap = useRef(null)
  const video = useRef(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [still, setStill] = useState(reducedMotion)

  // Reduced motion can change while the app is open.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setStill(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  // Load only once the orb is on screen.
  useEffect(() => {
    const el = wrap.current
    if (!el || visible) return undefined
    const io = new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() } })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  const workingRef = useRef(working)
  useEffect(() => { workingRef.current = working }, [working])

  // Loop while working; stop at the poster frame when the work ends.
  useEffect(() => {
    const v = video.current
    if (!v || still) return
    if (working) { v.loop = true; v.play().catch(() => {}) } else if (v.loop) { v.loop = false; v.pause(); v.currentTime = 0 }
  }, [working, still, visible])

  // Play once whenever `replay` changes (and not while working, which already moves).
  useEffect(() => {
    const v = video.current
    if (!v || still || !replay || workingRef.current) return
    v.loop = false
    v.currentTime = 0
    v.play().catch(() => {})
  }, [replay, still, visible])

  // Pause in a hidden tab; pick up the loop again on return if Keith is still working.
  useEffect(() => {
    const onVis = () => {
      const v = video.current
      if (!v) return
      if (document.hidden) v.pause()
      else if (workingRef.current && !still) v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [still])

  const box = { width: size, height: size }
  return (
    <span ref={wrap} className={`keith-orb-video ${className}`} style={box} aria-hidden="true">
      {still || !visible
        ? <img src={ORB_ANIM.poster} alt="" draggable="false" />
        : (
          <video
            ref={video}
            muted
            playsInline
            preload="metadata"
            poster={ORB_ANIM.poster}
            aria-hidden="true"
            disablePictureInPicture
            onEnded={(e) => { const v = e.currentTarget; if (!v.loop) { v.pause(); v.currentTime = 0 } }}
          >
            <source src={ORB_ANIM.webm} type="video/webm" />
            <source src={ORB_ANIM.mp4} type="video/mp4" />
          </video>
        )}
    </span>
  )
}
