import { useEffect, useState } from 'react';
import { onInitialized } from '@needle-tools/engine';
import '@needle-tools/engine';
import { useNavigate } from 'react-router-dom';
import './NeedlePage.css';

export default function NeedlePage() {
  const [context, setContext] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    return onInitialized(ctx => setContext(ctx));
  }, []);

  useEffect(() => {
    if (!context) return;
    console.log('Scene ready', context.scene);
  }, [context]);

  return (
    <div className="needle-wrapper">
      <div className="needle-sidebar">
        <button className="needle-side-btn" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
        <button className="needle-side-btn">
          Option 1
        </button>
        <button className="needle-side-btn">
          Option 2
        </button>
        <button className="needle-side-btn">
          Option 3
        </button>
      </div>

      <div className="needle-viewport">
        <needle-engine
          src="/Needle%201.glb"
          camera-controls
          background-color="transparent"
          environment-image="studio"
          contact-shadows
        ></needle-engine>
        <h1 className="needle-title">Needle</h1>
      </div>
    </div>
  );
}
