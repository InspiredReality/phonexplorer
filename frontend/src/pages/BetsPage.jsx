import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import './BetsPage.css';

const WEEK_COUNT = 10;
const LEG_COUNT = 10;
const STORAGE_KEY = 'phonexplorer-bets-tracker-v1';

const WEEKS = Array.from({ length: WEEK_COUNT }, (_, i) => `week${i + 1}`);
const LEGS = Array.from({ length: LEG_COUNT }, (_, i) => `leg${i + 1}`);

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
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

  const handleLegChange = (weekId, legId) => (event) => {
    const value = event.target.value;
    setEntries((prev) => {
      const next = { ...prev, [weekId]: { ...prev[weekId], [legId]: value } };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // e.g. private browsing / storage quota — entry stays in memory only
      }
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
                  {LEGS.map((legId, legIdx) => (
                    <tr key={legId}>
                      <td className="bets-table-label">Leg {legIdx + 1}</td>
                      <td className="bets-table-input-cell">
                        <input
                          type="text"
                          className="bets-table-input"
                          value={entries[weekId]?.[legId] ?? ''}
                          onChange={handleLegChange(weekId, legId)}
                          placeholder="Enter pick..."
                        />
                      </td>
                    </tr>
                  ))}
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
