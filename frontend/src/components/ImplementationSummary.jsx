import { useEffect, useState } from 'react';
import './ImplementationSummary.css';

// Implementation summary shown at the top of the project page:
//   - a phase table  POV | Kickoff | Onboarding | Go Live | Success  with a date row
//   - the Business Goals list (subtasks of "Document Business Goals", then the board's
//     milestones) with a due date each
//
// Props: groups = `groups` from GET /api/monday/project; boardId = project.board.id
//
// Dates:
//   POV start     typed in here (no Salesforce link); saved in this browser, per board
//   Kickoff       the earliest Agenda Date on the board (falls back to the earliest Timeline start)
//   Go Live       the date of the "Onboarding Complete" milestone
//   Onboarding / Success have no date: they are running timelines
//   Goal due      defaults to the subtask's Timeline end date (a milestone's date); editable, saved in this browser

const GOALS_TASK = 'document business goals';
const GO_LIVE_ITEM = 'onboarding complete';

const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmt = iso => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : dayFormat.format(date);
};

const storageKey = boardId => `monday-project-summary:${boardId}`;

function loadSaved(boardId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(boardId))) ?? {};
  } catch {
    return {};
  }
}

export default function ImplementationSummary({ groups, boardId }) {
  const [saved, setSaved] = useState(() => loadSaved(boardId));
  useEffect(() => { setSaved(loadSaved(boardId)); }, [boardId]);

  function update(patch) {
    setSaved(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(storageKey(boardId), JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }

  const tasks = (groups ?? []).flatMap(g => g.tasks);

  // Kickoff: earliest Agenda Date, else earliest Timeline start.
  const earliest = list => list.filter(Boolean).map(d => d.slice(0, 10)).sort()[0] ?? null;
  const agendaStart = earliest(tasks.map(t => t.agenda_date));
  const kickoff = agendaStart ?? earliest(tasks.map(t => t.timeline?.from));
  const kickoffFromTimeline = !agendaStart && !!kickoff;

  // Go Live: the "Onboarding Complete" milestone's date.
  const goLiveItem = tasks.find(t => t.name.trim().toLowerCase() === GO_LIVE_ITEM);
  const goLive = goLiveItem?.timeline?.from ?? goLiveItem?.agenda_date ?? null;

  // Business Goals: subtasks of "Document Business Goals", followed by the board's milestones.
  const goalsTask = tasks.find(t => t.name.trim().toLowerCase().includes(GOALS_TASK));
  const goalItems = (goalsTask?.subtasks ?? []).map(g => ({
    id: g.id, name: g.name, milestone: false, done: false, due: (g.timeline?.to ?? '').slice(0, 10),
  }));
  const milestoneItems = tasks
    .filter(t => t.milestone)
    .map(t => ({
      id: t.id, name: t.name, milestone: true,
      done: (t.status || '').trim().toLowerCase() === 'done',
      due: (t.timeline?.from ?? t.agenda_date ?? '').slice(0, 10),
    }))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const goals = [...goalItems, ...milestoneItems];

  return (
    <section className="is-card">
      <h2 className="is-title">Implementation</h2>

      <div className="is-scroll">
        <table className="is-table">
          <thead>
            <tr>
              <th>POV</th>
              <th>Kickoff</th>
              <th>Onboarding</th>
              <th>Go Live</th>
              <th>Success</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input
                  type="date"
                  className="is-date"
                  aria-label="POV start date"
                  value={saved.povStart ?? ''}
                  onChange={e => update({ povStart: e.target.value })}
                />
                <span className="is-note">start date</span>
              </td>
              <td>
                <span className="is-value">{fmt(kickoff) ?? '—'}</span>
                <span className="is-note">{kickoffFromTimeline ? 'earliest timeline start' : 'earliest agenda date'}</span>
              </td>
              <td className="is-running"><span>running timeline</span></td>
              <td>
                <span className="is-value">{fmt(goLive) ?? '—'}</span>
                <span className="is-note">Onboarding Complete</span>
              </td>
              <td className="is-running"><span>running timeline</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="is-subtitle">Business Goals</h3>
      {goals.length === 0 ? (
        <p className="is-empty">
          {goalsTask ? 'No subtasks on "Document Business Goals" and no milestones.' : 'No "Document Business Goals" task and no milestones on this board.'}
        </p>
      ) : (
        <ol className="is-goals">
          {goals.map(goal => (
            <li key={goal.id} className={`is-goal${goal.milestone ? ' is-goal--milestone' : ''}`}>
              <span className="is-goal__name">
                {goal.milestone && (
                  <span className={`is-diamond${goal.done ? ' is-diamond--done' : ''}`} title={goal.done ? 'Milestone done' : 'Milestone'} />
                )}
                {goal.name}
                {goal.milestone && <span className="is-tag">Milestone</span>}
              </span>
              <label className="is-goal__due">
                <span>Due</span>
                <input
                  type="date"
                  className="is-date"
                  value={saved.goalDue?.[goal.id] ?? goal.due}
                  onChange={e => update({ goalDue: { ...saved.goalDue, [goal.id]: e.target.value } })}
                />
              </label>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
