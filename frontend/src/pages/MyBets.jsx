import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import api from '../services/api';
import './MyBets.css';

const WEEK_COUNT = 15;
const STORAGE_KEY = 'phonexplorer-my-bets-picks-v1';

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

function weekNumber(weekId) {
  return Number(weekId.slice(4));
}

function formatGameDate(isoDate) {
  if (!isoDate) return { day: 'TBD', time: '' };
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return { day: 'TBD', time: '' };
  const day = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });
  const time = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return { day, time };
}

// Odds are signed numbers where the sign matters (e.g. +150 vs -180), but
// JS's default number-to-string drops the "+" on positive values.
function formatSigned(value) {
  if (value === null || value === undefined) return '—';
  return value > 0 ? `+${value}` : `${value}`;
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

// One column = one team. The logo always picks the moneyline (straight-up)
// winner; once ATS is unlocked for the week, the number beneath the logo
// switches from a plain moneyline readout to a clickable spread pick.
function TeamPickColumn({ team, moneyline, spread, mlPicked, atsPicked, atsUnlocked, onMlClick, onAtsClick }) {
  if (!team) return <div className="mybets-team-col" />;
  return (
    <div className="mybets-team-col">
      <button
        type="button"
        className={`mybets-team-logo-btn ${mlPicked ? 'is-picked' : ''}`}
        onClick={onMlClick}
        title={mlPicked ? `${team.name} — your moneyline pick` : `Pick ${team.name} to win`}
      >
        <span className="mybets-team-icon-ring">
          <img className="mybets-team-icon" src={team.logo} alt="" width={36} height={36} loading="lazy" />
        </span>
        <span className="mybets-team-name">{team.name}</span>
      </button>
      {atsUnlocked ? (
        <button
          type="button"
          className={`mybets-spread-btn ${atsPicked ? 'is-picked' : ''}`}
          onClick={onAtsClick}
          title={atsPicked ? `${team.name} — your ATS pick` : `Pick ${team.name} against the spread`}
        >
          {formatSigned(spread)}
        </button>
      ) : (
        <span className="mybets-team-odds">{formatSigned(moneyline)}</span>
      )}
    </div>
  );
}

function MyBets() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState({});
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

  const handleChange = (weekId) => (_event, isExpanded) => {
    setExpanded((prev) => ({ ...prev, [weekId]: isExpanded }));
    if (isExpanded) loadSchedule(weekId);
  };

  const handlePick = (weekId, gameId, market, teamId) => () => {
    const current = picks[weekId]?.[gameId]?.[market];
    const nextTeamId = current === teamId ? null : teamId;

    setPicks((prev) => {
      const gamePicks = { ...prev[weekId]?.[gameId] };
      if (nextTeamId) gamePicks[market] = nextTeamId;
      else delete gamePicks[market];
      const weekPicks = { ...prev[weekId], [gameId]: gamePicks };
      const next = { ...prev, [weekId]: weekPicks };
      persistLocalPicks(next);
      return next;
    });

    api
      .put(`/api/nfl/picks/${weekNumber(weekId)}/${gameId}/${market}`, { team_id: nextTeamId })
      .catch((err) => console.error('Failed to save pick', weekId, gameId, market, err));
  };

  return (
    <div className="mybets-page">
      <button className="mybets-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="mybets-heading">My Bets</h1>
      {loadError && <p className="mybets-load-error">{loadError}</p>}

      <div className="mybets-accordions">
        {WEEKS.slice(0, activeWeek).map((weekId, weekIdx) => {
          const schedule = schedules[weekId];
          const games = schedule?.games || [];
          const weekPicks = picks[weekId] || {};
          const moneylineCount = games.filter((g) => weekPicks[g.id]?.moneyline).length;
          const atsCount = games.filter((g) => weekPicks[g.id]?.ats).length;
          const atsUnlocked = games.length > 0 && moneylineCount === games.length;

          return (
            <Accordion
              key={weekId}
              expanded={!!expanded[weekId]}
              onChange={handleChange(weekId)}
              disableGutters
              sx={{
                bgcolor: '#111122',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary
                expandIcon={<span className="mybets-expand-icon">▾</span>}
                sx={{
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.06)' },
                  '.MuiAccordionSummary-content': {
                    margin: '12px 0',
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                  },
                }}
              >
                <span className="mybets-summary-label">
                  <span className="mybets-week-label-main">Week {weekIdx + 1}</span>
                  <span className="mybets-week-label-dates">({formatWeekRange(weekIdx + 1)})</span>
                </span>
                {schedule?.status === 'loaded' && games.length > 0 && (
                  <span className="mybets-game-count">
                    ML {moneylineCount}/{games.length}
                    {atsUnlocked && <> · ATS {atsCount}/{games.length}</>}
                  </span>
                )}
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0, borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
                {(!schedule || schedule.status === 'loading') && (
                  <p className="mybets-status-text">Loading matchups…</p>
                )}
                {schedule?.status === 'error' && (
                  <p className="mybets-status-text mybets-status-error">
                    Couldn't load this week's matchups. Try reopening the week.
                  </p>
                )}
                {schedule?.status === 'loaded' && games.length === 0 && (
                  <p className="mybets-status-text">No matchups posted for this week yet.</p>
                )}
                {schedule?.status === 'loaded' && games.length > 0 && (
                  <div className="mybets-matchups">
                    <div className="mybets-matchups-header">
                      <span />
                      <span>Away</span>
                      <span>Home</span>
                    </div>
                    {games.map((game) => {
                      const gamePicks = weekPicks[game.id] || {};
                      const { day, time } = formatGameDate(game.date);
                      return (
                        <div key={game.id} className="mybets-matchup-row">
                          <div className="mybets-date-col">
                            <span className="mybets-date-day">{day}</span>
                            <span className="mybets-date-time">{time}</span>
                          </div>
                          <TeamPickColumn
                            team={game.away}
                            moneyline={game.away?.moneyline}
                            spread={game.away?.spread}
                            mlPicked={gamePicks.moneyline === game.away?.id}
                            atsPicked={gamePicks.ats === game.away?.id}
                            atsUnlocked={atsUnlocked}
                            onMlClick={handlePick(weekId, game.id, 'moneyline', game.away?.id)}
                            onAtsClick={handlePick(weekId, game.id, 'ats', game.away?.id)}
                          />
                          <TeamPickColumn
                            team={game.home}
                            moneyline={game.home?.moneyline}
                            spread={game.home?.spread}
                            mlPicked={gamePicks.moneyline === game.home?.id}
                            atsPicked={gamePicks.ats === game.home?.id}
                            atsUnlocked={atsUnlocked}
                            onMlClick={handlePick(weekId, game.id, 'moneyline', game.home?.id)}
                            onAtsClick={handlePick(weekId, game.id, 'ats', game.home?.id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </div>
    </div>
  );
}

export default MyBets;
