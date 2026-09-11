import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './AssignExplorer.css';

const NUM_CUBES       = 27; // 3 x 3 x 3
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
const TARGET_CUBE     = 0; // front-top-left cube (layer 0, row 0, col 0)
const LEG_MS          = 1300;
const LEG_HOLD_MS     = 500;

const COLOR_LINE  = '#dfe7ff';
const COLOR_BLUE  = '#4f8cff';
const COLOR_WHITE = '#f1f5f9';
const COLOR_BLACK = '#5b6472';

const PHASE_LABELS = [
  'Sources ingest assets with findings',
  'Teams own assets',
  'Nucleus assigns findings to Teams',
];

// ── Layout math (module-level, pure) ────────────────────────────────────────

function cubeCoord(i) {
  const layer = Math.floor(i / 9);
  const rem   = i % 9;
  return { layer, row: Math.floor(rem / 3), col: rem % 3 };
}

const TOP_INDICES    = [];
const BOTTOM_INDICES = [];
for (let i = 0; i < NUM_CUBES; i++) {
  (cubeCoord(i).row < 2 ? TOP_INDICES : BOTTOM_INDICES).push(i);
}

function tilePos(i) {
  const { layer, row, col } = cubeCoord(i);
  return {
    x: (col - 1) * TILE_SPACING,
    y: (1 - row) * TILE_SPACING,
    z: (1 - layer) * TILE_SPACING,
  };
}

function gridPos(i, grouped) {
  const { layer, row, col } = cubeCoord(i);
  const x = (col - 1) * GRID_SPACING;
  let y = (1 - row) * GRID_SPACING;
  if (grouped) y += row < 2 ? TOP_LIFT : -BOTTOM_DROP;
  const z = (1 - layer) * GRID_SPACING;
  return { x, y, z };
}

