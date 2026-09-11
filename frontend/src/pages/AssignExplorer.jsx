import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './AssignExplorer.css';

const NUM_CUBES       = 27; // 3 x 3 x 3
const CUBE_SIZE       = 0.95;
const CUBE_EDGE_THICK_RADIUS = 0.045;
const TILE_SPACING    = CUBE_SIZE;       // sub-cubes touch edge-to-edge, tiling the source cube's silhouette
const SOURCE_SIZE     = CUBE_SIZE * 3;
const GRID_SPACING    = 1.55;
const TOP_LIFT        = 1.9;
const BOTTOM_DROP     = 1.0;
const HALO_PAD_CUBE   = 0.35;
const SPHERE_RADIUS   = 0.1;
const HALO_PAD_SPHERE = 0.16;
const SPHERE_UNIT       = 0.34;  // spacing between neighboring sphere centers within a block
const BLOCK_SERVER_N    = 3;     // Server Team: 3 x 3 x 3 = 27 spheres, sits on top
const BLOCK_APP_N       = 4;     // App Team: 4 x 4 x 4 = 64 spheres, drops to the bottom
const SPHERE_BLOCK_GAP  = 0.5;   // vertical gap separating the two cube-blocks
const SPHERE_PAD        = 0.14;  // clearance between the sphere formation and the thick cube's wall
const TARGET_CUBE     = 0; // front-top-left cube (layer 0, row 0, col 0)
const LEG_MS          = 1300;
const LEG_HOLD_MS     = 500;
const CLICK_MAX_MOVE  = 6;

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

// An n x n x n cube of sphere positions, centered on the given Y and on
// X/Z=0, giving the findings formation real depth instead of a flat grid.
function cubeBlockPositions(n, centerY) {
  const half = (n - 1) / 2;
  const pts = [];
  for (let ix = 0; ix < n; ix++) {
    for (let iy = 0; iy < n; iy++) {
      for (let iz = 0; iz < n; iz++) {
        pts.push({
          x: (ix - half) * SPHERE_UNIT,
          y: (iy - half) * SPHERE_UNIT + centerY,
          z: (iz - half) * SPHERE_UNIT,
        });
      }
    }
  }
  return pts;
}

const SERVER_HALF_Y = (BLOCK_SERVER_N - 1) / 2 * SPHERE_UNIT;
const APP_HALF_Y    = (BLOCK_APP_N - 1) / 2 * SPHERE_UNIT;
const SERVER_CENTER_Y =  (SERVER_HALF_Y + SPHERE_BLOCK_GAP / 2); // goes up
const APP_CENTER_Y    = -(APP_HALF_Y + SPHERE_BLOCK_GAP / 2);    // drops down

// index 0..26 = Server Team (blue, top); 27..90 = App Team (black, bottom)
const SERVER_LOCAL_POSITIONS = cubeBlockPositions(BLOCK_SERVER_N, SERVER_CENTER_Y);
const APP_LOCAL_POSITIONS    = cubeBlockPositions(BLOCK_APP_N, APP_CENTER_Y);
const SPHERE_LOCAL_POSITIONS = [...SERVER_LOCAL_POSITIONS, ...APP_LOCAL_POSITIONS];
const NUM_SPHERES   = SPHERE_LOCAL_POSITIONS.length; // 91
const BLUE_SPHERES  = Array.from({ length: SERVER_LOCAL_POSITIONS.length }, (_, i) => i);
const BLACK_SPHERES = Array.from({ length: APP_LOCAL_POSITIONS.length }, (_, i) => i + SERVER_LOCAL_POSITIONS.length);

// The thick cube outline has to grow enough to enclose every sphere.
const SPHERE_HALF_EXTENT = Math.max(
  ...SPHERE_LOCAL_POSITIONS.map(p => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)))
) + SPHERE_RADIUS + SPHERE_PAD;
const EXPANDED_CUBE_SIZE = 2 * SPHERE_HALF_EXTENT;

