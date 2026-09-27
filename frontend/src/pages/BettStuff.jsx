import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import api from '../services/api';
import './BettStuff.css';

const STORAGE_KEY = 'phonexplorer-bett-stuff-v1';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SPORTSBOOKS = ['Draft Kings', 'BetMGM', 'Fanatics', 'Kalshi', 'theScore'];
// Cycles Live -> Win -> Loss -> Live each time the result toggle is clicked.
const NEXT_RESULT = { live: 'win', win: 'loss', loss: 'live' };
const RESULT_LABEL = { live: 'Live', win: 'Win', loss: 'Loss' };

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(d) {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

// Sunday-through-Saturday of the current (local) week, each with its own
// calendar date so entries persist under the actual day, not just its name.
function currentWeekDays() {
  const today = new Date();
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
    return { dateKey: toDateKey(d), dayName: DAY_NAMES[i], dateLabel: formatDateLabel(d), isToday: toDateKey(d) === toDateKey(today) };
  });
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistEntries(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // e.g. private browsing / storage quota — used only as a local store
  }
}

function computeProfit(row) {
  const bet = parseFloat(row.bet);
  const toWin = parseFloat(row.toWin);
  return Number.isNaN(bet) || Number.isNaN(toWin) ? null : toWin - bet;
}

// A row is only worth a database record once it's fully settled — still
// Live means the outcome isn't known yet, so there's nothing to save.
function isSettled(row) {
  return row.status === 'closed' && row.result !== 'live';
}

// The Day/Week totals count every Win or Loss row regardless of whether
// it's still Open or already Closed — only Live (outcome unknown) is
// excluded. A win nets To Win minus Bet; a loss nets the Bet amount lost.
function resultProfit(row) {
  if (row.result === 'win') return computeProfit(row) ?? 0;
  if (row.result === 'loss') return -(parseFloat(row.bet) || 0);
  return 0;
}

function sumProfit(rows) {
  return rows.reduce((total, row) => total + resultProfit(row), 0);
}

function formatMoney(amount) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function amountClass(amount) {
  if (amount > 0) return 'bett-summary-value-positive';
  if (amount < 0) return 'bett-summary-value-negative';
  return 'bett-summary-value-zero';
}

// Saves (or, once unsettled again, deletes) a row's settlement record.
// Fire-and-forget: a page reload always rebuilds this from the panel's own
// localStorage state, so a dropped request here just means a slightly
// stale copy on the server until the next edit retries it.
function syncSettlement(dateKey, row) {
  if (isSettled(row)) {
    const profit = computeProfit(row);
    api
      .put(`/api/bett-stuff/settlements/${row.id}`, {
        bet_date: dateKey,
        pick: row.text,
        image: row.image,
        bet_amount: parseFloat(row.bet) || 0,
        to_win: parseFloat(row.toWin) || 0,
        profit: profit ?? 0,
        sportsbook: row.sportsbook || null,
        status: row.status,
        result: row.result,
      })
      .catch((err) => console.error('Failed to save bet settlement:', err));
  } else {
    api.delete(`/api/bett-stuff/settlements/${row.id}`).catch((err) => {
      console.error('Failed to clear bet settlement:', err);
    });
  }
}

function makeRow() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: '',
    image: null,
    bet: '',
    toWin: '',
    sportsbook: '',
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
  const [days] = useState(currentWeekDays);
  const [entries, setEntries] = useState(loadEntries);
  const [expanded, setExpanded] = useState(() => {
    const today = days.find((d) => d.isToday);
    return today ? { [today.dateKey]: true } : {};
  });
  const [previewImage, setPreviewImage] = useState(null);

  const rowsFor = (dateKey) => entries[dateKey] || [];

  const todayKey = days.find((d) => d.isToday)?.dateKey;
  const dayProfit = sumProfit(rowsFor(todayKey));
  const weekProfit = sumProfit(days.flatMap((d) => rowsFor(d.dateKey)));

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
    updateEntries(dateKey, (rows) => [...rows, makeRow()]);
  };

  const handleRemoveRow = (dateKey, rowId) => {
    updateEntries(dateKey, (rows) => rows.filter((r) => r.id !== rowId));
    api.delete(`/api/bett-stuff/settlements/${rowId}`).catch((err) => {
      console.error('Failed to clear bet settlement:', err);
    });
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

  return (
    <div className="bett-page">
      <button className="bett-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="bett-heading">Bett Stuff</h1>

      <div className="bett-accordions">
        {days.map(({ dateKey, dayName, dateLabel, isToday }) => {
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
                {rows.length > 0 && <span className="bett-row-count">{rows.length} bet{rows.length === 1 ? '' : 's'}</span>}
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0, borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
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
                <button type="button" className="bett-add-row-btn" onClick={() => handleAddRow(dateKey)}>
                  + Add Row
                </button>
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

      <div className="bett-summary-bar">
        <div className="bett-summary-item">
          <span className="bett-summary-label-text">Day</span>
          <span className={`bett-summary-value ${amountClass(dayProfit)}`}>{formatMoney(dayProfit)}</span>
        </div>
        <div className="bett-summary-item">
          <span className="bett-summary-label-text">Week</span>
          <span className={`bett-summary-value ${amountClass(weekProfit)}`}>{formatMoney(weekProfit)}</span>
        </div>
      </div>
    </div>
  );
}

export default BettStuff;
