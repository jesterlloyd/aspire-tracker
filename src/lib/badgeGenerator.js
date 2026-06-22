// src/lib/badgeGenerator.js
// Client-side badge generation using the native Canvas API.
// Produces two 750 x 1050 PNG files (2.5 inches x 3.5 inches at 300 DPI).
//
// TEMPLATE ASSETS
// Drop two PNG files into the repo before generating badges:
//   public/badge-templates/front.png
//   public/badge-templates/back.png
//
// OVERLAY COORDINATES
// All coordinates below are for a 750 x 1050 canvas.
// Adjust as needed after the first print test -- they are intentionally
// exposed as named constants so a single value change propagates everywhere.

import { fullSchool } from './displayFormatters'
import { getStudentPreferredFullName } from './studentNameFormatters'

// Output dimensions: 2.5" x 3.5" at 300 DPI
const CANVAS_W = 750
const CANVAS_H = 1050

// Template paths (relative to the public/ directory)
const TEMPLATE_FRONT = '/badge-templates/front.png'
const TEMPLATE_BACK  = '/badge-templates/back.png'

// Date value that signals "not yet set by admin"
const SENTINEL = '1900-01-01'

// Overlay coordinates -- adjust after each print test
// Math reference: 1 inch = 300px at 300 DPI on a 750x1050 canvas (2.5" x 3.5")
const FRONT = {
  // 1.03" x 1.31" frame at (0.73", 0.92") from top-left
  photo:  { x: 219, y: 276, w: 309, h: 393 },
  // ~13pt equivalent (54px), bold, centered on 750px canvas; maxWidth scales long names to fit.
  name:   { x: 375, y: 760, fontSize: 54, fontWeight: 700, color: '#545454', align: 'center', maxWidth: 680 },
  // ~10.9pt equivalent (45px), centered below name; maxWidth scales long names to fit
  school: { x: 375, y: 820, fontSize: 45, fontWeight: 400, color: '#545454', align: 'center', maxWidth: 700 },
}
const BACK = {
  // Group anchor: top-left of issue date text at (1.36", 2.21") = (408px, 663px).
  // valid-until stacked 55px below (one line height at 45px font).
  // textBaseline = 'top' so y aligns to the TOP of the text (matches Canva measurement).
  // ~10.9pt equivalent (45px), bold, CS red (#DC1E34).
  // maxWidth (234px = 0.78") prevents long date strings from overflowing.
  issueDate:  { x: 408, y: 663, fontSize: 45, fontWeight: 700, color: '#DC1E34', align: 'left', maxWidth: 234 },
  validUntil: { x: 408, y: 718, fontSize: 45, fontWeight: 700, color: '#DC1E34', align: 'left', maxWidth: 234 },
}

// ── One-time startup asset check ─────────────────────────────────────────────
// Runs once when the module is first imported. Logs a console warning for any
// missing template so the user knows what to upload.

let _checked = false
;(function checkTemplateAssets() {
  if (_checked || typeof window === 'undefined') return
  _checked = true
  ;[TEMPLATE_FRONT, TEMPLATE_BACK].forEach(path => {
    fetch(path, { method: 'HEAD', cache: 'no-store' })
      .then(r => {
        if (!r.ok) {
          console.warn(
            `[ASPIRE Badge] Template not found at ${path}.\n` +
            `Upload the approved PNG file there to enable badge downloads.`
          )
        }
      })
      .catch(() => {
        console.warn(`[ASPIRE Badge] Could not verify template at ${path}.`)
      })
  })
})()


// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Calculates the two badge dates from a cohort_school_rotations row.
 *
 * issueDate:  rotation_start_date minus 7 calendar days
 * validUntil: last calendar day of the month containing rotation_end_date
 *
 * Returns null when rotation is missing, either date is null/undefined/sentinel,
 * or the parsed dates are invalid.
 *
 * @param {Object|null} rotation - cohort_school_rotations row
 * @returns {{ issueDate: Date, validUntil: Date } | null}
 */
export function calculateBadgeDates(rotation) {
  if (!rotation) return null
  const { rotation_start_date: start, rotation_end_date: end } = rotation
  if (!start || !end || start === SENTINEL || end === SENTINEL) return null

  // Parse at noon UTC so date-boundary timezone issues cannot shift the day
  const startUTC = new Date(start + 'T12:00:00Z')
  const endUTC   = new Date(end   + 'T12:00:00Z')
  if (isNaN(startUTC.getTime()) || isNaN(endUTC.getTime())) return null

  const issueDate = new Date(startUTC)
  issueDate.setUTCDate(issueDate.getUTCDate() - 7)

  // Last day of the month containing end: day 0 of the following month
  const validUntil = new Date(
    Date.UTC(endUTC.getUTCFullYear(), endUTC.getUTCMonth() + 1, 0)
  )

  return { issueDate, validUntil }
}

/**
 * Formats a Date as "MMMM D, YYYY" (example: "May 28, 2026").
 * Always uses America/Los_Angeles as the display timezone.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatBadgeDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  })
}


// ── Canvas helpers ────────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error(`Image failed to load: ${src}`))
    img.src = src
  })
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

/**
 * Draws an image scaled to fill the canvas while preserving aspect ratio.
 * Areas outside the image's natural ratio are filled with white (letterbox).
 */
function drawTemplateScaled(ctx, img, w, h) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  const imgAspect    = img.naturalWidth / img.naturalHeight
  const canvasAspect = w / h

  let dx, dy, dw, dh
  if (Math.abs(imgAspect - canvasAspect) < 0.005) {
    dx = 0; dy = 0; dw = w; dh = h
  } else if (imgAspect > canvasAspect) {
    // Image wider: pillarbox
    dh = h; dw = dh * imgAspect
    dx = (w - dw) / 2; dy = 0
  } else {
    // Image taller: letterbox
    dw = w; dh = dw / imgAspect
    dx = 0; dy = (h - dh) / 2
  }
  ctx.drawImage(img, dx, dy, dw, dh)
}

