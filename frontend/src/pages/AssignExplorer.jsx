import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import './AssignExplorer.css';
import { fetchObjects } from '../api';
import { makeMesh, makeLine, buildScene } from '../three/sceneBuilder';

const ORBIT_RADIUS = 16;
const ORBIT_HEIGHT = 4;
const ORBIT_SPEED  = 0.35; // radians / second

function AssignExplorer() {
  const navigate  = useNavigate();
  const mountRef  = useRef(null);
  const playingRef = useRef(true);
  const angleRef   = useRef(0);
  const resetRef   = useRef(null);

  const [playing, setPlaying] = useState(true);

  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const mount = mountRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 200);

    const scene = buildScene();

    const linesGroup = new THREE.Group();
    scene.add(linesGroup);

    const objectMeshes = {};

    (async () => {
      try {
        const objects = await fetchObjects();

        for (const obj of objects) {
          const mesh = makeMesh(obj);
          scene.add(mesh);
          objectMeshes[obj.id] = mesh;
        }

        const drawn = new Set();
        for (const obj of objects) {
          for (const relId of obj.relationships ?? []) {
            const key = [obj.id, relId].sort().join('-');
            if (drawn.has(key)) continue;
            drawn.add(key);
            const meshA = objectMeshes[obj.id];
            const meshB = objectMeshes[relId];
            if (meshA && meshB) {
              linesGroup.add(makeLine(meshA.position, meshB.position));
            }
          }
        }
      } catch (err) {
        console.error('Failed to load scene objects:', err);
      }
    })();

    resetRef.current = () => { angleRef.current = 0; };

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    let animId;
    let lastTime = performance.now();

    const animate = (now) => {
      animId = requestAnimationFrame(animate);
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (playingRef.current) {
        angleRef.current += ORBIT_SPEED * dt;
      }

      const a = angleRef.current;
      camera.position.set(Math.sin(a) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.cos(a) * ORBIT_RADIUS);
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="assign-wrapper">
      <div className="assign-sidebar">
        <button
          className="assign-side-btn assign-side-btn--play"
          onClick={() => setPlaying(true)}
          disabled={playing}
        >
          Play
        </button>
        <button
          className="assign-side-btn assign-side-btn--pause"
          onClick={() => setPlaying(false)}
          disabled={!playing}
        >
          Pause
        </button>
        <button
          className="assign-side-btn assign-side-btn--reset"
          onClick={() => resetRef.current?.()}
        >
          Reset
        </button>
      </div>

      <div className="assign-viewport">
        <div ref={mountRef} className="assign-canvas-mount" />
        <h1 className="assign-title" onClick={() => navigate('/')}>
          Phone Explorer — Preview
        </h1>
      </div>
    </div>
  );
}

export default AssignExplorer;
