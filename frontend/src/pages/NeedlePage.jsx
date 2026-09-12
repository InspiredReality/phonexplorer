import { useEffect, useState } from 'react';
import { onStart, findObjectOfType } from '@needle-tools/engine';
import '@needle-tools/engine';
import { useNavigate } from 'react-router-dom';
import { AppStateController } from '../scripts/AppStateController';
import './NeedlePage.css';

const STATES = [
  { code: 'STATE_1', label: 'Animation 1', className: 'needle-side-btn--anim1' },
  { code: 'STATE_2', label: 'Animation 2', className: 'needle-side-btn--anim2' },
  { code: 'STATE_3', label: 'Animation 3', className: 'needle-side-btn--anim3' },
];

export default function NeedlePage() {
  const [activeState, setActiveState] = useState(null);
  const navigate = useNavigate();

  // Make sure the scene has a controller waiting to receive state codes.
  useEffect(() => {
    return onStart((ctx) => {
      if (!findObjectOfType(AppStateController, ctx)) {
        ctx.scene.addComponent(AppStateController);
      }
    });
  }, []);

  // Reflect state changes the 3D scene reports back: highlight as soon as a
  // transition starts, and log once it actually finishes.
  useEffect(() => {
    const el = document.querySelector('needle-engine');
    const onStarted = (evt) => setActiveState(evt.detail?.code ?? null);
    const onComplete = (evt) => console.log('Scene finished transitioning to', evt.detail?.code);
    el?.addEventListener('app-state-started', onStarted);
    el?.addEventListener('app-state-complete', onComplete);
    return () => {
      el?.removeEventListener('app-state-started', onStarted);
      el?.removeEventListener('app-state-complete', onComplete);
    };
  }, []);

  const handleState = (code) => {
    const controller = findObjectOfType(AppStateController);
    if (!controller) {
      console.warn('AppStateController not ready yet');
      return;
    }
    controller.setState(code);
  };

  return (
    <div className="needle-wrapper">
      <div className="needle-sidebar">
        <button className="needle-side-btn needle-side-btn--back" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
        {STATES.map(({ code, label, className }) => (
          <button
            key={code}
            className={`needle-side-btn ${className}${activeState === code ? ' is-active' : ''}`}
            onClick={() => handleState(code)}
          >
            {label}
          </button>
        ))}
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
