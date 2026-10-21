import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseTile, buildingsOf, holesOf } from '../world/tiledata.js';
import { PROFILE } from './profile.js';
import { loadTileBytes } from './load.js';
import tileUrl from '../../.generated/toronto/0_0.bin?url';
import sourceUrl from '../../fixtures/toronto/block.geojson?url';
import provenanceUrl from '../../fixtures/toronto/provenance.json?url';

const status = document.querySelector('#status');
document.querySelector('#source-download').href = sourceUrl;
document.querySelector('#provenance-download').href = provenanceUrl;

export async function start(showFailure) {
  const tile = parseTile(await loadTileBytes(tileUrl));
  if (tile.header.profile?.id !== PROFILE.id) throw new Error('Unexpected city profile');
  const records = [...buildingsOf(tile, { applyOverrides: false })];
  const holes = holesOf(tile);
  const viewport = document.querySelector('#viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  viewport.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    showFailure(new Error('Graphics context lost. Reload to restart the study.'));
  });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdbe4e8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x687781, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-80, 200, -120); scene.add(sun);
  const masses = new THREE.Group(); scene.add(masses);
  const ring = (start, len) => Array.from({ length: len }, (_, i) =>
    new THREE.Vector2(tile.S.bldgXZ[(start + i) * 2], -tile.S.bldgXZ[(start + i) * 2 + 1]));
  const material = new THREE.MeshStandardMaterial({ color: 0x829ba9, roughness: 0.85 });
  for (const b of records) {
    const shape = new THREE.Shape(ring(b.start, b.len));
    for (const hole of holes.get(b.i) || []) shape.holes.push(new THREE.Path(ring(hole.start, hole.len)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(tile.header.origin[0], b.baseY, tile.header.origin[1]);
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.userData = { ...tile.header.records[b.i], height: b.height };
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x344d5b }));
    scene.add(edges); masses.add(mesh);
  }
  const bounds = new THREE.Box3().setFromObject(masses);
  const centre = bounds.getCenter(new THREE.Vector3());
  const grid = new THREE.GridHelper(240, 24, 0x889da9, 0xbacbd3);
  grid.position.set(centre.x, -0.05, centre.z); scene.add(grid);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(centre.x, 0, centre.z);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 20; controls.maxDistance = 650;
  function view(plan) {
    camera.up.set(0, 1, 0);
    camera.position.set(centre.x + (plan ? 0 : 165), plan ? 290 : 175, centre.z + (plan ? 0.01 : 190));
    controls.update();
  }
  document.querySelector('#plan').onclick = () => view(true);
  document.querySelector('#perspective').onclick = () => view(false);
  view(false);
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const picked = ray.intersectObjects(masses.children, false)[0]?.object;
    if (!picked) return;
    for (const mesh of masses.children) mesh.material.color.set(mesh === picked ? 0xb16d3f : 0x829ba9);
    const { sourceId, height } = picked.userData;
    document.querySelector('#detail').textContent = `${sourceId} · AVG_HEIGHT ${height.toFixed(4)} m. ID is an archive record index, not an official property identifier.`;
  });
  function resize() {
    const { width, height } = viewport.getBoundingClientRect();
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport); resize();
  status.textContent = `${records.length} source masses · one 512 m tile · 10 m grid`;
  window.__TORONTO = { renderer, camera, controls, masses, tile, records, frames: 0 };
  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera); window.__TORONTO.frames++;
  });
}
