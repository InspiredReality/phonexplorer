import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api'

export const useTagsStore = defineStore('tags', () => {
  const tags = ref([])

  async function fetchTags() {
    const res = await api.get('/tags')
    tags.value = res.data.tags
    return tags.value
  }

  async function createTag(name, color = '#6366f1') {
    const res = await api.post('/tags', { name, color })
    const tag = res.data.tag
    if (!tags.value.find(t => t.id === tag.id)) {
      tags.value.push(tag)
      tags.value.sort((a, b) => a.name.localeCompare(b.name))
    }
    return tag
  }

  async function deleteTag(id) {
    await api.delete(`/tags/${id}`)
    tags.value = tags.value.filter(t => t.id !== id)
  }

  return { tags, fetchTags, createTag, deleteTag }
})
