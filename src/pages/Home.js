import { useNavigate } from 'react-router-dom';
import './Home.css';

function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <button className="enter-btn" onClick={() => navigate('/explorer')}>
        enter
      </button>
    </div>
  );
}

export default Home;
