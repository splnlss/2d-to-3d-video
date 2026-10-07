import * as THREE from "./lib/three.module.js";

// Shared layer 0 makes this interface visible to both eyes. Display units are
// WebXR local metres. Controller rays use the actual tracked target-ray pose.
export function createXRModeButton() {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 154;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.18), material);
  mesh.position.set(0, -0.72, 0.3);
  mesh.renderOrder = 10;
  mesh.visible = false;
  const ray = new THREE.Raycaster();
  return {
    mesh,
    setLabel(label) {
      context.fillStyle = "#213644";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#a9ddff";
      context.lineWidth = 8;
      context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
      context.fillStyle = "white";
      context.font = "bold 50px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, canvas.width / 2, canvas.height / 2);
      texture.needsUpdate = true;
    },
    hit(controller) {
      if (!mesh.visible) return null;
      controller.updateWorldMatrix(true, false);
      mesh.updateWorldMatrix(true, false);
      ray.setFromXRController(controller);
      return ray.intersectObject(mesh, false)[0] ?? null;
    },
    highlight(value) {
      material.color.set(value ? "#ffffff" : "#b8c7d1");
    },
  };
}
