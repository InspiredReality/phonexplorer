import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BettSummaryBar from '../components/BettSummaryBar';
import {
  amountClass,
  currentWeekDays,
  formatMoney,
  loadEntries,
  loadWeeklyGoal,
  saveWeeklyGoal,
  sumProfit,
} from './bettStuffData';
import './BettStuff.css';

function BettStuffStats() {
  const navigate = useNavigate();
  const [days] = useState(currentWeekDays);
  const [entries] = useState(loadEntries);
  const [weeklyGoal, setWeeklyGoal] = useState(loadWeeklyGoal);

  const rowsFor = (dateKey) => entries[dateKey] || [];
  const dayProfits = days.map((d) => ({ ...d, profit: sumProfit(rowsFor(d.dateKey)) }));
  const weekProfit = dayProfits.reduce((total, d) => total + d.profit, 0);
  const goalMet = weekProfit >= (parseFloat(weeklyGoal) || 0);

  const handleGoalChange = (value) => {
    setWeeklyGoal(value);
    saveWeeklyGoal(value);
  };

  return (
    <div className="bett-page">
      <button className="bett-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="bett-heading">Bett Stuff Stats</h1>

      <div className="bett-goal-row">
        <span className="bett-goal-label">Weekly Profit Goal</span>
        <input
          type="number"
          inputMode="decimal"
          className="bett-goal-input"
          placeholder="$0"
          value={weeklyGoal}
          onChange={(e) => handleGoalChange(e.target.value)}
        />
      </div>

      <div className="bett-stats-grid">
        {dayProfits.map((d) => (
          <div key={d.dateKey} className="bett-stats-cell">
            <span className="bett-stats-cell-label">{d.dayName.slice(0, 3)}</span>
            <span className={`bett-stats-cell-value ${amountClass(d.profit)}`}>{formatMoney(d.profit)}</span>
          </div>
        ))}
        <div className="bett-stats-cell bett-stats-cell-week">
          <span className="bett-stats-cell-label">Week</span>
          <span className={`bett-stats-cell-value ${goalMet ? 'bett-stats-goal-met' : 'bett-stats-goal-missed'}`}>
            {goalMet ? '✓' : '✗'}
          </span>
        </div>
      </div>

      <BettSummaryBar days={days} entries={entries} activePage="stats" />
    </div>
  );
}

export default BettStuffStats;
