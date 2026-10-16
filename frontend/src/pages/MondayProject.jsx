import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './MondayProject.css';
import OnboardingChecklist from '../components/OnboardingChecklist';
import SuccessRoadmap from '../components/SuccessRoadmap';
import RecentUpdates from '../components/RecentUpdates';
import WeeklyActivityTimeline from '../components/WeeklyActivityTimeline';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try { detail = (await res.json()).detail || detail; } catch { /* non-JSON body */ }
    throw new Error(detail);
  }
  return res.json();
}

const fetchProject = customer => getJSON(`/api/monday/project?customer=${encodeURIComponent(customer)}`);
const fetchActivity = customer => getJSON(`/api/monday/project/activity?customer=${encodeURIComponent(customer)}&days=30`);

export default function MondayProject() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState('');
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loadingA, setLoadingA] = useState(false);
  const [errorA, setErrorA] = useState(null);

  async function loadActivity(name) {
    setLoadingA(true);
    setErrorA(null);
    try {
      setActivity(await fetchActivity(name));
    } catch (err) {
      setActivity(null);
      setErrorA(err.message);
    } finally {
      setLoadingA(false);
    }
  }

  async function load(e) {
    e.preventDefault();
    const name = customer.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    setActivity(null);
    try {
      setProject(await fetchProject(name));
      loadActivity(name);
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

        {project && (
          <>
            <OnboardingChecklist groups={project.groups} />
            <SuccessRoadmap groups={project.groups} />
            {activity?.updates?.length > 0 && <RecentUpdates updates={activity.updates} />}
            <WeeklyActivityTimeline
              updates={activity?.updates}
              changes={activity?.status_changes}
              loading={loadingA}
              error={errorA}
              onRetry={() => loadActivity(customer.trim())}
              title="Activity Timeline (30 days) · By Week"
              emptyText="No updates or status changes on this board in the last 30 days."
            />
          </>
        )}
      </main>
    </div>
  );
}
