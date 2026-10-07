import * as THREE from "./lib/three.module.js";
import { createDepthSubject, frameAtTime, clampOrbit } from "./depth-subject.js";

const video = document.querySelector("#video");
const stage = document.querySelector("#stage");
const playButton = document.querySelector("#play");
const restartButton = document.querySelector("#restart");
const vrButton = document.querySelector("#vr");
const orbit = document.querySelector("#orbit");
const orbitAngle = document.querySelector("#orbit-angle");
const status = document.querySelector("#status");
const depthStatus = document.querySelector("#depth-status");
const xrStatus = document.querySelector("#xr-status");
const time = document.querySelector("#time");
let session = null;
let xrSupported = false;
let entering = false;
let failed = false;
let ready = false;
let centerOnNextFrame = false;
let subject = null;
let spec = null;
let degrees = 0;
let lastTime = null;

function refreshControls() {
  playButton.textContent = video.paused ? "Play" : "Pause";
  // Mobile browsers can defer preload until play() runs within a user gesture.
  playButton.disabled = !ready || failed;
  restartButton.disabled = !ready || failed || video.readyState < 2;
  vrButton.disabled = entering || (!session && (!ready || failed || !xrSupported));
  vrButton.textContent = entering ? "Entering VR…" : session ? "Exit VR" : "Enter VR";
}
function fail(message) {
  failed = true;
  video.pause();
  status.textContent = message;
  refreshControls();
}
async function play() {
  try {
    await video.play();
    status.textContent = "Playing";
  } catch (error) {
    status.textContent = `Playback could not start. Press Play to retry. ${error.message}`;
  }
  refreshControls();
}
function togglePlayback() {
  if (video.paused) void play();
  else video.pause();
}
function setOrbit(value) {
  degrees = clampOrbit(value);
  if (subject) subject.rotation.y = THREE.MathUtils.degToRad(degrees);
  orbit.value = String(degrees);
  orbitAngle.value = `${Math.round(degrees)}°`;
}
function recenter() {
  setOrbit(0);
  centerOnNextFrame = !!session;
  if (!session) anchor.position.set(0, 0, -1.8);
}
playButton.addEventListener("click", togglePlayback);
restartButton.addEventListener("click", () => {
  video.currentTime = 0;
  void play();
});
orbit.addEventListener("input", () => setOrbit(Number(orbit.value)));
document.querySelector("#recenter").addEventListener("click", recenter);
video.addEventListener("error", () => fail("The video could not be loaded. Reload the page to retry."));
video.addEventListener("loadeddata", () => {
  drawFrame(video.currentTime);
  if (ready && !failed) status.textContent = "Ready to play";
  refreshControls();
});
video.addEventListener("play", refreshControls);
video.addEventListener("canplay", refreshControls);
video.addEventListener("pause", () => {
  if (!failed) status.textContent = "Paused";
  refreshControls();
});
video.addEventListener("ended", () => {
  status.textContent = "Finished — press Restart to watch again";
  refreshControls();
});
function clock(seconds) {
  return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00";
}
function updateTime() {
  time.textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
}
video.addEventListener("timeupdate", updateTime);
video.addEventListener("loadedmetadata", updateTime);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local");
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#050608");
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 20);
const anchor = new THREE.Group();
anchor.position.set(0, 0, -1.8); // Display metres; independent of monocular scene scale.
scene.add(anchor);

// Freeze the exact decoded color frame alongside its atlas index in one callback.
// There is one media clock, rather than two independently drifting video players.
const colorCanvas = document.createElement("canvas");
colorCanvas.width = 960;
colorCanvas.height = 540;
const context = colorCanvas.getContext("2d", { alpha: false });
const colorTexture = new THREE.CanvasTexture(colorCanvas);
colorTexture.colorSpace = THREE.SRGBColorSpace;
colorTexture.generateMipmaps = false;
colorTexture.minFilter = THREE.LinearFilter;
function drawFrame(mediaTime) {
  if (video.readyState < 2) return;
  context.drawImage(video, 0, 0, 960, 540);
  colorTexture.needsUpdate = true;
  if (subject && spec) {
    const shot = subject.setFrame(frameAtTime(mediaTime, spec));
    depthStatus.textContent = shot.talking ? "Person depth applied · move your head or orbit" : "Cutaway · flat video; person depth resumes when Bob returns";
  }
}
// Paused, hidden videos do not reliably issue a new compositor callback after
// seeking. At seeked the requested frame is decoded and can be captured safely.
video.addEventListener("seeked", () => drawFrame(video.currentTime));
if (video.requestVideoFrameCallback) {
  const decoded = (_, metadata) => {
    const stalePausedFrame = video.paused && spec && Math.abs(metadata.mediaTime - video.currentTime) > 1 / spec.fps;
    if (!video.seeking && !stalePausedFrame) drawFrame(metadata.mediaTime);
    video.requestVideoFrameCallback(decoded);
  };
  video.requestVideoFrameCallback(decoded);
}

