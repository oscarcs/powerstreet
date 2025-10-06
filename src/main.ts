import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

const geometry = new THREE.BoxGeometry(1, 1, 1);

const material = new THREE.MeshLambertMaterial({ 
  color: 0x606060
});

const building = new THREE.Mesh(geometry, material);
building.position.set(0, 0, 0);
scene.add(building);

// Set up OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 5, 0);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.update();

// Keyboard movement variables
const moveSpeed = 0.1;
const keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false
};

// Add some basic lighting to see the cube better
const ambientLight = new THREE.AmbientLight(0xCCCCCC, 0.8);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// Keyboard event listeners
window.addEventListener('keydown', (event) => {
  if (event.code in keys) {
    keys[event.code as keyof typeof keys] = true;
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code in keys) {
    keys[event.code as keyof typeof keys] = false;
  }
});

function animate() {
  requestAnimationFrame(animate);
  
  // Handle keyboard movement
  if (keys.ArrowUp) {
    controls.target.z -= moveSpeed;
    camera.position.z -= moveSpeed;
  }
  if (keys.ArrowDown) {
    controls.target.z += moveSpeed;
    camera.position.z += moveSpeed;
  }
  if (keys.ArrowLeft) {
    controls.target.x -= moveSpeed;
    camera.position.x -= moveSpeed;
  }
  if (keys.ArrowRight) {
    controls.target.x += moveSpeed;
    camera.position.x += moveSpeed;
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