function boundsOf(indices, positions, halfSize, pad) {
  const xs = indices.map(i => positions[i].x);
  const ys = indices.map(i => positions[i].y);
  const minX = Math.min(...xs) - halfSize - pad, maxX = Math.max(...xs) + halfSize + pad;
  const minY = Math.min(...ys) - halfSize - pad, maxY = Math.max(...ys) + halfSize + pad;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// ── Keyframe helpers: a "cube" is a fill mesh + a thin edge outline that ────
//    always move and fade together, so every leg touches both at once. ─────

function cubeState(i, pos, opacity) {
  return { [`cube${i}`]: { pos, opacity }, [`cube${i}Edge`]: { pos, opacity } };
}
function cubePosState(i, pos) {
  return { [`cube${i}`]: { pos }, [`cube${i}Edge`]: { pos } };
}
function cubeOpacityState(i, opacity) {
  return { [`cube${i}`]: { opacity }, [`cube${i}Edge`]: { opacity } };
}

// ── Generic per-object read/apply for the animation registry. A "thick     ──
//    edge" group (12 cylinder meshes standing in for one cube's outline)   ──
//    shares one material for opacity and uses each mesh's own local scale  ──
//    (x/z only — its geometry axis is already aligned to the edge) as a    ──
//    stand-in for line thickness, so it needs special-casing here. ─────────

function readOpacity(obj) {
  return obj.userData?.edgeMeshes ? obj.userData.edgeMat.opacity : obj.material.opacity;
}
function readScale(obj) {
  return obj.userData?.edgeMeshes ? obj.userData.edgeMeshes[0].scale.clone() : obj.scale.clone();
}
function applyOpacity(obj, value) {
  if (obj.userData?.edgeMeshes) obj.userData.edgeMat.opacity = value;
  else obj.material.opacity = value;
  obj.visible = value > 0.02;
}
function applyScale(obj, scale) {
  if (obj.userData?.edgeMeshes) {
    obj.userData.edgeMeshes.forEach((m) => m.scale.set(scale.x, 1, scale.z));
  } else {
    obj.scale.set(scale.x, scale.y, scale.z);
  }
}

// ── Three.js object factories ───────────────────────────────────────────────

function makeCubeOutline(size, color) {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
  return new THREE.LineSegments(edges, mat);
}

function makeCubeFill(size, color) {
  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0, metalness: 0.15, roughness: 0.55 });
  return new THREE.Mesh(geo, mat);
}

