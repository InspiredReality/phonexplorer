import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { amountClass, formatMoney, openBetTotal, sumProfit } from '../pages/bettStuffData';
import '../pages/BettStuff.css';

// Every Open row across every day, newest first — exactly what Table sums,
// so the drill-down list below matches the number dollar-for-dollar.
function openRows(entries) {
  return Object.entries(entries)
    .flatMap(([dateKey, rows]) => rows.filter((row) => row.status === 'open').map((row) => ({ ...row, dateKey })))
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));
}

// Always-visible footer shared by the picks page (Bett Stuff) and the
// stats page (Bett Stuff Stats): Table/Day/Week totals, plus a toggle
// button that swaps between the two pages.
function BettSummaryBar({ days, entries, activePage }) {
  const navigate = useNavigate();
  const [showOpenBets, setShowOpenBets] = useState(false);
  const rowsFor = (dateKey) => entries[dateKey] || [];
  const todayKey = days.find((d) => d.isToday)?.dateKey;
  const tableTotal = openBetTotal(entries);
  const dayProfit = sumProfit(rowsFor(todayKey));
  const weekProfit = sumProfit(days.flatMap((d) => rowsFor(d.dateKey)));

  const isStats = activePage === 'stats';
  const toggleLabel = isStats ? 'Bett' : 'Stuff';
  const togglePath = isStats ? '/bett-stuff' : '/bett-stuff-stats';
  const openBetRows = showOpenBets ? openRows(entries) : [];

  return (
    <>
      <div className="bett-summary-bar">
        <div className="bett-summary-stats">
          <button type="button" className="bett-summary-item bett-summary-item-button" onClick={() => setShowOpenBets(true)}>
            <span className="bett-summary-label-text">Table</span>
            <span className="bett-summary-value">{formatMoney(tableTotal)}</span>
          </button>
          <div className="bett-summary-item">
            <span className="bett-summary-label-text">Day</span>
            <span className={`bett-summary-value ${amountClass(dayProfit)}`}>{formatMoney(dayProfit)}</span>
          </div>
          <div className="bett-summary-item">
            <span className="bett-summary-label-text">Week</span>
            <span className={`bett-summary-value ${amountClass(weekProfit)}`}>{formatMoney(weekProfit)}</span>
          </div>
        </div>
        <button type="button" className="bett-summary-toggle-btn" onClick={() => navigate(togglePath)}>
          {toggleLabel}
        </button>
      </div>

      {showOpenBets && (
        <div className="bett-lightbox" onClick={() => setShowOpenBets(false)}>
          <div className="bett-open-bets-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bett-open-bets-header">
              <h2 className="bett-open-bets-title">Open Bets — {formatMoney(tableTotal)}</h2>
              <button
                type="button"
                className="bett-day-remove"
                aria-label="Close"
                onClick={() => setShowOpenBets(false)}
              >
                ×
              </button>
            </div>
            <div className="bett-open-bets-list">
              {openBetRows.map((row) => (
                <div key={row.id} className="bett-open-bet-item">
                  <span className="bett-open-bet-date">{row.dateKey}</span>
                  <span className="bett-open-bet-pick">{row.text || '(no pick text)'}</span>
                  {row.sportsbook && <span className="bett-open-bet-sportsbook">{row.sportsbook}</span>}
                  <span className="bett-open-bet-amount">{formatMoney(parseFloat(row.bet) || 0)}</span>
                </div>
              ))}
              {openBetRows.length === 0 && <p className="bett-status-text">No open bets.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BettSummaryBar;
