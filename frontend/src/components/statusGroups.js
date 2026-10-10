// Raw Monday statuses folded into the filter groups used by the timelines and
// the Onboarding Checklist: Done + Deferred are one group, every "Pending
// Nucleus ..." status is one group, TODO shows as "ToDo". Anything else keeps its own name.

export const GREEN = '#00c875';
export const DEFAULT_STATUS_COLOR = '#579bfc';

export const STATUS_ORDER = [
  'ToDo',
  'Pending Customer',
  'Pending Nucleus',
  'Done/Deferred',
];

const STATUS_COLORS = {
  'ToDo': '#797e93',            // grey
  'Pending Customer': '#f5c542', // yellow
  'Done/Deferred': GREEN,
};

export function statusGroup(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'done' || s === 'deferred') return 'Done/Deferred';
  if (s === 'todo' || s === 'to do') return 'ToDo';
  if (s.startsWith('pending nucleus')) return 'Pending Nucleus'; // Implementation + Product
  return (raw || '').trim() || '—';
}

export function statusColor(group) {
  return STATUS_COLORS[group] ?? DEFAULT_STATUS_COLOR;
}

// Filter chips to show: the fixed groups in order, then any others present in `counts` (a Map of group -> n).
export function orderedStatusGroups(counts) {
  const names = new Set([...STATUS_ORDER, ...[...counts.entries()].filter(([, n]) => n > 0).map(([k]) => k)]);
  return [...names].sort((a, b) => {
    const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}
