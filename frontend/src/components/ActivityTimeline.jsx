import { useEffect, useRef } from 'react';
import './ActivityTimeline.css';

// Posted updates + Activity-log status changes, merged into one time-ordered list.
// `updates` use Monday's update shape (created_at, creator, body, _item_name, _board);
// `changes` use the /status-changes shape (timestamp, item_name, from/to_status, user).

// Monday update bodies are HTML: keep paragraph breaks, drop tags, decode entities (&amp; etc).
export function htmlToText(html) {
  if (!html) return '';
  const stripped = html.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]*>/g, '');
  const box = document.createElement('textarea');
  box.innerHTML = stripped;
  return box.value.trim() || '(empty)';
}

// Every comment update AND each reply to one, as flat entries (replies carry
// their parent's item). `updates` use Monday's update shape.
export function flattenComments(updates) {
  const out = [];
  for (const u of updates ?? []) {
    out.push({
      key: `u-${u.id}`, time: u.created_at, item: u._item_name,
      who: u.creator?.name, text: htmlToText(u.body), isReply: false,
      subtype: commentSubtype(htmlToText(u.body)),
    });
    for (const r of u.replies ?? []) {
      out.push({
        key: `r-${r.id}`, time: r.created_at, item: u._item_name,
        who: r.creator?.name, text: htmlToText(r.body), isReply: true,
        subtype: commentSubtype(htmlToText(r.body)),
      });
    }
  }
  return out;
}

// A Monday update or reply containing the hashtag #decision is a Decision; the rest are Comments.
export function commentSubtype(text) {
  return /#decision\b/i.test(text || '') ? 'decision' : 'comment';
}

// Keep a horizontally scrolling element scrolled to its right edge (today) whenever `dep` changes.
export function useScrollToEnd(ref, dep) {
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [ref, dep]);
}

export function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function firstWords(text, n = 8) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
}

export function buildEvents(updates, changes) {
  const events = [];
  for (const c of flattenComments(updates)) {
    events.push({
      key: c.key,
      kind: 'update',
      time: c.time,
      item: c.item,
      who: c.who && c.isReply ? `${c.who} · reply` : c.who,
      text: c.text,
      subtype: c.subtype,
    });
  }
  for (const c of changes ?? []) {
    events.push({
      key: `c-${c.id}`,
      kind: 'status',
      time: c.timestamp,
      item: c.item_name,
      who: c.user,
      status: c.to_status ?? null,
      text: `${c.from_status ?? '—'} → ${c.to_status ?? '—'}`,
    });
  }
  return events
    .filter(e => e.time && !Number.isNaN(new Date(e.time).getTime()))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
}

export default function ActivityTimeline({
  updates, changes, loading, error, errorChanges, onRetry,
  title = 'Activity Timeline',
  emptyText = 'No updates or status changes in this period.',
}) {
  const events = buildEvents(updates, changes);
  const scrollRef = useRef(null);
  useScrollToEnd(scrollRef, `${loading}-${events.length}`);

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
                <span><i className="tl-dot tl-dot--update" /> Comment Update</span>
                <span><i className="tl-dot tl-dot--status" /> Status change</span>
              </div>
              <div className="atl-scroll" ref={scrollRef}>
                <ol className="timeline">
                  {events.map(e => (
                    <li key={e.key} className={`tl-event tl-event--${e.kind}`}>
                      <span className="tl-time">{formatDate(e.time)}</span>
                      <span className={`tl-dot tl-dot--${e.kind}`} />
                      <div className="tl-card" title={e.text}>
                        <div className="tl-item">{e.item ?? '—'}</div>
                        <div className="tl-text">
                          {e.kind === 'update' ? firstWords(e.text) : e.text}
                        </div>
                        {e.who && <div className="tl-who">{e.who}</div>}
                      </div>
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
