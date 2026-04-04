import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import './PhoneExplorer.css';

const OBJECT_META = {
  sphere: {
    title: 'Sphere',
    description: 'A perfectly round geometric solid. Every point on its surface is equidistant from the center. Spheres appear throughout nature in bubbles, planets, and cells.',
  },
  cube: {
    title: 'Cube',
    description: 'A regular hexahedron with 6 square faces, 12 edges, and 8 vertices. One of the five Platonic solids and the basis of much 3D level design.',
  },
  tetrahedron: {
    title: 'Tetrahedron',
    description: 'The simplest polyhedron, composed of 4 triangular faces, 6 edges, and 4 vertices. It is the 3D analog of the triangle.',
  },
};

function seededRandom(seed) {
  const results = [];
  let s = seed;
  for (let i = 0; i < 100; i++) {
    s = (s * 9301 + 49297) % 233280;
    results.push((s / 233280) * 20 - 10);
  }
  return results;
}

function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111122);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  const rnd = seededRandom(42);
  let ri = 0;
  const next3 = () => [rnd[ri++], rnd[ri++], rnd[ri++]];

  const matSphere = new THREE.MeshStandardMaterial({ color: 0x4488ff, metalness: 0.3, roughness: 0.6 });
  const matCube   = new THREE.MeshStandardMaterial({ color: 0xff6644, metalness: 0.3, roughness: 0.6 });
  const matTetra  = new THREE.MeshStandardMaterial({ color: 0x44cc88, metalness: 0.3, roughness: 0.6 });

  const interactables = [];

  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), matSphere.clone());
    mesh.position.set(...next3());
    mesh.userData = { type: 'sphere', index: i + 1 };
    scene.add(mesh);
    interactables.push(mesh);
  }

  for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), matCube.clone());
    mesh.position.set(...next3());
    mesh.userData = { type: 'cube', index: i + 1 };
    scene.add(mesh);
    interactables.push(mesh);
  }

  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.7), matTetra.clone());
    mesh.position.set(...next3());
    mesh.userData = { type: 'tetrahedron', index: i + 1 };
    scene.add(mesh);
    interactables.push(mesh);
  }

  // Bounding box
  scene.add(new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10)),
    0x333355
  ));

  // Thick white floor slab (25× the original grid line — solid geometry instead of lines)
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 20), floorMat);
  floorMesh.position.set(0, -10.25, 0); // sits just below y=-10
  scene.add(floorMesh);

  // Subtle grid lines on top of the slab for spatial reference
  const grid = new THREE.GridHelper(20, 20, 0xcccccc, 0xcccccc);
  grid.position.y = -10.0;
  scene.add(grid);

  return { scene, interactables };
}

