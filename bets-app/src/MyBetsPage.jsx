import { useEffect, useState } from 'react';
import api from './services/api';
import './BetsPage.css';
import './MyBetsPage.css';

const WEEK_COUNT = 15;
const STORAGE_KEY = 'phonexplorer-my-bets-picks-v1';

const WEEKS = Array.from({ length: WEEK_COUNT }, (_, i) => `week${i + 1}`);

// Same Week 1 anchor as the parlay picks page, so both pages agree on dates.
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

function weekNumber(weekId) {
  return Number(weekId.slice(4));
}

function formatGameTime(isoDate) {
  if (!isoDate) return 'Time TBD';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Time TBD';
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function loadLocalPicks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistLocalPicks(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // e.g. private browsing / storage quota — used only as a local cache anyway
  }
}

function WeekAccordion({ label, meta, expanded, onToggle, children }) {
  return (
    <div className="bets-accordion">
      <button
        type="button"
        className="bets-accordion-summary"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="bets-summary-label">{label}</span>
        <span className="bets-summary-meta">{meta}</span>
        <span className="bets-expand-icon">{expanded ? '▲' : '▾'}</span>
      </button>
      {expanded && <div className="bets-accordion-details">{children}</div>}
    </div>
  );
}

function TeamColumn({ team, picked, onClick, disabled }) {
  if (!team) return <div className="mybets-team-col" />;
  return (
    <button
      type="button"
      className={`mybets-team-col ${picked ? 'is-picked' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={picked ? `${team.name} — your pick` : `Pick ${team.name}`}
    >
      <span className="mybets-team-icon-ring">
        <img className="mybets-team-icon" src={team.logo} alt="" width={40} height={40} loading="lazy" />
      </span>
      <span className="mybets-team-name">{team.name}</span>
    </button>
  );
}

export default function MyBetsPage() {
  const [expanded, setExpanded] = useState(() =>
    Object.fromEntries(WEEKS.map((weekId) => [weekId, false]))
  );
  const [activeWeek, setActiveWeek] = useState(1);
  const [seasonYear, setSeasonYear] = useState(new Date().getUTCFullYear());
  const [schedules, setSchedules] = useState({});
  const [picks, setPicks] = useState(loadLocalPicks);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [{ data: bets }, { data: nflPicks }] = await Promise.all([
          api.get('/api/bets'),
          api.get('/api/nfl/picks'),
        ]);
        if (cancelled) return;
        setActiveWeek(bets.season?.active_week ?? 1);
        if (bets.season?.season_start) {
          setSeasonYear(new Date(bets.season.season_start).getUTCFullYear());
        }
        setPicks(nflPicks.picks || {});
        persistLocalPicks(nflPicks.picks || {});
      } catch (err) {
        console.error('Failed to load My Bets data', err);
        if (!cancelled) {
          setLoadError('Could not reach the server — showing picks saved on this device only.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadSchedule = async (weekId) => {
    if (schedules[weekId]) return; // already loaded or loading
    setSchedules((prev) => ({ ...prev, [weekId]: { status: 'loading', games: [] } }));
    try {
      const { data } = await api.get(`/api/nfl/schedule/${weekNumber(weekId)}?season=${seasonYear}`);
      setSchedules((prev) => ({ ...prev, [weekId]: { status: 'loaded', games: data.games || [] } }));
    } catch (err) {
      console.error('Failed to load NFL schedule', weekId, err);
      setSchedules((prev) => ({ ...prev, [weekId]: { status: 'error', games: [] } }));
    }
  };

  const handleToggle = (weekId) => {
    const nextExpanded = !expanded[weekId];
    setExpanded((prev) => ({ ...prev, [weekId]: nextExpanded }));
    if (nextExpanded) loadSchedule(weekId);
  };

  const handlePick = (weekId, gameId, teamId) => () => {
    const current = picks[weekId]?.[gameId];
    const nextTeamId = current === teamId ? null : teamId;

    setPicks((prev) => {
      const weekPicks = { ...prev[weekId] };
      if (nextTeamId) weekPicks[gameId] = nextTeamId;
      else delete weekPicks[gameId];
      const next = { ...prev, [weekId]: weekPicks };
      persistLocalPicks(next);
      return next;
    });

    api
      .put(`/api/nfl/picks/${weekNumber(weekId)}/${gameId}`, { team_id: nextTeamId })
      .catch((err) => console.error('Failed to save pick', weekId, gameId, err));
  };

  return (
    <div className="bets-page">
      <h1 className="bets-heading">My Bets</h1>
      <div className="bets-page-nav">
        <a className="bets-nav-btn" href="/">
          Chuggler Bets
        </a>
      </div>
      {loadError && <p className="bets-load-error">{loadError}</p>}

      <h2 className="bets-section-heading">Weekly NFL Matchups</h2>
      <div className="bets-accordions">
        {WEEKS.slice(0, activeWeek).map((weekId, weekIdx) => {
          const schedule = schedules[weekId];
          const weekPicks = picks[weekId] || {};
          return (
            <WeekAccordion
              key={weekId}
              label={
                <>
                  <span className="bets-week-label-main">Week {weekIdx + 1}</span>
                  <span className="bets-week-label-dates">({formatWeekRange(weekIdx + 1)})</span>
                </>
              }
              meta={
                schedule?.status === 'loaded' && (
                  <span className="mybets-game-count">
                    {Object.keys(weekPicks).length}/{schedule.games.length} picked
                  </span>
                )
              }
              expanded={!!expanded[weekId]}
              onToggle={() => handleToggle(weekId)}
            >
              {(!schedule || schedule.status === 'loading') && (
                <p className="mybets-status-text">Loading matchups…</p>
              )}
              {schedule?.status === 'error' && (
                <p className="mybets-status-text mybets-status-error">
                  Couldn't load this week's matchups. Try reopening the week.
                </p>
              )}
              {schedule?.status === 'loaded' && schedule.games.length === 0 && (
                <p className="mybets-status-text">No matchups posted for this week yet.</p>
              )}
              {schedule?.status === 'loaded' && schedule.games.length > 0 && (
                <div className="mybets-matchups">
                  <div className="mybets-matchups-header">
                    <span>Home</span>
                    <span className="mybets-vs" />
                    <span>Away</span>
                  </div>
                  {schedule.games.map((game) => (
                    <div key={game.id} className="mybets-matchup-row">
                      <TeamColumn
                        team={game.home}
                        picked={weekPicks[game.id] === game.home?.id}
                        onClick={handlePick(weekId, game.id, game.home?.id)}
                      />
                      <div className="mybets-matchup-meta">
                        <span className="mybets-vs-label">vs</span>
                        <span className="mybets-game-time">{formatGameTime(game.date)}</span>
                      </div>
                      <TeamColumn
                        team={game.away}
                        picked={weekPicks[game.id] === game.away?.id}
                        onClick={handlePick(weekId, game.id, game.away?.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </WeekAccordion>
          );
        })}
      </div>
    </div>
  );
}