// A cube's 12 edges as individual cylinders whose radial (local x/z) scale
// can be animated from near-zero (looks like a thin line) up to `radius`
// (a properly thick outline) — real geometry thickness, unlike
// LineBasicMaterial's unreliable linewidth.
function makeCubeThickEdges(size, radius, color) {
  const h    = size / 2;
  const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
  const geo  = new THREE.CylinderGeometry(radius, radius, size, 8);
  const group = new THREE.Group();
  const edgeMeshes = [];

  const addEdge = (axis, a, b) => {
    const mesh = new THREE.Mesh(geo, mat);
    if (axis === 'x')      { mesh.rotation.z = Math.PI / 2; mesh.position.set(0, a, b); }
    else if (axis === 'y') { mesh.position.set(a, 0, b); }
    else                   { mesh.rotation.x = Math.PI / 2; mesh.position.set(a, b, 0); }
    mesh.scale.set(0.001, 1, 0.001);
    group.add(mesh);
    edgeMeshes.push(mesh);
  };

  for (const y of [-h, h]) for (const z of [-h, h]) addEdge('x', y, z);
  for (const x of [-h, h]) for (const z of [-h, h]) addEdge('y', x, z);
  for (const x of [-h, h]) for (const y of [-h, h]) addEdge('z', x, y);

  group.userData.edgeMeshes = edgeMeshes;
  group.userData.edgeMat    = mat;
  return group;
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
  const mountRef        = useRef(null);
  const goToStageRef    = useRef(null);
  const selectedMeshRef = useRef(null);
  const infoPanelRef    = useRef(null);
  const dismissRef      = useRef(null);
  const [phase, setPhase] = useState(0);

  const [selected, setSelected] = useState(null); // { id, title } | null
  const [notes, setNotes]       = useState({});   // id -> free text note

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

    const cubes = Array.from({ length: NUM_CUBES }, (_, i) => {
      const mesh = makeCubeFill(CUBE_SIZE, COLOR_LINE);
      mesh.userData = { id: `asset-${i}`, title: `Asset ${i + 1}` };
      return mesh;
    });
    cubes.forEach(c => scene.add(c));

    const cubeEdges = Array.from({ length: NUM_CUBES }, () => makeCubeOutline(CUBE_SIZE, COLOR_LINE));
    cubeEdges.forEach(e => scene.add(e));

    const targetEdgeThick = makeCubeThickEdges(
      EXPANDED_CUBE_SIZE,
      CUBE_EDGE_THICK_RADIUS * (EXPANDED_CUBE_SIZE / CUBE_SIZE),
      COLOR_LINE
    );
    scene.add(targetEdgeThick);

    const haloTeamBlue  = makeHalo(COLOR_BLUE);
    const haloTeamWhite = makeHalo(COLOR_WHITE);
    scene.add(haloTeamBlue, haloTeamWhite);
    const labelServerTeam = makeTextSprite('Server Team', '#bcd2ff', 2.0);
    const labelCloudTeam  = makeTextSprite('Cloud Team', '#ffffff', 2.0);
    scene.add(labelServerTeam, labelCloudTeam);

    const spheres = Array.from({ length: NUM_SPHERES }, (_, i) => {
      const mesh = makeSphere(SPHERE_RADIUS, COLOR_LINE);
      mesh.userData = { id: `finding-${i}`, title: `Finding ${i + 1}` };
      return mesh;
    });
    spheres.forEach(s => scene.add(s));

    const haloFindBlue  = makeHalo(COLOR_BLUE);
    const haloFindBlack = makeHalo(COLOR_BLACK);
    scene.add(haloFindBlue, haloFindBlack);
    const labelServerFindings = makeTextSprite('Server Team', '#bcd2ff', 0.8);
    const labelAppFindings    = makeTextSprite('App Team', '#c9ccd4', 0.8);
    scene.add(labelServerFindings, labelAppFindings);

    const interactables = [...cubes, ...spheres];

    // ── Layout ─────────────────────────────────────────────────────────────
    const groupedPositions = Array.from({ length: NUM_CUBES }, (_, i) => gridPos(i, true));
    const teamBlueBoundsGrouped  = boundsOf(TOP_INDICES, groupedPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);
    const teamWhiteBoundsGrouped = boundsOf(BOTTOM_INDICES, groupedPositions, CUBE_SIZE / 2, HALO_PAD_CUBE);

    const targetCubePos = groupedPositions[TARGET_CUBE];
    const sphereWorlds  = SPHERE_LOCAL_POSITIONS.map((p) => ({
      x: p.x + targetCubePos.x, y: p.y + targetCubePos.y, z: p.z + targetCubePos.z,
    }));
    const findBlueBounds  = boundsOf(BLUE_SPHERES, sphereWorlds, SPHERE_RADIUS, HALO_PAD_SPHERE);
    const findBlackBounds = boundsOf(BLACK_SPHERES, sphereWorlds, SPHERE_RADIUS, HALO_PAD_SPHERE);

    const viewDir = DEFAULT_CAM_POS.clone().sub(DEFAULT_LOOKAT).normalize();
    const zoomCamPos = new THREE.Vector3(targetCubePos.x, targetCubePos.y, targetCubePos.z)
      .add(viewDir.multiplyScalar(2.8 * (EXPANDED_CUBE_SIZE / CUBE_SIZE)));
    const zoomLookAt = new THREE.Vector3(targetCubePos.x, targetCubePos.y, targetCubePos.z);

    const HALO_TEAM_Z = GRID_SPACING + 0.5;
    const LABEL_TEAM_Z = HALO_TEAM_Z + 0.15;
    const HALO_FIND_Z = targetCubePos.z + EXPANDED_CUBE_SIZE / 2 + 0.1;
    const LABEL_FIND_Z = HALO_FIND_Z + 0.1;

    const V1 = { x: 1, y: 1, z: 1 };
    const V0 = { x: 0, y: 0, z: 0 };

    // ── Stage keyframe legs (each partial-diff except a stage's first leg,
    //    which is a full snapshot of that stage's opening tableau) ──────────

    function neutralState() {
      const s = {};
      s.source = { pos: { x: 0, y: 0, z: 0 }, opacity: 0 };
      for (let i = 0; i < NUM_CUBES; i++) Object.assign(s, cubeState(i, tilePos(i), 0));
      s.targetEdgeThick = { pos: targetCubePos, scale: { x: 0.001, y: 1, z: 0.001 }, opacity: 0 };
      s.haloTeamBlue  = { pos: { x: 0, y: 0, z: HALO_TEAM_Z }, scale: { x: 0.001, y: 0.001, z: 1 }, opacity: 0 };
      s.haloTeamWhite = { pos: { x: 0, y: 0, z: HALO_TEAM_Z }, scale: { x: 0.001, y: 0.001, z: 1 }, opacity: 0 };
      s.labelServerTeam = { pos: { x: 0, y: 0, z: LABEL_TEAM_Z }, opacity: 0 };
      s.labelCloudTeam  = { pos: { x: 0, y: 0, z: LABEL_TEAM_Z }, opacity: 0 };
      for (let i = 0; i < NUM_SPHERES; i++) s[`sphere${i}`] = { pos: sphereWorlds[i], scale: V0, opacity: 0 };
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
      for (let i = 0; i < NUM_CUBES; i++) Object.assign(leg2, cubeState(i, gridPos(i, false), 1));

      return [leg1, leg2];
    }

    function stage2Legs() {
      const leg1 = neutralState();
      for (let i = 0; i < NUM_CUBES; i++) Object.assign(leg1, cubeState(i, gridPos(i, false), 1));
      leg1.camera = { pos: DEFAULT_CAM_POS, lookAt: DEFAULT_LOOKAT };

      // Cubes move into their team groupings first...
      const leg2 = {};
      for (let i = 0; i < NUM_CUBES; i++) Object.assign(leg2, cubePosState(i, gridPos(i, true)));

      // ...then the halos fade in directly around the now-grouped cubes.
      const leg3 = {
        haloTeamBlue:  { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamBlueBoundsGrouped.rx, y: teamBlueBoundsGrouped.ry, z: 1 }, opacity: 0.55 },
        haloTeamWhite: { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamWhiteBoundsGrouped.rx, y: teamWhiteBoundsGrouped.ry, z: 1 }, opacity: 0.45 },
        labelServerTeam: { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy + teamBlueBoundsGrouped.ry + 0.45, z: LABEL_TEAM_Z }, opacity: 1 },
        labelCloudTeam:  { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy - teamWhiteBoundsGrouped.ry - 0.45, z: LABEL_TEAM_Z }, opacity: 1 },
      };

      return [leg1, leg2, leg3];
    }

    function stage3Legs() {
      const leg1 = neutralState();
      for (let i = 0; i < NUM_CUBES; i++) Object.assign(leg1, cubeState(i, gridPos(i, true), 1));
      leg1.haloTeamBlue  = { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamBlueBoundsGrouped.rx, y: teamBlueBoundsGrouped.ry, z: 1 }, opacity: 0.55 };
      leg1.haloTeamWhite = { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy, z: HALO_TEAM_Z }, scale: { x: teamWhiteBoundsGrouped.rx, y: teamWhiteBoundsGrouped.ry, z: 1 }, opacity: 0.45 };
      leg1.labelServerTeam = { pos: { x: teamBlueBoundsGrouped.cx, y: teamBlueBoundsGrouped.cy + teamBlueBoundsGrouped.ry + 0.45, z: LABEL_TEAM_Z }, opacity: 1 };
      leg1.labelCloudTeam  = { pos: { x: teamWhiteBoundsGrouped.cx, y: teamWhiteBoundsGrouped.cy - teamWhiteBoundsGrouped.ry - 0.45, z: LABEL_TEAM_Z }, opacity: 1 };
      leg1.camera = { pos: OVERVIEW_CAM_POS, lookAt: DEFAULT_LOOKAT };

      // Every cube's opaque faces fade away (outline included) while the
      // target cube grows a thicker standalone outline in their place.
      const leg2 = {
        haloTeamBlue: { opacity: 0 }, haloTeamWhite: { opacity: 0 },
        labelServerTeam: { opacity: 0 }, labelCloudTeam: { opacity: 0 },
        targetEdgeThick: { opacity: 1, scale: { x: 1, y: 1, z: 1 } },
      };
      for (let i = 0; i < NUM_CUBES; i++) Object.assign(leg2, cubeOpacityState(i, 0));
      leg2.camera = { pos: zoomCamPos, lookAt: zoomLookAt };

      const leg3 = {};
      for (let i = 0; i < NUM_SPHERES; i++) leg3[`sphere${i}`] = { pos: sphereWorlds[i], scale: V1, opacity: 1 };

      const leg4 = {
        haloFindBlue:  { pos: { x: findBlueBounds.cx, y: findBlueBounds.cy, z: HALO_FIND_Z }, scale: { x: findBlueBounds.rx, y: findBlueBounds.ry, z: 1 }, opacity: 0.55 },
        haloFindBlack: { pos: { x: findBlackBounds.cx, y: findBlackBounds.cy, z: HALO_FIND_Z }, scale: { x: findBlackBounds.rx, y: findBlackBounds.ry, z: 1 }, opacity: 0.7 },
        labelServerFindings: { pos: { x: findBlueBounds.cx, y: findBlueBounds.cy + findBlueBounds.ry + 0.3, z: LABEL_FIND_Z }, opacity: 1 },
        labelAppFindings:    { pos: { x: findBlackBounds.cx, y: findBlackBounds.cy - findBlackBounds.ry - 0.3, z: LABEL_FIND_Z }, opacity: 1 },
      };

      return [leg1, leg2, leg3, leg4];
    }

    const registry = { source, haloTeamBlue, haloTeamWhite, labelServerTeam, labelCloudTeam, haloFindBlue, haloFindBlack, labelServerFindings, labelAppFindings, targetEdgeThick };
    cubes.forEach((c, i) => { registry[`cube${i}`] = c; });
    cubeEdges.forEach((e, i) => { registry[`cube${i}Edge`] = e; });
    spheres.forEach((s, i) => { registry[`sphere${i}`] = s; });

    const applyImmediate = (target) => {
      Object.keys(target).forEach((key) => {
        if (key === 'camera') return;
        const obj = registry[key];
        const to  = target[key];
        obj.position.set(to.pos.x, to.pos.y, to.pos.z);
        if (to.scale) applyScale(obj, to.scale);
        applyOpacity(obj, to.opacity);
      });
    };
    applyImmediate(withOverrides(neutralState(), { source: { opacity: 1 } }));

    let transition = null; // { from, to, start }
    let queue = [];

    const startLeg = (to, holdMs) => {
      const from = { camera: { pos: camera.position.clone(), lookAt: controls.target.clone() } };
      Object.keys(registry).forEach((key) => {
        const obj = registry[key];
        from[key] = { pos: obj.position.clone(), scale: readScale(obj), opacity: readOpacity(obj) };
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

    // ── Click-to-select ────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const toNDC = (cx, cy) => {
      const rect = mount.getBoundingClientRect();
      return new THREE.Vector2(
        ((cx - rect.left) / rect.width) * 2 - 1,
        -((cy - rect.top) / rect.height) * 2 + 1
      );
    };

    let highlighted = null;
    const setHighlight = (mesh, on) => {
      if (!mesh) return;
      mesh.material.emissive.set(on ? 0x445577 : 0x000000);
    };

    dismissRef.current = () => {
      setHighlight(highlighted, false);
      highlighted = null;
      selectedMeshRef.current = null;
      setSelected(null);
    };

    const selectObject = (cx, cy) => {
      const ndc = toNDC(cx, cy);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(interactables, false);

      if (hits.length === 0) {
        dismissRef.current();
        return;
      }

      const mesh = hits[0].object;
      setHighlight(highlighted, false);
      highlighted = mesh;
      setHighlight(highlighted, true);
      selectedMeshRef.current = mesh;
      setSelected({ id: mesh.userData.id, title: mesh.userData.title });
    };

    let downX = null, downY = null;
    const onPointerDown = (e) => { downX = e.clientX; downY = e.clientY; };
    const onPointerUp = (e) => {
      if (downX === null) return;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      downX = null; downY = null;
      if (moved > CLICK_MAX_MOVE) return;
      selectObject(e.clientX, e.clientY);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

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
            applyScale(obj, {
              x: lerp(from.scale.x, to.scale.x, te),
              y: lerp(from.scale.y, to.scale.y, te),
              z: lerp(from.scale.z, to.scale.z, te),
            });
          }
          if (to.opacity !== undefined) {
            applyOpacity(obj, lerp(from.opacity, to.opacity, te));
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
      updatePanelPosition();
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
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
      <div className="assign-viewport">
        <div ref={mountRef} className="assign-canvas-mount" />
        <h1 className="assign-title" onClick={() => navigate('/')}>
          Assign
        </h1>
        <div className="assign-hint">
          <span>drag = orbit</span>
          <span>scroll / pinch = zoom</span>
          <span>click = info</span>
        </div>

        {selected && (
          <div className="assign-info-panel" ref={infoPanelRef}>
            <button className="assign-info-close" onClick={() => dismissRef.current?.()}>✕</button>
            <h2 className="assign-info-title">{selected.title}</h2>
            <textarea
              className="assign-info-textbox"
              placeholder="Add a note…"
              rows={3}
              value={notes[selected.id] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [selected.id]: e.target.value }))}
            />
          </div>
        )}
      </div>

      <div className="assign-bottombar">
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
    </div>
  );
}

export default AssignExplorer;
