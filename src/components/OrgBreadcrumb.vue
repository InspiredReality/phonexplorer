<template>
  <nav class="flex items-center gap-1 text-sm text-gray-400 flex-wrap">
    <button
      @click="$emit('navigate', -1)"
      class="hover:text-white transition font-medium text-primary-400"
    >
      {{ realityName }}
    </button>
    <template v-for="(node, index) in path" :key="node.id">
      <span class="text-gray-600">/</span>
      <button
        @click="$emit('navigate', index)"
        class="hover:text-white transition truncate max-w-[120px]"
        :class="index === path.length - 1 ? 'text-white' : 'text-gray-400'"
      >
        {{ node.name }}
      </button>
    </template>
  </nav>
</template>

<script setup>
defineProps({
  realityName: { type: String, required: true },
  path: { type: Array, default: () => [] },
})

defineEmits(['navigate'])
</script>
