import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import './BettStuff.css';

const STORAGE_KEY = 'phonexplorer-bett-stuff-v1';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SPORTSBOOKS = ['Draft Kings', 'BetMGM', 'Fanatics', 'Kalshi', 'theScore'];

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

function makeRow() {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: '', image: null, bet: '', toWin: '', sportsbook: '' };
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
  const bet = parseFloat(row.bet);
  const toWin = parseFloat(row.toWin);
  const hasProfit = !Number.isNaN(bet) && !Number.isNaN(toWin);
  const profit = hasProfit ? toWin - bet : '';

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
  };

  const handleField = (dateKey, rowId, field, value) => {
    updateEntries(dateKey, (rows) => rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
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
    </div>
  );
}

export default BettStuff;
