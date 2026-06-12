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
        <button className="home-btn home-btn--monday" onClick={() => navigate('/monday')}>
          monday
        </button>
        <button className="home-btn home-btn--realities" onClick={() => navigate('/realities')}>
          realities
        </button>
        <button className="home-btn home-btn--deep" onClick={() => navigate('/deep')}>
          deep
        </button>
      </div>
    </div>
  );
}

export default Home;
