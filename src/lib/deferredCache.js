/** Write large payloads to IndexedDB without blocking the main thread. */
export function scheduleCacheWrite(writeFn) {
  const run = () => {
    try {
      writeFn()
    } catch (e) {
      console.error('Cache write error', e)
    }
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 8000 })
  } else {
    setTimeout(run, 50)
  }
}
