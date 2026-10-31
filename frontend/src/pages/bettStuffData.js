// Shared between BettStuff (the picks page) and BettStuffStats: both load
// the same bet entries (from the database, with localStorage as a local
// cache/fallback) and need the same Day/Week profit math for the
// always-visible summary bar.

import { useSyncExternalStore } from 'react';
import api from '../services/api';

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
// Takes entries as a parameter (rather than loading them itself) so it
// stays correct once entries are hydrated from the database.
export function allBettingWeeks(entries) {
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


// ---------------------------------------------------------------------------
// Shared, offline-first bet store
//
// One module-level copy of every bet that both pages read from, so moving
// between Bett and Stuff never re-fetches or flashes stale numbers. It is
// hydrated synchronously from localStorage (rows only — screenshots are far
// too big for its ~5MB quota, so those live in IndexedDB), then revalidated
// against the API at most once per STALE_MS. Edits apply locally first and
// are queued as "pending" until the API accepts them, so the app keeps
// working (and keeps its changes) with no or flaky connectivity.
// ---------------------------------------------------------------------------

const PENDING_KEY = 'phonexplorer-bett-stuff-pending-v1';
const BRIDGED_KEY = 'phonexplorer-bett-stuff-bridged-v1';
const STALE_MS = 5 * 60 * 1000;
const IDB_NAME = 'phonexplorer-bett-stuff';
const IDB_STORE = 'images';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // e.g. private browsing / storage quota — the in-memory store still works
  }
}

// --- screenshots (IndexedDB, best effort) ---

function openImageDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withImageStore(mode, run) {
  const db = await openImageDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const result = run(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const storedImages = new Map(); // id -> data URL last written to IndexedDB

function putImage(id, image) {
  if (!image || storedImages.get(id) === image) return;
  storedImages.set(id, image);
  withImageStore('readwrite', (s) => s.put(image, id)).catch(() => storedImages.delete(id));
}

function deleteImage(id) {
  storedImages.delete(id);
  withImageStore('readwrite', (s) => s.delete(id)).catch(() => {});
}

async function loadAllImages() {
  const db = await openImageDb();
  try {
    return await new Promise((resolve, reject) => {
      const out = {};
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        out[cursor.key] = cursor.value;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// --- store ---

function stripImages(entries) {
  const slim = {};
  for (const [dateKey, rows] of Object.entries(entries)) {
    slim[dateKey] = rows.map(({ image, ...rest }) => ({ ...rest, image: null }));
  }
  return slim;
}

// Caches written before screenshots moved out may still carry them inline;
// rescue those into IndexedDB so nothing is lost when the slim copy replaces it.
function loadInitialEntries() {
  const raw = readJson(STORAGE_KEY, {});
  for (const rows of Object.values(raw)) {
    for (const row of rows) if (row.image) putImage(row.id, row.image);
  }
  return raw;
}

let entriesState = loadInitialEntries();
let syncingState = false;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

function setEntriesState(next) {
  entriesState = next;
  writeJson(STORAGE_KEY, stripImages(next));
  emit();
}

export function getEntries() {
  return entriesState;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSyncing() {
  return syncingState;
}

// Both pages call this; it re-renders them whenever the shared copy changes.
export function useBettEntries() {
  const entries = useSyncExternalStore(subscribe, getEntries);
  const syncing = useSyncExternalStore(subscribe, getSyncing);
  return { entries, syncing };
}

// Local-only change (e.g. adding a blank row); nothing is sent to the API.
export function updateEntries(dateKey, updateRows) {
  const rows = updateRows(entriesState[dateKey] || []);
  setEntriesState({ ...entriesState, [dateKey]: rows });
}

// --- pending queue: edits the API hasn't acknowledged yet ---

let pendingSeq = 0;

function loadPending() {
  const p = readJson(PENDING_KEY, null);
  return { upserts: p?.upserts || {}, deletes: p?.deletes || [] };
}

function findRow(entries, id) {
  for (const [dateKey, rows] of Object.entries(entries)) {
    const row = rows.find((r) => r.id === id);
    if (row) return { dateKey, row };
  }
  return null;
}

let flushing = null;

export function flushPending() {
  if (flushing) return flushing;
  flushing = (async () => {
    const pending = loadPending();
    for (const id of [...pending.deletes]) {
      try {
        await deleteBetFromApi(id);
        const p = loadPending();
        writeJson(PENDING_KEY, { ...p, deletes: p.deletes.filter((d) => d !== id) });
      } catch {
        return false; // offline or server down — keep the queue, retry later
      }
    }
    for (const [id, seq] of Object.entries(pending.upserts)) {
      const found = findRow(entriesState, id);
      if (found) {
        try {
          await saveBetToApi(found.dateKey, found.row);
        } catch {
          return false;
        }
      }
      // Drop it from the queue unless it was edited again while in flight.
      const p = loadPending();
      if (p.upserts[id] === seq) {
        delete p.upserts[id];
        writeJson(PENDING_KEY, p);
      }
    }
    return true;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// Persist a row's latest state locally and queue it for the API.
export function saveBet(dateKey, row) {
  putImage(row.id, row.image);
  const p = loadPending();
  p.upserts[row.id] = ++pendingSeq;
  p.deletes = p.deletes.filter((d) => d !== row.id);
  writeJson(PENDING_KEY, p);
  flushPending();
}

export function removeBet(dateKey, rowId) {
  updateEntries(dateKey, (rows) => rows.filter((r) => r.id !== rowId));
  deleteImage(rowId);
  const p = loadPending();
  delete p.upserts[rowId];
  if (!p.deletes.includes(rowId)) p.deletes.push(rowId);
  writeJson(PENDING_KEY, p);
  flushPending();
}

// --- revalidation ---

function tagsToString(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function tagsStringToArray(value) {
  return (value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function settlementToRow(record) {
  return {
    id: record.id,
    text: record.pick || '',
    notes: record.notes || '',
    image: record.image || null,
    hasImage: !!(record.has_image || record.image),
    bet: record.bet_amount || record.bet_amount === 0 ? String(record.bet_amount) : '',
    toWin: record.to_win || record.to_win === 0 ? String(record.to_win) : '',
    toWinExact: record.to_win_exact != null ? String(record.to_win_exact) : null,
    sportsbook: record.sportsbook || '',
    tags: tagsToString(record.tags),
    when: record.bet_when || 'pregame',
    betType: record.bet_type || 'single',
    sport: record.sport || 'NFL',
    status: record.status || 'open',
    result: record.result || 'live',
  };
}

// Every distinct tag used across every bet, for the Tags textbox's
// suggestion list — so a tag becomes selectable again once it's been used
// anywhere, without needing its own table. Also backs the stats page's tag
// filter dropdown.
export function collectKnownTags(entries) {
  const tags = new Set();
  for (const rows of Object.values(entries)) {
    for (const row of rows) {
      for (const tag of tagsStringToArray(row.tags)) tags.add(tag);
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

export function rowHasTag(row, tag) {
  return tagsStringToArray(row.tags).includes(tag);
}

// Every bet from the database, without screenshots (those come separately,
// see fetchImage). Returns [{ dateKey, row, hasImage }].
async function fetchRecordsFromApi() {
  const res = await api.get('/api/bett-stuff/settlements');
  return res.data.map((record) => ({
    dateKey: record.bet_date,
    row: settlementToRow(record),
    hasImage: !!record.has_image,
  }));
}

async function fetchImage(id) {
  const res = await api.get(`/api/bett-stuff/settlements/${id}/image`);
  return res.data.image || null;
}

export async function saveBetToApi(dateKey, row) {
  // An unloaded screenshot is null locally; sending that could make a server
  // that treats null as "clear" erase it. Load it first, or don't save yet.
  if (row.hasImage && !row.image) {
    const image = await fetchImage(row.id);
    if (!image) throw new Error('screenshot not loaded yet');
    row = { ...row, image };
  }
  await api.put(`/api/bett-stuff/settlements/${row.id}`, {
    bet_date: dateKey,
    pick: row.text,
    notes: row.notes || null,
    image: row.image,
    bet_amount: parseFloat(row.bet) || 0,
    to_win: parseFloat(row.toWin) || 0,
    to_win_exact: parseFloat(row.toWinExact) || null,
    profit: computeProfit(row) ?? 0,
    sportsbook: row.sportsbook || null,
    tags: tagsStringToArray(row.tags),
    bet_when: row.when || 'pregame',
    bet_type: row.betType || 'single',
    sport: row.sport || 'NFL',
    status: row.status,
    result: row.result,
  });
}

// Shrinks a screenshot before upload — slip text stays legible at this size
// and the request stays small on a phone connection.
function downscaleForReading(dataUrl, maxSide = 1280) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Asks the backend to read Bet / To Win off a bet-slip screenshot. Needs a
// connection; callers treat any failure as "just leave the fields alone".
export async function readSlip(dataUrl) {
  const image = await downscaleForReading(dataUrl);
  const res = await api.post('/api/bett-stuff/read-slip', { image });
  return res.data; // { bet, to_win } — each a number or null
}

export async function deleteBetFromApi(rowId) {
  await api.delete(`/api/bett-stuff/settlements/${rowId}`);
}

function isBlankDraft(row) {
  return !row.text && !row.notes && !row.bet && !row.toWin && !row.image;
}

// Brings the shared copy in line with the database without clobbering
// anything the API hasn't seen yet: pending edits win over the server's
// version, pending deletes stay deleted, and rows only this browser has
// (logged before sync existed, or while offline) are kept and pushed up.
async function revalidate() {
  await flushPending();
  const records = await fetchRecordsFromApi();

  const pending = loadPending();
  const firstBridge = !readJson(BRIDGED_KEY, false);
  const current = entriesState;
  const dbIds = new Set(records.map((r) => r.row.id));

  const merged = {};
  const add = (dateKey, row) => {
    (merged[dateKey] ??= []).push(row);
  };

  for (const { dateKey, row } of records) {
    if (pending.deletes.includes(row.id)) continue;
    const local = findRow(current, row.id);
    if (pending.upserts[row.id] && local) {
      add(local.dateKey, local.row);
      continue;
    }
    add(dateKey, { ...row, image: local?.row.image || row.image });
  }

  for (const [dateKey, rows] of Object.entries(current)) {
    for (const row of rows) {
      if (dbIds.has(row.id)) continue;
      const keep = pending.upserts[row.id] || firstBridge || isBlankDraft(row);
      if (!keep) continue;
      add(dateKey, row);
      if (!isBlankDraft(row)) {
        const p = loadPending();
        p.upserts[row.id] = ++pendingSeq;
        writeJson(PENDING_KEY, p);
      }
    }
  }

  writeJson(BRIDGED_KEY, true);
  setEntriesState(merged);
  flushPending();
}

function setImage(id, image) {
  const found = findRow(entriesState, id);
  if (!found || found.row.image === image) return;
  putImage(id, image);
  // Not persisted to localStorage anyway, so skip the write and just notify.
  entriesState = {
    ...entriesState,
    [found.dateKey]: entriesState[found.dateKey].map((r) => (r.id === id ? { ...r, image, hasImage: true } : r)),
  };
  emit();
}

const imageFetches = new Set();

// Pulls screenshots for the given rows (e.g. the days currently expanded)
// into the store and IndexedDB. Already-loaded and in-flight rows are skipped,
// and offline failures are simply retried the next time it's called.
export function loadImagesFor(dateKeys) {
  const ids = [];
  for (const dateKey of dateKeys) {
    for (const row of entriesState[dateKey] || []) {
      if (row.hasImage && !row.image && !imageFetches.has(row.id)) ids.push(row.id);
    }
  }
  for (const id of ids) {
    imageFetches.add(id);
    fetchImage(id)
      .then((image) => image && setImage(id, image))
      .catch(() => {})
      .finally(() => imageFetches.delete(id));
  }
}

const LAST_SYNC_KEY = 'phonexplorer-bett-stuff-last-sync-v1';
// Persisted so reopening the app soon after a sync doesn't refetch at all.
let lastSyncAt = readJson(LAST_SYNC_KEY, 0);
let syncPromise = null;

// Revalidates against the API unless it already did recently. Safe to call
// from every page mount: concurrent and repeat calls collapse into one
// request, and failures (offline) leave the cached data untouched.
export function syncEntries({ force = false } = {}) {
  if (syncPromise) return syncPromise;
  if (!force && Date.now() - lastSyncAt < STALE_MS) return Promise.resolve();
  syncingState = true;
  emit();
  syncPromise = revalidate()
    .then(() => {
      lastSyncAt = Date.now();
      writeJson(LAST_SYNC_KEY, lastSyncAt);
    })
    .catch((err) => console.error('Failed to sync bets, using local cache:', err))
    .finally(() => {
      syncingState = false;
      syncPromise = null;
      emit();
    });
  return syncPromise;
}

// Screenshots saved to IndexedDB on a previous visit come back after first paint.
loadAllImages()
  .then((images) => {
    for (const [id, image] of Object.entries(images)) {
      storedImages.set(id, image);
      setImage(id, image);
    }
  })
  .catch(() => {});

if (typeof window !== 'undefined') {
  // Coming back online (or back to the tab) is the moment to push queued
  // edits and pick up changes made on other devices.
  window.addEventListener('online', () => syncEntries({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncEntries();
  });
}


// American odds implied by the bet and its total payout (To Win includes the
// stake): profit >= stake is "+" odds (profit per $100), less is "-" odds
// (stake needed to win $100). Blank until both amounts make a real bet.
export function computeOdds(row) {
  const bet = parseFloat(row.bet);
  // Prefer the slip's exact-cents payout; it's cleared whenever To Win is typed over.
  const toWin = parseFloat(row.toWinExact ?? row.toWin);
  if (!(bet > 0) || !(toWin > bet)) return '';
  const profit = toWin - bet;
  if (profit >= bet) return `+${Math.round((profit / bet) * 100)}`;
  return `-${Math.round((bet / profit) * 100)}`;
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
