import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './MondayProject.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const FALLBACK_STATUS_COLOR = '#797e93';
const FALLBACK_GROUP_COLOR = '#579bfc';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function fetchProject(customer) {
  const res = await fetch(`${API_BASE}/api/monday/project?customer=${encodeURIComponent(customer)}`);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try { detail = (await res.json()).detail || detail; } catch { /* non-JSON body */ }
    throw new Error(detail);
  }
  return res.json();
}

function fmtDay(iso) {
  const [, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${d}`;
}

function fmtTimeline(t) {
  if (!t) return '—';
  const start = t.from.slice(0, 10);
  const end = (t.to || t.from).slice(0, 10);
  if (start === end) return fmtDay(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${fmtDay(start)} - ${sameMonth ? end.slice(8) : fmtDay(end)}`;
}

function StatusPill({ status, color }) {
  if (!status) return <span className="mp-pill mp-pill--empty">—</span>;
  return <span className="mp-pill" style={{ background: color || FALLBACK_STATUS_COLOR }}>{status}</span>;
}

function Task({ task }) {
  const [open, setOpen] = useState(false);
  const hasSubs = task.subtasks.length > 0;

  return (
    <li className="mp-task">
      <div
        className={`mp-row${hasSubs ? ' mp-row--expandable' : ''}`}
        onClick={hasSubs ? () => setOpen(o => !o) : undefined}
      >
        <span className="mp-row__name">
          {hasSubs
            ? <span className={`mp-caret${open ? ' mp-caret--open' : ''}`}>▸</span>
            : <span className="mp-caret mp-caret--none" />}
          {task.name}
        </span>
        {hasSubs && <span className="mp-subcount" title="Subitems">{task.subtasks.length}</span>}
        <StatusPill status={task.status} color={task.status_color} />
        <span className="mp-timeline">{fmtTimeline(task.timeline)}</span>
      </div>

      {hasSubs && open && (
        <ul className="mp-subtasks">
          {task.subtasks.map(s => (
            <li key={s.id} className="mp-row mp-row--sub">
              <span className="mp-row__name">{s.name}</span>
              <StatusPill status={s.status} color={s.status_color} />
              <span className="mp-timeline">{fmtTimeline(s.timeline)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Group({ group }) {
  const [open, setOpen] = useState(false);
  const color = group.color || FALLBACK_GROUP_COLOR;
  const done = group.tasks.filter(t => (t.status || '').toLowerCase() === 'done').length;

  return (
    <section className="mp-group" style={{ '--group-color': color }}>
      <button className="mp-group__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={`mp-caret${open ? ' mp-caret--open' : ''}`}>▸</span>
        <span className="mp-group__title">{group.title}</span>
        <span className="mp-group__count">{done}/{group.tasks.length}</span>
      </button>
      {open && (
        <ul className="mp-tasks">
          {group.tasks.length === 0
            ? <li className="mp-empty">No tasks in this group.</li>
            : group.tasks.map(t => <Task key={t.id} task={t} />)}
        </ul>
      )}
    </section>
  );
}

export default function MondayProject() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState('');
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(e) {
    e.preventDefault();
    const name = customer.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      setProject(await fetchProject(name));
    } catch (err) {
      setProject(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mp-page">
      <header className="mp-header">
        <button className="mp-back" onClick={() => navigate('/')}>← back</button>
        <h1 className="mp-title">{project ? project.board.name : 'Monday Project'}</h1>
      </header>

      <form className="mp-search" onSubmit={load}>
        <input
          className="mp-input"
          type="text"
          placeholder="Customer name"
          value={customer}
          onChange={e => setCustomer(e.target.value)}
          autoFocus
        />
        <button className="mp-go" type="submit" disabled={loading || !customer.trim()}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </form>

      <main className="mp-main">
        {error && <p className="mp-error">{error}</p>}
        {!project && !error && !loading && (
          <p className="mp-hint">Enter a customer name to load their Monday project board.</p>
        )}
        {project?.groups.map(g => <Group key={g.id} group={g} />)}
      </main>
    </div>
  );
}
