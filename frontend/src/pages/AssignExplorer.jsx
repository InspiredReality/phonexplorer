import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './AssignExplorer.css';

const CUBE_SIZE       = 0.95;
const TILE_SPACING    = CUBE_SIZE;       // sub-cubes touch edge-to-edge, tiling the source cube's silhouette
const SOURCE_SIZE     = CUBE_SIZE * 3;
const GRID_SPACING    = 1.55;
const TOP_LIFT        = 1.9;
const BOTTOM_DROP     = 1.0;
const HALO_PAD_CUBE   = 0.35;
const SPHERE_SPACING  = 0.34;
const SPHERE_RADIUS   = 0.1;
const HALO_PAD_SPHERE = 0.16;
const TARGET_CUBE     = 0;
const ANIM_MS         = 1500;

const COLOR_LINE  = '#dfe7ff';
const COLOR_BLUE  = '#4f8cff';
const COLOR_WHITE = '#f1f5f9';
const COLOR_BLACK = '#5b6472';

const TOP_INDICES    = [0, 1, 2, 3, 4, 5];
const BOTTOM_INDICES = [6, 7, 8];
const BLUE_SPHERES   = [0, 1, 2, 3, 4, 5, 6, 7];
const BLACK_SPHERES  = [8, 9, 10, 11];

const PHASE_LABELS = [
  'Sources ingest assets with findings',
  'Teams own assets',
  'Nucleus assigns findings to Teams',
];

// ── Layout math (module-level, pure) ────────────────────────────────────────

function tilePos(i) {
  const row = Math.floor(i / 3);
  const col = i % 3;
  return { x: (col - 1) * TILE_SPACING, y: (1 - row) * TILE_SPACING, z: 0 };
}

function gridPos(i, grouped) {
  const row = Math.floor(i / 3);
  const col = i % 3;
  const x = (col - 1) * GRID_SPACING;
  let y = (1 - row) * GRID_SPACING;
  if (grouped) y += row < 2 ? TOP_LIFT : -BOTTOM_DROP;
  return { x, y, z: 0 };
}

function sphereLocalPos(i) {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { x: (col - 1.5) * SPHERE_SPACING, y: (1 - row) * SPHERE_SPACING, z: 0.05 };
}

function boundsOf(indices, positions, halfSize, pad) {
  const xs = indices.map(i => positions[i].x);
  const ys = indices.map(i => positions[i].y);
  const minX = Math.min(...xs) - halfSize - pad, maxX = Math.max(...xs) + halfSize + pad;
  const minY = Math.min(...ys) - halfSize - pad, maxY = Math.max(...ys) + halfSize + pad;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// ── Three.js object factories ───────────────────────────────────────────────

function makeCubeOutline(size, color) {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
  return new THREE.LineSegments(edges, mat);
}

function makeSphere(radius, color) {
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0, metalness: 0.25, roughness: 0.5 });
  return new THREE.Mesh(geo, mat);
}

