import { useNavigate } from 'react-router-dom';
import '@needle-tools/engine';
import './DripPage.css';

// `embedded` is set when DripPage is mounted inside another page (e.g. the
// Config Test accordions) — there it has no reason to offer its own way
// back to the home screen, so the sidebar/back button are skipped entirely.
export default function DripPage({ embedded = false }) {
  const navigate = useNavigate();

  return (
    <div className="drip-wrapper">
      {!embedded && (
        <div className="drip-sidebar">
          <button className="drip-side-btn drip-side-btn--back" onClick={() => navigate('/')}>
            ← Back to Home
          </button>
        </div>
      )}

      <div className="drip-viewport">
        <needle-engine
          src="/Drop.glb"
          camera-controls
          background-color="transparent"
          environment-image="studio"
          contact-shadows
        ></needle-engine>
        <h1 className="drip-title">Drip</h1>
      </div>
    </div>
  );
}
