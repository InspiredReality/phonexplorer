import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRealitiesStore } from '../store/realities'
import { useTagsStore } from '../store/tags'
import { getUploadUrl } from '../services/api'

export default function Realities() {
  const navigate = useNavigate()
  const store = useRealitiesStore()
  const tagsStore = useTagsStore()
  const [loading, setLoading] = useState(true)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '' })
  const [createError, setCreateError] = useState('')

  // Edit modal
  const [editingReality, setEditingReality] = useState(null)
  const [editForm, setEditForm] = useState({ name:'', description:'', length_m:null, width_m:null, selectedTags:[] })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editPhotoPreview, setEditPhotoPreview] = useState(null)
  const [editPhotoFile, setEditPhotoFile] = useState(null)
  const photoInputRef = useRef(null)

  // Tag picker
  const [tagSearch, setTagSearch] = useState('')
  const [showTagDropdown, setShowTagDropdown] = useState(false)

  useEffect(() => {
    Promise.all([store.fetchRealities(), tagsStore.fetchTags()]).finally(() => setLoading(false))
  }, [])

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase()
    const selectedIds = new Set(editForm.selectedTags.map(t => t.id))
    return tagsStore.tags.filter(t => !selectedIds.has(t.id) && (!q || t.name.toLowerCase().includes(q)))
  }, [tagsStore.tags, editForm.selectedTags, tagSearch])

  const exactTagMatch = useMemo(() =>
    tagsStore.tags.some(t => t.name.toLowerCase() === tagSearch.trim().toLowerCase()),
    [tagsStore.tags, tagSearch])

  function formatDate(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })
  }

  async function submitCreate() {
    if (!createForm.name.trim()) return
    setCreating(true); setCreateError('')
    try {
      await store.createReality({ name: createForm.name.trim(),
        description: createForm.description.trim() || null })
      setShowCreate(false); setCreateForm({ name:'', description:'' })
    } catch (err) {
      setCreateError(err.response?.data?.detail || err.message || 'Failed to create')
    } finally { setCreating(false) }
  }

  function startEdit(reality) {
    setEditingReality(reality)
    setEditForm({ name: reality.name, description: reality.description || '',
      length_m: reality.length_m ?? null, width_m: reality.width_m ?? null,
      selectedTags: [...(reality.tags || [])] })
    setEditPhotoPreview(null); setEditPhotoFile(null)
    setEditError(''); setTagSearch(''); setShowTagDropdown(false)
  }

  async function submitEdit() {
    if (!editForm.name.trim()) return
    setEditSaving(true); setEditError('')
    try {
      await store.updateReality(editingReality.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        length_m: editForm.length_m || null,
        width_m: editForm.width_m || null,
        tag_ids: editForm.selectedTags.map(t => t.id),
      })
      if (editPhotoFile) await store.uploadRealityImage(editingReality.id, editPhotoFile)
      setEditingReality(null)
    } catch (err) {
      setEditError(err.response?.data?.detail || err.message || 'Failed to save')
    } finally { setEditSaving(false) }
  }

  async function deleteReality(id) {
    if (!confirm('Delete this Reality and all its contents?')) return
    await store.deleteReality(id)
  }

  async function createAndSelectTag() {
    const name = tagSearch.trim(); if (!name) return
    try {
      const tag = await tagsStore.createTag(name)
      setEditForm(f => ({ ...f, selectedTags: [...f.selectedTags, tag] }))
      setTagSearch(''); setShowTagDropdown(false)
    } catch { /* ignore */ }
  }

  const INPUT = "bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 w-full"

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Realities</h1>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
          New Reality
        </button>
      </div>

      {store.realities.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-neutral-400 mb-4">No realities yet. Create one to get started.</p>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm">
            Create Reality
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {store.realities.map(reality => (
            <div key={reality.id}
              className="bg-neutral-800 rounded-xl p-4 border border-transparent hover:border-indigo-500/50 transition-colors cursor-pointer"
              onClick={() => navigate(`/realities/${reality.id}`)}>

              <div className="aspect-video bg-neutral-700 rounded-lg flex items-center justify-center mb-3 overflow-hidden">
                {reality.image_path
                  ? <img src={getUploadUrl(reality.image_path)} alt={reality.name} className="w-full h-full object-cover" />
                  : <span className="text-neutral-500 text-4xl">🏢</span>
                }
              </div>

              <h3 className="font-semibold text-lg mb-1">{reality.name}</h3>
              {reality.description && <p className="text-sm text-neutral-400 mb-2 line-clamp-2">{reality.description}</p>}
              {(reality.width_m || reality.length_m) && (
                <p className="text-xs text-neutral-500 mb-2">
                  {reality.length_m ?? '—'} m × {reality.width_m ?? '—'} m
                </p>
              )}
              {reality.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {reality.tags.map(tag => (
                    <span key={tag.id} className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: tag.color + '33', color: tag.color }}>
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between text-sm text-neutral-500 mb-4">
                <span>{reality.org_ob_count} item{reality.org_ob_count !== 1 ? 's' : ''}</span>
                <span>{formatDate(reality.created_at)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={e => { e.stopPropagation(); navigate(`/realities/${reality.id}`) }}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm">
                  Open
                </button>
                <button onClick={e => { e.stopPropagation(); startEdit(reality) }}
                  className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-sm">
                  ✎
                </button>
                <button onClick={e => { e.stopPropagation(); deleteReality(reality.id) }}
                  className="px-3 py-2 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-sm">
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
          onClick={e => { if (e.target === e.currentTarget) { setShowCreate(false); setCreateForm({ name:'', description:'' }) } }}>
          <div className="bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">New Reality</h2>
            <div className="flex flex-col gap-3">
              <input value={createForm.name} onChange={e => setCreateForm(f => ({...f, name: e.target.value}))}
                onKeyDown={e => e.key === 'Enter' && submitCreate()}
                placeholder="Name *" maxLength={100} className={INPUT} />
              <textarea value={createForm.description} onChange={e => setCreateForm(f => ({...f, description: e.target.value}))}
                placeholder="Description (optional)" rows={3} className={INPUT + " resize-none"} />
            </div>
            {createError && <p className="text-red-400 text-sm mt-3">{createError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={submitCreate} disabled={!createForm.name.trim() || creating}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40">
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => { setShowCreate(false); setCreateForm({ name:'', description:'' }) }}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingReality && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 overflow-y-auto py-8"
          onClick={e => { if (e.target === e.currentTarget) setEditingReality(null) }}>
          <div className="bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl my-auto">
            <h2 className="text-lg font-semibold mb-4">Edit Reality</h2>

            {/* Photo */}
            <div className="aspect-video bg-neutral-700 rounded-lg flex items-center justify-center mb-4 overflow-hidden relative cursor-pointer group"
              onClick={() => photoInputRef.current?.click()}>
              {editPhotoPreview || editingReality.image_path
                ? <img src={editPhotoPreview || getUploadUrl(editingReality.image_path)} alt="" className="w-full h-full object-cover" />
                : <span className="text-neutral-500 text-sm">Add photo</span>
              }
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <span className="text-white text-sm font-medium">Change photo</span>
              </div>
            </div>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]; if (!f) return
                setEditPhotoFile(f); setEditPhotoPreview(URL.createObjectURL(f)); e.target.value = ''
              }} />

            <div className="flex flex-col gap-3">
              <input value={editForm.name} onChange={e => setEditForm(f => ({...f, name: e.target.value}))}
                placeholder="Name *" maxLength={100} className={INPUT} />
              <textarea value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))}
                placeholder="Description (optional)" rows={2} className={INPUT + " resize-none"} />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-neutral-400 mb-1 block">Length (m)</label>
                  <input type="number" min={0} step={0.1}
                    value={editForm.length_m ?? ''} onChange={e => setEditForm(f => ({...f, length_m: e.target.value ? Number(e.target.value) : null}))}
                    className={INPUT} placeholder="e.g. 10" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-neutral-400 mb-1 block">Width (m)</label>
                  <input type="number" min={0} step={0.1}
                    value={editForm.width_m ?? ''} onChange={e => setEditForm(f => ({...f, width_m: e.target.value ? Number(e.target.value) : null}))}
                    className={INPUT} placeholder="e.g. 8" />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-xs text-neutral-400 mb-2 block">Tags</label>
                {editForm.selectedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {editForm.selectedTags.map(tag => (
                      <button key={tag.id} type="button"
                        className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                        style={{ backgroundColor: tag.color + '33', color: tag.color }}
                        onClick={() => setEditForm(f => ({ ...f, selectedTags: f.selectedTags.filter(t => t.id !== tag.id) }))}>
                        {tag.name} <span className="opacity-70">✕</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <input value={tagSearch} onChange={e => setTagSearch(e.target.value)}
                    placeholder="Search or create tag…"
                    onFocus={() => setShowTagDropdown(true)}
                    onBlur={() => setTimeout(() => setShowTagDropdown(false), 150)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault()
                        if (filteredTags.length) { const t = filteredTags[0]; setEditForm(f => ({...f, selectedTags: [...f.selectedTags, t]})); setTagSearch('') }
                        else if (tagSearch.trim() && !exactTagMatch) createAndSelectTag()
                      }
                    }}
                    className={INPUT} />
                  {showTagDropdown && (filteredTags.length > 0 || tagSearch.trim()) && (
                    <div className="absolute z-10 w-full mt-1 bg-neutral-900 border border-neutral-600 rounded-lg shadow-xl overflow-hidden">
                      {filteredTags.map(tag => (
                        <button key={tag.id} type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700 flex items-center gap-2"
                          onMouseDown={e => { e.preventDefault(); setEditForm(f => ({...f, selectedTags: [...f.selectedTags, tag]})); setTagSearch(''); setShowTagDropdown(false) }}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      ))}
                      {tagSearch.trim() && !exactTagMatch && (
                        <button type="button"
                          className="w-full text-left px-3 py-2 text-sm text-indigo-400 hover:bg-neutral-700 flex items-center gap-2"
                          onMouseDown={e => { e.preventDefault(); createAndSelectTag() }}>
                          <span className="text-lg leading-none">+</span> Create "{tagSearch.trim()}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {editError && <p className="text-red-400 text-sm mt-3">{editError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={submitEdit} disabled={!editForm.name.trim() || editSaving}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40">
                {editSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingReality(null)}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}