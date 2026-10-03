import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import BettSummaryBar from '../components/BettSummaryBar';
import {
  collectKnownTags,
  computeProfit,
  currentBettingWeekDays,
  dateKeyInfo,
  deleteBetFromApi,
  loadEntries,
  loadExtraDays,
  persistEntries,
  reconcileEntriesWithApi,
  saveBetToApi,
  saveExtraDays,
  todayDateKey,
} from './bettStuffData';
import './BettStuff.css';

const SPORTSBOOKS = ['Draft Kings', 'BetMGM', 'Fanatics', 'Kalshi', 'theScore'];
// Cycles Live -> Win -> Loss -> Live each time the result toggle is clicked.
const NEXT_RESULT = { live: 'win', win: 'loss', loss: 'live' };
const RESULT_LABEL = { live: 'Live', win: 'Win', loss: 'Loss' };

// Saves a row's full state to the database on every edit, regardless of
// status or result — the database is the source of truth on load, so
// anything not yet written there wouldn't survive opening the app
// elsewhere. Fire-and-forget: local state (and its localStorage cache)
// already has the change, so a dropped request here just means a slightly
// stale copy on the server until the next edit retries it.
function syncSettlement(dateKey, row) {
  saveBetToApi(dateKey, row).catch((err) => console.error('Failed to save bet:', err));
}

function makeRow() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: '',
    notes: '',
    image: null,
    bet: '',
    toWin: '',
    sportsbook: '',
    tags: '',
    status: 'open',
    result: 'live',
  };
}

function ImageCell({ row, onChange, onPreview }) {
  const inputRef = useRef(null);
  return (
    <div className="bett-cell bett-cell-image">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="bett-image-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file);
          e.target.value = '';
        }}
      />
      {row.image ? (
        <div className="bett-image-wrap">
          <button type="button" className="bett-image-preview-btn" onClick={() => onPreview(row.image)}>
            <img src={row.image} alt="" className="bett-image-full" />
          </button>
          <button type="button" className="bett-image-replace-btn" onClick={() => inputRef.current?.click()}>
            Replace
          </button>
        </div>
      ) : (
        <button type="button" className="bett-image-upload-btn" onClick={() => inputRef.current?.click()}>
          + Add Photo
        </button>
      )}
    </div>
  );
}

// A newly added day before its date has been set. The date input is a
// one-time affair: once a valid date is picked the draft graduates into a
// normal accordion and this component unmounts. Typing the wrong date has
// no separate "edit" path — cancel this draft (or delete the day once it's
// been created) and add a fresh one instead. Defaults to today but isn't
// capped at it — future days are allowed, e.g. logging Sunday's NFL slate
// the day before.
function DraftDayRow({ defaultDate, onConfirm, onCancel }) {
  const [value, setValue] = useState(defaultDate);

  return (
    <div className="bett-draft-day">
      <input
        type="date"
        className="bett-day-date-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className="bett-day-confirm-btn"
        disabled={!value}
        onClick={() => value && onConfirm(value)}
      >
        Add
      </button>
      <button type="button" className="bett-day-remove" onClick={onCancel} aria-label="Cancel new day">
        ×
      </button>
    </div>
  );
}

