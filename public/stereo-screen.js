import * as THREE from "./lib/three.module.js";

// WebXR local space, in metres. A 16:9 plane restores the aspect ratio of each
// horizontally compressed half in this half-side-by-side video.
export function createStereoScreen(texture) {
  const screen = new THREE.Group();
  for (const [eye, offset] of [
    [1, 0],
    [2, 0.5],
  ]) {
    const geometry = new THREE.PlaneGeometry(3.2, 1.8);
    const uv = geometry.getAttribute("uv");
    for (let index = 0; index < uv.count; index++) {
      uv.setX(index, uv.getX(index) * 0.5 + offset);
    }
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    // Three's XR cameras reserve layer 1 for left and layer 2 for right.
    // Neither screen is on shared layer 0, which would show it in both eyes.
    mesh.layers.set(eye);
    screen.add(mesh);
  }
  return screen;
}
