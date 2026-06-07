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
      </div>
    </div>
  );
}

export default Home;
