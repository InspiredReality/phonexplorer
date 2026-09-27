import { useNavigate } from 'react-router-dom';
import BettSummaryBar from '../components/BettSummaryBar';
import { currentWeekDays, loadEntries } from './bettStuffData';
import './BettStuff.css';

function BettStuffStats() {
  const navigate = useNavigate();
  const days = currentWeekDays();
  const entries = loadEntries();

  return (
    <div className="bett-page">
      <button className="bett-back-btn" onClick={() => navigate('/')}>← Back</button>
      <h1 className="bett-heading">Bett Stuff Stats</h1>

      <BettSummaryBar days={days} entries={entries} activePage="stats" />
    </div>
  );
}

export default BettStuffStats;
