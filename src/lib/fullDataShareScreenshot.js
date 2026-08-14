import { toBlob, toCanvas, toPng } from 'html-to-image'

const MAX_CANVAS_EDGE = 8192
const CAPTURE_PAD_X = 28
const CAPTURE_PAD_Y = 16

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })
}

function measureNode(node) {
  const rect = node.getBoundingClientRect?.() || { width: 0, height: 0 }
  const width = Math.ceil(
    Math.max(node.scrollWidth, node.offsetWidth, node.clientWidth, rect.width || 0, 1)
  )
  const height = Math.ceil(
    Math.max(node.scrollHeight, node.offsetHeight, node.clientHeight, rect.height || 0, 1)
  )
  let pixelRatio = 2
  if (width * pixelRatio > MAX_CANVAS_EDGE || height * pixelRatio > MAX_CANVAS_EDGE) {
    pixelRatio = Math.max(0.75, Math.min(MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height))
  }
  return { width, height, pixelRatio }
}

function applyShareYesterdayPrep(clone, prep) {
  if (!prep) return
  if (prep.hideDateKey) {
    clone.querySelectorAll(`[data-date-key="${prep.hideDateKey}"]`).forEach((el) => el.remove())
  }
  if (prep.totalsByMetric) {
    clone.querySelectorAll('[data-metric-total]').forEach((el) => {
      const key = el.getAttribute('data-metric-total')
      if (key && Object.prototype.hasOwnProperty.call(prep.totalsByMetric, key)) {
        el.textContent = prep.totalsByMetric[key]
      }
    })
  }
  if (prep.headerText) {
    const header = clone.querySelector('[data-share-header]')
    if (header) header.textContent = prep.headerText
  }
  if (prep.colSpan) {
    clone.querySelectorAll('[data-share-colspan]').forEach((el) => {
      el.setAttribute('colspan', String(prep.colSpan))
    })
  }
}

function expandCloneForFullTable(root) {
  root.style.boxSizing = 'border-box'
  root.style.width = 'max-content'
  root.style.minWidth = 'max-content'
  root.style.maxWidth = 'none'
  root.style.height = 'auto'
  root.style.maxHeight = 'none'
  root.style.overflow = 'visible'
  root.style.transform = 'none'
  root.style.paddingRight = `${CAPTURE_PAD_X}px`
  root.style.paddingBottom = `${CAPTURE_PAD_Y}px`

  root.querySelectorAll('*').forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    const style = el.style
    if (style.position === 'sticky' || style.position === 'fixed') {
      style.position = 'static'
      style.left = 'auto'
      style.top = 'auto'
      style.zIndex = 'auto'
      style.boxShadow = 'none'
    }
    style.maxWidth = 'none'
    style.overflow = 'visible'
  })
}

function captureOptions(node, { width, height, pixelRatio, backgroundColor }) {
  return {
    cacheBust: true,
    pixelRatio,
    backgroundColor,
    width,
    height,
    skipFonts: true,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: 'none',
      overflow: 'visible',
      maxHeight: 'none',
      maxWidth: 'none',
    },
    filter: (el) => {
      if (!el || !el.tagName) return true
      const tag = el.tagName.toLowerCase()
      return tag !== 'script' && tag !== 'link'
    },
  }
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Screenshot canvas empty'))
      },
      'image/png',
      0.92
    )
  })
}

/**
 * Capture a DOM node as PNG Blob (robust for wide Full Data tables).
 * Clones off-screen at full table width so the last date column is not clipped.
 */
