import { useRef, useState } from 'react';
import './ActivityTimeline.css';
import './WeeklyActivityTimeline.css';
import { buildEvents, firstWords, formatDate, useScrollToEnd } from './ActivityTimeline';

// Same data as ActivityTimeline, grouped into Monday-start weeks. Each week is
// one column on the horizontal line; its updates and status changes stack
// vertically underneath, aligned in a single column.

const DAY_MS = 24 * 60 * 60 * 1000;

function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back up to Monday
  return d;
}

function weekLabel(start) {
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

// Oldest → newest, including empty weeks in between so gaps stay visible.
function groupByWeek(events) {
  if (events.length === 0) return [];
  const byWeek = new Map();
  for (const e of events) {
    const key = weekStart(e.time).getTime();
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(e);
  }
  const first = Math.min(...byWeek.keys());
  const last = Math.max(...byWeek.keys());
  const weeks = [];
  for (let t = first; t <= last; ) {
    const start = new Date(t);
    weeks.push({ key: t, start, events: byWeek.get(t) ?? [] });
    const next = new Date(start);
    next.setDate(next.getDate() + 7); // calendar-safe across DST
    t = next.getTime();
  }
  return weeks;
}

const GREEN = '#00c875';
const PINK = '#f6287e';
const DEFAULT_STATUS_COLOR = '#579bfc';

// Filter groups. Raw Monday statuses are folded into these (Done + Deferred
// are one tag; TODO shows as "ToDo"); anything else keeps its own name.
const STATUS_ORDER = [
  'ToDo',
  'Pending Customer',
  'Pending Nucleus',
  'Done/Deferred',
];
const STATUS_COLORS = {
  'ToDo': '#797e93',                         // grey
  'Pending Customer': '#f5c542',             // yellow
  'Done/Deferred': GREEN,
};

function statusGroup(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'done' || s === 'deferred') return 'Done/Deferred';
  if (s === 'todo' || s === 'to do') return 'ToDo';
  if (s.startsWith('pending nucleus')) return 'Pending Nucleus'; // Implementation + Product
  return (raw || '').trim() || '—';
}

function statusColor(group) {
  return STATUS_COLORS[group] ?? DEFAULT_STATUS_COLOR;
}

function eventColor(e) {
  if (e.kind === 'update') return e.subtype === 'decision' ? GREEN : PINK;
  return statusColor(statusGroup(e.status));
}

const SUBTYPES = [
  { key: 'comment', label: 'Comments', color: PINK },
  { key: 'decision', label: 'Decisions', color: GREEN },
];

