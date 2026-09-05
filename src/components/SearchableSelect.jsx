import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { Search, ChevronDown } from 'lucide-react'

const buttonStyle = {
  padding: '0.45rem 0.65rem',
  color: '#fff',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
}

/**
 * Dark-theme searchable dropdown with light option text (avoids native <select> black-on-dark).
 */
export const SearchableSelect = memo(function SearchableSelect({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  minWidth = 180,
  searchPlaceholder = 'Search…',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [menuStyle, setMenuStyle] = useState(null)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const updateMenuPosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const menuWidth = Math.max(rect.width, minWidth)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const preferBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove
    const maxHeight = Math.min(320, preferBelow ? spaceBelow - 4 : spaceAbove - 4)
    const top = preferBelow ? rect.bottom + 4 : Math.max(8, rect.top - maxHeight - 4)
    let left = rect.left
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8)
    }
    setMenuStyle({
      position: 'fixed',
      top,
      left,
      width: menuWidth,
      maxHeight: Math.max(160, maxHeight),
      zIndex: 10050,
    })
  }, [minWidth])

  useEffect(() => {
    if (!isOpen) return undefined
    updateMenuPosition()
    const onScrollOrResize = () => updateMenuPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [isOpen, updateMenuPosition])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleClickOutside = (event) => {
      if (containerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      setIsOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) => opt.toString().toLowerCase().includes(q))
  }, [options, search])

  const pick = (opt) => {
    onChange(opt)
    setIsOpen(false)
    setSearch('')
  }

  const menu =
    isOpen && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              ...menuStyle,
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px',
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
              padding: '0.5rem',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'rgba(255,255,255,0.05)',
                padding: '0.4rem 0.6rem',
                borderRadius: '6px',
                marginBottom: '0.5rem',
                flexShrink: 0,
              }}
            >
              <Search size={12} color="#94a3b8" />
              <input
                autoFocus
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: '0.75rem',
                  outline: 'none',
                  width: '100%',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {filteredOptions.map((opt) => {
                const selected = value === opt
                return (
                  <div
                    key={opt}
                    role="option"
                    aria-selected={selected}
                    style={{
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.75rem',
                      color: selected ? '#fff' : '#e2e8f0',
                      background: selected ? 'rgba(59,130,246,0.35)' : 'transparent',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: selected ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => pick(opt)}
                    onMouseEnter={(e) => {
                      if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {opt}
                  </div>
                )
              })}
              {!filteredOptions.length && (
                <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                  No matches
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        fontSize: '0.78rem',
        color: 'var(--text-dim)',
        minWidth,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        {Icon ? <Icon size={13} /> : null} {label}
      </span>
      <div ref={containerRef} style={{ position: 'relative', minWidth }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          style={{
            ...buttonStyle,
            minWidth,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#fff',
            }}
          >
            {value || 'All'}
          </span>
          <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
        </button>
        {menu}
      </div>
    </label>
  )
})

export default SearchableSelect
