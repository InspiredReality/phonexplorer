import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BettSummaryBar from '../components/BettSummaryBar';
import {
  allBettingWeeks,
  amountClass,
  collectKnownTags,
  currentBettingWeekDays,
  formatMoneyShort,
  loadEntries,
  loadWeeklyGoal,
  persistEntries,
  reconcileEntriesWithApi,
  rowHasTag,
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
  // Local storage hydrates the first paint; the database fetch then
  // overwrites it as the source of truth (and refreshes the cache), so
  // this matches whatever the picks page has saved from any browser.
  const [entries, setEntries] = useState(loadEntries);
  const [weeklyGoal, setWeeklyGoal] = useState(loadWeeklyGoal);
  const [tagFilter, setTagFilter] = useState('');

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

  const knownTags = collectKnownTags(entries);
  // Only the grid's per-day and week totals are scoped to the selected tag —
  // the bottom summary bar (Table/Day/Week) always reflects everything.
  const rowsFor = (dateKey) => {
    const rows = entries[dateKey] || [];
    return tagFilter ? rows.filter((row) => rowHasTag(row, tagFilter)) : rows;
  };
  const weeks = allBettingWeeks(entries);
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
        <span className="bett-goal-label">Tag</span>
        <select
          className="bett-select-input bett-tag-filter-select"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
        >
          <option value="">All Tags</option>
          {knownTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
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
