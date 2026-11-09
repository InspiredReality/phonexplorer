import { useState } from 'react'
import { INPUT } from '../styles/constants'

// Controlled editor for user-defined fields. `value` is an array of { key, value };
// `onChange` gets the new array. A new field is typed into a draft row and only added
// once the "✓" is clicked (the "+" button turns into the "✓" while a draft is open).
export default function CustomFieldsEditor({ value, onChange }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ key: '', value: '' })

  const draftKey = draft.key.trim()
  const duplicate = value.some(f => f.key.trim().toLowerCase() === draftKey.toLowerCase())
  const canSubmit = draftKey && draft.value.trim() && !duplicate

  function toggle() {
    if (!adding) { setAdding(true); return }
    if (!canSubmit) return
    onChange([...value, { key: draftKey, value: draft.value.trim() }])
    setDraft({ key: '', value: '' })
    setAdding(false)
  }

  function update(i, patch) {
    onChange(value.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  }

  return (
    <div className="flex flex-col gap-2">
      {value.map((f, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={f.key} onChange={e => update(i, { key: e.target.value })}
            placeholder="Field name" maxLength={100} className={INPUT + ' flex-1 min-w-0'} />
          <input value={f.value} onChange={e => update(i, { value: e.target.value })}
            placeholder="Value" className={INPUT + ' flex-1 min-w-0'} />
          <button type="button" title="Remove field"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="text-red-500 hover:text-red-400 px-2 py-2 shrink-0">✕</button>
        </div>
      ))}

      {adding && (
        <div className="flex gap-2">
          <input autoFocus value={draft.key} onChange={e => setDraft(d => ({ ...d, key: e.target.value }))}
            placeholder="Field name" maxLength={100} className={INPUT + ' flex-1 min-w-0'} />
          <input value={draft.value} onChange={e => setDraft(d => ({ ...d, value: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); toggle() } }}
            placeholder="Value" className={INPUT + ' flex-1 min-w-0'} />
        </div>
      )}
      {adding && duplicate && draftKey && (
        <p className="text-xs text-red-400">A field named "{draftKey}" already exists.</p>
      )}

      <button type="button" onClick={toggle} disabled={adding && !canSubmit}
        title={adding ? 'Add field' : 'Add custom field'}
        className={`w-full py-2 rounded-lg text-lg leading-none transition disabled:opacity-40 ${
          adding ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'
        }`}>
        {adding ? '✓' : '+'}
      </button>
    </div>
  )
}
