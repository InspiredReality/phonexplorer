import { useNavigate } from 'react-router-dom';
import './Home.css';

function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <div className="home-buttons">
        <button className="home-btn" onClick={() => navigate('/explorer')}>
          enter
        </button>
        <button className="home-btn home-btn--assign" onClick={() => navigate('/assign')}>
          assign
        </button>
        <button className="home-btn home-btn--monday" onClick={() => navigate('/monday')}>
          monday
        </button>
        <button className="home-btn home-btn--realities" onClick={() => navigate('/realities')}>
          realities
        </button>
        <button className="home-btn home-btn--deep" onClick={() => navigate('/deep')}>
          deep
        </button>
        <button className="home-btn home-btn--stickers" onClick={() => navigate('/stickers')}>
          stickers
        </button>
        <button className="home-btn home-btn--needle" onClick={() => navigate('/needle')}>
          needle
        </button>
        <button className="home-btn home-btn--drip" onClick={() => navigate('/drip')}>
          drip
        </button>
        <button className="home-btn home-btn--config-test" onClick={() => navigate('/config-test')}>
          config test
        </button>
        <button className="home-btn home-btn--bets" onClick={() => navigate('/bets')}>
          bets
        </button>
      </div>
    </div>
  );
}

export default Home;