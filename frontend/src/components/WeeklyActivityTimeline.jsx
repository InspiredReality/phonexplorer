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

export default function WeeklyActivityTimeline({
  updates, changes, loading, error, errorChanges, onRetry,
  title = 'Activity Timeline · By Week',
  emptyText = 'No updates or status changes in this period.',
}) {
  const events = buildEvents(updates, changes);
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
          {events.length === 0 ? (
            <div className="atl-state">{emptyText}</div>
          ) : (
            <>
              <div className="atl-legend">
                <span><i className="tl-dot tl-dot--update" /> Update</span>
                <span><i className="tl-dot tl-dot--status" /> Status change</span>
              </div>
              <div className="atl-scroll">
                <ol className="wk-timeline">
                  {weeks.map(w => (
                    <li key={w.key} className="wk-col">
                      <span className="wk-label">{weekLabel(w.start)}</span>
                      <span className="wk-node" />
                      <ul className="wk-stack">
                        {w.events.length === 0 && <li className="wk-empty">No activity</li>}
                        {w.events.map(e => (
                          <li key={e.key} className={`tl-card wk-card wk-card--${e.kind}`} title={e.text}>
                            <div className="wk-card__top">
                              <span className={`tl-dot tl-dot--${e.kind} wk-card__dot`} />
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
            </>
          )}
        </>
      )}
    </section>
  );
}
