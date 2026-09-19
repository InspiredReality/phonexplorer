import { useNavigate } from 'react-router-dom';
import '@needle-tools/engine';
import './NeedlePage.css';

export default function DripPage() {
  const navigate = useNavigate();

  return (
    <div className="needle-wrapper">
      <div className="needle-sidebar">
        <button className="needle-side-btn needle-side-btn--back" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
      </div>

      <div className="needle-viewport">
        <needle-engine
          src="/Drop.glb"
          camera-controls
          background-color="transparent"
          environment-image="studio"
          contact-shadows
        ></needle-engine>
        <h1 className="needle-title">Drip</h1>
      </div>
    </div>
  );
}