function roundedRectShape(hw, hh, r) {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function makeHalo(color) {
  const outer = roundedRectShape(1, 1, 0.32);
  outer.holes.push(roundedRectShape(0.84, 0.84, 0.24));
  const geo = new THREE.ShapeGeometry(outer, 16);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

function makeTextSprite(text, color, worldWidth) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 46;
  ctx.font = `600 ${fontSize}px sans-serif`;
  const textWidth = ctx.measureText(text).width;
  canvas.width  = textWidth + 48;
  canvas.height = fontSize * 1.7;
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  const scaleFactor = worldWidth / canvas.width;
  sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
  return sprite;
}

// ── Component ────────────────────────────────────────────────────────────────

function AssignExplorer() {
  const navigate = useNavigate();
  const mountRef = useRef(null);
  const goToPhaseRef = useRef(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c18);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(6, 10, 8);
    scene.add(dirLight);

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 100);
    const DEFAULT_CAM_POS = new THREE.Vector3(4.4, 2.7, 8.1);
    const DEFAULT_LOOKAT  = new THREE.Vector3(0, 0.5, 0);
    camera.position.copy(DEFAULT_CAM_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 26;
    controls.target.copy(DEFAULT_LOOKAT);
    controls.update();

    // ── Objects ────────────────────────────────────────────────────────────
    const source = makeCubeOutline(SOURCE_SIZE, COLOR_LINE);
    scene.add(source);

    const cubes = Array.from({ length: 9 }, () => makeCubeOutline(CUBE_SIZE, COLOR_LINE));
    cubes.forEach(c => scene.add(c));

    const haloTeamBlue  = makeHalo(COLOR_BLUE);
    const haloTeamWhite = makeHalo(COLOR_WHITE);
    scene.add(haloTeamBlue, haloTeamWhite);
    const labelServerTeam = makeTextSprite('Server Team', '#bcd2ff', 2.0);
    const labelCloudTeam  = makeTextSprite('Cloud Team', '#ffffff', 2.0);
    scene.add(labelServerTeam, labelCloudTeam);

    const spheres = Array.from({ length: 12 }, () => makeSphere(SPHERE_RADIUS, COLOR_LINE));
    spheres.forEach(s => scene.add(s));

    const haloFindBlue  = makeHalo(COLOR_BLUE);
    const haloFindBlack = makeHalo(COLOR_BLACK);
    scene.add(haloFindBlue, haloFindBlack);
    const labelServerFindings = makeTextSprite('Server Team', '#bcd2ff', 0.8);
    const labelAppFindings    = makeTextSprite('App Team', '#c9ccd4', 0.8);
    scene.add(labelServerFindings, labelAppFindings);

    // ── Layout ─────────────────────────────────────────────────────────────
    const groupedPositions = Array.from({ length: 9 }, (_, i) => gridPos(i, true));
    const teamBlueBounds   = boundsOf(TOP_INDICES, groupedPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);
    const teamWhiteBounds  = boundsOf(BOTTOM_INDICES, groupedPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);

    const targetCubePos = groupedPositions[TARGET_CUBE];
    const sphereWorlds  = Array.from({ length: 12 }, (_, i) => {
      const p = sphereLocalPos(i);
      return { x: p.x + targetCubePos.x, y: p.y + targetCubePos.y, z: p.z };
    });
    const findBlueBounds  = boundsOf(BLUE_SPHERES, sphereWorlds, SPHERE_RADIUS, HALO_PAD_SPHERE);
    const findBlackBounds = boundsOf(BLACK_SPHERES, sphereWorlds, SPHERE_RADIUS, HALO_PAD_SPHERE);

    const viewDir = DEFAULT_CAM_POS.clone().sub(DEFAULT_LOOKAT).normalize();
    const zoomCamPos = new THREE.Vector3(targetCubePos.x, targetCubePos.y, targetCubePos.z)
      .add(viewDir.multiplyScalar(2.6));
    const zoomLookAt = new THREE.Vector3(targetCubePos.x, targetCubePos.y, targetCubePos.z);

    const V1 = { x: 1, y: 1, z: 1 };
    const V0 = { x: 0, y: 0, z: 0 };

    function phaseTarget(p) {
      const t = { camera: { pos: DEFAULT_CAM_POS, lookAt: DEFAULT_LOOKAT } };

      t.source = { pos: { x: 0, y: 0, z: 0 }, opacity: p === 0 ? 1 : 0 };

      for (let i = 0; i < 9; i++) {
        const pos = p === 0 ? tilePos(i) : gridPos(i, p >= 2);
        let opacity = p === 0 ? 0 : 1;
        if (p === 3) opacity = i === TARGET_CUBE ? 0.12 : 0;
        t[`cube${i}`] = { pos, opacity };
      }

      const showTeamHalos = p === 2;
      t.haloTeamBlue  = { pos: { x: teamBlueBounds.cx, y: teamBlueBounds.cy, z: -0.1 }, scale: { x: teamBlueBounds.rx, y: teamBlueBounds.ry, z: 1 }, opacity: showTeamHalos ? 0.55 : 0 };
      t.haloTeamWhite = { pos: { x: teamWhiteBounds.cx, y: teamWhiteBounds.cy, z: -0.1 }, scale: { x: teamWhiteBounds.rx, y: teamWhiteBounds.ry, z: 1 }, opacity: showTeamHalos ? 0.45 : 0 };
      t.labelServerTeam = { pos: { x: teamBlueBounds.cx, y: teamBlueBounds.cy + teamBlueBounds.ry + 0.45, z: 0.2 }, opacity: showTeamHalos ? 1 : 0 };
      t.labelCloudTeam  = { pos: { x: teamWhiteBounds.cx, y: teamWhiteBounds.cy - teamWhiteBounds.ry - 0.45, z: 0.2 }, opacity: showTeamHalos ? 1 : 0 };

      const showSpheres = p === 3;
      for (let i = 0; i < 12; i++) {
        t[`sphere${i}`] = { pos: sphereWorlds[i], scale: showSpheres ? V1 : V0, opacity: showSpheres ? 1 : 0 };
      }
      t.haloFindBlue  = { pos: { x: findBlueBounds.cx, y: findBlueBounds.cy, z: -0.05 }, scale: { x: findBlueBounds.rx, y: findBlueBounds.ry, z: 1 }, opacity: showSpheres ? 0.55 : 0 };
      t.haloFindBlack = { pos: { x: findBlackBounds.cx, y: findBlackBounds.cy, z: -0.05 }, scale: { x: findBlackBounds.rx, y: findBlackBounds.ry, z: 1 }, opacity: showSpheres ? 0.7 : 0 };
      t.labelServerFindings = { pos: { x: findBlueBounds.cx, y: findBlueBounds.cy + findBlueBounds.ry + 0.3, z: 0.2 }, opacity: showSpheres ? 1 : 0 };
      t.labelAppFindings    = { pos: { x: findBlackBounds.cx, y: findBlackBounds.cy - findBlackBounds.ry - 0.3, z: 0.2 }, opacity: showSpheres ? 1 : 0 };

      if (p === 2) t.camera = { pos: new THREE.Vector3(5.1, 3.1, 9.6), lookAt: new THREE.Vector3(0, 0.5, 0) };
      if (p === 3) t.camera = { pos: zoomCamPos, lookAt: zoomLookAt };

      return t;
    }

    const registry = {
      source, haloTeamBlue, haloTeamWhite, labelServerTeam, labelCloudTeam,
      haloFindBlue, haloFindBlack, labelServerFindings, labelAppFindings,
    };
    cubes.forEach((c, i) => { registry[`cube${i}`] = c; });
    spheres.forEach((s, i) => { registry[`sphere${i}`] = s; });

    const applyImmediate = (target) => {
      Object.keys(target).forEach((key) => {
        if (key === 'camera') return;
        const obj = registry[key];
        const to  = target[key];
        obj.position.set(to.pos.x, to.pos.y, to.pos.z);
        if (to.scale) obj.scale.set(to.scale.x, to.scale.y, to.scale.z);
        obj.material.opacity = to.opacity;
      });
    };
    applyImmediate(phaseTarget(0));

    let transition = null; // { from, to, start }

    goToPhaseRef.current = (p) => {
      const from = { camera: { pos: camera.position.clone(), lookAt: controls.target.clone() } };
      Object.keys(registry).forEach((key) => {
        const obj = registry[key];
        from[key] = { pos: obj.position.clone(), scale: obj.scale.clone(), opacity: obj.material.opacity };
      });
      transition = { from, to: phaseTarget(p), start: performance.now() };
    };

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    let animId;
    const animate = (now) => {
      animId = requestAnimationFrame(animate);

      if (transition) {
        const t  = Math.min((now - transition.start) / ANIM_MS, 1);
        const te = easeInOutCubic(t);

        Object.keys(transition.to).forEach((key) => {
          if (key === 'camera') return;
          const obj  = registry[key];
          const from = transition.from[key];
          const to   = transition.to[key];
          obj.position.set(
            lerp(from.pos.x, to.pos.x, te),
            lerp(from.pos.y, to.pos.y, te),
            lerp(from.pos.z, to.pos.z, te),
          );
          if (to.scale) {
            obj.scale.set(
              lerp(from.scale.x, to.scale.x, te),
              lerp(from.scale.y, to.scale.y, te),
              lerp(from.scale.z, to.scale.z, te),
            );
          }
          obj.material.opacity = lerp(from.opacity, to.opacity, te);
        });

        const camFrom = transition.from.camera;
        const camTo   = transition.to.camera;
        camera.position.set(
          lerp(camFrom.pos.x, camTo.pos.x, te),
          lerp(camFrom.pos.y, camTo.pos.y, te),
          lerp(camFrom.pos.z, camTo.pos.z, te),
        );
        controls.target.set(
          lerp(camFrom.lookAt.x, camTo.lookAt.x, te),
          lerp(camFrom.lookAt.y, camTo.lookAt.y, te),
          lerp(camFrom.lookAt.z, camTo.lookAt.z, te),
        );

        if (t >= 1) transition = null;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  const handlePhase = (p) => {
    setPhase(p);
    goToPhaseRef.current?.(p);
  };

  return (
    <div className="assign-wrapper">
      <div className="assign-sidebar">
        {PHASE_LABELS.map((label, idx) => (
          <button
            key={label}
            className={`assign-side-btn assign-side-btn--phase${idx + 1}${phase === idx + 1 ? ' is-active' : ''}`}
            onClick={() => handlePhase(idx + 1)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="assign-viewport">
        <div ref={mountRef} className="assign-canvas-mount" />
        <h1 className="assign-title" onClick={() => navigate('/')}>
          Assign
        </h1>
        <div className="assign-hint">
          <span>drag = orbit</span>
          <span>scroll / pinch = zoom</span>
        </div>
      </div>
    </div>
  );
}

export default AssignExplorer;