function PhoneExplorer() {
  const mountRef  = useRef(null);
  const [infoPanel, setInfoPanel] = useState(null); // { title, description } or null

  useEffect(() => {
    const mount = mountRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.1, 200);
    camera.position.set(0, 0, 12);

    const { scene, interactables } = buildScene();

    // --- Camera orientation ---
    let yaw = 0, pitch = 0;
    const applyOrientation = () => {
      camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    };
    applyOrientation();

    // --- Camera fly-to animation ---
    let flyTarget = null;   // { pos: Vector3, lookAt: Vector3 }
    let flyProgress = 0;
    const flyStartPos = new THREE.Vector3();
    const flyStartQuat = new THREE.Quaternion();

    const startFly = (targetPos, lookAtPos) => {
      flyStartPos.copy(camera.position);
      flyStartQuat.copy(camera.quaternion);
      flyTarget = { pos: targetPos.clone(), lookAt: lookAtPos.clone() };
      flyProgress = 0;
    };

    // --- Highlight ---
    let highlighted = null;
    const setHighlight = (mesh, on) => {
      if (!mesh) return;
      mesh.material.emissive = on ? new THREE.Color(0x444444) : new THREE.Color(0x000000);
    };

    // --- Raycaster ---
    const raycaster = new THREE.Raycaster();
    const castAtNDC = (nx, ny) => {
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      return raycaster.intersectObjects(interactables);
    };

    // Convert client coords to NDC
    const toNDC = (cx, cy) => {
      const rect = mount.getBoundingClientRect();
      return {
        x: ((cx - rect.left) / rect.width)  * 2 - 1,
        y: -((cy - rect.top)  / rect.height) * 2 + 1,
      };
    };

    // --- Touch state ---
    let activeTouches = {};
    const LOOK_SPEED = 0.003;
    const MOVE_SPEED = 0.018;
    let lastSingleX = null, lastSingleY = null;
    let lastPinchDist = null;

    // Tap detection
    let tapStart = null;        // { x, y, time, id }
    let lastTapTime = 0;
    let lastTapPos  = null;
    const TAP_MAX_MOVE = 12;    // px
    const TAP_MAX_MS   = 250;
    const DOUBLE_TAP_MS = 400;

    const getDistance = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTap = (cx, cy, isDouble) => {
      const { x, y } = toNDC(cx, cy);
      const hits = castAtNDC(x, y);

      if (hits.length === 0) {
        // Tap on empty space — deselect
        setHighlight(highlighted, false);
        highlighted = null;
        setInfoPanel(null);
        return;
      }

      const mesh = hits[0].object;
      const { type, index } = mesh.userData;
      const meta = OBJECT_META[type];

      // Update highlight
      setHighlight(highlighted, false);
      highlighted = mesh;
      setHighlight(highlighted, true);

      setInfoPanel({ title: `${meta.title} ${index}`, description: meta.description });

      if (isDouble) {
        // Fly camera: object appears left-of-center, panel fills right side
        // Offset camera to the RIGHT of and behind the object so object sits left in view
        const objPos = mesh.position.clone();
        const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        const back    = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).normalize();
        // Position: step behind + shift right so object projects to left ~30% of screen
        const targetPos = objPos.clone()
          .add(right.clone().multiplyScalar(2.5))
          .add(back.clone().multiplyScalar(4))
          .add(new THREE.Vector3(0, 0.5, 0));
        startFly(targetPos, objPos);
      }
    };

    const onTouchStart = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        activeTouches[t.identifier] = { clientX: t.clientX, clientY: t.clientY };
      }
      const ids = Object.keys(activeTouches);

      if (ids.length === 1) {
        const t = activeTouches[ids[0]];
        tapStart = { x: t.clientX, y: t.clientY, time: Date.now(), id: ids[0] };
        lastSingleX = t.clientX;
        lastSingleY = t.clientY;
        lastPinchDist = null;
      } else if (ids.length >= 2) {
        tapStart = null;
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
        const cx = activeTouches[ids[0]].clientX;
        const cy = activeTouches[ids[0]].clientY;

        // Invalidate tap if moved too far
        if (tapStart) {
          const dx = cx - tapStart.x, dy = cy - tapStart.y;
          if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_MOVE) tapStart = null;
        }

        if (lastSingleX !== null) {
          yaw   -= (cx - lastSingleX) * LOOK_SPEED;
          pitch -= (cy - lastSingleY) * LOOK_SPEED;
          pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
          applyOrientation();
        }
        lastSingleX = cx;
        lastSingleY = cy;
      } else if (ids.length >= 2) {
        tapStart = null;
        const [a, b] = ids;
        const dist = getDistance(activeTouches[a], activeTouches[b]);
        if (lastPinchDist !== null) {
          const delta = dist - lastPinchDist;
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          camera.position.addScaledVector(forward, delta * MOVE_SPEED);
        }
        lastPinchDist = dist;
        lastSingleX = null;
        lastSingleY = null;
      }
    };

    const onTouchEnd = (e) => {
      e.preventDefault();

      // Check for tap before removing touch
      for (const t of e.changedTouches) {
        if (tapStart && tapStart.id === String(t.identifier)) {
          const elapsed = Date.now() - tapStart.time;
          const dx = t.clientX - tapStart.x, dy = t.clientY - tapStart.y;
          const moved = Math.sqrt(dx * dx + dy * dy);

          if (elapsed < TAP_MAX_MS && moved < TAP_MAX_MOVE) {
            const now = Date.now();
            const isDouble =
              lastTapPos &&
              now - lastTapTime < DOUBLE_TAP_MS &&
              Math.abs(t.clientX - lastTapPos.x) < 40 &&
              Math.abs(t.clientY - lastTapPos.y) < 40;

            handleTap(t.clientX, t.clientY, isDouble);
            lastTapTime = now;
            lastTapPos  = { x: t.clientX, y: t.clientY };
          }
          tapStart = null;
        }
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

    // Desktop click / dblclick
    let clickDebounce = null;
    const onMouseClick = (e) => {
      clearTimeout(clickDebounce);
      clickDebounce = setTimeout(() => handleTap(e.clientX, e.clientY, false), 180);
    };
    const onDblClick = (e) => {
      clearTimeout(clickDebounce);
      handleTap(e.clientX, e.clientY, true);
    };

    mount.addEventListener('touchstart',  onTouchStart, { passive: false });
    mount.addEventListener('touchmove',   onTouchMove,  { passive: false });
    mount.addEventListener('touchend',    onTouchEnd,   { passive: false });
    mount.addEventListener('touchcancel', onTouchEnd,   { passive: false });
    mount.addEventListener('click',       onMouseClick);
    mount.addEventListener('dblclick',    onDblClick);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // --- Animation loop ---
    const tmpQuat = new THREE.Quaternion();
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Fly-to animation
      if (flyTarget) {
        flyProgress = Math.min(flyProgress + 0.04, 1);
        const t = 1 - Math.pow(1 - flyProgress, 3); // ease-out cubic

        camera.position.lerpVectors(flyStartPos, flyTarget.pos, t);

        // Compute target quaternion by aiming at lookAt
        const dummy = new THREE.Object3D();
        dummy.position.copy(flyTarget.pos);
        dummy.lookAt(flyTarget.lookAt);
        tmpQuat.copy(dummy.quaternion);
        camera.quaternion.slerpQuaternions(flyStartQuat, tmpQuat, t);

        if (flyProgress >= 1) {
          // Sync yaw/pitch to final orientation so swipe continues from correct angles
          const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
          yaw   = e.y;
          pitch = e.x;
          flyTarget = null;
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(clickDebounce);
      window.removeEventListener('resize', onResize);
      mount.removeEventListener('touchstart',  onTouchStart);
      mount.removeEventListener('touchmove',   onTouchMove);
      mount.removeEventListener('touchend',    onTouchEnd);
      mount.removeEventListener('touchcancel', onTouchEnd);
      mount.removeEventListener('click',       onMouseClick);
      mount.removeEventListener('dblclick',    onDblClick);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="explorer-wrapper">
      <h1 className="explorer-title">Phone Explorer</h1>

      <div className="hint">
        <span>1 finger = look</span>
        <span>spread = forward</span>
        <span>pinch = back</span>
        <span>tap = info</span>
        <span>double tap = focus</span>
      </div>

      {infoPanel && (
        <div className="info-panel">
          <button className="info-close" onClick={() => setInfoPanel(null)}>✕</button>
          <h2 className="info-title">{infoPanel.title}</h2>
          <p className="info-desc">{infoPanel.description}</p>
        </div>
      )}

      <div ref={mountRef} className="canvas-mount" />
    </div>
  );
}

export default PhoneExplorer;
