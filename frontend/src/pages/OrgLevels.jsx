import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRealitiesStore } from '../store/realities'
import OrgObPanel from '../components/OrgObPanel'
import OrgBreadcrumb from '../components/OrgBreadcrumb'
import { INPUT } from '../styles/constants'

export default function OrgLevels() {
  const { id } = useParams()
  const realityId = Number(id)
  const navigate = useNavigate()
  const store = useRealitiesStore()
  const [selectedPath, setSelectedPath] = useState([])
  const [loadingChildren, setLoadingChildren] = useState(false)
  const [editingOrgOb, setEditingOrgOb] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', description: '' })

  useEffect(() => {
    store.clearCache()
    store.fetchReality(realityId).then(() => store.fetchTopLevel(realityId))
  }, [realityId])

  // Build column panels from selectedPath
  const panels = (() => {
    const result = [{
      level: 0, parentOrgOb: null,
      nodes: store.getChildren(realityId, null),
      selectedNode: selectedPath[0] ?? null,
    }]
    for (let i = 0; i < selectedPath.length; i++) {
      result.push({
        level: i + 1,
        parentOrgOb: selectedPath[i],
        nodes: store.getChildren(realityId, selectedPath[i].id),
        selectedNode: selectedPath[i + 1] ?? null,
      })
    }
    return result
  })()

  async function selectOrgOb(level, orgOb) {
    setSelectedPath([...selectedPath.slice(0, level), orgOb])
    if (!store.orgObCache[orgOb.id]) {
      setLoadingChildren(true)
      try { await store.fetchOrgOb(orgOb.id) }
      finally { setLoadingChildren(false) }
    }
  }

  function navigateTo(pathIndex) {
    setSelectedPath(pathIndex < 0 ? [] : selectedPath.slice(0, pathIndex + 1))
  }

  async function addOrgOb(panel, { name, description, parentOrgOb }) {
    const parentId = parentOrgOb ? parentOrgOb.id : null
    await store.createOrgOb(realityId, {
      name, description,
      parent_id: parentId,
      order_index: store.getChildren(realityId, parentId).length,
    })
  }

  function openEditModal(orgOb) {
    setEditingOrgOb(orgOb)
    setEditForm({ name: orgOb.name, description: orgOb.description || '' })
  }

  async function saveEdit() {
    if (!editForm.name.trim()) return
    const updated = await store.updateOrgOb(editingOrgOb.id, {
      name: editForm.name.trim(),
      description: editForm.description.trim() || null,
    })
    setSelectedPath(selectedPath.map(n => n.id === updated.id ? updated : n))
    setEditingOrgOb(null)
  }

  async function reorderPanel(panel, orderedIds) {
    const parentId = panel.parentOrgOb ? panel.parentOrgOb.id : null
    await store.reorderOrgObs(realityId, parentId, orderedIds)
  }

  async function confirmDelete(orgOb) {
    // eslint-disable-next-line no-restricted-globals
    if (!confirm(`Delete "${orgOb.name}" and all its children?`)) return
    await store.deleteOrgOb(orgOb.id, orgOb.parent_id, realityId)
    const pathIdx = selectedPath.findIndex(n => n.id === orgOb.id)
    if (pathIdx !== -1) setSelectedPath(selectedPath.slice(0, pathIdx))
  }

  if (store.loading && !store.currentReality)
    return <div className="text-center py-20 text-neutral-400">Loading…</div>
  if (store.error)
    return <div className="text-center py-20 text-red-400">{store.error}</div>
  if (!store.currentReality)
    return <div className="text-center py-20 text-neutral-400">Reality not found.</div>

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 bg-neutral-900 text-white flex flex-col z-10">
      <div className="max-w-4xl mx-auto w-full flex flex-col flex-1 min-h-0 px-4">

        {/* Header */}
        <div className="flex items-center gap-3 py-4 shrink-0">
          <button onClick={() => navigate('/realities')}
            className="text-neutral-400 hover:text-white transition text-sm shrink-0">
            ← Realities
          </button>
          <div className="flex-1 min-w-0">
            {store.currentReality && (
              <OrgBreadcrumb
                realityName={store.currentReality.name}
                path={selectedPath}
                onNavigate={navigateTo}
              />
            )}
          </div>
        </div>

        {/* Panels — only scroll area */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pb-6">
          {panels.map(panel => (
            <OrgObPanel
              key={panel.level}
              panel={panel}
              isActive={panel.level === panels.length - 1}
              onSelect={orgOb => selectOrgOb(panel.level, orgOb)}
              onAdd={data => addOrgOb(panel, data)}
              onEdit={openEditModal}
              onDelete={orgOb => confirmDelete(orgOb)}
              onReorder={orderedIds => reorderPanel(panel, orderedIds)}
            />
          ))}
          {loadingChildren && (
            <div className="rounded-xl border border-neutral-700 bg-neutral-800 p-6 animate-pulse h-24" />
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingOrgOb && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
          onClick={e => { if (e.target === e.currentTarget) setEditingOrgOb(null) }}>
          <div className="bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">Edit</h2>
            <div className="flex flex-col gap-3">
              <input value={editForm.name} onChange={e => setEditForm(f => ({...f, name: e.target.value}))}
                placeholder="Name" maxLength={200} className={INPUT} />
              <textarea value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))}
                placeholder="Description (optional)" rows={3} className={INPUT + " resize-none"} />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={saveEdit} disabled={!editForm.name.trim()}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40">
                Save
              </button>
              <button onClick={() => setEditingOrgOb(null)}
                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}