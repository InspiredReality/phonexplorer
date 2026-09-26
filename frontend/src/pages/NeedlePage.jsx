import { useEffect } from 'react';
import { onStart, findObjectOfType } from '@needle-tools/engine';
import '@needle-tools/engine';
import { useNavigate } from 'react-router-dom';
import { AppStateController } from '../scripts/AppStateController';
import './NeedlePage.css';

export default function NeedlePage() {
  const navigate = useNavigate();

  // Make sure the scene has a controller waiting to receive state codes.
  useEffect(() => {
    return onStart((ctx) => {
      if (!findObjectOfType(AppStateController, ctx)) {
        ctx.scene.addComponent(AppStateController);
      }
    });
  }, []);

  return (
    <div className="needle-wrapper">
      <button className="needle-back-btn" onClick={() => navigate('/')}>
        ← Back
      </button>

      <div className="needle-viewport">
        <needle-engine
          src="/Drop.glb"
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
