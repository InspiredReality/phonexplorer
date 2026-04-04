import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import './PhoneExplorer.css';

const OBJECT_META = {
  sphere: {
    title: 'Sphere',
    description: 'A perfectly round geometric solid. Every point on its surface is equidistant from the center.',
  },
  cube: {
    title: 'Cube',
    description: 'A regular hexahedron with 6 square faces, 12 edges, and 8 vertices. One of the five Platonic solids.',
  },
  tetrahedron: {
    title: 'Tetrahedron',
    description: 'The simplest polyhedron — 4 triangular faces, 6 edges, 4 vertices. The 3D analog of the triangle.',
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

  scene.add(new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10)),
    0x333355
  ));

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 20), floorMat);
  floorMesh.position.set(0, -10.25, 0);
  scene.add(floorMesh);

  const grid = new THREE.GridHelper(20, 20, 0xcccccc, 0xcccccc);
  grid.position.y = -10.0;
  scene.add(grid);

  return { scene, interactables };
}

function PhoneExplorer() {
  const mountRef        = useRef(null);
  const infoPanelRef    = useRef(null);
  const selectedMeshRef = useRef(null);
  const dismissRef      = useRef(null);
  const strafeBarRef    = useRef(null);
  const strafeThumbRef  = useRef(null);

  const [infoPanel, setInfoPanel]       = useState(null);
  const [hintsVisible, setHintsVisible] = useState(true);

  const dismiss = useCallback(() => {
    setInfoPanel(null);
    selectedMeshRef.current = null;
  }, []);

  // Keep dismissRef in sync so the Three.js loop can call it
  useEffect(() => { dismissRef.current = dismiss; }, [dismiss]);

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

    // --- Fly-to state ---
    let flyTarget   = null;  // { pos, lookAt }
    let flyProgress = 0;
    const flyStartPos  = new THREE.Vector3();
    const flyStartQuat = new THREE.Quaternion();

    const startFly = (mesh) => {
      flyStartPos.copy(camera.position);
      flyStartQuat.copy(camera.quaternion);

      const objPos = mesh.position.clone();

      // Compute stop distance so the object fills ~screen width
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const halfSize = Math.max(size.x, size.y, size.z) / 2;

      const fovY = THREE.MathUtils.degToRad(camera.fov);
      const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
      // Distance where halfSize fills half the horizontal FOV → object fills screen width
      const stopDist = (halfSize / Math.tan(fovX / 2)) * 1.3; // 30% breathing room

      // Approach along the current camera→object axis (never overshoot)
      const dir = camera.position.clone().sub(objPos).normalize();
      const targetPos = objPos.clone().addScaledVector(dir, stopDist);

      flyTarget = { pos: targetPos, lookAt: objPos };
      flyProgress = 0;
    };

    // --- Highlight ---
    let highlighted = null;
    const setHighlight = (mesh, on) => {
      if (!mesh) return;
      mesh.material.emissive.set(on ? 0x444444 : 0x000000);
    };

    // --- Raycaster ---
    const raycaster = new THREE.Raycaster();
    const toNDC = (cx, cy) => {
      const rect = mount.getBoundingClientRect();
      return new THREE.Vector2(
        ((cx - rect.left) / rect.width)  * 2 - 1,
        -((cy - rect.top)  / rect.height) * 2 + 1
      );
    };

    const handleTap = (cx, cy, isDouble) => {
      const ndc  = toNDC(cx, cy);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(interactables);

      if (hits.length === 0) {
        setHighlight(highlighted, false);
        highlighted = null;
        selectedMeshRef.current = null;
        dismissRef.current?.();
        return;
      }

      const mesh = hits[0].object;
      const { type, index } = mesh.userData;
      const meta = OBJECT_META[type];

      setHighlight(highlighted, false);
      highlighted = mesh;
      setHighlight(highlighted, true);
      selectedMeshRef.current = mesh;

      setInfoPanel({ title: `${meta.title} ${index}`, description: meta.description });

      if (isDouble) {
        startFly(mesh);
      }
    };

    // --- Touch handling ---
    let activeTouches = {};
    const LOOK_SPEED = 0.003;
    const MOVE_SPEED = 0.018;
    let lastSingleX = null, lastSingleY = null;
    let lastPinchDist = null;

    let tapStart    = null;
    let lastTapTime = 0;
    let lastTapPos  = null;
    const TAP_MAX_MOVE  = 12;
    const TAP_MAX_MS    = 250;
    const DOUBLE_TAP_MS = 400;

    const dist2D = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

    const onTouchStart = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        activeTouches[t.identifier] = { clientX: t.clientX, clientY: t.clientY };
      }
      const ids = Object.keys(activeTouches);

      if (ids.length === 1) {
        const t = activeTouches[ids[0]];
        tapStart    = { x: t.clientX, y: t.clientY, time: Date.now(), id: ids[0] };
        lastSingleX = t.clientX;
        lastSingleY = t.clientY;
        lastPinchDist = null;
      } else if (ids.length >= 2) {
        tapStart = null; lastSingleX = null; lastSingleY = null;
        const [a, b] = ids;
        lastPinchDist = dist2D(
          activeTouches[a].clientX, activeTouches[a].clientY,
          activeTouches[b].clientX, activeTouches[b].clientY
        );
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
        if (tapStart && dist2D(cx, cy, tapStart.x, tapStart.y) > TAP_MAX_MOVE) tapStart = null;
        if (lastSingleX !== null) {
          yaw   -= (cx - lastSingleX) * LOOK_SPEED;
          pitch -= (cy - lastSingleY) * LOOK_SPEED;
          pitch  = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
          applyOrientation();
        }
        lastSingleX = cx; lastSingleY = cy;
      } else if (ids.length >= 2) {
        tapStart = null;
        const [a, b] = ids;
        const d = dist2D(
          activeTouches[a].clientX, activeTouches[a].clientY,
          activeTouches[b].clientX, activeTouches[b].clientY
        );
        if (lastPinchDist !== null) {
          const delta   = d - lastPinchDist;
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          camera.position.addScaledVector(forward, delta * MOVE_SPEED);
        }
        lastPinchDist = d; lastSingleX = null; lastSingleY = null;
      }
    };

    const onTouchEnd = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (tapStart && tapStart.id === String(t.identifier)) {
          const elapsed = Date.now() - tapStart.time;
          const moved   = dist2D(t.clientX, t.clientY, tapStart.x, tapStart.y);
          if (elapsed < TAP_MAX_MS && moved < TAP_MAX_MOVE) {
            const now      = Date.now();
            const isDouble = lastTapPos &&
              now - lastTapTime < DOUBLE_TAP_MS &&
              dist2D(t.clientX, t.clientY, lastTapPos.x, lastTapPos.y) < 40;
            handleTap(t.clientX, t.clientY, !!isDouble);
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
      } else { lastSingleX = null; lastSingleY = null; }
    };

    // Desktop
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

    // --- Strafe scrollbar ---
    const STRAFE_SPEED = 0.022;
    let strafeActiveId  = null;
    let strafeLastX     = null;

    const thumbEl  = () => strafeThumbRef.current;
    const THUMB_MAX = 90; // max px the thumb travels from center

    const setThumbX = (px, animated) => {
      const el = thumbEl();
      if (!el) return;
      el.style.transition = animated ? 'transform 0.25s ease-out' : 'none';
      el.style.transform  = `translateX(${Math.max(-THUMB_MAX, Math.min(THUMB_MAX, px))}px)`;
    };

    let thumbOffset = 0;

    const onStrafeStart = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const t = e.changedTouches[0];
      strafeActiveId = t.identifier;
      strafeLastX    = t.clientX;
      thumbOffset    = 0;
      setThumbX(0, false);
    };

    const onStrafeMove = (e) => {
      e.stopPropagation();
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== strafeActiveId) continue;
        const dx = t.clientX - strafeLastX;
        strafeLastX = t.clientX;
        thumbOffset += dx;
        setThumbX(thumbOffset, false);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(right, dx * STRAFE_SPEED);
      }
    };

    const onStrafeEnd = (e) => {
      e.stopPropagation();
      e.preventDefault();
      strafeActiveId = null;
      strafeLastX    = null;
      thumbOffset    = 0;
      setThumbX(0, true); // snap back
    };

    const strafeBar = strafeBarRef.current;
    if (strafeBar) {
      strafeBar.addEventListener('touchstart',  onStrafeStart, { passive: false });
      strafeBar.addEventListener('touchmove',   onStrafeMove,  { passive: false });
      strafeBar.addEventListener('touchend',    onStrafeEnd,   { passive: false });
      strafeBar.addEventListener('touchcancel', onStrafeEnd,   { passive: false });
    }

    // Desktop drag on strafe bar
    let strafeMouseDown = false;
    let strafeMouseLastX = null;
    const onStrafeMouseDown = (e) => {
      strafeMouseDown  = true;
      strafeMouseLastX = e.clientX;
      thumbOffset      = 0;
    };
    const onStrafeMouseMove = (e) => {
      if (!strafeMouseDown) return;
      const dx = e.clientX - strafeMouseLastX;
      strafeMouseLastX = e.clientX;
      thumbOffset += dx;
      setThumbX(thumbOffset, false);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(right, dx * STRAFE_SPEED);
    };
    const onStrafeMouseUp = () => {
      strafeMouseDown = false;
      thumbOffset = 0;
      setThumbX(0, true);
    };
    if (strafeBar) {
      strafeBar.addEventListener('mousedown', onStrafeMouseDown);
    }
    window.addEventListener('mousemove', onStrafeMouseMove);
    window.addEventListener('mouseup',   onStrafeMouseUp);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // --- Panel position update (called each frame) ---
    const tmpV  = new THREE.Vector3();
    const updatePanelPosition = () => {
      const panel = infoPanelRef.current;
      const mesh  = selectedMeshRef.current;
      if (!panel || !mesh) return;

      tmpV.copy(mesh.position);
      tmpV.project(camera);

      // If object is behind camera, hide panel
      if (tmpV.z > 1) { panel.style.display = 'none'; return; }
      panel.style.display = '';

      const w  = mount.clientWidth;
      const h  = mount.clientHeight;
      const sx = ( tmpV.x * 0.5 + 0.5) * w;
      const sy = (-tmpV.y * 0.5 + 0.5) * h;

      const pw = panel.offsetWidth  || 220;
      const ph = panel.offsetHeight || 100;
      const GAP = 14;

      let left = sx - pw / 2;
      let top  = sy - ph - GAP;

      // Clamp horizontally
      left = Math.max(8, Math.min(w - pw - 8, left));
      // If panel would clip top, flip it below the object
      if (top < 8) top = sy + GAP;

      panel.style.left = `${left}px`;
      panel.style.top  = `${top}px`;
    };

    // --- Fly-to target quaternion helper ---
    const flyTargetQuat = new THREE.Quaternion();
    const flyM          = new THREE.Matrix4();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (flyTarget) {
        flyProgress = Math.min(flyProgress + 0.04, 1);
        const t = 1 - Math.pow(1 - flyProgress, 3); // ease-out cubic

        camera.position.lerpVectors(flyStartPos, flyTarget.pos, t);

        // Build target look-at quaternion
        flyM.lookAt(flyTarget.pos, flyTarget.lookAt, camera.up);
        flyTargetQuat.setFromRotationMatrix(flyM);
        camera.quaternion.slerpQuaternions(flyStartQuat, flyTargetQuat, t);

        if (flyProgress >= 1) {
          const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
          yaw   = euler.y;
          pitch = euler.x;
          flyTarget = null;
        }
      }

      renderer.render(scene, camera);
      updatePanelPosition();
    };

    let animId;
    animate();

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(clickDebounce);
      window.removeEventListener('resize',     onResize);
      window.removeEventListener('mousemove',  onStrafeMouseMove);
      window.removeEventListener('mouseup',    onStrafeMouseUp);
      mount.removeEventListener('touchstart',  onTouchStart);
      mount.removeEventListener('touchmove',   onTouchMove);
      mount.removeEventListener('touchend',    onTouchEnd);
      mount.removeEventListener('touchcancel', onTouchEnd);
      mount.removeEventListener('click',       onMouseClick);
      mount.removeEventListener('dblclick',    onDblClick);
      if (strafeBar) {
        strafeBar.removeEventListener('touchstart',  onStrafeStart);
        strafeBar.removeEventListener('touchmove',   onStrafeMove);
        strafeBar.removeEventListener('touchend',    onStrafeEnd);
        strafeBar.removeEventListener('touchcancel', onStrafeEnd);
        strafeBar.removeEventListener('mousedown',   onStrafeMouseDown);
      }
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="explorer-wrapper">

      {/* canvas area — flex:1, fills everything above the strafe bar */}
      <div className="canvas-area">
        <div ref={mountRef} className="canvas-mount" />

        <h1 className="explorer-title">Phone Explorer</h1>

        {hintsVisible && (
          <div className="hint">
            <span>1 finger = look</span>
            <span>spread = forward</span>
            <span>pinch = back</span>
            <span>tap = info</span>
            <span>double tap = focus</span>
          </div>
        )}

        {infoPanel && (
          <div className="info-panel" ref={infoPanelRef}>
            <button className="info-close" onClick={dismiss}>✕</button>
            <h2 className="info-title">{infoPanel.title}</h2>
            <p className="info-desc">{infoPanel.description}</p>
          </div>
        )}
      </div>

      {/* strafe bar — fixed-height flex footer, always visible */}
      <div className="strafe-bar" ref={strafeBarRef}>
        <button
          className="hints-toggle"
          onClick={() => setHintsVisible(v => !v)}
        >
          {hintsVisible ? 'hints ✕' : 'hints'}
        </button>

        <div className="strafe-track">
          <div className="strafe-thumb" ref={strafeThumbRef} />
        </div>
      </div>

    </div>
  );
}

export default PhoneExplorer;
