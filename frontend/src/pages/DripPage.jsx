import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { onStart, findObjectOfType, SyncedRoom } from '@needle-tools/engine';
import '@needle-tools/engine';
import './DripPage.css';

// `embedded` is set when DripPage is mounted inside another page (e.g. the
// Config Test accordions) — there it has no reason to offer its own way
// back to the home screen, so the sidebar/back button are skipped entirely.
export default function DripPage({ embedded = false }) {
  const navigate = useNavigate();

  // The scene auto-joins/offers a networked room via Needle's built-in
  // "Join Room" menu button. Add a small "x" next to it so users can
  // dismiss that option instead of it always being there.
  useEffect(() => {
    return onStart((ctx) => {
      const room = findObjectOfType(SyncedRoom, ctx);
      if (!room || !ctx.menu) return;

      let dismissButton;
      dismissButton = ctx.menu.appendChild({
        label: '✕',
        title: 'Dismiss the networked room option',
        priority: 91,
        onClick: () => {
          room.enabled = false; // removes the Join/Leave Room button and leaves the room
          dismissButton?.remove();
        },
      });
      Object.assign(dismissButton.style, {
        borderRadius: '50%',
        width: '28px',
        height: '28px',
        lineHeight: '1',
        padding: '0',
      });
    });
  }, []);

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
