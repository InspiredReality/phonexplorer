import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import './BetsPage.css';

const WEEK_COUNT = 15;
const STORAGE_KEY = 'phonexplorer-bets-tracker-v2';

// Logo files live in public/team-logos/<id>.png — replace any of them in
// place (same filename) to swap in a better version later.
const TEAMS = [
  { id: 'octagone', name: 'Octagone' },
  { id: 'otoshi-nakamoto', name: 'O₿toshi Nakamoto' },
  { id: 'front-gate-dragon', name: 'Front Gate Dragon' },
  { id: 'ceedeez-chocolate-ballz', name: 'CeeDeez Chocolate Ballz' },
  { id: 'michaels-neat-team', name: "Michael's Neat Team" },
  { id: 'last-dart', name: 'Last Dart' },
  { id: 'creed', name: 'Creed' },
  { id: 'king-of-the-north', name: 'King Of The North' },
  { id: 'lord-of-lakengren', name: 'Lord of Lakengren' },
  { id: 'sportins-squad', name: 'Sportins Squad' },
].map((team) => ({ ...team, logo: `/team-logos/${team.id}.png` }));

const WEEKS = Array.from({ length: WEEK_COUNT }, (_, i) => `week${i + 1}`);

const STATUS_CYCLE = ['pending', 'won', 'loss'];
const STATUS_CONFIG = {
  pending: { symbol: '?', label: 'Pending', className: 'bets-status--pending' },
  won: { symbol: '✅', label: 'Won', className: 'bets-status--won' },
  loss: { symbol: '✕', label: 'Loss', className: 'bets-status--loss' },
};

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
    // e.g. private browsing / storage quota — entry stays in memory only
  }
}

// Older saved data stored just the pick text as a plain string; normalize
// both that and the current { pick, status } shape into one object so the
// rest of the page never has to care which one it's looking at.
function normalizeCell(raw) {
  if (typeof raw === 'string') return { pick: raw, status: 'pending' };
  if (raw && typeof raw === 'object') return { pick: raw.pick ?? '', status: raw.status ?? 'pending' };
  return { pick: '', status: 'pending' };
}

function BetsPage() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(() =>
    Object.fromEntries(WEEKS.map((weekId) => [weekId, false]))
  );
  const [entries, setEntries] = useState(loadEntries);

  const handleAccordionChange = (weekId) => (_event, isExpanded) => {
    setExpanded((prev) => ({ ...prev, [weekId]: isExpanded }));
  };

  const handlePickChange = (weekId, teamId) => (event) => {
    const value = event.target.value;
    setEntries((prev) => {
      const cell = normalizeCell(prev[weekId]?.[teamId]);
      const next = {
        ...prev,
        [weekId]: { ...prev[weekId], [teamId]: { ...cell, pick: value } },
      };
      persistEntries(next);
      return next;
    });
  };

  const handleStatusCycle = (weekId, teamId) => () => {
    setEntries((prev) => {
      const cell = normalizeCell(prev[weekId]?.[teamId]);
      const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cell.status) + 1) % STATUS_CYCLE.length];
      const next = {
        ...prev,
        [weekId]: { ...prev[weekId], [teamId]: { ...cell, status: nextStatus } },
      };
      persistEntries(next);
      return next;
    });
  };

  return (
    <div className="bets-page">
      <button className="bets-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="bets-heading">Bets</h1>

      <div className="bets-accordions">
        {WEEKS.map((weekId, weekIdx) => (
          <Accordion
            key={weekId}
            expanded={!!expanded[weekId]}
            onChange={handleAccordionChange(weekId)}
            disableGutters
            sx={{
              bgcolor: '#111122',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary
              expandIcon={<span className="bets-expand-icon">▾</span>}
              sx={{
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.06)' },
                '.MuiAccordionSummary-content': { margin: '12px 0' },
              }}
            >
              <span className="bets-summary-label">Week {weekIdx + 1}</span>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <table className="bets-table">
                <tbody>
                  {TEAMS.map((team) => {
                    const cell = normalizeCell(entries[weekId]?.[team.id]);
                    const status = STATUS_CONFIG[cell.status];
                    return (
                      <tr key={team.id}>
                        <td className="bets-table-label">
                          <img
                            className="bets-team-logo"
                            src={team.logo}
                            alt=""
                            width={32}
                            height={32}
                            loading="lazy"
                          />
                          <span>{team.name}</span>
                        </td>
                        <td className="bets-table-input-cell">
                          <input
                            type="text"
                            className="bets-table-input"
                            value={cell.pick}
                            onChange={handlePickChange(weekId, team.id)}
                            placeholder="Enter pick..."
                          />
                        </td>
                        <td className="bets-table-status-cell">
                          <button
                            type="button"
                            className={`bets-status-btn ${status.className}`}
                            onClick={handleStatusCycle(weekId, team.id)}
                            title={`${status.label} — click to change`}
                            aria-label={`${team.name} status: ${status.label}. Click to change.`}
                          >
                            {status.symbol}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AccordionDetails>
          </Accordion>
        ))}
      </div>
    </div>
  );
}

export default BetsPage;
