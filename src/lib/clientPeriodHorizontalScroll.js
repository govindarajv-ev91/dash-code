/** One horizontal scrollbar moves every trend table; vertical scrolling stays on the page. */
export function attachClientPeriodHorizontalScroll(page) {
  if (!page) return () => {}
  const view = page.ownerDocument.defaultView
  const sections = [...page.querySelectorAll('section')].filter((section) => section.querySelector('.data-table'))
  const scrollbar = page.ownerDocument.createElement('div')
  scrollbar.className = 'ev91-client-trend-page-scrollbar'
  scrollbar.setAttribute('role', 'region')
  scrollbar.setAttribute('aria-label', 'Scroll all trend tables horizontally')
  scrollbar.tabIndex = 0
  scrollbar.hidden = true
  const track = page.ownerDocument.createElement('div')
  track.style.height = '1px'
  scrollbar.appendChild(track)
  page.ownerDocument.body.appendChild(scrollbar)
  const applied = new WeakMap()
  let left = 0
  let maxLeft = 0
  let frame = null

  const sync = (offset) => {
    left = Math.max(0, Math.min(offset, maxLeft))
    for (const section of sections) {
      const target = Math.min(left, Math.max(0, section.scrollWidth - section.clientWidth))
      applied.set(section, target)
      if (section.scrollLeft !== target) section.scrollLeft = target
    }
    if (!scrollbar.hidden) {
      applied.set(scrollbar, left)
      if (scrollbar.scrollLeft !== left) scrollbar.scrollLeft = left
    }
  }
  const update = () => {
    frame = null
    const rect = page.getBoundingClientRect()
    maxLeft = Math.max(0, ...sections.map((section) => section.scrollWidth - section.clientWidth))
    scrollbar.hidden = maxLeft <= 1 || !sections.some((section) => {
      const bounds = section.getBoundingClientRect()
      return bounds.top < view.innerHeight && bounds.bottom > 0
    })
    Object.assign(scrollbar.style, { left: `${rect.left}px`, width: `${rect.width}px` })
    track.style.width = `${rect.width + maxLeft}px`
    sync(left)
  }
  const schedule = () => {
    if (frame == null) frame = view.requestAnimationFrame(update)
  }
  const onScroll = (event) => {
    const target = event.target
    if (sections.includes(target) || (target === scrollbar && !scrollbar.hidden)) {
      // Ignore events from our own writes, including tables with a shorter range.
      if (target.scrollLeft !== applied.get(target)) sync(target.scrollLeft)
    }
    schedule()
  }
  const resize = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : null
  resize?.observe(page)
  for (const section of sections) resize?.observe(section)
  const mutations = new view.MutationObserver(schedule)
  mutations.observe(page, { childList: true, subtree: true, characterData: true })
  view.addEventListener('scroll', onScroll, true)
  view.addEventListener('resize', schedule)
  update()
  return () => {
    view.removeEventListener('scroll', onScroll, true)
    view.removeEventListener('resize', schedule)
    resize?.disconnect()
    mutations.disconnect()
    if (frame != null) view.cancelAnimationFrame(frame)
    scrollbar.remove()
  }
}