export async function captureElementPngBlob(node, { backgroundColor = '#0f172a', sharePrep = null } = {}) {
  if (!node) throw new Error('Nothing to capture')

  const host = document.createElement('div')
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'z-index:-1',
    'opacity:0',
    'pointer-events:none',
    'overflow:visible',
    `background:${backgroundColor}`,
  ].join(';')

  const clone = node.cloneNode(true)
  expandCloneForFullTable(clone)
  applyShareYesterdayPrep(clone, sharePrep)
  host.appendChild(clone)
  document.body.appendChild(host)

  try {
    await nextPaint()
    const size = measureNode(clone)
    size.width += CAPTURE_PAD_X
    size.height += CAPTURE_PAD_Y
    const opts = captureOptions(clone, { ...size, backgroundColor })

    // Prefer toBlob; fall back to canvas / data-URL if html-to-image fails on large nodes
    try {
      const blob = await toBlob(clone, opts)
      if (blob && blob.size > 0) return blob
    } catch {
      // continue
    }

    try {
      const canvas = await toCanvas(clone, { ...opts, pixelRatio: Math.min(opts.pixelRatio, 1.25) })
      const blob = await canvasToPngBlob(canvas)
      if (blob && blob.size > 0) return blob
    } catch {
      // continue
    }

    try {
      const dataUrl = await toPng(clone, { ...opts, pixelRatio: 1 })
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      if (blob && blob.size > 0) return blob
    } catch (err) {
      throw new Error(err?.message || 'Screenshot failed — table may be too large')
    }

    throw new Error('Screenshot failed — try again')
  } finally {
    host.remove()
  }
}

async function tryNativeShareFile(file, caption) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false
  }

  const payload = {
    files: [file],
    title: 'FleetPro Full Data',
    text: caption,
  }

  if (typeof navigator.canShare === 'function') {
    try {
      if (!navigator.canShare({ files: [file] }) && !navigator.canShare(payload)) {
        return false
      }
    } catch {
      // try share anyway
    }
  }

  try {
    await navigator.share(payload)
    return true
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('Share cancelled')
      e.name = 'AbortError'
      throw e
    }
    return false
  }
}

async function copyImageToClipboard(blob) {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
    return false
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob,
      }),
    ])
    return true
  } catch {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': Promise.resolve(blob),
        }),
      ])
      return true
    } catch {
      return false
    }
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function whatsAppUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

function navigateWhatsApp(waWin, text) {
  const url = whatsAppUrl(text)
  if (waWin && !waWin.closed) {
    try {
      waWin.location.href = url
      waWin.focus()
      return true
    } catch {
      // fall through
    }
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  return Boolean(opened)
}

/**
 * Share Full Data screenshot to WhatsApp.
 * Pass `waWin` from a sync window.open(about:blank) on click to avoid popup blockers.
 */
export async function shareFullDataScreenshot({
  node,
  filename = 'Full_Data.png',
  caption = 'FleetPro Full Data report',
  waWin = null,
  sharePrep = null,
} = {}) {
  let blob
  try {
    blob = await captureElementPngBlob(node, { sharePrep })
  } catch (err) {
    if (waWin && !waWin.closed) waWin.close()
    throw err
  }

  const file = new File([blob], filename, { type: 'image/png' })

  // 1) Native share sheet (pick WhatsApp) — best on mobile / supported desktop
  try {
    const shared = await tryNativeShareFile(file, caption)
    if (shared) {
      if (waWin && !waWin.closed) waWin.close()
      return { mode: 'share' }
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (waWin && !waWin.closed) waWin.close()
      throw err
    }
  }

  // 2) Copy image + open WhatsApp (paste in chat) — no download
  const copied = await copyImageToClipboard(blob)
  if (copied) {
    navigateWhatsApp(
      waWin,
      `${caption}\n\nScreenshot copied — open a chat and press Ctrl+V (or long-press → Paste) to send the image.`
    )
    return { mode: 'clipboard' }
  }

  // 3) Download PNG + open WhatsApp (reliable desktop fallback)
  downloadBlob(blob, filename)
  navigateWhatsApp(
    waWin,
    `${caption}\n\nScreenshot saved as ${filename}. Attach that image in this WhatsApp chat.`
  )
  return { mode: 'download' }
}
