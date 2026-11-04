import { useState } from 'react';
import './SuccessRoadmap.css';

// Success Roadmap: the project board's groups as an accordion (tasks, with their
// subtasks bundled underneath), plus Done / Open filter chips.
// Props: groups = [{ id, title, color, tasks: [{ id, name, status, status_color, timeline, subtasks: [...] }] }]
// (the `groups` array returned by GET /api/monday/project)

const FALLBACK_STATUS_COLOR = '#797e93';
const FALLBACK_GROUP_COLOR = '#579bfc';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDay(iso) {
  const [, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${d}`;
}

function fmtTimeline(t) {
  if (!t) return '—';
  const start = t.from.slice(0, 10);
  const end = (t.to || t.from).slice(0, 10);
  if (start === end) return fmtDay(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${fmtDay(start)} - ${sameMonth ? end.slice(8) : fmtDay(end)}`;
}

function StatusPill({ status, color }) {
  if (!status) return <span className="sr-pill sr-pill--empty">—</span>;
  return <span className="sr-pill" style={{ background: color || FALLBACK_STATUS_COLOR }}>{status}</span>;
}

function Task({ task }) {
  const [open, setOpen] = useState(false);
  const hasSubs = task.subtasks.length > 0;

  return (
    <li className="sr-task">
      <div
        className={`sr-row${hasSubs ? ' sr-row--expandable' : ''}`}
        onClick={hasSubs ? () => setOpen(o => !o) : undefined}
      >
        <span className="sr-row__name">
          {hasSubs
            ? <span className={`sr-caret${open ? ' sr-caret--open' : ''}`}>▸</span>
            : <span className="sr-caret sr-caret--none" />}
          {task.name}
        </span>
        {hasSubs && <span className="sr-subcount" title="Subitems">{task.subtasks.length}</span>}
        <StatusPill status={task.status} color={task.status_color} />
        <span className="sr-timeline">{fmtTimeline(task.timeline)}</span>
      </div>

      {hasSubs && open && (
        <ul className="sr-subtasks">
          {task.subtasks.map(s => (
            <li key={s.id} className="sr-row sr-row--sub">
              <span className="sr-row__name">{s.name}</span>
              <StatusPill status={s.status} color={s.status_color} />
              <span className="sr-timeline">{fmtTimeline(s.timeline)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Success Roadmap only: "Done" means status Done. Deferred (and every other status) is Open,
// unlike the Done/Deferred grouping used by the timelines and the Onboarding Checklist.
const isDoneTask = t => (t.status || '').trim().toLowerCase() === 'done';

function Group({ group, show }) {
  const [open, setOpen] = useState(false);
  const color = group.color || FALLBACK_GROUP_COLOR;
  const done = group.tasks.filter(t => (t.status || '').toLowerCase() === 'done').length;

  return (
    <section className="sr-group" style={{ '--group-color': color }}>
      <button className="sr-group__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={`sr-caret${open ? ' sr-caret--open' : ''}`}>▸</span>
        <span className="sr-group__title">{group.title}</span>
        <span className="sr-group__count">{done}/{group.tasks.length}</span>
      </button>
      {open && (
        <ul className="sr-tasks">
          {group.tasks.filter(show).length === 0
            ? <li className="sr-empty">{group.tasks.length === 0 ? 'No tasks in this group.' : 'No tasks match the filter.'}</li>
            : group.tasks.filter(show).map(t => <Task key={t.id} task={t} />)}
        </ul>
      )}
    </section>
  );
}

export default function SuccessRoadmap({ groups }) {
  const [hidden, setHidden] = useState(() => new Set()); // 'done' and/or 'open'
  const all = groups.flatMap(g => g.tasks);
  const counts = {
    done: all.filter(isDoneTask).length,
    open: all.filter(t => !isDoneTask(t)).length,
  };
  const show = t => !hidden.has(isDoneTask(t) ? 'done' : 'open');

  function toggle(key) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <section className="sr-roadmap">
      <h2 className="sr-roadmap__title">Success Roadmap</h2>
      <div className="sr-filters">
        {[['done', 'Done'], ['open', 'Open']].map(([key, label]) => {
          const off = hidden.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`sr-chip sr-chip--plain${off ? ' sr-chip--off' : ''}`}
              aria-pressed={!off}
              onClick={() => toggle(key)}
            >
              <i className="sr-chip__dot" /> {label} <span className="sr-chip__n">{counts[key]}</span>
            </button>
          );
        })}
      </div>
      {groups.map(g => <Group key={g.id} group={g} show={show} />)}
    </section>
  );
}
