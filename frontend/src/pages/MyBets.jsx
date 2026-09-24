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

// One line per kickoff time, e.g. "Thu, 9/24 · 8:15 PM EDT" — shown once as
// a sub-header above every game that kicks off at that moment, instead of
// repeated per row.
function formatKickoffLabel(isoDate) {
  if (!isoDate) return 'Time TBD';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Time TBD';
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
  return `${day} · ${time}`;
}

// Games are already sorted by kickoff time; group consecutive games that
// share the same one so "Sun, 9/27 · 1:00 PM EDT" (the usual 1pm slate)
// only prints once, above all of that slot's games.
function groupGamesByKickoff(games) {
  const groups = [];
  for (const game of games) {
    const last = groups[groups.length - 1];
    if (last && last.date === game.date) last.games.push(game);
    else groups.push({ date: game.date, games: [game] });
  }
  return groups;
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

// How many prior weeks' worth of history to show per team, and how far back
// (as a count of already-loaded weeks, not calendar weeks) to fetch.
const HISTORY_WEEKS = 4;

function findTeamGame(games, teamId) {
  return games.find((g) => g.home?.id === teamId || g.away?.id === teamId);
}

function teamScoreMargin(teamId, game) {
  if (!game || !game.completed) return null;
  const isHome = game.home?.id === teamId;
  const teamScore = isHome ? game.home?.score : game.away?.score;
  const oppScore = isHome ? game.away?.score : game.home?.score;
  const spread = isHome ? game.home?.spread : game.away?.spread;
  const opponentId = isHome ? game.away?.id : game.home?.id;
  if (teamScore == null || oppScore == null) return null;
  return { teamScore, oppScore, spread, opponentId };
}

// The letter always reflects what actually happened (W/L), independent of
// any pick. state reflects whether YOUR prediction on this team was right:
// picking this team means "predicted win", picking the opponent means
// "predicted loss" — so a correctly-called loss shows a green L.
function gradeMoneylineHistory(teamId, game, gamePicks) {
  const margin = teamScoreMargin(teamId, game);
  if (!game) return { letter: null, state: 'bye' };
  if (!margin) return { letter: null, state: 'pending' };
  const { teamScore, oppScore, opponentId } = margin;
  if (teamScore === oppScore) return { letter: 'T', state: 'push' };
  const letter = teamScore > oppScore ? 'W' : 'L';

  const picked = gamePicks?.moneyline;
  let predictedWin;
  if (picked === teamId) predictedWin = true;
  else if (picked === opponentId) predictedWin = false;
  else return { letter, state: 'no-pick' };

  const correct = predictedWin ? letter === 'W' : letter === 'L';
  return { letter, state: correct ? 'correct' : 'incorrect' };
}

// label is always this team's spread for that game (so you can see the
// number even with no pick made); state grades whether your ATS pick on
// this team — cover if you picked them, no-cover if you picked their
// opponent — matched what actually happened.
function gradeAtsHistory(teamId, game, gamePicks) {
  const margin = teamScoreMargin(teamId, game);
  if (!game) return { label: null, state: 'bye' };
  if (!margin) return { label: null, state: 'pending' };
  const { teamScore, oppScore, spread, opponentId } = margin;
  const label = formatSigned(spread);
  if (spread == null) return { label, state: 'no-pick' };

  const adjusted = teamScore - oppScore + spread;
  if (adjusted === 0) return { label, state: 'push' };
  const covered = adjusted > 0;

  const picked = gamePicks?.ats;
  let predictedCover;
  if (picked === teamId) predictedCover = true;
  else if (picked === opponentId) predictedCover = false;
  else return { label, state: 'no-pick' };

  const correct = predictedCover === covered;
  return { label, state: correct ? 'correct' : 'incorrect' };
}

// priorWeekIds is nearest-week-first (last week, then the week before, …).
function buildTeamHistory(teamId, priorWeekIds, schedules, picks) {
  if (!teamId) return [];
  return priorWeekIds.map((weekId) => {
    const sched = schedules[weekId];
    if (!sched || sched.status === 'loading') {
      return { weekId, ml: { letter: null, state: 'loading' }, ats: { label: null, state: 'loading' } };
    }
    if (sched.status === 'error') {
      return { weekId, ml: { letter: null, state: 'unknown' }, ats: { label: null, state: 'unknown' } };
    }
    const game = findTeamGame(sched.games, teamId);
    const gamePicks = game ? picks[weekId]?.[game.id] : undefined;
    return {
      weekId,
      ml: gradeMoneylineHistory(teamId, game, gamePicks),
      ats: gradeAtsHistory(teamId, game, gamePicks),
    };
  });
}

const HISTORY_STATE_LABELS = {
  correct: 'predicted correctly',
  incorrect: 'predicted wrong',
  push: 'push',
  'no-pick': 'no pick made',
  bye: 'bye week',
  pending: 'not final yet',
  loading: 'loading…',
  unknown: 'unavailable',
};

// Nearest week first, each week's W/L and spread sitting side by side
// (not stacked) so the whole strip reads as one horizontal line that
// scrolls if it runs out of room, rather than wrapping to a new row.
function TeamHistoryRow({ team, history }) {
  if (!history.length) return null;
  return (
    <div className="mybets-team-history">
      {history.map((h) => (
        <div key={h.weekId} className="mybets-history-week">
          <span
            className={`mybets-history-ml mybets-history-ml--${h.ml.state}`}
            title={`Week ${weekNumber(h.weekId)}: ${team.name} ${h.ml.letter || 'bye'} — ${HISTORY_STATE_LABELS[h.ml.state] || h.ml.state}`}
          >
            {h.ml.letter || '–'}
          </span>
          <span
            className={`mybets-history-ats mybets-history-ats--${h.ats.state}`}
            title={`Week ${weekNumber(h.weekId)}: ${team.name} ATS ${h.ats.label || ''} — ${HISTORY_STATE_LABELS[h.ats.state] || h.ats.state}`}
          >
            {h.ats.label || '–'}
          </span>
        </div>
      ))}
    </div>
  );
}

// One team = one horizontal row: logo+name, then this week's pick control,
// then — stretching to fill (and scrolling if needed) the rest of the row —
// the team's history. Away/home stack as two rows so a matchup reads
// top-to-bottom instead of side by side. The logo always picks the
// moneyline (straight-up) winner; once ATS is unlocked for the week, the
// number after the name switches from a plain moneyline readout to a
// clickable spread pick. history is this team's last few weeks, nearest
// first: a W/L letter (green if your moneyline call was right) and the
// spread number (green if your ATS call was right).
function TeamPickRow({ team, moneyline, spread, mlPicked, atsPicked, atsUnlocked, onMlClick, onAtsClick, history }) {
  if (!team) return <div className="mybets-team-row" />;
  return (
    <div className="mybets-team-row">
      <button
        type="button"
        className={`mybets-team-logo-btn ${mlPicked ? 'is-picked' : ''}`}
        onClick={onMlClick}
        title={mlPicked ? `${team.name} — your moneyline pick` : `Pick ${team.name} to win`}
      >
        <span className="mybets-team-icon-ring">
          <img className="mybets-team-icon" src={team.logo} alt="" width={30} height={30} loading="lazy" />
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
      <TeamHistoryRow team={team} history={history || []} />
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

  // Nearest-first prior week ids for a given 0-based week index, capped at
  // HISTORY_WEEKS and never going before Week 1.
  const priorWeekIds = (weekIdx) => {
    const ids = [];
    for (let i = 1; i <= HISTORY_WEEKS && weekIdx - i >= 0; i++) ids.push(WEEKS[weekIdx - i]);
    return ids;
  };

  const handleChange = (weekId, weekIdx) => (_event, isExpanded) => {
    setExpanded((prev) => ({ ...prev, [weekId]: isExpanded }));
    if (isExpanded) {
      loadSchedule(weekId);
      priorWeekIds(weekIdx).forEach(loadSchedule);
    }
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
          const historyWeekIds = priorWeekIds(weekIdx);

          return (
            <Accordion
              key={weekId}
              expanded={!!expanded[weekId]}
              onChange={handleChange(weekId, weekIdx)}
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
                    {groupGamesByKickoff(games).map((group) => (
                      <div key={group.date || group.games[0].id} className="mybets-timeslot">
                        <div className="mybets-timeslot-header">{formatKickoffLabel(group.date)}</div>
                        {group.games.map((game) => {
                          const gamePicks = weekPicks[game.id] || {};
                          return (
                            <div key={game.id} className="mybets-matchup-row">
                              <div className="mybets-matchup-teams">
                                <TeamPickRow
                                  team={game.away}
                                  moneyline={game.away?.moneyline}
                                  spread={game.away?.spread}
                                  mlPicked={gamePicks.moneyline === game.away?.id}
                                  atsPicked={gamePicks.ats === game.away?.id}
                                  atsUnlocked={atsUnlocked}
                                  onMlClick={handlePick(weekId, game.id, 'moneyline', game.away?.id)}
                                  onAtsClick={handlePick(weekId, game.id, 'ats', game.away?.id)}
                                  history={buildTeamHistory(game.away?.id, historyWeekIds, schedules, picks)}
                                />
                                <span className="mybets-at-divider">@</span>
                                <TeamPickRow
                                  team={game.home}
                                  moneyline={game.home?.moneyline}
                                  spread={game.home?.spread}
                                  mlPicked={gamePicks.moneyline === game.home?.id}
                                  atsPicked={gamePicks.ats === game.home?.id}
                                  atsUnlocked={atsUnlocked}
                                  onMlClick={handlePick(weekId, game.id, 'moneyline', game.home?.id)}
                                  onAtsClick={handlePick(weekId, game.id, 'ats', game.home?.id)}
                                  history={buildTeamHistory(game.home?.id, historyWeekIds, schedules, picks)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
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
