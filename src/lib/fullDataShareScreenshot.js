import { toBlob, toCanvas, toPng } from 'html-to-image'

const MAX_CANVAS_EDGE = 8192

function measureNode(node) {
  const width = Math.max(node.scrollWidth, node.offsetWidth, node.clientWidth, 1)
  const height = Math.max(node.scrollHeight, node.offsetHeight, node.clientHeight, 1)
  let pixelRatio = 2
  if (width * pixelRatio > MAX_CANVAS_EDGE || height * pixelRatio > MAX_CANVAS_EDGE) {
    pixelRatio = Math.max(0.75, Math.min(MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height))
  }
  return { width, height, pixelRatio }
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
 */
export async function captureElementPngBlob(node, { backgroundColor = '#0f172a' } = {}) {
  if (!node) throw new Error('Nothing to capture')

  const size = measureNode(node)
  const opts = captureOptions(node, { ...size, backgroundColor })

  // Prefer toBlob; fall back to canvas / data-URL if html-to-image fails on large nodes
  try {
    const blob = await toBlob(node, opts)
    if (blob && blob.size > 0) return blob
  } catch {
    // continue
  }

  try {
    const canvas = await toCanvas(node, { ...opts, pixelRatio: Math.min(opts.pixelRatio, 1.25) })
    const blob = await canvasToPngBlob(canvas)
    if (blob && blob.size > 0) return blob
  } catch {
    // continue
  }

  try {
    const dataUrl = await toPng(node, { ...opts, pixelRatio: 1 })
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    if (blob && blob.size > 0) return blob
  } catch (err) {
    throw new Error(err?.message || 'Screenshot failed — table may be too large')
  }

  throw new Error('Screenshot failed — try again')
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
} = {}) {
  let blob
  try {
    blob = await captureElementPngBlob(node)
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
