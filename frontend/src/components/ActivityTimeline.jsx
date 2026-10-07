import './ActivityTimeline.css';

// Posted updates + Activity-log status changes, merged into one time-ordered list.
// `updates` use Monday's update shape (created_at, creator, body, _item_name, _board);
// `changes` use the /status-changes shape (timestamp, item_name, from/to_status, user).

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim() || '(empty)';
}

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function firstWords(text, n = 8) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
}

function buildEvents(updates, changes) {
  const events = [];
  for (const u of updates ?? []) {
    events.push({
      key: `u-${u.id}`,
      kind: 'update',
      time: u.created_at,
      item: u._item_name,
      who: u.creator?.name,
      text: stripHtml(u.body),
    });
  }
  for (const c of changes ?? []) {
    events.push({
      key: `c-${c.id}`,
      kind: 'status',
      time: c.timestamp,
      item: c.item_name,
      who: c.user,
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
