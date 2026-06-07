import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api'
import { getUploadUrl } from '@/services/api'

export const useRealitiesStore = defineStore('realities', () => {
  const realities = ref([])
  const currentReality = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // Cache: key = orgOb id (number) or null (top-level). Value = OrgOb with children array.
  const orgObCache = ref({})

  // ----------------------------
  // Reality CRUD
  // ----------------------------
  async function fetchRealities() {
    loading.value = true
    error.value = null
    try {
      const res = await api.get('/realities')
      realities.value = res.data.realities
      return realities.value
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchReality(id) {
    loading.value = true
    try {
      const res = await api.get(`/realities/${id}`)
      currentReality.value = res.data.reality
      return currentReality.value
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createReality(data) {
    const res = await api.post('/realities', data)
    realities.value.unshift(res.data.reality)
    return res.data.reality
  }

  async function updateReality(id, data) {
    const res = await api.put(`/realities/${id}`, data)
    const idx = realities.value.findIndex(r => r.id === id)
    if (idx !== -1) realities.value[idx] = res.data.reality
    if (currentReality.value?.id === id) currentReality.value = res.data.reality
    return res.data.reality
  }

  async function deleteReality(id) {
    await api.delete(`/realities/${id}`)
    realities.value = realities.value.filter(r => r.id !== id)
    if (currentReality.value?.id === id) currentReality.value = null
  }

  async function uploadRealityImage(id, file) {
    const formData = new FormData()
    formData.append('image', file)
    const res = await api.post(`/realities/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    const updated = res.data.reality
    const idx = realities.value.findIndex(r => r.id === id)
    if (idx !== -1) realities.value[idx] = updated
    if (currentReality.value?.id === id) currentReality.value = updated
    return updated
  }

  function getRealityImageUrl(imagePath) {
    if (!imagePath) return null
    return getUploadUrl(imagePath)
  }

  // ----------------------------
  // OrgOb lazy-load
  // ----------------------------

  // Fetch top-level OrgObs (parent_id = null) for a Reality.
  // Stores each top-level OrgOb and its children in orgObCache.
  async function fetchTopLevel(realityId) {
    loading.value = true
    try {
      const res = await api.get(`/realities/${realityId}/org-obs`)
      const topLevel = res.data.org_obs
      topLevel.forEach(o => { orgObCache.value[o.id] = o })
      // Store the top-level list under the null key scoped to this reality
      orgObCache.value[`top:${realityId}`] = topLevel
      return topLevel
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchOrgOb(orgObId) {
    const res = await api.get(`/org-obs/${orgObId}`)
    const orgOb = res.data.org_ob
    orgObCache.value[orgOb.id] = orgOb
    return orgOb
  }

  async function createOrgOb(realityId, data) {
    const res = await api.post(`/realities/${realityId}/org-obs`, data)
    const orgOb = res.data.org_ob

    // Insert into cache
    orgObCache.value[orgOb.id] = orgOb

    if (orgOb.parent_id === null) {
      // Append to the top-level list
      const key = `top:${realityId}`
      if (!orgObCache.value[key]) orgObCache.value[key] = []
      orgObCache.value[key] = [...orgObCache.value[key], orgOb]
    } else {
      // Append to parent's children array in cache
      const parent = orgObCache.value[orgOb.parent_id]
      if (parent) {
        parent.children = [...(parent.children || []), orgOb]
        parent.children_count = (parent.children_count || 0) + 1
      }
    }

    return orgOb
  }

  async function updateOrgOb(id, data) {
    const res = await api.put(`/org-obs/${id}`, data)
    const updated = res.data.org_ob
    orgObCache.value[id] = updated

    // Also replace the node inside whichever list renders it
    if (updated.parent_id === null) {
      const key = `top:${updated.reality_id}`
      if (orgObCache.value[key]) {
        orgObCache.value[key] = orgObCache.value[key].map(o => o.id === id ? updated : o)
      }
    } else {
      const parent = orgObCache.value[updated.parent_id]
      if (parent?.children) {
        parent.children = parent.children.map(c => c.id === id ? updated : c)
      }
    }

    return updated
  }

  async function reorderOrgObs(realityId, parentId, orderedIds) {
    // Optimistically update the cache list immediately so the UI doesn't jump back
    const applyOrder = (list) =>
      orderedIds.map(id => list.find(o => o.id === id)).filter(Boolean)

    if (parentId === null) {
      const key = `top:${realityId}`
      if (orgObCache.value[key]) orgObCache.value[key] = applyOrder(orgObCache.value[key])
    } else {
      const parent = orgObCache.value[parentId]
      if (parent?.children) parent.children = applyOrder(parent.children)
    }

    await api.post('/org-obs/reorder', {
      items: orderedIds.map((id, index) => ({ id, order_index: index })),
    })
  }

  async function deleteOrgOb(id, parentId, realityId) {
    await api.delete(`/org-obs/${id}`)
    delete orgObCache.value[id]

    if (parentId === null) {
      const key = `top:${realityId}`
      if (orgObCache.value[key]) {
        orgObCache.value[key] = orgObCache.value[key].filter(o => o.id !== id)
      }
    } else {
      const parent = orgObCache.value[parentId]
      if (parent?.children) {
        parent.children = parent.children.filter(c => c.id !== id)
        parent.children_count = Math.max(0, (parent.children_count || 1) - 1)
      }
    }
  }

  // ----------------------------
  // Helpers
  // ----------------------------

  // Returns the list of OrgObs for a given parent context.
  // parentId = null → top-level list; parentId = number → children of that OrgOb.
  function getChildren(realityId, parentId) {
    if (parentId === null) {
      return orgObCache.value[`top:${realityId}`] || []
    }
    return orgObCache.value[parentId]?.children || []
  }

  function clearCache() {
    orgObCache.value = {}
    currentReality.value = null
  }

  return {
    realities,
    currentReality,
    loading,
    error,
    orgObCache,
    fetchRealities,
    fetchReality,
    createReality,
    updateReality,
    deleteReality,
    uploadRealityImage,
    getRealityImageUrl,
    fetchTopLevel,
    reorderOrgObs,
    fetchOrgOb,
    createOrgOb,
    updateOrgOb,
    deleteOrgOb,
    getChildren,
    clearCache,
  }
})
