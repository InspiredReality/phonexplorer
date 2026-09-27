import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BettSummaryBar from '../components/BettSummaryBar';
import {
  amountClass,
  currentBettingWeekDays,
  formatMoneyShort,
  loadEntries,
  loadWeeklyGoal,
  saveWeeklyGoal,
  sumProfit,
} from './bettStuffData';
import './BettStuff.css';

function BettStuffStats() {
  const navigate = useNavigate();
  const [statsDays] = useState(currentBettingWeekDays);
  const [entries] = useState(loadEntries);
  const [weeklyGoal, setWeeklyGoal] = useState(loadWeeklyGoal);

  const rowsFor = (dateKey) => entries[dateKey] || [];
  const dayProfits = statsDays.map((d) => ({ ...d, profit: sumProfit(rowsFor(d.dateKey)) }));
  const weekProfit = dayProfits.reduce((total, d) => total + d.profit, 0);

  // Green once the week hits its goal, white if it's still positive but
  // short of the goal, red if the week is in the red.
  const goalValue = parseFloat(weeklyGoal) || 0;
  const weekValueClass =
    weekProfit >= goalValue
      ? 'bett-stats-amount-good'
      : weekProfit < 0
      ? 'bett-stats-amount-bad'
      : 'bett-stats-amount-neutral';

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

      <div className="bett-stats-header-row">
        <div className="bett-stats-header-cell bett-stats-header-week" />
        {dayProfits.map((d) => (
          <div key={d.dateKey} className="bett-stats-header-cell">{d.dayName.slice(0, 3)}</div>
        ))}
      </div>

      <div className="bett-stats-grid">
        <div className="bett-stats-cell bett-stats-cell-week">
          <span className="bett-stats-cell-label bett-stats-week-range">
            <span>{statsDays[0].shortLabel}</span>
            <span>{statsDays[6].shortLabel}</span>
          </span>
          <span className={`bett-stats-cell-value ${weekValueClass}`}>{formatMoneyShort(weekProfit)}</span>
        </div>
        {dayProfits.map((d) => (
          <div key={d.dateKey} className="bett-stats-cell bett-stats-cell-day">
            <span className={`bett-stats-cell-value ${amountClass(d.profit)}`}>{formatMoneyShort(d.profit)}</span>
          </div>
        ))}
      </div>

      <BettSummaryBar days={statsDays} entries={entries} activePage="stats" />
    </div>
  );
}

export default BettStuffStats;
