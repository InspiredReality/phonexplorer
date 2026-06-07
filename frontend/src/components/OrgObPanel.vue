<template>
  <div
    class="rounded-xl border transition-colors"
    :class="isActive ? 'border-primary-500/60 bg-dark-200' : 'border-gray-700 bg-dark-300'"
  >
    <!-- Panel header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400">
        {{ panel.parentOrgOb ? panel.parentOrgOb.name : 'Top Level' }}
      </h3>
      <button
        v-if="!showForm"
        @click="showForm = true"
        class="text-xs text-primary-400 hover:text-primary-300 transition flex items-center gap-1"
      >
        <span class="text-base leading-none">+</span> Add
      </button>
    </div>

    <!-- Node list (sortable) -->
    <div class="px-3 py-2 flex flex-col gap-1">
      <div
        v-if="panel.nodes.length === 0 && !showForm"
        class="text-gray-500 text-sm py-2 text-center"
      >
        Empty — add the first item above
      </div>

      <!-- Sortable container — only node rows live here -->
      <div ref="listEl">
        <div
          v-for="node in panel.nodes"
          :key="node.id"
          :data-id="node.id"
          class="org-ob-node flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition group mb-1"
          :class="
            panel.selectedNode?.id === node.id
              ? 'bg-primary-500/20 border border-primary-500/50'
              : 'hover:bg-dark-100 border border-transparent'
          "
          @click="$emit('select', node)"
        >
          <!-- Drag handle -->
          <span
            class="drag-handle text-gray-600 hover:text-gray-400 mr-2 cursor-grab active:cursor-grabbing select-none shrink-0 touch-none"
            title="Hold to reorder"
          >⠿</span>

          <div class="flex items-center gap-2 min-w-0 flex-1">
            <span class="font-medium text-sm text-white truncate">{{ node.name }}</span>
            <span
              v-if="node.children_count > 0"
              class="text-xs text-gray-500 shrink-0"
            >{{ node.children_count }}</span>
          </div>

          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            <button
              @click.stop="$emit('edit', node)"
              class="text-gray-400 hover:text-white text-xs px-1"
              title="Edit"
            >✎</button>
            <button
              @click.stop="$emit('delete', node)"
              class="text-red-500 hover:text-red-400 text-xs px-1"
              title="Delete"
            >✕</button>
          </div>

          <span
            v-if="panel.selectedNode?.id === node.id"
            class="text-primary-400 text-xs ml-1 shrink-0"
          >▶</span>
        </div>
      </div>

      <!-- Inline add form (outside sortable div so it's never draggable) -->
      <AddOrgObForm
        v-if="showForm"
        @submit="handleAdd"
        @cancel="showForm = false"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import Sortable from 'sortablejs'
import AddOrgObForm from './AddOrgObForm.vue'

const props = defineProps({
  panel: { type: Object, required: true },
  isActive: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'add', 'edit', 'delete', 'reorder'])

const showForm = ref(false)
const listEl = ref(null)
let sortable = null

function initSortable() {
  if (!listEl.value || sortable) return
  sortable = Sortable.create(listEl.value, {
    animation: 150,
    delay: 300,
    delayOnTouchOnly: true,
    touchStartThreshold: 5,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(evt) {
      if (evt.oldIndex === evt.newIndex) return
      const ids = [...listEl.value.querySelectorAll('[data-id]')]
        .map(el => Number(el.dataset.id))
        .filter(id => !isNaN(id) && id > 0)
      emit('reorder', ids)
    },
  })
}

onMounted(initSortable)

onBeforeUnmount(() => {
  sortable?.destroy()
  sortable = null
})

function handleAdd(data) {
  showForm.value = false
  emit('add', { ...data, parentOrgOb: props.panel.parentOrgOb })
}
</script>

<style scoped>
.sortable-ghost {
  opacity: 0.4;
  background: rgba(99, 102, 241, 0.15);
  border: 1px dashed rgba(99, 102, 241, 0.5);
  border-radius: 0.5rem;
}

.sortable-chosen {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
</style>
