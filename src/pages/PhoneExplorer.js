import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import './PhoneExplorer.css';
import { fetchObjects, createObject, addRelationship } from '../api';

// ── Three.js helpers (module-level, no React state) ────────────────────────

const GEO_FACTORIES = {
  sphere:      () => new THREE.SphereGeometry(0.5, 32, 32),
  cube:        () => new THREE.BoxGeometry(0.9, 0.9, 0.9),
  tetrahedron: () => new THREE.TetrahedronGeometry(0.7),
};

function makeMesh(obj) {
  const geo = (GEO_FACTORIES[obj.shape] || GEO_FACTORIES.sphere)();
  const mat = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(obj.color || '#4488ff'),
    metalness: 0.3,
    roughness: 0.6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(obj.x ?? 0, obj.y ?? 0, obj.z ?? 0);
  mesh.userData = {
    id:          obj.id,
    type:        obj.shape,
    customTitle: obj.title,
    customDescription: obj.description ?? '',
  };
  return mesh;
}

function makeLine(posA, posB) {
  const geo = new THREE.BufferGeometry().setFromPoints([posA.clone(), posB.clone()]);
  const mat = new THREE.LineBasicMaterial({ color: 0x8899ff, opacity: 0.65, transparent: true });
  return new THREE.Line(geo, mat);
}

function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111122);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  scene.add(new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10)),
    0x333355
  ));

  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(20, 0.5, 20),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 })
  );
  floorMesh.position.set(0, -10.25, 0);
  scene.add(floorMesh);

  const grid = new THREE.GridHelper(20, 20, 0xcccccc, 0xcccccc);
  grid.position.y = -10.0;
  scene.add(grid);

  return scene;
}

// ── Component ──────────────────────────────────────────────────────────────

