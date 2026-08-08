import { toBlob } from 'html-to-image'

/**
 * Capture a DOM node (e.g. Full Data table) as a PNG Blob.
 * Uses full scroll size so wide month tables are not clipped.
 */
export async function captureElementPngBlob(node, { backgroundColor = '#0f172a', pixelRatio = 2 } = {}) {
  if (!node) throw new Error('Nothing to capture')

  const width = Math.max(node.scrollWidth, node.offsetWidth, 1)
  const height = Math.max(node.scrollHeight, node.offsetHeight, 1)

  const blob = await toBlob(node, {
    cacheBust: true,
    pixelRatio: Math.min(pixelRatio, 2),
    backgroundColor,
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: 'none',
      overflow: 'visible',
    },
    filter: (el) => {
      if (!el || !el.tagName) return true
      const tag = el.tagName.toLowerCase()
      return tag !== 'script' && tag !== 'style'
    },
  })

  if (!blob) throw new Error('Screenshot failed — try again')
  return blob
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

  // Prefer canShare when available; some browsers still share even if canShare is missing.
  if (typeof navigator.canShare === 'function') {
    try {
      if (!navigator.canShare(payload) && !navigator.canShare({ files: [file] })) {
        return false
      }
    } catch {
      // continue and try share anyway
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
    // Some browsers require the ClipboardItem value to be a Promise of Blob
    const item = new ClipboardItem({
      [blob.type || 'image/png']: blob,
    })
    await navigator.clipboard.write([item])
    return true
  } catch {
    try {
      const item = new ClipboardItem({
        'image/png': Promise.resolve(blob),
      })
      await navigator.clipboard.write([item])
      return true
    } catch {
      return false
    }
  }
}

function openWhatsApp(caption, { pasteHint = false } = {}) {
  const text = pasteHint
    ? `${caption}\n\n📷 Screenshot is copied — paste it in this chat (Ctrl+V / long-press → Paste).`
    : caption
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Share Full Data screenshot to WhatsApp directly (no PNG download).
 * 1) Native share sheet (pick WhatsApp) when the browser supports file share
 * 2) Else copy image to clipboard + open WhatsApp so user pastes
 */
export async function shareFullDataScreenshot({
  node,
  filename = 'Full_Data.png',
  caption = 'FleetPro Full Data report',
} = {}) {
  const blob = await captureElementPngBlob(node)
  const file = new File([blob], filename, { type: 'image/png' })

  // 1) Direct system share → user chooses WhatsApp (works often on mobile / some desktop)
  const shared = await tryNativeShareFile(file, caption)
  if (shared) return { mode: 'share' }

  // 2) Copy screenshot + open WhatsApp (no download) — paste into chat
  const copied = await copyImageToClipboard(blob)
  if (copied) {
    openWhatsApp(caption, { pasteHint: true })
    return { mode: 'clipboard' }
  }

  // Last resort: still open WhatsApp with caption (image couldn't be handed off)
  openWhatsApp(
    `${caption}\n\n(Could not attach screenshot automatically — use Share again on mobile, or press Print Screen.)`,
    { pasteHint: false }
  )
  return { mode: 'whatsapp-text' }
}
