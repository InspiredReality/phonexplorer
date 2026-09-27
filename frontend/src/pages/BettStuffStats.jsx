import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BettSummaryBar from '../components/BettSummaryBar';
import {
  allBettingWeeks,
  amountClass,
  currentBettingWeekDays,
  formatMoneyShort,
  loadEntries,
  loadWeeklyGoal,
  saveWeeklyGoal,
  sumProfit,
} from './bettStuffData';
import './BettStuff.css';

// Green once the week hits its goal, white if it's still positive but short
// of the goal, red if the week is in the red.
function goalValueClass(weekProfit, goalValue) {
  if (weekProfit >= goalValue) return 'bett-stats-amount-good';
  if (weekProfit < 0) return 'bett-stats-amount-bad';
  return 'bett-stats-amount-neutral';
}

function WeekRow({ week, rowsFor, goalValue }) {
  const dayProfits = week.map((d) => ({ ...d, profit: sumProfit(rowsFor(d.dateKey)) }));
  const weekProfit = dayProfits.reduce((total, d) => total + d.profit, 0);

  return (
    <div className="bett-stats-grid">
      <div className="bett-stats-cell bett-stats-cell-week">
        <span className="bett-stats-cell-label bett-stats-week-range">
          <span>{week[0].shortLabel}</span>
          <span>{week[6].shortLabel}</span>
        </span>
        <span className={`bett-stats-cell-value ${goalValueClass(weekProfit, goalValue)}`}>
          {formatMoneyShort(weekProfit)}
        </span>
      </div>
      {dayProfits.map((d) => (
        <div key={d.dateKey} className="bett-stats-cell bett-stats-cell-day">
          <span className={`bett-stats-cell-value ${amountClass(d.profit)}`}>{formatMoneyShort(d.profit)}</span>
        </div>
      ))}
    </div>
  );
}

function BettStuffStats() {
  const navigate = useNavigate();
  // The bottom summary bar always tracks just the current week; the grid
  // below shows every week back through the earliest logged day.
  const [summaryDays] = useState(currentBettingWeekDays);
  const [weeks] = useState(allBettingWeeks);
  const [entries] = useState(loadEntries);
  const [weeklyGoal, setWeeklyGoal] = useState(loadWeeklyGoal);

  const rowsFor = (dateKey) => entries[dateKey] || [];
  const goalValue = parseFloat(weeklyGoal) || 0;

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
        {weeks[0].map((d) => (
          <div key={d.dayName} className="bett-stats-header-cell">{d.dayName.slice(0, 3)}</div>
        ))}
      </div>

      <div className="bett-stats-weeks">
        {weeks.map((week) => (
          <WeekRow key={week[0].dateKey} week={week} rowsFor={rowsFor} goalValue={goalValue} />
        ))}
      </div>

      <BettSummaryBar days={summaryDays} entries={entries} activePage="stats" />
    </div>
  );
}

export default BettStuffStats;