function BetRow({ row, onField, onImageChange, onPreview, onRemove }) {
  const computedProfit = computeProfit(row);
  const profit = computedProfit ?? '';

  return (
    <div className="bett-row">
      <button type="button" className="bett-row-remove" onClick={onRemove} title="Remove row" aria-label="Remove row">
        ×
      </button>
      <div className="bett-cell bett-cell-text">
        <span className="bett-cell-label">Pick</span>
        <input
          type="text"
          className="bett-text-input"
          placeholder="Bet description…"
          value={row.text}
          onChange={(e) => onField('text', e.target.value)}
        />
      </div>
      <ImageCell row={row} onChange={onImageChange} onPreview={onPreview} />
      <div className="bett-fields-row">
        <div className="bett-cell bett-cell-bet">
          <span className="bett-cell-label">Bet</span>
          <input
            type="number"
            inputMode="decimal"
            className="bett-number-input"
            placeholder="$0"
            value={row.bet}
            onChange={(e) => onField('bet', e.target.value)}
          />
        </div>
        <div className="bett-cell bett-cell-towin">
          <span className="bett-cell-label">To Win</span>
          <input
            type="number"
            inputMode="decimal"
            className="bett-number-input"
            placeholder="$0"
            value={row.toWin}
            onChange={(e) => onField('toWin', e.target.value)}
          />
        </div>
        <div className="bett-cell bett-cell-profit">
          <span className="bett-cell-label">Profit</span>
          <input
            type="number"
            className="bett-number-input"
            placeholder="$0"
            value={profit}
            disabled
            readOnly
          />
        </div>
      </div>
      <div className="bett-cell bett-cell-notes">
        <span className="bett-cell-label">Notes</span>
        <input
          type="text"
          className="bett-text-input"
          placeholder="Notes…"
          value={row.notes}
          onChange={(e) => onField('notes', e.target.value)}
        />
      </div>
      <div className="bett-sportsbook-tags-row">
        <div className="bett-cell bett-cell-sportsbook">
          <span className="bett-cell-label">Sportsbook</span>
          <select
            className="bett-select-input"
            value={row.sportsbook}
            onChange={(e) => onField('sportsbook', e.target.value)}
          >
            <option value="">Select…</option>
            {SPORTSBOOKS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="bett-cell bett-cell-tags">
          <span className="bett-cell-label">Tags</span>
          <input
            type="text"
            className="bett-text-input"
            list="bett-known-tags"
            placeholder="e.g. parlay, primetime"
            value={row.tags}
            onChange={(e) => onField('tags', e.target.value)}
          />
        </div>
      </div>
      <div className="bett-toggle-row">
        <button
          type="button"
          className={`bett-toggle-btn bett-toggle-status bett-toggle-status-${row.status}`}
          onClick={() => onField('status', row.status === 'open' ? 'closed' : 'open')}
        >
          {row.status === 'open' ? 'Open' : 'Closed'}
        </button>
        <button
          type="button"
          className={`bett-toggle-btn bett-toggle-result bett-toggle-result-${row.result}`}
          onClick={() => onField('result', NEXT_RESULT[row.result] || 'live')}
        >
          {RESULT_LABEL[row.result] || 'Live'}
        </button>
      </div>
    </div>
  );
}

function BettStuff() {
  const navigate = useNavigate();
  // The bottom summary bar's "Week" total follows the stats page's
  // Tuesday-through-Monday week, independent of which day accordions are
  // showing above it.
  const [summaryDays] = useState(currentBettingWeekDays);
  // Local storage hydrates the very first paint; the database fetch below
  // then overwrites it as the source of truth (and refreshes the cache),
  // so a different browser sees the same bets instead of starting empty.
  const [entries, setEntries] = useState(loadEntries);
  const [extraDays, setExtraDaysState] = useState(loadExtraDays);
  const [drafts, setDrafts] = useState([]);
  const [expanded, setExpanded] = useState(() => ({ [todayDateKey()]: true }));
  const [previewImage, setPreviewImage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Anything only in this browser's local cache (e.g. bets logged before
    // database sync existed here) gets pushed up as part of this call, so
    // it isn't lost once the database becomes the source of truth.
    reconcileEntriesWithApi(loadEntries())
      .then((merged) => {
        if (cancelled) return;
        setEntries(merged);
        persistEntries(merged);
      })
      .catch((err) => console.error('Failed to load bets from database, using local cache:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const rowsFor = (dateKey) => entries[dateKey] || [];
  const knownTags = collectKnownTags(entries);

  const setExtraDays = (updater) => {
    setExtraDaysState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveExtraDays(next);
      return next;
    });
  };

  // What actually shows as an accordion: today, any day that already has a
  // bet logged, and any day manually added via "+ Add Day" — including
  // future days added on purpose (e.g. Sunday's slate logged on Saturday) —
  // newest first.
  const todayKey = todayDateKey();
  const visibleDateKeys = Array.from(
    new Set([
      todayKey,
      ...extraDays,
      ...Object.keys(entries).filter((k) => (entries[k] || []).length > 0),
    ])
  )
    .sort()
    .reverse();

  // Always derives the next rows from the latest state (not a closed-over
  // snapshot), so rapid clicks/edits in the same tick don't clobber each other.
  const updateEntries = (dateKey, updateRows) => {
    setEntries((prev) => {
      const rows = updateRows(prev[dateKey] || []);
      const next = { ...prev, [dateKey]: rows };
      persistEntries(next);
      return next;
    });
  };

  const handleAddRow = (dateKey) => {
    updateEntries(dateKey, (rows) => [makeRow(), ...rows]);
  };

  const handleRemoveRow = (dateKey, rowId) => {
    updateEntries(dateKey, (rows) => rows.filter((r) => r.id !== rowId));
    deleteBetFromApi(rowId).catch((err) => console.error('Failed to clear bet:', err));
  };

  const handleField = (dateKey, rowId, field, value) => {
    updateEntries(dateKey, (rows) => rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
    const current = rowsFor(dateKey).find((r) => r.id === rowId);
    if (current) syncSettlement(dateKey, { ...current, [field]: value });
  };

  const handleImageChange = (dateKey, rowId, file) => {
    const reader = new FileReader();
    reader.onload = () => {
      handleField(dateKey, rowId, 'image', reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleAccordionChange = (dateKey) => (_event, isExpanded) => {
    setExpanded((prev) => ({ ...prev, [dateKey]: isExpanded }));
  };

  const handleAddDraftDay = () => {
    setDrafts((prev) => [{ id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, ...prev]);
  };

  const handleCancelDraftDay = (draftId) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleConfirmDraftDay = (draftId, dateKey) => {
    setExtraDays((prev) => (prev.includes(dateKey) ? prev : [...prev, dateKey]));
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    setExpanded((prev) => ({ ...prev, [dateKey]: true }));
  };

  // Only ever called for a day with zero bets (the button itself doesn't
  // render otherwise) — there's nothing to lose, so no confirmation or API
  // delete is needed. Lets a day added with the wrong date be thrown out
  // before anything's entered under it.
  const handleRemoveEmptyDay = (dateKey) => {
    setExtraDays((prev) => prev.filter((k) => k !== dateKey));
  };

  return (
    <div className="bett-page">
      <button className="bett-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="bett-heading">Bett Stuff</h1>

      <datalist id="bett-known-tags">
        {knownTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      <div className="bett-add-day-row">
        <button type="button" className="bett-add-day-btn" onClick={handleAddDraftDay}>
          + Add Day
        </button>
      </div>

      <div className="bett-accordions">
        {drafts.map((draft) => (
          <DraftDayRow
            key={draft.id}
            defaultDate={todayKey}
            onConfirm={(dateKey) => handleConfirmDraftDay(draft.id, dateKey)}
            onCancel={() => handleCancelDraftDay(draft.id)}
          />
        ))}
        {visibleDateKeys.map((dateKey) => {
          const { dayName, dateLabel, isToday } = dateKeyInfo(dateKey);
          const rows = rowsFor(dateKey);
          return (
            <Accordion
              key={dateKey}
              expanded={!!expanded[dateKey]}
              onChange={handleAccordionChange(dateKey)}
              disableGutters
              sx={{
                bgcolor: '#111122',
                color: '#ffffff',
                border: isToday ? '1px solid rgba(234, 179, 8, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary
                expandIcon={<span className="bett-expand-icon">▾</span>}
                sx={{
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.06)' },
                  '.MuiAccordionSummary-content': {
                    margin: '12px 0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  },
                }}
              >
                <span className="bett-summary-label">
                  <span className="bett-day-label-main">{dayName}</span>
                  <span className="bett-day-label-date">({dateLabel})</span>
                </span>
                <span className="bett-accordion-trailing">
                  {rows.length > 0 && <span className="bett-row-count">{rows.length} bet{rows.length === 1 ? '' : 's'}</span>}
                  {rows.length === 0 && (
                    <button
                      type="button"
                      className="bett-day-remove"
                      aria-label="Delete this empty day"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveEmptyDay(dateKey);
                      }}
                    >
                      ×
                    </button>
                  )}
                </span>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0, borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
                <button type="button" className="bett-add-row-btn" onClick={() => handleAddRow(dateKey)}>
                  + Add Row
                </button>
                <div className="bett-rows">
                  {rows.length === 0 && <p className="bett-status-text">No bets logged yet.</p>}
                  {rows.map((row) => (
                    <BetRow
                      key={row.id}
                      row={row}
                      onField={(field, value) => handleField(dateKey, row.id, field, value)}
                      onImageChange={(file) => handleImageChange(dateKey, row.id, file)}
                      onPreview={setPreviewImage}
                      onRemove={() => handleRemoveRow(dateKey, row.id)}
                    />
                  ))}
                </div>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </div>

      {previewImage && (
        <div className="bett-lightbox" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} alt="" className="bett-lightbox-img" />
        </div>
      )}

      <BettSummaryBar days={summaryDays} entries={entries} activePage="picks" />
    </div>
  );
}

export default BettStuff;