function resize() {
  const { width, height } = stage.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(stage);
resize();
for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  controller.addEventListener("select", togglePlayback);
  controller.addEventListener("squeezestart", recenter);
  scene.add(controller);
}
renderer.xr.addEventListener("sessionend", () => {
  session = null;
  centerOnNextFrame = false;
  lastTime = null;
  video.pause();
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  anchor.position.set(0, 0, -1.8);
  anchor.quaternion.identity();
  refreshControls();
});
vrButton.addEventListener("click", async () => {
  if (session) {
    await session.end();
    return;
  }
  if (entering || !ready || failed || !xrSupported) return;
  entering = true;
  refreshControls();
  const wasPaused = video.paused;
  try {
    const requested = navigator.xr.requestSession("immersive-vr", { requiredFeatures: ["local"] });
    void play();
    session = await requested;
    centerOnNextFrame = true;
    await renderer.xr.setSession(session);
    session.addEventListener("visibilitychange", () => {
      if (session?.visibilityState === "hidden") video.pause();
    });
  } catch (error) {
    if (session) await session.end().catch(() => {});
    session = null;
    if (wasPaused) video.pause();
    status.textContent = `VR could not start. ${error.message}`;
  } finally {
    entering = false;
    refreshControls();
  }
});

const headPosition = new THREE.Vector3();
const headOrientation = new THREE.Quaternion();
const distance = new THREE.Vector3();
renderer.setAnimationLoop((timestamp, frame) => {
  const dt = lastTime === null ? 0 : Math.min(Math.max((timestamp - lastTime) / 1000, 0), 0.05);
  lastTime = timestamp;
  if (centerOnNextFrame && frame) {
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (pose) {
      headPosition.copy(pose.transform.position);
      headOrientation.copy(pose.transform.orientation);
      distance.set(0, 0, -1.8).applyQuaternion(headOrientation);
      anchor.position.copy(headPosition).add(distance);
      anchor.quaternion.copy(headOrientation);
      centerOnNextFrame = false; // World-fixed afterwards: real head motion is parallax.
    }
  }
  if (session) {
    const inputs = Array.from(session.inputSources);
    const source = inputs.find((source) => source.handedness === "right" && source.gamepad) ?? inputs.find((source) => source.gamepad);
    const axes = source?.gamepad?.axes;
    const x = axes ? axes[axes.length >= 4 ? 2 : 0] : 0;
    if (Number.isFinite(x) && Math.abs(x) > 0.15) setOrbit(degrees + x * 45 * dt);
  }
  if (!video.requestVideoFrameCallback) drawFrame(video.currentTime);
  renderer.render(scene, camera);
});

async function initializeDepth() {
  try {
    const response = await fetch("./Bob_live_depth.json");
    if (!response.ok) throw new Error("Depth metadata is unavailable");
    spec = await response.json();
    if (spec.version !== 1 || spec.frames < 1 || spec.tileWidth < 2 || spec.tileHeight < 2 || !(spec.near > 0 && spec.far > spec.near)) throw new Error("Invalid depth metadata");
    const texture = await new THREE.TextureLoader().loadAsync("./Bob_live_depth.png");
    if (texture.image.width !== spec.columns * spec.tileWidth || texture.image.height !== spec.rows * spec.tileHeight) throw new Error("Depth atlas dimensions differ from metadata");
    subject = createDepthSubject(colorTexture, texture, spec);
    anchor.add(subject);
    ready = true;
    drawFrame(video.currentTime);
    if (!failed) status.textContent = "Ready to play";
    refreshControls();
  } catch (error) {
    depthStatus.textContent = "Depth unavailable";
    fail(`Depth could not be loaded. Reload to retry. ${error.message}`);
  }
}
async function checkXR() {
  if (!isSecureContext || !navigator.xr) {
    xrStatus.textContent = "VR needs a headset browser and HTTPS or localhost.";
    return;
  }
  try {
    xrSupported = await navigator.xr.isSessionSupported("immersive-vr");
    xrStatus.textContent = xrSupported ? "Headset ready. Choose Enter VR." : "Desktop preview available. Open this page in your headset browser for head parallax.";
  } catch {
    xrStatus.textContent = "Headset support could not be checked. Desktop preview is available.";
  }
  refreshControls();
}
window.addEventListener("pagehide", () => video.pause());
void initializeDepth();
void checkXR();
if (video.error) fail("The video could not be loaded. Reload the page to retry.");
refreshControls();
