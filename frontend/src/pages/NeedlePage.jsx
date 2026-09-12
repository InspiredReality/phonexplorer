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

  // Reflect state changes the 3D scene reports back (e.g. once an animation starts).
  useEffect(() => {
    const el = document.querySelector('needle-engine');
    const onChanged = (evt) => setActiveState(evt.detail?.code ?? null);
    el?.addEventListener('app-state-changed', onChanged);
    return () => el?.removeEventListener('app-state-changed', onChanged);
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
