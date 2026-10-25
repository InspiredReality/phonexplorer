import { useState, useMemo } from 'react'
import { useTagsStore } from '../store/tags'
import { INPUT } from '../styles/constants'

// Controlled tag selector: `value` is an array of tag objects, `onChange` gets the new array.
export default function TagPicker({ value, onChange }) {
  const tagsStore = useTagsStore()
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const selectedIds = new Set(value.map(t => t.id))
    return tagsStore.tags.filter(t => !selectedIds.has(t.id) && (!q || t.name.toLowerCase().includes(q)))
  }, [tagsStore.tags, value, search])

  const exactMatch = useMemo(
    () => tagsStore.tags.some(t => t.name.toLowerCase() === search.trim().toLowerCase()),
    [tagsStore.tags, search])

  function add(tag) {
    onChange([...value, tag])
    setSearch(''); setShowDropdown(false)
  }

  async function createAndAdd() {
    const name = search.trim(); if (!name) return
    try { add(await tagsStore.createTag(name)) } catch { /* ignore */ }
  }

  return (
    <div>
      <label className="text-xs text-neutral-400 mb-2 block">Tags</label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {value.map(tag => (
            <button key={tag.id} type="button"
              className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
              style={{ backgroundColor: tag.color + '33', color: tag.color }}
              onClick={() => onChange(value.filter(t => t.id !== tag.id))}>
              {tag.name} <span className="opacity-70">✕</span>
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search or create tag…"
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (filtered.length) add(filtered[0])
            else if (search.trim() && !exactMatch) createAndAdd()
          }}
          className={INPUT} />
        {showDropdown && (filtered.length > 0 || search.trim()) && (
          <div className="absolute z-10 w-full mt-1 bg-neutral-900 border border-neutral-600 rounded-lg shadow-xl overflow-hidden">
            {filtered.map(tag => (
              <button key={tag.id} type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700 flex items-center gap-2"
                onMouseDown={e => { e.preventDefault(); add(tag) }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            ))}
            {search.trim() && !exactMatch && (
              <button type="button"
                className="w-full text-left px-3 py-2 text-sm text-indigo-400 hover:bg-neutral-700 flex items-center gap-2"
                onMouseDown={e => { e.preventDefault(); createAndAdd() }}>
                <span className="text-lg leading-none">+</span> Create "{search.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
