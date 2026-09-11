import * as THREE from 'three';

export const GEO_FACTORIES = {
  sphere:      () => new THREE.SphereGeometry(0.5, 32, 32),
  cube:        () => new THREE.BoxGeometry(0.9, 0.9, 0.9),
  tetrahedron: () => new THREE.TetrahedronGeometry(0.7),
};

export function makeMesh(obj) {
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

export function makeLine(posA, posB) {
  const geo = new THREE.BufferGeometry().setFromPoints([posA.clone(), posB.clone()]);
  const mat = new THREE.LineBasicMaterial({ color: 0x8899ff, opacity: 0.65, transparent: true });
  return new THREE.Line(geo, mat);
}

export function buildScene() {
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
