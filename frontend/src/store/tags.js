import { create } from 'zustand'
import api from '../services/api'

const useTagsStore = create((set, get) => ({
  tags: [],

  fetchTags: async () => {
    const res = await api.get('/api/tags')
    set({ tags: res.data.tags })
    return res.data.tags
  },

  createTag: async (name, color = '#6366f1') => {
    const res = await api.post('/api/tags', { name, color })
    const tag = res.data.tag
    const { tags } = get()
    if (!tags.find(t => t.id === tag.id)) {
      set({ tags: [...tags, tag].sort((a, b) => a.name.localeCompare(b.name)) })
    }
    return tag
  },

  deleteTag: async (id) => {
    await api.delete(`/api/tags/${id}`)
    set(s => ({ tags: s.tags.filter(t => t.id !== id) }))
  },
}))

export { useTagsStore }