function PhoneExplorer() {
  const mountRef        = useRef(null);
  const infoPanelRef    = useRef(null);
  const selectedMeshRef = useRef(null);
  const dismissRef      = useRef(null);
  const strafeBarRef    = useRef(null);
  const strafeThumbRef  = useRef(null);

  // Three.js scene bridges
  const sceneRef          = useRef(null);
  const interactablesRef  = useRef([]);
  const objectMeshesRef   = useRef({});  // id → mesh
  const linesGroupRef     = useRef(null);

  // Link-mode bridge (readable inside Three.js closure without re-creating handlers)
  const linkingFromRef    = useRef(null); // { id, mesh } | null
  const createRelationRef = useRef(null);

  const [infoPanel, setInfoPanel]       = useState(null);
  const [hintsVisible, setHintsVisible] = useState(true);
  const [strafeMode, setStrafeMode]     = useState('hor');
  const strafeModeRef                   = useRef('hor');

  const [addMenuOpen, setAddMenuOpen]   = useState(false);
  const [addForm, setAddForm]           = useState({
    object: 'sphere', title: '', description: '', x: '0', y: '0', z: '0', color: '#4488ff',
  });

  const [linkingFrom, setLinkingFrom]   = useState(null); // { id, title } — for UI only

  useEffect(() => { strafeModeRef.current = strafeMode; }, [strafeMode]);

  const dismiss = useCallback(() => {
    setInfoPanel(null);
    selectedMeshRef.current = null;
  }, []);

  useEffect(() => { dismissRef.current = dismiss; }, [dismiss]);

  // ── createRelationship: called from Three.js tap handler via ref ──────────
  const createRelationship = useCallback(async (fromId, toId) => {
    try {
      await addRelationship(fromId, toId);
      const meshA = objectMeshesRef.current[fromId];
      const meshB = objectMeshesRef.current[toId];
      if (meshA && meshB && linesGroupRef.current) {
        linesGroupRef.current.add(makeLine(meshA.position, meshB.position));
      }
    } catch (err) {
      console.error('Failed to link objects:', err);
    }
  }, []);

  useEffect(() => { createRelationRef.current = createRelationship; }, [createRelationship]);

  // ── Form handlers ────────────────────────────────────────────────────────
  const handleFormChange = useCallback((e) => {
    const { name, value } = e.target;
    setAddForm(f => ({ ...f, [name]: value }));
  }, []);

  const handleAddObject = useCallback(async (e) => {
    e.preventDefault();
    const { object, title, description, x, y, z, color } = addForm;
    try {
      const obj = await createObject({
        shape: object,
        title: title || object,
        description,
        x: parseFloat(x) || 0,
        y: parseFloat(y) || 0,
        z: parseFloat(z) || 0,
        color,
      });
      const mesh = makeMesh(obj);
      sceneRef.current?.add(mesh);
      interactablesRef.current.push(mesh);
      objectMeshesRef.current[obj.id] = mesh;

      setAddMenuOpen(false);
      setAddForm({ object: 'sphere', title: '', description: '', x: '0', y: '0', z: '0', color: '#4488ff' });
    } catch (err) {
      console.error('Failed to add object:', err);
    }
  }, [addForm]);

  // ── Three.js main effect ─────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.1, 200);
    camera.position.set(0, 0, 12);

    const scene = buildScene();
    sceneRef.current = scene;

    const linesGroup = new THREE.Group();
    scene.add(linesGroup);
    linesGroupRef.current = linesGroup;

    // Load objects from API
    (async () => {
      try {
        const objects = await fetchObjects();

        for (const obj of objects) {
          const mesh = makeMesh(obj);
          scene.add(mesh);
          interactablesRef.current.push(mesh);
          objectMeshesRef.current[obj.id] = mesh;
        }

        // Draw relationship lines (deduplicated)
        const drawn = new Set();
        for (const obj of objects) {
          for (const relId of obj.relationships ?? []) {
            const key = [obj.id, relId].sort().join('-');
            if (drawn.has(key)) continue;
            drawn.add(key);
            const meshA = objectMeshesRef.current[obj.id];
            const meshB = objectMeshesRef.current[relId];
            if (meshA && meshB) {
              linesGroup.add(makeLine(meshA.position, meshB.position));
            }
          }
        }
      } catch (err) {
        console.error('Failed to load scene objects:', err);
      }
    })();

    // ── Camera orientation ─────────────────────────────────────────────────
    let yaw = 0, pitch = 0;
    const applyOrientation = () => {
      camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    };
    applyOrientation();

    // ── Fly-to state ───────────────────────────────────────────────────────
    let flyTarget   = null;
    let flyProgress = 0;
    const flyStartPos  = new THREE.Vector3();
    const flyStartQuat = new THREE.Quaternion();

    const startFly = (mesh) => {
      flyStartPos.copy(camera.position);
      flyStartQuat.copy(camera.quaternion);
      const objPos = mesh.position.clone();
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const halfSize = Math.max(size.x, size.y, size.z) / 2;
      const fovY = THREE.MathUtils.degToRad(camera.fov);
      const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
      const stopDist = (halfSize / Math.tan(fovX / 2)) * 1.3;
      const dir = camera.position.clone().sub(objPos).normalize();
      flyTarget   = { pos: objPos.clone().addScaledVector(dir, stopDist), lookAt: objPos };
      flyProgress = 0;
    };

    // ── Highlight ──────────────────────────────────────────────────────────
    let highlighted = null;
    const setHighlight = (mesh, on) => {
      if (!mesh) return;
      mesh.material.emissive.set(on ? 0x444444 : 0x000000);
    };

    // ── Raycaster ──────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const toNDC = (cx, cy) => {
      const rect = mount.getBoundingClientRect();
      return new THREE.Vector2(
        ((cx - rect.left) / rect.width)  * 2 - 1,
        -((cy - rect.top)  / rect.height) * 2 + 1
      );
    };

    const handleTap = (cx, cy, isDouble) => {
      const ndc = toNDC(cx, cy);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(interactablesRef.current);

      if (hits.length === 0) {
        if (linkingFromRef.current) {
          linkingFromRef.current = null;
          setLinkingFrom(null);
        }
        setHighlight(highlighted, false);
        highlighted = null;
        selectedMeshRef.current = null;
        dismissRef.current?.();
        return;
      }

      const mesh = hits[0].object;

      // Link mode: connect this object to the pending one
      if (linkingFromRef.current) {
        const { id: fromId } = linkingFromRef.current;
        const toId = mesh.userData.id;
        if (fromId !== toId) {
          createRelationRef.current?.(fromId, toId);
        }
        linkingFromRef.current = null;
        setLinkingFrom(null);
        setHighlight(highlighted, false);
        highlighted = null;
        selectedMeshRef.current = null;
        dismissRef.current?.();
        return;
      }

      const { customTitle, customDescription } = mesh.userData;

      setHighlight(highlighted, false);
      highlighted = mesh;
      setHighlight(highlighted, true);
      selectedMeshRef.current = mesh;

      setInfoPanel({
        id:          mesh.userData.id,
        title:       customTitle,
        description: customDescription || '',
      });

      if (isDouble) startFly(mesh);
    };

    // ── Touch handling ─────────────────────────────────────────────────────
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

    // ── Strafe bar ─────────────────────────────────────────────────────────
    const STRAFE_SPEED = 0.022;
    let strafeActiveId  = null;
    let strafeLastX     = null;
    const thumbEl  = () => strafeThumbRef.current;
    const THUMB_MAX = 90;

    const setThumbX = (px, animated) => {
      const el = thumbEl();
      if (!el) return;
      el.style.transition = animated ? 'transform 0.25s ease-out' : 'none';
      el.style.transform  = `translateX(${Math.max(-THUMB_MAX, Math.min(THUMB_MAX, px))}px)`;
    };

    let thumbOffset = 0;

    const onStrafeStart = (e) => {
      if (e.target.closest('button')) return;
      e.stopPropagation(); e.preventDefault();
      const t = e.changedTouches[0];
      strafeActiveId = t.identifier;
      strafeLastX    = t.clientX;
      thumbOffset    = 0;
      setThumbX(0, false);
    };

    const onStrafeMove = (e) => {
      if (strafeActiveId === null) return;
      e.stopPropagation(); e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== strafeActiveId) continue;
        const dx = t.clientX - strafeLastX;
        strafeLastX = t.clientX;
        thumbOffset += dx;
        setThumbX(thumbOffset, false);
        if (strafeModeRef.current === 'hor') {
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          camera.position.addScaledVector(right, dx * STRAFE_SPEED);
        } else {
          camera.position.y += dx * STRAFE_SPEED;
        }
      }
    };

    const onStrafeEnd = (e) => {
      if (strafeActiveId === null) return;
      e.stopPropagation(); e.preventDefault();
      strafeActiveId = null;
      strafeLastX    = null;
      thumbOffset    = 0;
      setThumbX(0, true);
    };

    const strafeBar = strafeBarRef.current;
    if (strafeBar) {
      strafeBar.addEventListener('touchstart',  onStrafeStart, { passive: false });
      strafeBar.addEventListener('touchmove',   onStrafeMove,  { passive: false });
      strafeBar.addEventListener('touchend',    onStrafeEnd,   { passive: false });
      strafeBar.addEventListener('touchcancel', onStrafeEnd,   { passive: false });
    }

    let strafeMouseDown = false;
    let strafeMouseLastX = null;
    const onStrafeMouseDown = (e) => {
      if (e.target.closest('button')) return;
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
      if (strafeModeRef.current === 'hor') {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(right, dx * STRAFE_SPEED);
      } else {
        camera.position.y += dx * STRAFE_SPEED;
      }
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

    // ── Info-panel position (updated each frame) ───────────────────────────
    const tmpV = new THREE.Vector3();
    const updatePanelPosition = () => {
      const panel = infoPanelRef.current;
      const mesh  = selectedMeshRef.current;
      if (!panel || !mesh) return;

      tmpV.copy(mesh.position);
      tmpV.project(camera);

      if (tmpV.z > 1) { panel.style.display = 'none'; return; }
      panel.style.display = '';

      const w  = mount.clientWidth;
      const h  = mount.clientHeight;
      const sx = ( tmpV.x * 0.5 + 0.5) * w;
      const sy = (-tmpV.y * 0.5 + 0.5) * h;
      const pw = panel.offsetWidth  || 220;
      const ph = panel.offsetHeight || 100;
      const GAP = 14;

      let left = Math.max(8, Math.min(w - pw - 8, sx - pw / 2));
      let top  = sy - ph - GAP;
      if (top < 8) top = sy + GAP;

      panel.style.left = `${left}px`;
      panel.style.top  = `${top}px`;
    };

    // ── Fly-to ─────────────────────────────────────────────────────────────
    const flyTargetQuat = new THREE.Quaternion();
    const flyM          = new THREE.Matrix4();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (flyTarget) {
        flyProgress = Math.min(flyProgress + 0.04, 1);
        const t = 1 - Math.pow(1 - flyProgress, 3);
        camera.position.lerpVectors(flyStartPos, flyTarget.pos, t);
        flyM.lookAt(flyTarget.pos, flyTarget.lookAt, camera.up);
        flyTargetQuat.setFromRotationMatrix(flyM);
        camera.quaternion.slerpQuaternions(flyStartQuat, flyTargetQuat, t);
        if (flyProgress >= 1) {
          const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
          yaw = euler.y; pitch = euler.x;
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
      window.removeEventListener('resize',    onResize);
      window.removeEventListener('mousemove', onStrafeMouseMove);
      window.removeEventListener('mouseup',   onStrafeMouseUp);
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="explorer-wrapper">

      <div className="canvas-area">
        <div ref={mountRef} className="canvas-mount" />

        <h1 className="explorer-title" onClick={() => setAddMenuOpen(true)}>
          Phone Explorer
        </h1>

        {hintsVisible && (
          <div className="hint">
            <span>1 finger = look</span>
            <span>spread = forward</span>
            <span>pinch = back</span>
            <span>tap = info</span>
            <span>double tap = focus</span>
          </div>
        )}

        {/* Link-mode banner */}
        {linkingFrom && (
          <div className="link-banner">
            Tap an object to link with <strong>{linkingFrom.title}</strong>
            <button
              className="link-cancel"
              onClick={() => {
                linkingFromRef.current = null;
                setLinkingFrom(null);
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {infoPanel && (
          <div className="info-panel" ref={infoPanelRef}>
            <button className="info-close" onClick={dismiss}>✕</button>
            <h2 className="info-title">{infoPanel.title}</h2>
            <p className="info-desc">{infoPanel.description}</p>
            <button
              className="info-link-btn"
              onClick={() => {
                const mesh = selectedMeshRef.current;
                if (!mesh) return;
                linkingFromRef.current = { id: infoPanel.id, mesh };
                setLinkingFrom({ id: infoPanel.id, title: infoPanel.title });
                dismiss();
              }}
            >
              Link ⟶
            </button>
          </div>
        )}
      </div>

      {/* Add-object modal */}
      {addMenuOpen && (
        <div className="add-overlay" onClick={() => setAddMenuOpen(false)}>
          <div className="add-modal" onClick={e => e.stopPropagation()}>
            <button className="add-modal-close" onClick={() => setAddMenuOpen(false)}>✕</button>
            <h2 className="add-modal-heading">Add Object</h2>
            <form className="add-modal-form" onSubmit={handleAddObject}>
              <label className="add-field">
                <span>Shape</span>
                <select name="object" value={addForm.object} onChange={handleFormChange}>
                  <option value="sphere">Sphere</option>
                  <option value="cube">Cube</option>
                  <option value="tetrahedron">Tetrahedron</option>
                </select>
              </label>
              <label className="add-field">
                <span>Title</span>
                <input type="text" name="title" value={addForm.title} onChange={handleFormChange} placeholder="My Object" />
              </label>
              <label className="add-field">
                <span>Description</span>
                <textarea name="description" value={addForm.description} onChange={handleFormChange} rows={3} placeholder="Describe this object…" />
              </label>
              <div className="add-field-row">
                <label className="add-field">
                  <span>X</span>
                  <input type="number" name="x" value={addForm.x} onChange={handleFormChange} step="0.5" />
                </label>
                <label className="add-field">
                  <span>Y</span>
                  <input type="number" name="y" value={addForm.y} onChange={handleFormChange} step="0.5" />
                </label>
                <label className="add-field">
                  <span>Z</span>
                  <input type="number" name="z" value={addForm.z} onChange={handleFormChange} step="0.5" />
                </label>
              </div>
              <label className="add-field add-field--color">
                <span>Color</span>
                <input type="color" name="color" value={addForm.color} onChange={handleFormChange} />
              </label>
              <button type="submit" className="add-submit">Add to Scene</button>
            </form>
          </div>
        </div>
      )}

      {/* Strafe bar */}
      <div className="strafe-bar" ref={strafeBarRef}>
        <button
          className="bar-btn bar-btn--left"
          onClick={() => setHintsVisible(v => !v)}
        >
          {hintsVisible ? 'hints ✕' : 'hints'}
        </button>

        <div className="strafe-track">
          <div className="strafe-thumb" ref={strafeThumbRef} />
        </div>

        <button
          className="bar-btn bar-btn--right"
          onClick={() => setStrafeMode(m => m === 'hor' ? 'vert' : 'hor')}
        >
          {strafeMode}
        </button>
      </div>

    </div>
  );
}

export default PhoneExplorer;
