import { useEffect, useRef, useState } from 'react';
import '../pages/BettStuff.css';

// Multi-select chip filter shared by the picks and stats pages (tags, and the
// stats page's Sport / When / Type). The button
// summarises the selection ("All Tags", one tag, or "lock +2"); tapping it
// opens a scrollable chip list where tags toggle on and off and the list
// stays open, so several can be picked in a row.
function BettTagFilter({ tags, selected, onChange, allLabel = 'All Tags', formatLabel = (v) => v }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const toggle = (tag) => {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  };

  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? formatLabel(selected[0])
        : `${formatLabel(selected[0])} +${selected.length - 1}`;

  return (
    <div className="bett-tag-filter" ref={wrapRef}>
      <button type="button" className="bett-select-input bett-tag-filter-btn" onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="bett-tags-chips bett-tag-filter-panel">
          <button
            type="button"
            className={`bett-tag-chip${selected.length === 0 ? ' bett-tag-chip-on' : ''}`}
            onClick={() => onChange([])}
          >
            {allLabel}
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`bett-tag-chip${selected.includes(tag) ? ' bett-tag-chip-on' : ''}`}
              onClick={() => toggle(tag)}
            >
              {formatLabel(tag)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default BettTagFilter;
