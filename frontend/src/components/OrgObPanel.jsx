import { useState, useEffect, useRef } from 'react'
import Sortable from 'sortablejs'
import AddOrgObForm from './AddOrgObForm'

export default function OrgObPanel({ panel, isActive, onSelect, onAdd, onEdit, onDelete, onReorder }) {
  const [showForm, setShowForm] = useState(false)
  const listRef = useRef(null)
  const sortableRef = useRef(null)

  useEffect(() => {
    if (!listRef.current || sortableRef.current) return
    sortableRef.current = Sortable.create(listRef.current, {
      animation: 150,
      delay: 300,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd(evt) {
        if (evt.oldIndex === evt.newIndex) return
        const ids = [...listRef.current.querySelectorAll('[data-id]')]
          .map(el => Number(el.dataset.id))
          .filter(id => !isNaN(id) && id > 0)
        onReorder(ids)
      },
    })
    return () => {
      sortableRef.current?.destroy()
      sortableRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleAdd(data) {
    setShowForm(false)
    onAdd({ ...data, parentOrgOb: panel.parentOrgOb })
  }

  return (
    <div className={`rounded-xl border transition-colors ${
      isActive ? 'border-indigo-500/60 bg-neutral-800' : 'border-neutral-700 bg-neutral-900'
    }`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700/50">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {panel.parentOrgOb ? panel.parentOrgOb.name : 'Top Level'}
        </h3>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1">
            <span className="text-base leading-none">+</span> Add
          </button>
        )}
      </div>

      <div className="px-3 py-2 flex flex-col gap-1">
        {panel.nodes.length === 0 && !showForm && (
          <div className="text-neutral-500 text-sm py-2 text-center">
            Empty — add the first item above
          </div>
        )}

        <div ref={listRef}>
          {panel.nodes.map(node => (
            <div key={node.id} data-id={node.id}
              className={`flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition group mb-1 border ${
                panel.selectedNode?.id === node.id
                  ? 'bg-indigo-500/20 border-indigo-500/50'
                  : 'hover:bg-neutral-700 border-transparent'
              }`}
              onClick={() => onSelect(node)}>
              <span className="drag-handle text-neutral-600 hover:text-neutral-400 mr-2 cursor-grab active:cursor-grabbing select-none shrink-0 touch-none"
                title="Hold to reorder">⠿</span>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-medium text-sm text-white truncate">{node.name}</span>
                {node.children_count > 0 && (
                  <span className="text-xs text-neutral-500 shrink-0">{node.children_count}</span>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button onClick={e => { e.stopPropagation(); onEdit(node) }}
                  className="text-neutral-400 hover:text-white text-xs px-1" title="Edit">✎</button>
                <button onClick={e => { e.stopPropagation(); onDelete(node) }}
                  className="text-red-500 hover:text-red-400 text-xs px-1" title="Delete">✕</button>
              </div>
              {panel.selectedNode?.id === node.id && (
                <span className="text-indigo-400 text-xs ml-1 shrink-0">▶</span>
              )}
            </div>
          ))}
        </div>

        {showForm && <AddOrgObForm onSubmit={handleAdd} onCancel={() => setShowForm(false)} />}
      </div>
    </div>
  )
}
