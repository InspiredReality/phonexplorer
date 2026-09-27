// Shared between BettStuff (the picks page) and BettStuffStats: both read
// the same localStorage-backed weekly entries and need the same Day/Week
// profit math for the always-visible summary bar.

export const STORAGE_KEY = 'phonexplorer-bett-stuff-v1';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(d) {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

// Sunday-through-Saturday of the current (local) week, each with its own
// calendar date so entries persist under the actual day, not just its name.
export function currentWeekDays() {
  const today = new Date();
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
    return { dateKey: toDateKey(d), dayName: DAY_NAMES[i], dateLabel: formatDateLabel(d), isToday: toDateKey(d) === toDateKey(today) };
  });
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

export function formatMoney(amount) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function amountClass(amount) {
  if (amount > 0) return 'bett-summary-value-positive';
  if (amount < 0) return 'bett-summary-value-negative';
  return 'bett-summary-value-zero';
}
