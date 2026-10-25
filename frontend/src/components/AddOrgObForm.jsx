import { useState, useEffect, useRef } from 'react'
import { INPUT } from '../styles/constants'

export default function AddOrgObForm({ onSubmit, onCancel }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function submit() {
    if (!name.trim()) return
    onSubmit({ name: name.trim(), description: description.trim() || null })
    setName('')
    setDescription('')
  }

  function handleKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
        type="text" placeholder="Name" maxLength={200}
        className={INPUT} onKeyDown={handleKey} />
      <input value={description} onChange={e => setDescription(e.target.value)}
        type="text" placeholder="Description (optional)"
        className={INPUT} onKeyDown={handleKey} />
      <div className="flex gap-2">
        <button onClick={submit} disabled={!name.trim()}
          className="flex-1 py-1 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs disabled:opacity-40">
          Add
        </button>
        <button onClick={onCancel}
          className="py-1 px-3 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-xs">
          Cancel
        </button>
      </div>
    </div>
  )
}
