import { create } from 'zustand'
import api from '../services/api'

const useRealitiesStore = create((set, get) => ({
  realities: [],
  currentReality: null,
  loading: false,
  error: null,
  orgObCache: {},

  // ── Reality CRUD ─────────────────────────────────────────────────────────

  fetchRealities: async () => {
    set({ loading: true, error: null })
    try {
      const res = await api.get('/api/realities')
      set({ realities: res.data.realities })
      return res.data.realities
    } catch (err) {
      set({ error: err.message })
      throw err
    } finally {
      set({ loading: false })
    }
  },

  fetchReality: async (id) => {
    set({ loading: true })
    try {
      const res = await api.get(`/api/realities/${id}`)
      set({ currentReality: res.data.reality })
      return res.data.reality
    } catch (err) {
      set({ error: err.message })
      throw err
    } finally {
      set({ loading: false })
    }
  },

  createReality: async (data) => {
    const res = await api.post('/api/realities', data)
    const reality = res.data.reality
    set(s => ({ realities: [reality, ...s.realities] }))
    return reality
  },

  updateReality: async (id, data) => {
    const res = await api.put(`/api/realities/${id}`, data)
    const reality = res.data.reality
    set(s => ({
      realities: s.realities.map(r => r.id === id ? reality : r),
      currentReality: s.currentReality?.id === id ? reality : s.currentReality,
    }))
    return reality
  },

  deleteReality: async (id) => {
    await api.delete(`/api/realities/${id}`)
    set(s => ({
      realities: s.realities.filter(r => r.id !== id),
      currentReality: s.currentReality?.id === id ? null : s.currentReality,
    }))
  },

  uploadRealityImage: async (id, file) => {
    const formData = new FormData()
    formData.append('image', file)
    const res = await api.post(`/api/realities/${id}/image`, formData)
    const updated = res.data.reality
    set(s => ({
      realities: s.realities.map(r => r.id === id ? updated : r),
      currentReality: s.currentReality?.id === id ? updated : s.currentReality,
    }))
    return updated
  },

  // ── OrgOb lazy-load cache ─────────────────────────────────────────────────

  fetchTopLevel: async (realityId) => {
    set({ loading: true })
    try {
      const res = await api.get(`/api/realities/${realityId}/org-obs`)
      const topLevel = res.data.org_obs
      set(s => {
        const cache = { ...s.orgObCache }
        topLevel.forEach(o => { cache[o.id] = o })
        cache[`top:${realityId}`] = topLevel
        return { orgObCache: cache }
      })
      return topLevel
    } catch (err) {
      set({ error: err.message })
      throw err
    } finally {
      set({ loading: false })
    }
  },

  fetchOrgOb: async (orgObId) => {
    const res = await api.get(`/api/org-obs/${orgObId}`)
    const orgOb = res.data.org_ob
    set(s => ({ orgObCache: { ...s.orgObCache, [orgOb.id]: orgOb } }))
    return orgOb
  },

  createOrgOb: async (realityId, data) => {
    const res = await api.post(`/api/realities/${realityId}/org-obs`, data)
    const orgOb = res.data.org_ob
    set(s => {
      const cache = { ...s.orgObCache, [orgOb.id]: orgOb }
      if (orgOb.parent_id === null) {
        const key = `top:${realityId}`
        cache[key] = [...(cache[key] || []), orgOb]
      } else {
        const parent = cache[orgOb.parent_id]
        if (parent) {
          cache[orgOb.parent_id] = {
            ...parent,
            children: [...(parent.children || []), orgOb],
            children_count: (parent.children_count || 0) + 1,
          }
        }
      }
      return { orgObCache: cache }
    })
    return orgOb
  },

  updateOrgOb: async (id, data) => {
    const res = await api.put(`/api/org-obs/${id}`, data)
    const updated = res.data.org_ob
    set(s => {
      const cache = { ...s.orgObCache, [id]: updated }
      if (updated.parent_id === null) {
        const key = `top:${updated.reality_id}`
        if (cache[key]) cache[key] = cache[key].map(o => o.id === id ? updated : o)
      } else {
        const parent = cache[updated.parent_id]
        if (parent?.children) {
          cache[updated.parent_id] = {
            ...parent,
            children: parent.children.map(c => c.id === id ? updated : c),
          }
        }
      }
      return { orgObCache: cache }
    })
    return updated
  },

  reorderOrgObs: async (realityId, parentId, orderedIds) => {
    set(s => {
      const cache = { ...s.orgObCache }
      const applyOrder = list => orderedIds.map(id => list.find(o => o.id === id)).filter(Boolean)
      if (parentId === null) {
        const key = `top:${realityId}`
        if (cache[key]) cache[key] = applyOrder(cache[key])
      } else {
        const parent = cache[parentId]
        if (parent?.children) {
          cache[parentId] = { ...parent, children: applyOrder(parent.children) }
        }
      }
      return { orgObCache: cache }
    })
    await api.post('/api/org-obs/reorder', {
      items: orderedIds.map((id, index) => ({ id, order_index: index })),
    })
  },

  deleteOrgOb: async (id, parentId, realityId) => {
    await api.delete(`/api/org-obs/${id}`)
    set(s => {
      const cache = { ...s.orgObCache }
      delete cache[id]
      if (parentId === null) {
        const key = `top:${realityId}`
        if (cache[key]) cache[key] = cache[key].filter(o => o.id !== id)
      } else {
        const parent = cache[parentId]
        if (parent?.children) {
          cache[parentId] = {
            ...parent,
            children: parent.children.filter(c => c.id !== id),
            children_count: Math.max(0, (parent.children_count || 1) - 1),
          }
        }
      }
      return { orgObCache: cache }
    })
  },

  getChildren: (realityId, parentId) => {
    const cache = get().orgObCache
    return parentId === null
      ? cache[`top:${realityId}`] || []
      : cache[parentId]?.children || []
  },

  clearCache: () => set({ orgObCache: {}, currentReality: null }),
}))

export { useRealitiesStore }
