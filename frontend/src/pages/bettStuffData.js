// Shared between BettStuff (the picks page) and BettStuffStats: both read
// the same localStorage-backed weekly entries and need the same Day/Week
// profit math for the always-visible summary bar.

export const STORAGE_KEY = 'phonexplorer-bett-stuff-v1';
const WEEKLY_GOAL_KEY = 'phonexplorer-bett-stuff-weekly-goal-v1';
const EXTRA_DAYS_KEY = 'phonexplorer-bett-stuff-extra-days-v1';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayDateKey() {
  return toDateKey(new Date());
}

// Turns a "YYYY-MM-DD" key (the same format <input type="date"> produces)
// back into display info for an accordion header.
export function dateKeyInfo(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return {
    dateKey,
    dayName: DAY_NAMES[date.getDay()],
    dateLabel: formatDateLabel(date),
    isToday: dateKey === todayDateKey(),
  };
}

function formatDateLabel(d) {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function formatShortDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// The Tuesday on or before the given date — the start of that date's
// betting week (Tue-Mon), regardless of which day of the week it falls on.
function mostRecentTuesday(date) {
  const diff = (date.getDay() - 2 + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff);
}

function buildBettingWeek(tuesday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(tuesday.getFullYear(), tuesday.getMonth(), tuesday.getDate() + i);
    return {
      dateKey: toDateKey(d),
      dayName: DAY_NAMES[d.getDay()],
      dateLabel: formatDateLabel(d),
      shortLabel: formatShortDate(d),
      isToday: dateKeyIsToday(toDateKey(d)),
    };
  });
}

function dateKeyIsToday(dateKey) {
  return dateKey === todayDateKey();
}

// The stats page's Tuesday-through-Monday week, used for the bottom summary
// bar on both pages.
export function currentBettingWeekDays() {
  return buildBettingWeek(mostRecentTuesday(new Date()));
}

// Every Tuesday-through-Monday week from the one containing the earliest
// logged (or manually added) day through the current week, newest first —
// the stats page's full calendar-like history instead of just this week.
export function allBettingWeeks() {
  const entries = loadEntries();
  const dataKeys = Object.keys(entries).filter((k) => (entries[k] || []).length > 0);
  const allKeys = [...dataKeys, ...loadExtraDays()];

  const currentTuesday = mostRecentTuesday(new Date());
  let earliestTuesday = currentTuesday;
  for (const key of allKeys) {
    const [year, month, day] = key.split('-').map(Number);
    const tuesday = mostRecentTuesday(new Date(year, month - 1, day));
    if (tuesday < earliestTuesday) earliestTuesday = tuesday;
  }

  const weeks = [];
  const cursor = new Date(currentTuesday);
  while (cursor >= earliestTuesday) {
    weeks.push(buildBettingWeek(cursor));
    cursor.setDate(cursor.getDate() - 7);
  }
  return weeks;
}

export function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function computeProfit(row) {
  const bet = parseFloat(row.bet);
  const toWin = parseFloat(row.toWin);
  return Number.isNaN(bet) || Number.isNaN(toWin) ? null : toWin - bet;
}

// The Day/Week totals count every Win or Loss row regardless of whether
// it's still Open or already Closed — only Live (outcome unknown) is
// excluded. A win nets To Win minus Bet; a loss nets the Bet amount lost.
export function resultProfit(row) {
  if (row.result === 'win') return computeProfit(row) ?? 0;
  if (row.result === 'loss') return -(parseFloat(row.bet) || 0);
  return 0;
}

export function sumProfit(rows) {
  return rows.reduce((total, row) => total + resultProfit(row), 0);
}

// Money currently at the table: the Bet amount (never To Win or Profit) of
// every still-Open row, across every day ever logged — not scoped to a
// particular day or week like the other totals.
export function openBetTotal(entries) {
  return Object.values(entries)
    .flat()
    .filter((row) => row.status === 'open')
    .reduce((total, row) => total + (parseFloat(row.bet) || 0), 0);
}

export function formatMoney(amount) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

// Whole-dollar rendering for the stats grid, where 8 columns need to fit in
// a single row without wrapping.
export function formatMoneyShort(amount) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(amount))}`;
}

export function amountClass(amount) {
  if (amount > 0) return 'bett-summary-value-positive';
  if (amount < 0) return 'bett-summary-value-negative';
  return 'bett-summary-value-zero';
}

export function loadWeeklyGoal() {
  try {
    return localStorage.getItem(WEEKLY_GOAL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveWeeklyGoal(value) {
  try {
    localStorage.setItem(WEEKLY_GOAL_KEY, value);
  } catch {
    // e.g. private browsing / storage quota — used only as a local store
  }
}

// Manually added day accordions (via "+ Add Day") that should stay visible
// even before any bet is logged under them.
export function loadExtraDays() {
  try {
    const raw = localStorage.getItem(EXTRA_DAYS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveExtraDays(dateKeys) {
  try {
    localStorage.setItem(EXTRA_DAYS_KEY, JSON.stringify(dateKeys));
  } catch {
    // e.g. private browsing / storage quota — used only as a local store
  }
}
