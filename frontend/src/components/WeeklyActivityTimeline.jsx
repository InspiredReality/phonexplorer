import { useState } from 'react';
import './ActivityTimeline.css';
import './WeeklyActivityTimeline.css';
import { buildEvents, firstWords, formatDate } from './ActivityTimeline';

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

const UPDATE_COLOR = '#f6287e';
const DEFAULT_STATUS_COLOR = '#579bfc';

// Done / Deferred read as resolved (green), Pending Customer as waiting (yellow).
function statusColor(status) {
  const s = (status || '').trim().toLowerCase();
  if (s === 'done' || s === 'deferred') return '#00c875';
  if (s === 'pending customer') return '#f5c542';
  return DEFAULT_STATUS_COLOR;
}

function eventColor(e) {
  return e.kind === 'update' ? UPDATE_COLOR : statusColor(e.status);
}

export default function WeeklyActivityTimeline({
  updates, changes, loading, error, errorChanges, onRetry,
  title = 'Activity Timeline · By Week',
  emptyText = 'No updates or status changes in this period.',
}) {
  const allEvents = buildEvents(updates, changes);

  // Filters: click a legend chip to hide / show that kind of event.
  const [hideUpdates, setHideUpdates] = useState(false);
  const [hideStatusChanges, setHideStatusChanges] = useState(false);
  const [hiddenStatuses, setHiddenStatuses] = useState(() => new Set());

  // Distinct new-status values among status changes, most common first.
  const statusCounts = new Map();
  for (const e of allEvents) {
    if (e.kind === 'status') {
      const key = e.status ?? '—';
      statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    }
  }
  const statuses = [...statusCounts.entries()].sort((a, b) => b[1] - a[1]);

  function toggleStatus(name) {
    setHiddenStatuses(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const events = allEvents.filter(e => {
    if (e.kind === 'update') return !hideUpdates;
    return !hideStatusChanges && !hiddenStatuses.has(e.status ?? '—');
  });
  const weeks = groupByWeek(events);

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
                <button
                  type="button"
                  className={`wk-chip${hideUpdates ? ' wk-chip--off' : ''}`}
                  style={{ '--c': UPDATE_COLOR }}
                  aria-pressed={!hideUpdates}
                  onClick={() => setHideUpdates(v => !v)}
                >
                  <i className="wk-chip__dot" /> Update
                </button>
                <button
                  type="button"
                  className={`wk-chip${hideStatusChanges ? ' wk-chip--off' : ''}`}
                  style={{ '--c': DEFAULT_STATUS_COLOR }}
                  aria-pressed={!hideStatusChanges}
                  onClick={() => setHideStatusChanges(v => !v)}
                >
                  <i className="wk-chip__dot" /> Status change
                </button>
                {statuses.length > 0 && (
                  <span className="wk-filters__sep" aria-hidden="true">|</span>
                )}
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
                      onClick={() => toggleStatus(name)}
                    >
                      <i className="wk-chip__dot" /> {name} <span className="wk-chip__n">{count}</span>
                    </button>
                  );
                })}
              </div>
              {events.length === 0 ? (
                <div className="atl-state">Everything is filtered out. Click a filter above to show it again.</div>
              ) : (
              <div className="atl-scroll">
                <ol className="wk-timeline">
                  {weeks.map(w => (
                    <li key={w.key} className="wk-col">
                      <span className="wk-label">{weekLabel(w.start)}</span>
                      <span className="wk-node" />
                      <ul className="wk-stack">
                        {w.events.length === 0 && <li className="wk-empty">No activity</li>}
                        {w.events.map(e => (
                          <li
                            key={e.key}
                            className="tl-card wk-card"
                            style={{ '--c': eventColor(e) }}
                            title={`${e.item ?? ''}: ${e.text}`}
                          >
                            <div className="wk-card__top">
                              <span className="wk-card__dot" />
                              <span className="wk-card__time">{formatDate(e.time)}</span>
                            </div>
                            <div className="tl-item">{e.item ?? '—'}</div>
                            <div className="tl-text">
                              {e.kind === 'update' ? firstWords(e.text) : e.text}
                            </div>
                            {e.who && <div className="tl-who">{e.who}</div>}
                          </li>
                        ))}
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
