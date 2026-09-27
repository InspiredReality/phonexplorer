import { useNavigate } from 'react-router-dom';
import { amountClass, formatMoney, sumProfit } from '../pages/bettStuffData';
import '../pages/BettStuff.css';

// Always-visible footer shared by the picks page (Bett Stuff) and the
// stats page (Bett Stuff Stats): same Day/Week totals, plus a toggle
// button that swaps between the two pages.
function BettSummaryBar({ days, entries, activePage }) {
  const navigate = useNavigate();
  const rowsFor = (dateKey) => entries[dateKey] || [];
  const todayKey = days.find((d) => d.isToday)?.dateKey;
  const dayProfit = sumProfit(rowsFor(todayKey));
  const weekProfit = sumProfit(days.flatMap((d) => rowsFor(d.dateKey)));

  const isStats = activePage === 'stats';
  const toggleLabel = isStats ? 'Bett' : 'Stuff';
  const togglePath = isStats ? '/bett-stuff' : '/bett-stuff-stats';

  return (
    <div className="bett-summary-bar">
      <div className="bett-summary-stats">
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
  );
}

export default BettSummaryBar;
