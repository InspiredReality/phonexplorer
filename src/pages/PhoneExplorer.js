import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './PhoneExplorer.css';

// Seeded random to get consistent but varied positions
function seededRandom(seed) {
  const results = [];
  let s = seed;
  for (let i = 0; i < 100; i++) {
    s = (s * 9301 + 49297) % 233280;
    results.push((s / 233280) * 20 - 10); // range -10 to 10
  }
  return results;
}

function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111122);

  // Ambient + directional light
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  const rnd = seededRandom(42);
  let ri = 0;
  const next3 = () => [rnd[ri++], rnd[ri++], rnd[ri++]];

  const matSphere = new THREE.MeshStandardMaterial({ color: 0x4488ff, metalness: 0.3, roughness: 0.6 });
  const matCube = new THREE.MeshStandardMaterial({ color: 0xff6644, metalness: 0.3, roughness: 0.6 });
  const matTetra = new THREE.MeshStandardMaterial({ color: 0x44cc88, metalness: 0.3, roughness: 0.6 });

  // 4 Spheres
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), matSphere);
    const [x, y, z] = next3();
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }

  // 5 Cubes
  for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), matCube);
    const [x, y, z] = next3();
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }

  // 3 Tetrahedrons (icosahedron detail=0 gives tetrahedron-like, use TetrahedronGeometry)
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.7), matTetra);
    const [x, y, z] = next3();
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }

  // Bounding wireframe box so the 20x20x20 space is visible
  const boxHelper = new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10)),
    0x333355
  );
  scene.add(boxHelper);

  // Grid floor
  const grid = new THREE.GridHelper(20, 20, 0x222244, 0x222244);
  grid.position.y = -10;
  scene.add(grid);

  return scene;
}

function PhoneExplorer() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.1, 200);
    camera.position.set(0, 0, 12);

    // --- Scene ---
    const scene = buildScene();

    // --- State ---
    // Camera orientation stored as yaw (horizontal) and pitch (vertical)
    let yaw = 0;    // radians
    let pitch = 0;  // radians

    // Apply orientation to camera
    const applyOrientation = () => {
      const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
    };
    applyOrientation();

    // --- Touch helpers ---
    let activeTouches = {};

    const getDistance = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // For one-finger swipe
    let lastSingleX = null;
    let lastSingleY = null;

    // For two-finger pinch
    let lastPinchDist = null;

    const LOOK_SPEED = 0.003;   // radians per pixel
    const MOVE_SPEED = 0.018;   // units per pixel of pinch delta

    const onTouchStart = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        activeTouches[t.identifier] = { clientX: t.clientX, clientY: t.clientY };
      }

      const ids = Object.keys(activeTouches);
      if (ids.length === 1) {
        lastSingleX = activeTouches[ids[0]].clientX;
        lastSingleY = activeTouches[ids[0]].clientY;
        lastPinchDist = null;
      } else if (ids.length >= 2) {
        lastSingleX = null;
        lastSingleY = null;
        const [a, b] = ids;
        lastPinchDist = getDistance(activeTouches[a], activeTouches[b]);
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        activeTouches[t.identifier] = { clientX: t.clientX, clientY: t.clientY };
      }

      const ids = Object.keys(activeTouches);

      if (ids.length === 1) {
        // One finger: camera look (opposite direction of swipe)
        const cx = activeTouches[ids[0]].clientX;
        const cy = activeTouches[ids[0]].clientY;

        if (lastSingleX !== null) {
          const dx = cx - lastSingleX;
          const dy = cy - lastSingleY;
          // Opposite: negate dx/dy for yaw/pitch
          yaw -= dx * LOOK_SPEED;
          pitch -= dy * LOOK_SPEED;
          pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
          applyOrientation();
        }

        lastSingleX = cx;
        lastSingleY = cy;
      } else if (ids.length >= 2) {
        // Two fingers: pinch
        const [a, b] = ids;
        const dist = getDistance(activeTouches[a], activeTouches[b]);

        if (lastPinchDist !== null) {
          const delta = dist - lastPinchDist; // positive = zoom in, negative = pinch out
          // Forward direction in world space
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          // zoom in (fingers spread) = move forward; pinch (fingers close) = move backward
          camera.position.addScaledVector(forward, delta * MOVE_SPEED);
        }

        lastPinchDist = dist;
        lastSingleX = null;
        lastSingleY = null;
      }
    };

    const onTouchEnd = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        delete activeTouches[t.identifier];
      }

      const ids = Object.keys(activeTouches);
      lastPinchDist = null;

      if (ids.length === 1) {
        lastSingleX = activeTouches[ids[0]].clientX;
        lastSingleY = activeTouches[ids[0]].clientY;
      } else {
        lastSingleX = null;
        lastSingleY = null;
      }
    };

    mount.addEventListener('touchstart', onTouchStart, { passive: false });
    mount.addEventListener('touchmove', onTouchMove, { passive: false });
    mount.addEventListener('touchend', onTouchEnd, { passive: false });
    mount.addEventListener('touchcancel', onTouchEnd, { passive: false });

    // --- Resize ---
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // --- Animation loop ---
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      mount.removeEventListener('touchstart', onTouchStart);
      mount.removeEventListener('touchmove', onTouchMove);
      mount.removeEventListener('touchend', onTouchEnd);
      mount.removeEventListener('touchcancel', onTouchEnd);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="explorer-wrapper">
      <h1 className="explorer-title">Phone Explorer</h1>
      <div className="hint">
        <span>1 finger swipe = look</span>
        <span>2 finger spread = forward</span>
        <span>2 finger pinch = backward</span>
      </div>
      <div ref={mountRef} className="canvas-mount" />
    </div>
  );
}

export default PhoneExplorer;
