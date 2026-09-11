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
    <div className="needle-container">
      <button className="needle-back-btn" onClick={() => navigate('/')}>
        ← Back
      </button>
      <needle-engine
        src="/Needle%201.glb"
        camera-controls
        background-color="transparent"
        environment-image="studio"
        contact-shadows
      ></needle-engine>
    </div>
  );
}
