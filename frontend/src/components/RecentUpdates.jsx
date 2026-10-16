import { useState } from 'react';
import './RecentUpdates.css';
import { flattenComments } from './ActivityTimeline';
import { DECISION_COLOR } from './statusGroups';

// Recent Updates: the 10 newest comment updates (replies count as their own entries),
// with Comments / Decisions filter chips. A comment containing #decision is a Decision.
// Props: updates = the `updates` array returned by GET /api/monday/project/activity

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

export default function RecentUpdates({ updates }) {
  const [hidden, setHidden] = useState(() => new Set());
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

  // Comment updates and their replies, newest first, after filtering.
  const latest = all.filter(c => !hidden.has(c.subtype)).slice(0, 10);

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
      {latest.length === 0 && <p className="ru-updates__empty">Everything is filtered out.</p>}
      <ul className="ru-updates__list">
        {latest.map(c => (
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
    </section>
  );
}
