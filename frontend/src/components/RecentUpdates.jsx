import { useState } from 'react';
import './RecentUpdates.css';
import { flattenComments, weekLabel, weekStart } from './ActivityTimeline';
import { DECISION_COLOR, statusGroup } from './statusGroups';

// Recent Updates: every comment update from the period (replies count as their own entries),
// grouped into a box per calendar week (Monday start, newest week first) like the weekly
// Activity Timeline, with Comments / Decisions filter chips. A comment containing #decision is a Decision.
// Each week is collapsible; collapsed it shows only the date range and how many tasks were
// closed (moved to Done or Deferred) that week, counted from the status changes.
// Props: updates, changes = the `updates` and `status_changes` arrays returned by GET /api/monday/project/activity

function fmtStamp(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const UPDATE_FILTERS = [
  { key: 'comment', label: 'Comments', color: '#f6287e' },
  { key: 'decision', label: 'Decisions', color: DECISION_COLOR },
];

export default function RecentUpdates({ updates, changes }) {
  const [hidden, setHidden] = useState(() => new Set());
  const [toggled, setToggled] = useState({}); // week key -> open?, overriding the default (newest week open)
  const all = flattenComments(updates).sort((a, b) => new Date(b.time) - new Date(a.time));
  const counts = { comment: 0, decision: 0 };
  for (const c of all) counts[c.subtype] += 1;

  function toggle(key) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // One box per calendar week, newest week first; entries newest first inside each box.
  const thisWeek = weekStart(new Date()).getTime();
  const byWeek = new Map();
  for (const c of all) {
    if (hidden.has(c.subtype) || Number.isNaN(new Date(c.time).getTime())) continue;
    const key = weekStart(c.time).getTime();
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(c);
  }

  // Tasks closed per week: distinct tasks whose status changed to Done or Deferred that week.
  const closedByWeek = new Map();
  for (const ch of changes ?? []) {
    if (statusGroup(ch.to_status) !== 'Done/Deferred') continue;
    const key = weekStart(ch.timestamp).getTime();
    if (Number.isNaN(key)) continue;
    if (!closedByWeek.has(key)) closedByWeek.set(key, new Set());
    closedByWeek.get(key).add(ch.item_id || ch.id);
  }

  // A week is listed if it has updates or closed tasks.
  const keys = new Set([...byWeek.keys(), ...closedByWeek.keys()]);
  const weeks = [...keys].sort((a, b) => b - a).map(key => ({
    key,
    entries: byWeek.get(key) ?? [],
    closed: closedByWeek.get(key)?.size ?? 0,
  }));
  const isOpen = (key, index) => (key in toggled ? toggled[key] : index === 0);

  return (
    <section className="ru-updates">
      <h2 className="ru-updates__title">Recent Updates</h2>
      <div className="ru-filters">
        {UPDATE_FILTERS.map(({ key, label, color }) => {
          const off = hidden.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`ru-chip${off ? ' ru-chip--off' : ''}`}
              style={{ '--c': color }}
              aria-pressed={!off}
              onClick={() => toggle(key)}
            >
              <i className="ru-chip__dot" /> {label} <span className="ru-chip__n">{counts[key]}</span>
            </button>
          );
        })}
      </div>
      {weeks.length === 0 && <p className="ru-updates__empty">Everything is filtered out.</p>}
      {weeks.map(({ key, entries, closed }, index) => {
        const open = isOpen(key, index);
        return (
          <section key={key} className={`ru-week${key === thisWeek ? ' ru-week--current' : ''}`}>
            <button
              type="button"
              className="ru-week__head"
              aria-expanded={open}
              onClick={() => setToggled(prev => ({ ...prev, [key]: !open }))}
            >
              <span className={`ru-week__caret${open ? ' ru-week__caret--open' : ''}`}>▸</span>
              <span className="ru-week__title">
                {weekLabel(new Date(key))}{key === thisWeek ? ' · This week' : ''}
              </span>
              <span className="ru-week__closed">{closed} {closed === 1 ? 'task' : 'tasks'} closed</span>
            </button>
            {open && (
              entries.length === 0
                ? <p className="ru-week__none">No updates this week.</p>
                : (
                  <ul className="ru-updates__list">
                    {entries.map(c => (
                      <li key={c.key} className={`ru-update${c.isReply ? ' ru-update--reply' : ''}`}>
                        <div className="ru-update__meta">
                          <strong>
                            {c.item ?? '—'}
                            {c.subtype === 'decision' && <span className="ru-badge">Decision</span>}
                          </strong>
                          <span>{c.who ?? '—'}{c.isReply ? ' · reply' : ''} · {fmtStamp(c.time)}</span>
                        </div>
                        <p className="ru-update__body">{c.text}</p>
                      </li>
                    ))}
                  </ul>
                )
            )}
          </section>
        );
      })}
    </section>
  );
}