export default function WeeklyActivityTimeline({
  updates, changes, loading, error, errorChanges, onRetry,
  title = 'Activity Timeline · By Week',
  emptyText = 'No updates or status changes in this period.',
}) {
  const allEvents = buildEvents(updates, changes);

  // Filters: click a chip to hide / show that kind of event. The two top-level
  // chips switch a whole type off; the chips under them filter within it.
  const [hideUpdates, setHideUpdates] = useState(false);
  const [hideStatusChanges, setHideStatusChanges] = useState(false);
  const [hiddenSubtypes, setHiddenSubtypes] = useState(() => new Set());
  const [hiddenStatuses, setHiddenStatuses] = useState(() => new Set());

  const subtypeCounts = { comment: 0, decision: 0 };
  const statusCounts = new Map(STATUS_ORDER.map(n => [n, 0]));
  for (const e of allEvents) {
    if (e.kind === 'update') {
      subtypeCounts[e.subtype] += 1;
    } else {
      const g = statusGroup(e.status);
      statusCounts.set(g, (statusCounts.get(g) ?? 0) + 1);
    }
  }
  // Fixed order first, then any other statuses found in the data.
  const statuses = [...statusCounts.entries()]
    .filter(([name, count]) => STATUS_ORDER.includes(name) || count > 0)
    .sort(([a], [b]) => {
      const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    });

  // Cards the user has clicked open to show their full text.
  const [expanded, setExpanded] = useState(() => new Set());
  function toggleCard(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggle(setter, name) {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const events = allEvents.filter(e => {
    if (e.kind === 'update') return !hideUpdates && !hiddenSubtypes.has(e.subtype);
    return !hideStatusChanges && !hiddenStatuses.has(statusGroup(e.status));
  });
  const weeks = groupByWeek(events);
  const scrollRef = useRef(null);
  useScrollToEnd(scrollRef, `${loading}-${weeks.length}`);

  return (
    <section className="atl-card">
      <div className="atl-header">
        <h2 className="atl-title">
          {title}
          {!loading && !error && <span className="atl-count">{events.length}</span>}
        </h2>
        {onRetry && (
          <button className="atl-refresh" onClick={onRetry} disabled={loading}>
            {loading ? '…' : '↻'}
          </button>
        )}
      </div>

      {loading && <div className="atl-state">Loading…</div>}
      {!loading && error && <div className="atl-state atl-state--error">{error}</div>}

      {!loading && !error && (
        <>
          {errorChanges && (
            <div className="atl-warn">Status changes unavailable: {errorChanges}</div>
          )}
          {allEvents.length === 0 ? (
            <div className="atl-state">{emptyText}</div>
          ) : (
            <>
              <div className="wk-filters">
                <div className="wk-filters__col">
                  <button
                    type="button"
                    className={`wk-chip wk-chip--main${hideUpdates ? ' wk-chip--off' : ''}`}
                    aria-pressed={!hideUpdates}
                    onClick={() => setHideUpdates(v => !v)}
                  >
                    <i className="wk-chip__dot" /> Updates
                  </button>
                  {SUBTYPES.map(({ key, label, color }) => {
                    const off = hideUpdates || hiddenSubtypes.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`wk-chip${off ? ' wk-chip--off' : ''}`}
                        style={{ '--c': color }}
                        aria-pressed={!off}
                        disabled={hideUpdates}
                        onClick={() => toggle(setHiddenSubtypes, key)}
                      >
                        <i className="wk-chip__dot" /> {label} <span className="wk-chip__n">{subtypeCounts[key]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="wk-filters__col wk-filters__col--status">
                  <button
                    type="button"
                    className={`wk-chip wk-chip--main${hideStatusChanges ? ' wk-chip--off' : ''}`}
                    aria-pressed={!hideStatusChanges}
                    onClick={() => setHideStatusChanges(v => !v)}
                  >
                    <i className="wk-chip__dot" /> Status Changes
                  </button>
                  <div className="wk-filters__statuses">
                    {statuses.map(([name, count]) => {
                      const off = hideStatusChanges || hiddenStatuses.has(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`wk-chip wk-chip--status${off ? ' wk-chip--off' : ''}`}
                          style={{ '--c': statusColor(name) }}
                          aria-pressed={!off}
                          disabled={hideStatusChanges}
                          onClick={() => toggle(setHiddenStatuses, name)}
                        >
                          <i className="wk-chip__dot" /> {name} <span className="wk-chip__n">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {events.length === 0 ? (
                <div className="atl-state">Everything is filtered out. Click a filter above to show it again.</div>
              ) : (
              <div className="atl-scroll" ref={scrollRef}>
                <ol className="wk-timeline">
                  {weeks.map(w => (
                    <li key={w.key} className="wk-col">
                      <span className="wk-label">{weekLabel(w.start)}</span>
                      <span className="wk-node" />
                      <ul className="wk-stack">
                        {w.events.length === 0 && <li className="wk-empty">No activity</li>}
                        {w.events.map(e => {
                          const open = expanded.has(e.key);
                          return (
                            <li
                              key={e.key}
                              className={`tl-card wk-card${open ? ' wk-card--open' : ''}`}
                              style={{ '--c': eventColor(e) }}
                              role="button"
                              tabIndex={0}
                              aria-expanded={open}
                              onClick={() => toggleCard(e.key)}
                              onKeyDown={ev => {
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                  ev.preventDefault();
                                  toggleCard(e.key);
                                }
                              }}
                            >
                              <div className="wk-card__top">
                                <span className="wk-card__dot" />
                                <span className="wk-card__time">{formatDate(e.time)}</span>
                                {e.subtype === 'decision' && <span className="wk-card__badge">Decision</span>}
                              </div>
                              <div className="tl-item">{e.item ?? '—'}</div>
                              <div className="tl-text">
                                {e.kind === 'update' && !open ? firstWords(e.text) : e.text}
                              </div>
                              {e.who && <div className="tl-who">{e.who}</div>}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ol>
              </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
