import { useEffect, useState } from 'react';
import { onInitialized } from '@needle-tools/engine';
import '@needle-tools/engine';
import { useNavigate } from 'react-router-dom';
import './NeedlePage.css';

const ANIMATION_LABELS = [
  '1-Sources',
  '2-Teams',
  '3-AssignFindings',
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

    // Find all animation actions in the scene
    const foundAnimations = [];

    // Search for AnimationMixer and AnimationActions
    context.scene.traverse((object) => {
      // Check for animations stored in userData (Needle exports)
      if (object.userData?.animations) {
        foundAnimations.push(...object.userData.animations);
      }
      // Check for animations directly on the object
      if (object.animations && object.animations.length > 0) {
        foundAnimations.push(...object.animations);
      }
    });

    // Also check scene animations
    if (context.scene.animations && context.scene.animations.length > 0) {
      foundAnimations.push(...context.scene.animations);
    }

    console.log('Found animations:', foundAnimations);
    console.log('Animation names:', foundAnimations.map(a => a.name));
    setAnimations(foundAnimations);
  }, [context]);

  const handleAnimation = (animIndex) => {
    setActiveAnimation(animIndex);

    if (!context) {
      console.warn('No context available');
      return;
    }

    // Handle different actions based on which button was clicked
    switch(animIndex) {
      case 1: // Animation 1 - Sources
        handleAnimation1();
        break;
      case 2: // Animation 2 - Teams (Color Switch Example)
        handleColorSwitch();
        break;
      case 3: // Animation 3 - AssignFindings
        handleAnimation3();
        break;
      default:
        console.warn('Unknown animation index:', animIndex);
    }
  };

  // Example: Find and call a method on a Needle component
  const handleColorSwitch = () => {
    // Find the ColorSwitcher component in the scene
    let colorSwitcher = null;

    context.scene.traverse((object) => {
      // Needle components are stored in the object's components
      if (object.components) {
        const switcher = object.components.find(c => c.constructor.name === 'ColorSwitcher');
        if (switcher) {
          colorSwitcher = switcher;
        }
      }
    });

    if (colorSwitcher) {
      console.log('Found ColorSwitcher, switching color');
      colorSwitcher.SwitchColor();
    } else {
      console.warn('ColorSwitcher component not found in scene');
    }
  };

  const handleAnimation1 = () => {
    // Your animation logic or other state changes
    console.log('Animation 1 triggered');

    // Example: Play an actual animation if you have one
    if (animations.length > 0) {
      const targetName = ANIMATION_LABELS[0];
      const anim = animations.find(a => a.name === targetName);

      if (anim) {
        // Animation playback logic here
        console.log('Playing animation:', anim.name);
      }
    }
  };

  const handleAnimation3 = () => {
    // Another state change example
    console.log('Animation 3 triggered');
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
