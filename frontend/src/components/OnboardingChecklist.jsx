import { useState } from 'react';
import './ActivityTimeline.css';
import './WeeklyActivityTimeline.css';
import './OnboardingChecklist.css';
import { GREEN, orderedStatusGroups, statusColor, statusGroup } from './statusGroups';

// Onboarding Checklist: the project board's groups as columns on a horizontal
// line. Under each group's node sit its milestones, then cards for the items
// tagged #Onboarding (their subtasks come along, shown when a card is opened).

const TAG = 'onboarding';
const NODE_GREY = '#8b8ba7';
const FALLBACK_GROUP_COLOR = '#579bfc';
const FALLBACK_STATUS_COLOR = '#797e93';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isDone = t => (t.status || '').trim().toLowerCase() === 'done';
const hasTag = t => (t.tags ?? []).some(x => x.toLowerCase() === TAG);

// A milestone is a Timeline set to display as a milestone. As a fallback, an
// untagged item with a single-day timeline (the diamond in Monday) counts too,
// in case the milestone flag isn't in the API response.
function isMilestone(t) {
  if (t.milestone) return true;
  const tl = t.timeline;
  return !!tl && tl.from.slice(0, 10) === (tl.to || tl.from).slice(0, 10) && !hasTag(t);
}

function fmtDay(iso) {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1]} ${d}`;
}

function fmtTimeline(t) {
  if (!t) return null;
  const start = t.from.slice(0, 10);
  const end = (t.to || t.from).slice(0, 10);
  if (start === end) return fmtDay(start);
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${fmtDay(start)} - ${end.slice(8)}`
    : `${fmtDay(start)} - ${fmtDay(end)}`;
}

function StatusPill({ task }) {
  if (!task.status) return null;
  return (
    <span className="ob-pill" style={{ background: task.status_color || FALLBACK_STATUS_COLOR }}>
      {task.status}
    </span>
  );
}

function ChecklistCard({ task }) {
  const [open, setOpen] = useState(false);
  const subs = task.subtasks ?? [];
  const toggle = () => setOpen(o => !o);

  return (
    <li
      className={`tl-card wk-card ob-card${open ? ' wk-card--open' : ''}`}
      style={{ '--c': task.status_color || FALLBACK_STATUS_COLOR }}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      }}
    >
      <div className="wk-card__top">
        <span className="wk-card__dot" />
        <span className="wk-card__time">{fmtTimeline(task.timeline) ?? 'No date'}</span>
        {subs.length > 0 && <span className="ob-subcount" title="Subtasks">{subs.length}</span>}
      </div>
      <div className="tl-item">{task.name}</div>
      <StatusPill task={task} />
      {open && subs.length > 0 && (
        <ul className="ob-subs">
          {subs.map(s => (
            <li key={s.id} className="ob-sub">
              <span className="ob-sub__name">{s.name}</span>
              <StatusPill task={s} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OnboardingChecklist({ groups }) {
  const [hiddenStatuses, setHiddenStatuses] = useState(() => new Set());
  const visible = t => !hiddenStatuses.has(statusGroup(t.status));

  const all = groups
    .map(g => ({
      group: g,
      milestones: g.tasks.filter(isMilestone),
      cards: g.tasks.filter(t => !isMilestone(t) && hasTag(t)),
    }))
    .filter(c => c.milestones.length > 0 || c.cards.length > 0);

  // Filter chip counts cover every checklist item (cards and milestones).
  const counts = new Map();
  for (const { milestones, cards } of all) {
    for (const t of [...milestones, ...cards]) {
      const g = statusGroup(t.status);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  const statuses = orderedStatusGroups(counts);

  function toggleStatus(name) {
    setHiddenStatuses(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Filters hide cards and milestones from view; a node's green state still
  // looks at all of the group's milestones.
  const columns = all.map(c => ({
    ...c,
    reached: c.milestones.length > 0 && c.milestones.every(isDone),
    milestones: c.milestones.filter(visible),
    cards: c.cards.filter(visible),
  }));

  const total = all.reduce((n, c) => n + c.cards.length, 0);

  return (
    <section className="atl-card ob-card-shell">
      <div className="atl-header">
        <h2 className="atl-title">
          Onboarding Checklist
          <span className="atl-count">{total}</span>
        </h2>
      </div>

      {all.length === 0 ? (
        <div className="atl-state">No items tagged #Onboarding on this board.</div>
      ) : (
        <>
        <div className="wk-filters ob-filters">
          <div className="wk-filters__statuses">
            {statuses.map(name => {
              const off = hiddenStatuses.has(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`wk-chip wk-chip--status${off ? ' wk-chip--off' : ''}`}
                  style={{ '--c': statusColor(name) }}
                  aria-pressed={!off}
                  onClick={() => toggleStatus(name)}
                >
                  <i className="wk-chip__dot" /> {name} <span className="wk-chip__n">{counts.get(name) ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="atl-scroll">
          <ol className="wk-timeline ob-timeline">
            {columns.map(({ group, milestones, cards, reached }) => {
              const color = group.color || FALLBACK_GROUP_COLOR;
              // The node goes green once all of the group's milestones are Done.
              return (
                <li key={group.id} className="wk-col">
                  <span className="wk-label ob-label" style={{ color }} title={group.title}>
                    {group.title}
                  </span>
                  <span
                    className="wk-node"
                    style={reached ? { background: GREEN } : { background: NODE_GREY }}
                    title={reached ? 'All milestones done' : undefined}
                  />
                  {milestones.length > 0 && (
                    <ul className="ob-milestones">
                      {milestones.map(m => (
                        <li key={m.id} className="ob-ms" title={m.name}>
                          <span className="ob-ms__diamond" style={{ background: isDone(m) ? GREEN : NODE_GREY }} />
                          <span className="ob-ms__name">{m.name}</span>
                          {fmtTimeline(m.timeline) && <span className="ob-ms__date">{fmtTimeline(m.timeline)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <ul className="wk-stack ob-stack">
                    {cards.length === 0 && <li className="wk-empty">No onboarding items</li>}
                    {cards.map(t => <ChecklistCard key={t.id} task={t} />)}
                  </ul>
                </li>
              );
            })}
          </ol>
        </div>
        </>
      )}
    </section>
  );
}
