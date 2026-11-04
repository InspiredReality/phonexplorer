import { useEffect, useRef } from 'react';
import './ActivityTimeline.css';
import './GanttTimeline.css';
import { weekStart } from './ActivityTimeline';
import { STATUS_ORDER, statusColor, statusGroup } from './statusGroups';

// Gantt chart: every item with a Timeline set, one row each (grouped under the board's
// groups), weeks as columns like the Activity Timeline. Each item's band is coloured week
// by week with the status the task was in that week, rebuilt from the Activity log.
//
// Props:
//   groups  - `groups` from GET /api/monday/project (tasks carry `timeline`, `milestone`, `status`)
//   changes - status changes (oldest first) from GET /api/monday/project/status-history
//   historyLoading / historyError - state of that second request (without it, bands fall
//     back to each task's current status)

const DAY = 24 * 60 * 60 * 1000;
const MAX_WEEKS = 60;

const parseDay = iso => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d); // local midnight
};

const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export default function GanttTimeline({
  groups, changes, historyLoading, historyError,
  title = 'Timeline Gantt · By Week',
}) {
  const scrollRef = useRef(null);

  // Items with a Timeline, kept under their group (top-level tasks and milestones).
  const sections = (groups ?? [])
    .map(g => ({
      group: g,
      items: g.tasks
        .filter(t => t.timeline?.from)
        .map(t => ({
          id: String(t.id),
          name: t.name,
          milestone: !!t.milestone,
          status: t.status,
          from: parseDay(t.timeline.from),
          to: parseDay(t.timeline.to || t.timeline.from),
        }))
        .filter(i => !Number.isNaN(i.from.getTime()) && !Number.isNaN(i.to.getTime())),
    }))
    .filter(s => s.items.length > 0);
  const all = sections.flatMap(s => s.items);

  // Weeks from the earliest start to the latest end (always including this week).
  const thisWeek = weekStart(new Date());
  let first = thisWeek, last = thisWeek;
  for (const i of all) {
    const a = weekStart(i.from), b = weekStart(i.to);
    if (a < first) first = a;
    if (b > last) last = b;
  }
  const weeks = [];
  for (let d = new Date(first); d <= last && weeks.length < MAX_WEEKS; d.setDate(d.getDate() + 7)) {
    weeks.push(new Date(d));
  }

  // Status history per task, oldest change first.
  const history = new Map();
  for (const ch of changes ?? []) {
    const key = String(ch.item_id);
    if (!history.has(key)) history.set(key, []);
    history.get(key).push(ch);
  }
  for (const list of history.values()) list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // The status a task was in at the end of a given week. Current and future weeks use its
  // current status. Before the first known change, the status it changed away from.
  function statusAt(item, weekEnd) {
    if (weekEnd.getTime() > Date.now()) return item.status;
    const list = history.get(item.id) ?? [];
    let latest = null;
    for (const ch of list) {
      if (new Date(ch.timestamp) <= weekEnd) latest = ch; else break;
    }
    if (latest) return latest.to_status;
    if (list.length) return list[0].from_status ?? item.status;
    return item.status;
  }

  // Open with the current week roughly centred in the chart area.
  useEffect(() => {
    const sc = scrollRef.current;
    const now = sc?.querySelector('[data-now="true"]');
    if (!sc || !now) return;
    const name = sc.querySelector('.gt-name')?.getBoundingClientRect().width ?? 0;
    const rect = now.getBoundingClientRect();
    const left = rect.left - sc.getBoundingClientRect().left + sc.scrollLeft;
    sc.scrollLeft = Math.max(0, left - name - (sc.clientWidth - name) / 2 + rect.width / 2);
  }, [weeks.length, all.length]);

  const cols = { gridTemplateColumns: `var(--gt-name) repeat(${weeks.length}, var(--gt-week))` };

  function renderRow(item) {
    return (
      <div key={item.id} className="gt-row" style={cols}>
        <div className="gt-name gt-itemname" title={item.name}>
          {item.milestone && <span className="gt-diamond" />}
          <span className="gt-itemname__text">{item.name}</span>
        </div>
        {weeks.map(w => {
          const ws = w.getTime();
          const we = new Date(w); we.setDate(we.getDate() + 7);
          const startDay = Math.round((item.from - w) / DAY);   // day index within/outside this week
          const endDay = Math.round((item.to - w) / DAY) + 1;   // exclusive
          const lo = Math.max(startDay, 0), hi = Math.min(endDay, 7);
          const isNow = ws === thisWeek.getTime();
          if (lo >= hi) return <div key={ws} className={`gt-cell${isNow ? ' gt-cell--now' : ''}`} />;

          const weekEnd = new Date(we.getTime() - 1);
          const status = statusAt(item, weekEnd);
          const color = statusColor(statusGroup(status));
          const tip = `${item.name}: ${status ?? 'No status'} (week of ${shortDay.format(w)})`;
          return (
            <div key={ws} className={`gt-cell${isNow ? ' gt-cell--now' : ''}`}>
              {item.milestone ? (
                <span
                  className="gt-milestone"
                  style={{ left: `${((lo + 0.5) / 7) * 100}%`, background: color }}
                  title={tip}
                />
              ) : (
                <span
                  className={`gt-band${startDay >= 0 ? ' gt-band--start' : ''}${endDay <= 7 ? ' gt-band--end' : ''}`}
                  style={{ left: `${(lo / 7) * 100}%`, width: `${((hi - lo) / 7) * 100}%`, background: color }}
                  title={tip}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="atl-card">
      <div className="atl-header">
        <h2 className="atl-title">
          {title}
          <span className="atl-count">{all.length}</span>
        </h2>
      </div>

      {all.length === 0 ? (
        <div className="atl-state">No items with a Timeline set on this board.</div>
      ) : (
        <>
          {historyError && (
            <div className="atl-warn">
              Status history unavailable ({historyError}). Bands show each task's current status.
            </div>
          )}
          {historyLoading && <div className="atl-warn">Loading status history…</div>}
          <div className="gt-legend">
            {STATUS_ORDER.map(name => (
              <span key={name} className="gt-legend__item">
                <i className="gt-legend__swatch" style={{ background: statusColor(name) }} /> {name}
              </span>
            ))}
            <span className="gt-legend__item"><i className="gt-diamond" /> Milestone</span>
          </div>
          <div className="gt-scroll" ref={scrollRef}>
            <div className="gt-grid">
              <div className="gt-row gt-head" style={cols}>
                <div className="gt-name gt-head__name">Task</div>
                {weeks.map(w => {
                  const isNow = w.getTime() === thisWeek.getTime();
                  return (
                    <div
                      key={w.getTime()}
                      className={`gt-weeklabel${isNow ? ' gt-weeklabel--now' : ''}`}
                      data-now={isNow ? 'true' : undefined}
                    >
                      {shortDay.format(w)}{isNow ? ' · now' : ''}
                    </div>
                  );
                })}
              </div>
              {sections.map(({ group, items }) => (
                <div key={group.id} className="gt-section">
                  <div className="gt-row gt-grouprow" style={cols}>
                    <div className="gt-name gt-groupname" style={{ color: group.color || '#579bfc' }} title={group.title}>
                      {group.title}
                    </div>
                    {weeks.map(w => <div key={w.getTime()} className="gt-cell" />)}
                  </div>
                  {items.map(renderRow)}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
