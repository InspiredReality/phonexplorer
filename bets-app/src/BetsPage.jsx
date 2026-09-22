import { useEffect, useRef, useState } from 'react';
import api from './services/api';
import './BetsPage.css';

const WEEK_COUNT = 15;
const STORAGE_KEY = 'phonexplorer-bets-tracker-v2';
const SAVE_DEBOUNCE_MS = 500;

// Logo files live in public/team-logos/<id>.png — replace any of them in
// place (same filename) to swap in a better version later.
const TEAMS = [
  { id: 'octagone', name: 'Octagone' },
  { id: 'otoshi-nakamoto', name: 'O₿toshi Nakamoto' },
  { id: 'front-gate-dragon', name: 'Front Gate Dragon' },
  { id: 'ceedeez-chocolate-ballz', name: 'CeeDeez Chocolate Ballz' },
  { id: 'michaels-neat-team', name: "Michael's Neat Team" },
  { id: 'last-dart', name: 'Last Dart' },
  { id: 'creed', name: 'Creed' },
  { id: 'king-of-the-north', name: 'King Of The North' },
  { id: 'lord-of-lakengren', name: 'Lord of Lakengren' },
  { id: 'sportins-squad', name: 'Sportins Squad' },
].map((team) => ({ ...team, logo: `/team-logos/${team.id}.png` }));

const WEEKS = Array.from({ length: WEEK_COUNT }, (_, i) => `week${i + 1}`);

// Week 1 runs Sep 8-14; every later week just shifts by 7 days from there.
const WEEK1_START_UTC = Date.UTC(2025, 8, 8);