/**
 * Draws a headshot into a rectangular frame using cover-fit:
 * fills the frame completely, centering and cropping any overflow.
 */
function drawHeadshotCover(ctx, img, frame) {
  const { x, y, w, h } = frame
  const imgAspect   = img.naturalWidth / img.naturalHeight
  const frameAspect = w / h

  let sx, sy, sw, sh
  if (imgAspect > frameAspect) {
    // Photo wider: fill by height, crop sides
    sh = img.naturalHeight
    sw = sh * frameAspect
    sx = (img.naturalWidth - sw) / 2
    sy = 0
  } else {
    // Photo taller: fill by width, crop top/bottom
    sw = img.naturalWidth
    sh = sw / frameAspect
    sx = 0
    sy = (img.naturalHeight - sh) / 2
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
  ctx.restore()
}

function ctxFont(weight, size) {
  return `${weight} ${size}px 'DM Sans', system-ui, sans-serif`
}


// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates front and back badge PNGs as Blob objects.
 *
 * @param {{ student: Object, rotation: Object|null, headshotUrl: string }} params
 * @returns {Promise<{ frontBlob: Blob, backBlob: Blob }>}
 * @throws {Error} with a user-readable message if any asset fails to load
 */
export async function generateBadgePNGs({ student, rotation, headshotUrl }) {
  if (!headshotUrl) {
    throw new Error('A headshot photo is required to generate a badge.')
  }
  const dates = calculateBadgeDates(rotation)
  if (!dates) {
    throw new Error('Valid rotation dates are required to generate a badge.')
  }

  // Ensure DM Sans (and all other app fonts) are ready in the canvas context
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready
  }

  // Load all assets concurrently
  const [frontTemplate, backTemplate, headshot] = await Promise.all([
    loadImage(TEMPLATE_FRONT).catch(() => {
      throw new Error(
        'Front badge template not found. Upload public/badge-templates/front.png and try again.'
      )
    }),
    loadImage(TEMPLATE_BACK).catch(() => {
      throw new Error(
        'Back badge template not found. Upload public/badge-templates/back.png and try again.'
      )
    }),
    loadImage(headshotUrl).catch(() => {
      throw new Error(
        'Student headshot could not be loaded. The file may have been removed. Try re-uploading.'
      )
    }),
  ])

  // ── Front page ───────────────────────────────────────────────────────────

  const frontCanvas    = document.createElement('canvas')
  frontCanvas.width    = CANVAS_W
  frontCanvas.height   = CANVAS_H
  const fCtx = frontCanvas.getContext('2d')

  // 1. Template background
  drawTemplateScaled(fCtx, frontTemplate, CANVAS_W, CANVAS_H)

  // 2. Headshot in photo frame
  drawHeadshotCover(fCtx, headshot, FRONT.photo)

  // 3. Full name
  const nc = FRONT.name
  fCtx.font         = ctxFont(nc.fontWeight, nc.fontSize)
  fCtx.fillStyle    = nc.color
  fCtx.textAlign    = nc.align
  fCtx.textBaseline = 'alphabetic'
  // STUDENT-PREFERRED-FIRST-NAME-1B: badge uses the preferred full name (Brian Shin) when set;
  // maxWidth keeps long names from overflowing the card.
  const fullName    = getStudentPreferredFullName(student)
  fCtx.fillText(fullName, nc.x, nc.y, nc.maxWidth)

  // 4. School abbreviation
  const sc = FRONT.school
  fCtx.font      = ctxFont(sc.fontWeight, sc.fontSize)
  fCtx.fillStyle = sc.color
  fCtx.textAlign = sc.align
  const schoolLabel = fullSchool(student.school) || (student.school || '')
  fCtx.fillText(schoolLabel, sc.x, sc.y, sc.maxWidth)

  // ── Back page ────────────────────────────────────────────────────────────

  const backCanvas   = document.createElement('canvas')
  backCanvas.width   = CANVAS_W
  backCanvas.height  = CANVAS_H
  const bCtx = backCanvas.getContext('2d')

  // 1. Template background
  drawTemplateScaled(bCtx, backTemplate, CANVAS_W, CANVAS_H)

  // 2. Issue date + 3. Valid-until date
  // textBaseline = 'top': y coordinate corresponds to the TOP of the text so it
  // matches Canva pixel measurements taken from the top of the rendered characters.
  // Restored to 'alphabetic' after so any future text added below is unaffected.
  bCtx.textBaseline = 'top'

  const ic = BACK.issueDate
  bCtx.font      = ctxFont(ic.fontWeight, ic.fontSize)
  bCtx.fillStyle = ic.color
  bCtx.textAlign = ic.align
  bCtx.fillText(formatBadgeDate(dates.issueDate), ic.x, ic.y, ic.maxWidth)

  const vc = BACK.validUntil
  bCtx.font      = ctxFont(vc.fontWeight, vc.fontSize)
  bCtx.fillStyle = vc.color
  bCtx.textAlign = vc.align
  bCtx.fillText(formatBadgeDate(dates.validUntil), vc.x, vc.y, vc.maxWidth)

  bCtx.textBaseline = 'alphabetic' // restore default

  // ── Export as PNG Blobs ──────────────────────────────────────────────────

  const [frontBlob, backBlob] = await Promise.all([
    canvasToBlob(frontCanvas),
    canvasToBlob(backCanvas),
  ])

  return { frontBlob, backBlob }
}
