/** Keep the visible table's title and header below the filters during page scrolling.
 * Tables retain their full height and their original horizontal scrolling.
 */
export function attachClientPeriodStickyHeader(page, filters) {
  if (!page || !filters) return () => {}
  const view = page.ownerDocument.defaultView
  const overlay = page.ownerDocument.createElement('div')
  overlay.className = 'ev91-client-trend-sticky-header'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.hidden = true
  page.ownerDocument.body.appendChild(overlay)
  let activeTable = null
  let dirty = true
  let frame = null

  const update = () => {
    frame = null
    if (!page.isConnected) return
    const filterBottom = filters.getBoundingClientRect().bottom
    const table = [...page.querySelectorAll('.data-table')].find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      const title = candidate.closest('section')?.querySelector('.table-header')
      const heading = title || candidate.tHead
      return candidate.tHead && heading.getBoundingClientRect().top < filterBottom && rect.bottom > filterBottom
    })
    if (!table) {
      overlay.hidden = true
      activeTable = null
      return
    }
    const section = table.closest('section')
    const sectionRect = section.getBoundingClientRect()
    const tableRect = table.getBoundingClientRect()
    const headerHeight = table.tHead.getBoundingClientRect().height
    const title = section.querySelector('.table-header')
    const titleHeight = title?.getBoundingClientRect().height || 0
    const sectionStyle = view.getComputedStyle(section)
    if (dirty || activeTable !== table) {
      const copy = page.ownerDocument.createElement('table')
      copy.className = 'data-table'
      copy.style.width = `${tableRect.width}px`
      const columns = page.ownerDocument.createElement('colgroup')
      for (const cell of table.tHead.rows[0].cells) {
        const column = page.ownerDocument.createElement('col')
        column.style.width = `${cell.getBoundingClientRect().width}px`
        columns.appendChild(column)
      }
      copy.appendChild(columns)
      copy.appendChild(table.tHead.cloneNode(true))
      const columnsViewport = page.ownerDocument.createElement('div')
      columnsViewport.className = 'ev91-client-trend-sticky-columns'
      columnsViewport.appendChild(copy)
      const titleCopy = title?.cloneNode(true)
      if (titleCopy) {
        titleCopy.style.marginLeft = sectionStyle.paddingLeft
        titleCopy.style.marginRight = sectionStyle.paddingRight
      }
      overlay.replaceChildren(...(titleCopy ? [titleCopy, columnsViewport] : [columnsViewport]))
      activeTable = table
      dirty = false
    }
    Object.assign(overlay.style, {
      top: `${Math.min(filterBottom, tableRect.bottom - titleHeight - headerHeight)}px`,
      left: `${sectionRect.left + section.clientLeft}px`,
      width: `${section.clientWidth}px`,
      height: `${titleHeight + headerHeight}px`,
    })
    const columnsViewport = overlay.querySelector('.ev91-client-trend-sticky-columns')
    Object.assign(columnsViewport.style, {
      paddingLeft: sectionStyle.paddingLeft,
      paddingRight: sectionStyle.paddingRight,
    })
    overlay.hidden = false
    columnsViewport.scrollLeft = section.scrollLeft
  }
  const schedule = () => {
    if (frame == null) frame = view.requestAnimationFrame(update)
  }
  const invalidate = () => { dirty = true; schedule() }
  const resize = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(invalidate) : null
  resize?.observe(filters)
  for (const section of page.querySelectorAll('section')) resize?.observe(section)
  const mutations = new view.MutationObserver(invalidate)
  mutations.observe(page, { childList: true, subtree: true, characterData: true })
  view.addEventListener('scroll', schedule, true)
  view.addEventListener('resize', invalidate)
  update()
  return () => {
    view.removeEventListener('scroll', schedule, true)
    view.removeEventListener('resize', invalidate)
    resize?.disconnect()
    mutations.disconnect()
    if (frame != null) view.cancelAnimationFrame(frame)
    overlay.remove()
  }
}