function formatWeekRange(weekNum) {
  const start = new Date(WEEK1_START_UTC + (weekNum - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const startMonth = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const endMonth = end.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  return startMonth === endMonth
    ? `${startMonth} ${startDay} - ${endDay}`
    : `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}

const STATUS_CYCLE = ['pending', 'won', 'loss'];
const STATUS_CONFIG = {
  pending: { symbol: '?', label: 'Pending', className: 'bets-status--pending' },
  won: { symbol: '✅', label: 'Won', className: 'bets-status--won' },
  loss: { symbol: '✕', label: 'Loss', className: 'bets-status--loss' },
};

function loadLocalEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistLocalEntries(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // e.g. private browsing / storage quota — used only as a local cache anyway
  }
}

// Older saved data stored just the pick text as a plain string; normalize
// both that and the current { pick, status } shape into one object so the
// rest of the page never has to care which one it's looking at.
function normalizeCell(raw) {
  if (typeof raw === 'string') return { pick: raw, status: 'pending' };
  if (raw && typeof raw === 'object') return { pick: raw.pick ?? '', status: raw.status ?? 'pending' };
  return { pick: '', status: 'pending' };
}

function weekNumber(weekId) {
  return Number(weekId.slice(4));
}

function saveCellToBackend(weekId, teamId, patch) {
  return api.put(`/api/bets/${weekNumber(weekId)}/${teamId}`, patch);
}

function saveFunderToBackend(weekId, teamId) {
  return api.put(`/api/bets/${weekNumber(weekId)}/funder`, { team_id: teamId });
}

function WeekAccordion({ label, expanded, onToggle, children }) {
  return (
    <div className="bets-accordion">
      <button
        type="button"
        className="bets-accordion-summary"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="bets-summary-label">{label}</span>
        <span className="bets-expand-icon">{expanded ? '▲' : '▾'}</span>
      </button>
      {expanded && <div className="bets-accordion-details">{children}</div>}
    </div>
  );
}

export default function BetsPage() {
  const [expanded, setExpanded] = useState(() =>
    Object.fromEntries(WEEKS.map((weekId) => [weekId, false]))
  );
  const [entries, setEntries] = useState(loadLocalEntries);
  const [locks, setLocks] = useState({});
  const [funders, setFunders] = useState({});
  // Default to only Week 1 visible until the real value loads, so a future
  // week never flashes on screen even briefly.
  const [activeWeek, setActiveWeek] = useState(1);
  const [loadError, setLoadError] = useState(null);
  const pickSaveTimers = useRef({});

  // Backend is the source of truth once it answers. Anything that only
  // exists in this browser's localStorage (from before the backend existed)
  // gets pushed up once so it isn't silently lost.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get('/api/bets');
        if (cancelled) return;
        let backendEntries = data.entries || {};

        const local = loadLocalEntries();
        const migrations = [];
        for (const weekId of Object.keys(local)) {
          for (const teamId of Object.keys(local[weekId] || {})) {
            if (backendEntries[weekId]?.[teamId]) continue; // backend already has this cell
            const cell = normalizeCell(local[weekId][teamId]);
            if (!cell.pick && cell.status === 'pending') continue; // nothing worth migrating
            migrations.push(saveCellToBackend(weekId, teamId, cell));
            backendEntries = {
              ...backendEntries,
              [weekId]: { ...backendEntries[weekId], [teamId]: cell },
            };
          }
        }
        if (migrations.length) await Promise.allSettled(migrations);
        if (cancelled) return;

        setEntries(backendEntries);
        setLocks(data.locks || {});
        setFunders(data.funders || {});
        setActiveWeek(data.season?.active_week ?? 1);
        persistLocalEntries(backendEntries);
        setLoadError(null);
      } catch (err) {
        console.error('Failed to load bet entries from backend', err);
        if (!cancelled) {
          setLoadError('Could not reach the server — showing picks saved on this device only.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateCell = (weekId, teamId, patch) => {
    setEntries((prev) => {
      const cell = normalizeCell(prev[weekId]?.[teamId]);
      const next = {
        ...prev,
        [weekId]: { ...prev[weekId], [teamId]: { ...cell, ...patch } },
      };
      persistLocalEntries(next);
      return next;
    });
  };

  const handlePickChange = (weekId, teamId) => (event) => {
    const value = event.target.value;
    updateCell(weekId, teamId, { pick: value });

    const key = `${weekId}:${teamId}`;
    clearTimeout(pickSaveTimers.current[key]);
    pickSaveTimers.current[key] = setTimeout(() => {
      saveCellToBackend(weekId, teamId, { pick: value }).catch((err) =>
        console.error('Failed to save pick', weekId, teamId, err)
      );
    }, SAVE_DEBOUNCE_MS);
  };

  const handleStatusCycle = (weekId, teamId) => () => {
    const cell = normalizeCell(entries[weekId]?.[teamId]);
    const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cell.status) + 1) % STATUS_CYCLE.length];
    updateCell(weekId, teamId, { status: nextStatus });
    saveCellToBackend(weekId, teamId, { status: nextStatus }).catch((err) =>
      console.error('Failed to save status', weekId, teamId, err)
    );
  };

  // Triple-clicking a team's icon in a week's picks table marks them as the
  // funder for that week's parlay; triple-clicking the current funder again
  // clears it. event.detail is the browser's own click-count, so this rides
  // on native multi-click detection instead of hand-rolled timers.
  const handleFunderClick = (weekId, teamId) => (event) => {
    if (event.detail !== 3 || locks[weekId]) return;
    const nextTeamId = funders[weekId] === teamId ? null : teamId;
    setFunders((prev) => ({ ...prev, [weekId]: nextTeamId }));
    saveFunderToBackend(weekId, nextTeamId).catch((err) =>
      console.error('Failed to save funder', weekId, teamId, err)
    );
  };

  // Only tally weeks that are actually visible right now. Weeks beyond
  // activeWeek may still hold leftover data (e.g. from before week
  // visibility was restricted) that shouldn't count toward a season total
  // no one can currently see or edit.
  const visibleWeekIds = WEEKS.slice(0, activeWeek);

  const standings = TEAMS.map((team) => {
    let wins = 0;
    let submissions = 0;
    for (const weekId of WEEKS.slice(0, activeWeek)) {
      const cell = normalizeCell(entries[weekId]?.[team.id]);
      const hasPick = !!cell.pick.trim();
      if (hasPick) submissions += 1;
      // Require a visible pick too — clearing the pick text intentionally
      // keeps the underlying status (see handlePickChange), so without this
      // a cleared-out week could still count as a "win" with nothing to show for it.
      if (hasPick && cell.status === 'won') wins += 1;
    }

    const weeklyResults = visibleWeekIds.map((weekId) => {
      const cell = normalizeCell(entries[weekId]?.[team.id]);
      const hasPick = !!cell.pick.trim();
      // A cleared pick always reads as unsubmitted, even if a status
      // happened to be set on it before — see the note above.
      const status = hasPick ? cell.status : 'pending';
      return { weekId, weekNum: weekNumber(weekId), ...STATUS_CONFIG[status] };
    });

    return { ...team, wins, submissions, weeklyResults };
  });

  return (
    <div className="bets-page">
      <h1 className="bets-heading">Chuggler Bets</h1>
      {loadError && <p className="bets-load-error">{loadError}</p>}

      <h2 className="bets-section-heading">Low Score Parlays</h2>
      <div className="bets-accordions">
        {WEEKS.slice(0, activeWeek).map((weekId, weekIdx) => {
          const locked = !!locks[weekId];
          const funder = TEAMS.find((team) => team.id === funders[weekId]);
          return (
            <WeekAccordion
              key={weekId}
              label={
                <>
                  {`Week ${weekIdx + 1} (${formatWeekRange(weekIdx + 1)})`}
                  {funder && (
                    <span className="bets-funder-chip">
                      <img className="bets-funder-icon" src={funder.logo} alt="" />
                      {funder.name}
                    </span>
                  )}
                  {locked ? ' 🔒' : ''}
                </>
              }
              expanded={!!expanded[weekId]}
              onToggle={() => setExpanded((prev) => ({ ...prev, [weekId]: !prev[weekId] }))}
            >
              <table className="bets-table">
                <tbody>
                  {TEAMS.map((team) => {
                    const cell = normalizeCell(entries[weekId]?.[team.id]);
                    const status = STATUS_CONFIG[cell.status];
                    return (
                      <tr key={team.id}>
                        <td className="bets-table-label">
                          <img
                            className="bets-team-logo"
                            src={team.logo}
                            alt=""
                            width={48}
                            height={48}
                            loading="lazy"
                            onClick={handleFunderClick(weekId, team.id)}
                            title={
                              locked
                                ? undefined
                                : 'Triple-click to set as this week’s parlay funder'
                            }
                          />
                          <span>{team.name}</span>
                        </td>
                        <td className="bets-table-input-cell">
                          <input
                            type="text"
                            className="bets-table-input"
                            value={cell.pick}
                            onChange={handlePickChange(weekId, team.id)}
                            placeholder="Enter pick..."
                            disabled={locked}
                          />
                        </td>
                        <td className="bets-table-status-cell">
                          {cell.pick.trim() && (
                            <button
                              type="button"
                              className={`bets-status-btn ${status.className}`}
                              onClick={handleStatusCycle(weekId, team.id)}
                              title={`${status.label}${locked ? ' (locked)' : ' — click to change'}`}
                              aria-label={`${team.name} status: ${status.label}.${locked ? '' : ' Click to change.'}`}
                              disabled={locked}
                            >
                              {status.symbol}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </WeekAccordion>
          );
        })}
      </div>

      <div className="bets-standings">
        <h2 className="bets-section-heading">Season Contributions</h2>
        <table className="bets-standings-table">
          <thead>
            <tr>
              <th className="bets-standings-team-header">Team</th>
              <th className="bets-standings-recent-col">Weekly Results</th>
              <th className="bets-standings-num-col">Wins</th>
              <th className="bets-standings-num-col">Submissions</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((team) => (
              <tr key={team.id}>
                <td className="bets-standings-team">
                  <img
                    className="bets-team-logo"
                    src={team.logo}
                    alt=""
                    width={48}
                    height={48}
                    loading="lazy"
                  />
                  <span>{team.name}</span>
                </td>
                <td className="bets-standings-recent-col">
                  <div className="bets-standings-recent">
                    {team.weeklyResults.map((week) => (
                      <span
                        key={week.weekId}
                        className={`bets-recent-icon ${week.className}`}
                        title={`Week ${week.weekNum}: ${week.label}`}
                      >
                        {week.symbol}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="bets-standings-num-col">{team.wins}</td>
                <td className="bets-standings-num-col">{team.submissions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
