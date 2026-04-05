import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './MondayPage.css';

const API_BASE = process.env.REACT_APP_API_URL || '';

async function fetchJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function useMonday() {
  const [tasks, setTasks]       = useState(null);
  const [updates, setUpdates]   = useState(null);
  const [loadingT, setLoadingT] = useState(true);
  const [loadingU, setLoadingU] = useState(true);
  const [errorT, setErrorT]     = useState(null);
  const [errorU, setErrorU]     = useState(null);

  const loadTasks = useCallback(async () => {
    setLoadingT(true);
    setErrorT(null);
    try {
      const data = await fetchJSON('/api/monday/active-items');
      setTasks(data.items ?? []);
    } catch (e) {
      setErrorT(e.message);
    } finally {
      setLoadingT(false);
    }
  }, []);

  const loadUpdates = useCallback(async () => {
    setLoadingU(true);
    setErrorU(null);
    try {
      const data = await fetchJSON('/api/monday/recent-updates?days=7');
      setUpdates(data.updates ?? []);
    } catch (e) {
      setErrorU(e.message);
    } finally {
      setLoadingU(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    loadUpdates();
  }, [loadTasks, loadUpdates]);

  return { tasks, updates, loadingT, loadingU, errorT, errorU, loadTasks, loadUpdates };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ text }) {
  if (!text) return <span className="badge badge--empty">—</span>;
  return <span className="badge">{text}</span>;
}

function TableShell({ title, count, loading, error, onRetry, children }) {
  return (
    <section className="table-card">
      <div className="table-card__header">
        <h2 className="table-card__title">
          {title}
          {count != null && !loading && (
            <span className="table-card__count">{count}</span>
          )}
        </h2>
        <button className="refresh-btn" onClick={onRetry} disabled={loading}>
          {loading ? '…' : '↻'}
        </button>
      </div>

      {loading && <div className="table-state">Loading…</div>}
      {!loading && error && (
        <div className="table-state table-state--error">
          <p>{error}</p>
          <p className="table-state--hint">
            Make sure the FastAPI backend is running and{' '}
            <code>MONDAY_API_TOKEN</code> is set.
          </p>
        </div>
      )}
      {!loading && !error && children}
    </section>
  );
}

function OpenTasksTable({ tasks, loading, error, onRetry }) {
  return (
    <TableShell
      title="Open Tasks"
      count={tasks?.length}
      loading={loading}
      error={error}
      onRetry={onRetry}
    >
      {tasks?.length === 0 ? (
        <div className="table-state">No active tasks found.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Board</th>
                <th>Group</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tasks?.map((item) => {
                const status = item.column_values?.find(c => c.type === 'color' || c.id === 'status')?.text
                  || item.column_values?.find(c => c.label)?.label;
                const due    = item.column_values?.find(c => c.type === 'date')?.date
                  || item.column_values?.find(c => c.type === 'date')?.text;
                const owner  = item.creator?.name ?? '—';

                return (
                  <tr key={item.id}>
                    <td className="task-name">{item.name}</td>
                    <td>{item.board?.name ?? '—'}</td>
                    <td>{item.group?.title ?? '—'}</td>
                    <td><StatusBadge text={status} /></td>
                    <td>{owner}</td>
                    <td>{due ? formatDate(due) : '—'}</td>
                    <td>{item.updated_at ? formatDate(item.updated_at) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TableShell>
  );
}

function RecentUpdatesTable({ updates, loading, error, onRetry }) {
  return (
    <TableShell
      title="Recent Updates"
      count={updates?.length}
      loading={loading}
      error={error}
      onRetry={onRetry}
    >
      {updates?.length === 0 ? (
        <div className="table-state">No updates in the last 7 days.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Board</th>
                <th>Author</th>
                <th>Update</th>
              </tr>
            </thead>
            <tbody>
              {updates?.map((u) => (
                <tr key={u.id}>
                  <td className="nowrap">{formatDate(u.created_at)}</td>
                  <td className="task-name">{u._item_name ?? '—'}</td>
                  <td>{u._board?.name ?? '—'}</td>
                  <td className="nowrap">{u.creator?.name ?? '—'}</td>
                  <td className="update-body">
                    {stripHtml(u.body)}
                    {u.replies?.length > 0 && (
                      <span className="reply-count">
                        {' '}· {u.replies.length} repl{u.replies.length === 1 ? 'y' : 'ies'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableShell>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim().slice(0, 200) || '(empty)';
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MondayPage() {
  const navigate = useNavigate();
  const { tasks, updates, loadingT, loadingU, errorT, errorU, loadTasks, loadUpdates } = useMonday();

  return (
    <div className="monday-page">
      <header className="monday-header">
        <button className="back-btn" onClick={() => navigate('/')}>← back</button>
        <h1 className="monday-title">
          <span className="monday-dot" />
          Monday
        </h1>
      </header>

      <main className="monday-main">
        <OpenTasksTable
          tasks={tasks}
          loading={loadingT}
          error={errorT}
          onRetry={loadTasks}
        />
        <RecentUpdatesTable
          updates={updates}
          loading={loadingU}
          error={errorU}
          onRetry={loadUpdates}
        />
      </main>
    </div>
  );
}
