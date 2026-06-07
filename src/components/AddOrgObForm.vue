<template>
  <div class="mt-3 flex flex-col gap-2">
    <input
      v-model="name"
      type="text"
      placeholder="Name"
      maxlength="200"
      class="bg-dark-300 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 w-full"
      @keydown.enter.prevent="submit"
      @keydown.escape.prevent="$emit('cancel')"
      ref="inputRef"
    />
    <input
      v-model="description"
      type="text"
      placeholder="Description (optional)"
      class="bg-dark-300 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 w-full"
      @keydown.enter.prevent="submit"
      @keydown.escape.prevent="$emit('cancel')"
    />
    <div class="flex gap-2">
      <button
        @click="submit"
        :disabled="!name.trim()"
        class="btn btn-primary text-xs py-1 px-3 flex-1 disabled:opacity-40"
      >
        Add
      </button>
      <button
        @click="$emit('cancel')"
        class="btn btn-secondary text-xs py-1 px-3"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['submit', 'cancel'])

const name = ref('')
const description = ref('')
const inputRef = ref(null)

onMounted(() => {
  inputRef.value?.focus()
})

function submit() {
  if (!name.value.trim()) return
  emit('submit', { name: name.value.trim(), description: description.value.trim() || null })
  name.value = ''
  description.value = ''
}
</script>
