import { useEffect, useState } from 'react';
import { onInitialized } from '@needle-tools/engine';
import '@needle-tools/engine';
import { useNavigate } from 'react-router-dom';
import './NeedlePage.css';

const ANIMATION_LABELS = [
  'Animation 1',
  'Animation 2',
  'Animation 3',
];

export default function NeedlePage() {
  const [context, setContext] = useState(null);
  const [activeAnimation, setActiveAnimation] = useState(1);
  const [animations, setAnimations] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    return onInitialized(ctx => setContext(ctx));
  }, []);

  useEffect(() => {
    if (!context) return;
    console.log('Scene ready', context.scene);

    // Find all animation clips in the loaded scene
    const foundAnimations = [];
    context.scene.traverse((object) => {
      if (object.animations && object.animations.length > 0) {
        foundAnimations.push(...object.animations);
      }
    });

    // Also check the context for animations
    if (context.mainCameraComponent?.gameObject?.animations) {
      foundAnimations.push(...context.mainCameraComponent.gameObject.animations);
    }

    console.log('Found animations:', foundAnimations);
    setAnimations(foundAnimations);
  }, [context]);

  const handleAnimation = (animIndex) => {
    setActiveAnimation(animIndex);

    if (!context || !animations.length) {
      console.warn('No context or animations available');
      return;
    }

    // Play the animation at the specified index
    const anim = animations[animIndex - 1];
    if (anim) {
      console.log('Playing animation:', anim.name);
      // Use Needle's animation system to play the animation
      if (context.mainCameraComponent?.gameObject) {
        const animator = context.mainCameraComponent.gameObject.getComponent('Animator');
        if (animator) {
          animator.play(anim.name);
        }
      }
    }
  };

  return (
    <div className="needle-wrapper">
      <div className="needle-sidebar">
        <button className="needle-side-btn needle-side-btn--back" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
        {ANIMATION_LABELS.map((label, idx) => (
          <button
            key={label}
            className={`needle-side-btn needle-side-btn--anim${idx + 1}${activeAnimation === idx + 1 ? ' is-active' : ''}`}
            onClick={() => handleAnimation(idx + 1)}
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
