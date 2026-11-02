import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BettSummaryBar from '../components/BettSummaryBar';
import BettTagFilter from '../components/BettTagFilter';
import {
  allBettingWeeks,
  amountClass,
  collectKnownTags,
  currentBettingWeekDays,
  formatMoneyShort,
  loadWeeklyGoal,
  rowHasAnyTag,
  saveWeeklyGoal,
  sumProfit,
  syncEntries,
  useBettEntries,
} from './bettStuffData';
import './BettStuff.css';

// Green once the week hits its goal, white if it's still positive but short
// of the goal, red if the week is in the red.
// Filters are multi-select: nothing selected means no restriction.
const matchesAny = (selected, value) => selected.length === 0 || selected.includes(value);

const SPORTS = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'Other'];
const WHENS = ['pregame', 'live'];
const WHEN_LABEL = { pregame: 'Pregame', live: 'Live' };
const TYPES = ['single', 'two', 'three'];
const TYPE_LABEL = { single: 'Single', two: '2 Picks', three: '3+' };

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
  // Shared offline-first store: same data the picks page just used, so
  // navigating here shows it instantly; the sync only hits the API if stale.
  const { entries } = useBettEntries();
  const [weeklyGoal, setWeeklyGoal] = useState(loadWeeklyGoal);
  const [tagFilter, setTagFilter] = useState([]);
  const [sportFilter, setSportFilter] = useState([]);
  const [whenFilter, setWhenFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);

  useEffect(() => {
    syncEntries();
  }, []);

  const knownTags = collectKnownTags(entries);
  // Only the grid's per-day and week totals are scoped to the selected tag —
  // the bottom summary bar (Table/Day/Week) always reflects everything.
  const rowsFor = (dateKey) => {
    const rows = entries[dateKey] || [];
    return rows.filter(
      (row) =>
        rowHasAnyTag(row, tagFilter) &&
        matchesAny(sportFilter, row.sport || 'NFL') &&
        matchesAny(whenFilter, row.when || 'pregame') &&
        matchesAny(typeFilter, row.betType || 'single')
    );
  };
  const weeks = allBettingWeeks(entries);
  const goalValue = parseFloat(weeklyGoal) || 0;

  const handleGoalChange = (value) => {
    setWeeklyGoal(value);
    saveWeeklyGoal(value);
  };

  return (
    <div className="bett-page bett-page-stats">
      <button className="bett-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="bett-heading">Bett Stuff Stats</h1>

      <div className="bett-goal-row">
        <span className="bett-goal-label">Tag</span>
        <BettTagFilter tags={knownTags} selected={tagFilter} onChange={setTagFilter} />
      </div>

      <div className="bett-filter-row">
        <div className="bett-filter-cell">
          <span className="bett-goal-label">Sport</span>
          <BettTagFilter tags={SPORTS} selected={sportFilter} onChange={setSportFilter} allLabel="All" />
        </div>
        <div className="bett-filter-cell">
          <span className="bett-goal-label">When</span>
          <BettTagFilter
            tags={WHENS}
            selected={whenFilter}
            onChange={setWhenFilter}
            allLabel="All"
            formatLabel={(v) => WHEN_LABEL[v]}
          />
        </div>
        <div className="bett-filter-cell">
          <span className="bett-goal-label">Type</span>
          <BettTagFilter
            tags={TYPES}
            selected={typeFilter}
            onChange={setTypeFilter}
            allLabel="All"
            formatLabel={(v) => TYPE_LABEL[v]}
          />
        </div>
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

      <div className="bett-goal-row bett-goal-row-bottom">
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

      <BettSummaryBar days={summaryDays} entries={entries} activePage="stats" />
    </div>
  );
}

export default BettStuffStats;
