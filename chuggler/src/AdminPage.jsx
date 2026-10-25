import { useEffect, useState } from 'react';
import api from './services/api';
import { TEAMS } from './teams';
import './AdminPage.css';

const WEEK_COUNT = 15;
const TOKEN_KEY = 'bets-admin-token';

function useAdminToken() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');

  const setAndPersist = (value) => {
    sessionStorage.setItem(TOKEN_KEY, value);
    setToken(value);
  };

  const clear = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
  };

  return { token, setAndPersist, clear };
}

export default function AdminPage() {
  const { token, setAndPersist, clear } = useAdminToken();
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState(false);

  const [season, setSeason] = useState(null);
  const [locks, setLocks] = useState({});
  const [seasonStartInput, setSeasonStartInput] = useState('');
  const [forcedWeekInput, setForcedWeekInput] = useState('');
  const [status, setStatus] = useState('');
  // Ranked list of { team_id, rank, wins, points_for, points_against }.
  // Sets both the picks accordions' team order and the Season
  // Contributions table's default (unsorted) order.
  const [teamStandings, setTeamStandings] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);

  const authHeader = { Authorization: `Bearer ${token}` };

  const loadData = async () => {
    try {
      const { data } = await api.get('/api/bets');
      setSeason(data.season);
      setLocks(data.locks || {});
      setSeasonStartInput(data.season.season_start);
      setForcedWeekInput(data.season.forced_active_week ?? '');
      setTeamStandings([...(data.team_standings || [])].sort((a, b) => a.rank - b.rank));
    } catch (err) {
      setStatus('Failed to load: ' + err.message);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handle401 = (err) => {
    if (err.status === 401) {
      clear();
      setAuthError(true);
      return true;
    }
    return false;
  };

  const handleUnlockToken = (event) => {
    event.preventDefault();
    setAndPersist(tokenInput);
    setAuthError(false);
    setTokenInput('');
  };

  const handleSaveSeason = async () => {
    setStatus('Saving…');
    try {
      const body = { season_start: seasonStartInput };
      if (forcedWeekInput === '') {
        body.clear_forced_active_week = true;
      } else {
        body.forced_active_week = Number(forcedWeekInput);
      }
      const { data } = await api.put('/api/bets/season', body, { headers: authHeader });
      setSeason(data);
      setStatus('Saved.');
    } catch (err) {
      if (handle401(err)) return;
      setStatus('Failed: ' + err.message);
    }
  };

  const handleToggleLock = async (weekNum) => {
    const weekId = `week${weekNum}`;
    const nextLocked = !locks[weekId];
    setStatus(`Updating Week ${weekNum}…`);
    try {
      await api.put(`/api/bets/${weekNum}/lock`, { locked: nextLocked }, { headers: authHeader });
      setLocks((prev) => ({ ...prev, [weekId]: nextLocked }));
      setStatus('');
    } catch (err) {
      if (handle401(err)) return;
      setStatus('Failed: ' + err.message);
    }
  };

  const handleCleanup = async () => {
    const confirmed = window.confirm(
      'Delete every stale entry: empty picks with a leftover status, and anything sitting in a ' +
        'week that isn\'t visible yet. This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    setStatus('Cleaning up…');
    try {
      const { data } = await api.post('/api/bets/cleanup', undefined, { headers: authHeader });
      setStatus(`Deleted ${data.deleted} stale entr${data.deleted === 1 ? 'y' : 'ies'}.`);
      loadData();
    } catch (err) {
      if (handle401(err)) return;
      setStatus('Failed: ' + err.message);
    }
  };

  const persistTeamOrder = async (list) => {
    setStatus('Saving team order…');
    try {
      const { data } = await api.put(
        '/api/bets/team-order',
        { order: list.map((row) => row.team_id) },
        { headers: authHeader }
      );
      setTeamStandings([...data].sort((a, b) => a.rank - b.rank));
      setStatus('');
    } catch (err) {
      if (handle401(err)) return;
      setStatus('Failed to save team order: ' + err.message);
      loadData(); // revert the optimistic reorder to whatever's actually saved
    }
  };

  // Shared by both the drag-and-drop handlers and the ▲/▼ buttons below, so
  // reordering works the same way whether or not a mouse is available.
  const moveTeam = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= teamStandings.length || fromIndex === toIndex) return;
    const list = [...teamStandings];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    setTeamStandings(list);
    persistTeamOrder(list);
  };

  const handleDragStart = (index) => (event) => {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index)); // Firefox won't start a drag without this
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (index) => (event) => {
    event.preventDefault();
    if (dragIndex !== null && dragIndex !== index) moveTeam(dragIndex, index);
    setDragIndex(null);
  };

  if (!token || authError) {
    return (
      <div className="admin-page">
        <h1 className="admin-heading">Admin</h1>
        <form className="admin-token-form" onSubmit={handleUnlockToken}>
          <input
            type="password"
            placeholder="Admin token"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            autoFocus
          />
          <button type="submit">Enter</button>
        </form>
        {authError && <p className="admin-error">Wrong token.</p>}
      </div>
    );
  }

  return (
    <div className="admin-page">
      <h1 className="admin-heading">Admin</h1>
      {status && <p className="admin-status">{status}</p>}

      <section className="admin-section">
        <h2>Team order</h2>
        <p className="admin-hint">
          Sets both the pick accordions' team order and the Hit Rate table's default (unsorted)
          order. Drag a row by its handle, or use the ▲/▼ buttons to reorder without a
          mouse. Wins/PF/PA are placeholders for a future stats feed — not editable here yet.
        </p>
        <table className="admin-order-table">
          <thead>
            <tr>
              <th className="admin-order-handle-col" aria-hidden="true" />
              <th className="admin-order-rank-col">Rank</th>
              <th>Team</th>
              <th className="admin-order-num-col">Wins</th>
              <th className="admin-order-num-col">PF</th>
              <th className="admin-order-num-col">PA</th>
              <th className="admin-order-move-col" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {teamStandings.map((row, index) => {
              const team = TEAMS.find((t) => t.id === row.team_id);
              if (!team) return null;
              return (
                <tr
                  key={row.team_id}
                  draggable
                  onDragStart={handleDragStart(index)}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop(index)}
                  onDragEnd={() => setDragIndex(null)}
                  className={`admin-order-row ${dragIndex === index ? 'is-dragging' : ''}`}
                >
                  <td className="admin-order-handle-col">
                    <span className="admin-order-handle" aria-hidden="true">
                      ⠿
                    </span>
                  </td>
                  <td className="admin-order-rank-col">{index + 1}</td>
                  <td className="admin-order-team">
                    <img
                      className="admin-order-logo"
                      src={team.logo}
                      alt=""
                      width={36}
                      height={36}
                      loading="lazy"
                    />
                    <span>{team.name}</span>
                  </td>
                  <td className="admin-order-num-col">{row.wins}</td>
                  <td className="admin-order-num-col">{row.points_for}</td>
                  <td className="admin-order-num-col">{row.points_against}</td>
                  <td className="admin-order-move-col">
                    <button
                      type="button"
                      className="admin-order-move-btn"
                      onClick={() => moveTeam(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${team.name} up`}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="admin-order-move-btn"
                      onClick={() => moveTeam(index, index + 1)}
                      disabled={index === teamStandings.length - 1}
                      aria-label={`Move ${team.name} down`}
                    >
                      ▼
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Lock weekly inputs</h2>
        <p className="admin-hint">Locking a week stops picks/status from being edited for it, everywhere.</p>
        <div className="admin-lock-grid">
          {Array.from({ length: WEEK_COUNT }, (_, i) => i + 1).map((weekNum) => {
            const weekId = `week${weekNum}`;
            const locked = !!locks[weekId];
            return (
              <button
                key={weekId}
                type="button"
                className={`admin-lock-btn ${locked ? 'is-locked' : ''}`}
                onClick={() => handleToggleLock(weekNum)}
              >
                Week {weekNum} {locked ? '🔒' : '🔓'}
              </button>
            );
          })}
        </div>
      </section>

      <section className="admin-section">
        <h2>Data cleanup</h2>
        <p className="admin-hint">
          Removes entries that shouldn't count: an empty pick with a leftover won/loss status from
          before it was cleared, and anything sitting in a week that isn't visible yet.
        </p>
        <button type="button" className="admin-cleanup-btn" onClick={handleCleanup}>
          Clean up stale entries
        </button>
      </section>

      <section className="admin-section">
        <h2>Season</h2>
        <label className="admin-field">
          Week 1 start date
          <input
            type="date"
            value={seasonStartInput}
            onChange={(event) => setSeasonStartInput(event.target.value)}
          />
        </label>
        <label className="admin-field">
          Force active week (blank = auto)
          <input
            type="number"
            min="1"
            max={WEEK_COUNT}
            value={forcedWeekInput}
            onChange={(event) => setForcedWeekInput(event.target.value)}
            placeholder="auto"
          />
        </label>
        <button type="button" className="admin-save-btn" onClick={handleSaveSeason}>
          Save
        </button>
        {season && <p className="admin-hint">Currently showing weeks 1–{season.active_week}.</p>}
      </section>
    </div>
  );
}
