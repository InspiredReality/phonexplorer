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

  // The scene offers two things via Needle's built-in menu that we want a
  // single dismiss for: the networked "Join Room" button (from SyncedRoom)
  // and the "Open on Quest" button (added by WebXR — asynchronously, after
  // it checks VR support, so it may not exist yet when this effect runs).
  useEffect(() => {
    let questObserver = null;

    const unsubscribe = onStart((ctx) => {
      const room = findObjectOfType(SyncedRoom, ctx);
      if (!room || !ctx.menu) return;

      const questSelector = '[data-needle="webxr-sendtoquest-button"]';
      // `_menu`/`options` aren't part of the public NeedleMenu API (there's
      // no public "remove a button" method), but they're the live container
      // Needle itself appends every menu button into.
      const optionsContainer = ctx.menu._menu?.options ?? null;

      let questButton = optionsContainer?.querySelector(questSelector) ?? null;
      if (optionsContainer && !questButton) {
        questObserver = new MutationObserver(() => {
          const found = optionsContainer.querySelector(questSelector);
          if (found) {
            questButton = found;
            questObserver?.disconnect();
          }
        });
        questObserver.observe(optionsContainer, { childList: true });
      }

      let dismissButton;
      dismissButton = ctx.menu.appendChild({
        label: '✕',
        title: 'Dismiss the Join Room / Open on Quest options',
        priority: 91,
        onClick: () => {
          room.enabled = false; // removes the Join/Leave Room button and leaves the room
          (questButton ?? optionsContainer?.querySelector(questSelector))?.remove();
          questObserver?.disconnect();
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

    return () => {
      unsubscribe?.();
      questObserver?.disconnect();
    };
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