function sphereLocalPos(i) {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { x: (col - 1.5) * SPHERE_SPACING, y: (1 - row) * SPHERE_SPACING, z: 0 };
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
  const goToStageRef = useRef(null);
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
    const DEFAULT_CAM_POS = new THREE.Vector3(5.6, 3.4, 10.6);
    const DEFAULT_LOOKAT  = new THREE.Vector3(0, 0.4, 0);
    const OVERVIEW_CAM_POS = new THREE.Vector3(6.6, 4.0, 12.8);
    camera.position.copy(DEFAULT_CAM_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 30;
    controls.target.copy(DEFAULT_LOOKAT);
    controls.update();

    // ── Objects ────────────────────────────────────────────────────────────
    const source = makeCubeOutline(SOURCE_SIZE, COLOR_LINE);
    scene.add(source);

    const cubes = Array.from({ length: NUM_CUBES }, () => makeCubeOutline(CUBE_SIZE, COLOR_LINE));
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
    const flatPositions    = Array.from({ length: NUM_CUBES }, (_, i) => gridPos(i, false));
    const groupedPositions = Array.from({ length: NUM_CUBES }, (_, i) => gridPos(i, true));
    const teamBlueBoundsFlat     = boundsOf(TOP_INDICES, flatPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);
    const teamWhiteBoundsFlat    = boundsOf(BOTTOM_INDICES, flatPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);
    const teamBlueBoundsGrouped  = boundsOf(TOP_INDICES, groupedPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);
    const teamWhiteBoundsGrouped = boundsOf(BOTTOM_INDICES, groupedPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);

    const targetCubePos = groupedPositions[TARGET_CUBE];
    const sphereWorlds  = Array.from({ length: 12 }, (_, i) => {
      const p = sphereLocalPos(i);
      return { x: p.x + targetCubePos.x, y: p.y + targetCubePos.y, z: p.z + targetCubePos.z + 0.35 };
    });
    const BLUE_SPHERES  = [0, 1, 2, 3, 4, 5, 6, 7];
    const BLACK_SPHERES = [8, 9, 10, 11];
    const findBlueBounds  = boundsOf(BLUE_SPHERES, sphereWorlds, SPHERE_RADIUS, HALO_PAD_SPHERE);
    const findBlackBounds = boundsOf(BLACK_SPHERES, sphereWorlds, SPHERE_RADIUS, HALO_PAD_SPHERE);

    const viewDir = DEFAULT_CAM_POS.clone().sub(DEFAULT_LOOKAT).normalize();
    const zoomCamPos = new THREE.Vector3(targetCubePos.x, targetCubePos.y, targetCubePos.z)
      .add(viewDir.multiplyScalar(2.8));
    const zoomLookAt = new THREE.Vector3(targetCubePos.x, targetCubePos.y, targetCubePos.z);

    const HALO_TEAM_Z = GRID_SPACING + 0.5;
    const LABEL_TEAM_Z = HALO_TEAM_Z + 0.15;
    const HALO_FIND_Z = targetCubePos.z + 0.25;
    const LABEL_FIND_Z = HALO_FIND_Z + 0.1;

    const V1 = { x: 1, y: 1, z: 1 };
    const V0 = { x: 0, y: 0, z: 0 };

    // ── Stage keyframe legs (each partial-diff except a stage's first leg,
    //    which is a full snapshot of that stage's opening tableau) ──────────

    function neutralState() {
      const s = {};
      s.source = { pos: { x: 0, y: 0, z: 0 }, opacity: 0 };
      for (let i = 0; i < NUM_CUBES; i++) s[`cube${i}`] = { pos: tilePos(i), opacity: 0 };
      s.haloTeamBlue  = { pos: { x: 0, y: 0, z: HALO_TEAM_Z }, scale: { x: 0.001, y: 0.001, z: 1 }, opacity: 0 };
      s.haloTeamWhite = { pos: { x: 0, y: 0, z: HALO_TEAM_Z }, scale: { x: 0.001, y: 0.001, z: 1 }, opacity: 0 };
      s.labelServerTeam = { pos: { x: 0, y: 0, z: LABEL_TEAM_Z }, opacity: 0 };
      s.labelCloudTeam  = { pos: { x: 0, y: 0, z: LABEL_TEAM_Z }, opacity: 0 };
      for (let i = 0; i < 12; i++) s[`sphere${i}`] = { pos: sphereWorlds[i], scale: V0, opacity: 0 };
      s.haloFindBlue  = { pos: { x: 0, y: 0, z: HALO_FIND_Z }, scale: { x: 0.001, y: 0.001, z: 1 }, opacity: 0 };
      s.haloFindBlack = { pos: { x: 0, y: 0, z: HALO_FIND_Z }, scale: { x: 0.001, y: 0.001, z: 1 }, opacity: 0 };
      s.labelServerFindings = { pos: { x: 0, y: 0, z: LABEL_FIND_Z }, opacity: 0 };
      s.labelAppFindings    = { pos: { x: 0, y: 0, z: LABEL_FIND_Z }, opacity: 0 };
      return s;
    }

    function withOverrides(base, overrides) {
      const out = { ...base };
      for (const key in overrides) out[key] = { ...out[key], ...overrides[key] };
      return out;
    }

    function stage1Legs() {
      const leg1 = withOverrides(neutralState(), {
        source: { opacity: 1 },
      });
      leg1.camera = { pos: DEFAULT_CAM_POS, lookAt: DEFAULT_LOOKAT };

      const leg2 = { source: { opacity: 0 } };
      for (let i = 0; i < NUM_CUBES; i++) leg2[`cube${i}`] = { pos: gridPos(i, false), opacity: 1 };

      return [leg1, leg2];
    }

    function stage2Legs() {
      const leg1 = neutralState();
      for (let i = 0; i < NUM_CUBES; i++) leg1[`cube${i}`] = { pos: gridPos(i, false), opacity: 1 };
      leg1.camera = { pos: DEFAULT_CAM_POS, lookAt: DEFAULT_LOOKAT };

      const leg2 = {
        haloTeamBlue:  { pos: { x: teamBlueBoundsFlat.cx, y: teamBlueBoundsFlat.cy, z: HALO_TEAM_Z }, scale: { x: teamBlueBoundsFlat.rx, y: teamBlueBoundsFlat.ry, z: 1 }, opacity: 0.55 },
        haloTeamWhite: { pos: { x: teamWhiteBoundsFlat.cx, y: teamWhiteBoundsFlat.cy, z: HALO_TEAM_Z }, scale: { x: teamWhiteBoundsFlat.rx, y: teamWhiteBoundsFlat.ry, z: 1 }, opacity: 0.45 },
        labelServerTeam: { pos: { x: teamBlueBoundsFlat.cx, y: teamBlueBoundsFlat.cy + teamBlueBoundsFlat.ry + 0.45, z: LABEL_TEAM_Z }, opacity: 1 },
        labelCloudTeam:  { pos: { x: teamWhiteBoundsFlat.cx, y: teamWhiteBoundsFlat.cy - teamWhiteBoundsFlat.ry - 0.45, z: LABEL_TEAM_Z }, opacity: 1 },
      };

      const leg3 = {
        haloTeamBlue:  { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamBlueBoundsGrouped.rx, y: teamBlueBoundsGrouped.ry, z: 1 } },
        haloTeamWhite: { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamWhiteBoundsGrouped.rx, y: teamWhiteBoundsGrouped.ry, z: 1 } },
        labelServerTeam: { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy + teamBlueBoundsGrouped.ry + 0.45, z: LABEL_TEAM_Z } },
        labelCloudTeam:  { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy - teamWhiteBoundsGrouped.ry - 0.45, z: LABEL_TEAM_Z } },
      };
      for (let i = 0; i < NUM_CUBES; i++) leg3[`cube${i}`] = { pos: gridPos(i, true) };

      return [leg1, leg2, leg3];
    }

    function stage3Legs() {
      const leg1 = neutralState();
      for (let i = 0; i < NUM_CUBES; i++) leg1[`cube${i}`] = { pos: gridPos(i, true), opacity: 1 };
      leg1.haloTeamBlue  = { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamBlueBoundsGrouped.rx, y: teamBlueBoundsGrouped.ry, z: 1 }, opacity: 0.55 };
      leg1.haloTeamWhite = { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamWhiteBoundsGrouped.rx, y: teamWhiteBoundsGrouped.ry, z: 1 }, opacity: 0.45 };
      leg1.labelServerTeam = { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy + teamBlueBoundsGrouped.ry + 0.45, z: LABEL_TEAM_Z }, opacity: 1 };
      leg1.labelCloudTeam  = { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy - teamWhiteBoundsGrouped.ry - 0.45, z: LABEL_TEAM_Z }, opacity: 1 };
      leg1.camera = { pos: OVERVIEW_CAM_POS, lookAt: DEFAULT_LOOKAT };

      const leg2 = { haloTeamBlue: { opacity: 0 }, haloTeamWhite: { opacity: 0 }, labelServerTeam: { opacity: 0 }, labelCloudTeam: { opacity: 0 } };
      for (let i = 0; i < NUM_CUBES; i++) {
        leg2[`cube${i}`] = { opacity: i === TARGET_CUBE ? 0.12 : 0 };
      }
      leg2.camera = { pos: zoomCamPos, lookAt: zoomLookAt };

      const leg3 = {};
      for (let i = 0; i < 12; i++) leg3[`sphere${i}`] = { pos: sphereWorlds[i], scale: V1, opacity: 1 };

      const leg4 = {
        haloFindBlue:  { pos: { x: findBlueBounds.cx, y: findBlueBounds.cy, z: HALO_FIND_Z }, scale: { x: findBlueBounds.rx, y: findBlueBounds.ry, z: 1 }, opacity: 0.55 },
        haloFindBlack: { pos: { x: findBlackBounds.cx, y: findBlackBounds.cy, z: HALO_FIND_Z }, scale: { x: findBlackBounds.rx, y: findBlackBounds.ry, z: 1 }, opacity: 0.7 },
        labelServerFindings: { pos: { x: findBlueBounds.cx, y: findBlueBounds.cy + findBlueBounds.ry + 0.3, z: LABEL_FIND_Z }, opacity: 1 },
        labelAppFindings:    { pos: { x: findBlackBounds.cx, y: findBlackBounds.cy - findBlackBounds.ry - 0.3, z: LABEL_FIND_Z }, opacity: 1 },
      };

      return [leg1, leg2, leg3, leg4];
    }

    const registry = { source, haloTeamBlue, haloTeamWhite, labelServerTeam, labelCloudTeam, haloFindBlue, haloFindBlack, labelServerFindings, labelAppFindings };
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
    applyImmediate(withOverrides(neutralState(), { source: { opacity: 1 } }));

    let transition = null; // { from, to, start }
    let queue = [];

    const startLeg = (to, holdMs) => {
      const from = { camera: { pos: camera.position.clone(), lookAt: controls.target.clone() } };
      Object.keys(registry).forEach((key) => {
        const obj = registry[key];
        from[key] = { pos: obj.position.clone(), scale: obj.scale.clone(), opacity: obj.material.opacity };
      });
      transition = { from, to, start: performance.now() + holdMs };
    };

    goToStageRef.current = (stageNum) => {
      const legsBuilders = { 1: stage1Legs, 2: stage2Legs, 3: stage3Legs };
      const legs = legsBuilders[stageNum]();
      queue = legs.slice(1);
      startLeg(legs[0], 0);
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
        const t  = Math.max(0, Math.min((now - transition.start) / LEG_MS, 1));
        const te = easeInOutCubic(t);

        Object.keys(transition.to).forEach((key) => {
          if (key === 'camera') return;
          const obj  = registry[key];
          const from = transition.from[key];
          const to   = transition.to[key];
          if (to.pos) {
            obj.position.set(
              lerp(from.pos.x, to.pos.x, te),
              lerp(from.pos.y, to.pos.y, te),
              lerp(from.pos.z, to.pos.z, te),
            );
          }
          if (to.scale) {
            obj.scale.set(
              lerp(from.scale.x, to.scale.x, te),
              lerp(from.scale.y, to.scale.y, te),
              lerp(from.scale.z, to.scale.z, te),
            );
          }
          if (to.opacity !== undefined) {
            obj.material.opacity = lerp(from.opacity, to.opacity, te);
          }
        });

        if (transition.to.camera) {
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
        }

        if (t >= 1) {
          transition = null;
          if (queue.length) startLeg(queue.shift(), LEG_HOLD_MS);
        }
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
    goToStageRef.current?.(p);
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
