import { useEffect, useState } from 'react';
import api from './services/api';
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

  const authHeader = { Authorization: `Bearer ${token}` };

  const loadData = async () => {
    try {
      const { data } = await api.get('/api/bets');
      setSeason(data.season);
      setLocks(data.locks || {});
      setSeasonStartInput(data.season.season_start);
      setForcedWeekInput(data.season.forced_active_week ?? '');
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
    </div>
  );
}
