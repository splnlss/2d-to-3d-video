import * as THREE from "./lib/three.module.js";
import { createStereoScreen } from "./stereo-screen.js";

const video = document.querySelector("#video");
const stage = document.querySelector("#stage");
const playButton = document.querySelector("#play");
const restartButton = document.querySelector("#restart");
const vrButton = document.querySelector("#vr");
const status = document.querySelector("#status");
const xrStatus = document.querySelector("#xr-status");
const time = document.querySelector("#time");

let session = null;
let xrSupported = false;
let entering = false;
let centerOnNextFrame = false;
let mediaFailed = false;

function refreshControls() {
  playButton.textContent = video.paused ? "Play" : "Pause";
  playButton.disabled = mediaFailed || video.readyState < 2;
  restartButton.disabled = mediaFailed || video.readyState < 2;
  vrButton.disabled = entering || (!session && (mediaFailed || !xrSupported || video.readyState < 2));
  vrButton.textContent = entering ? "Entering VR…" : session ? "Exit VR" : "Enter VR";
}

function failedMedia() {
  mediaFailed = true;
  status.textContent = "The video could not be loaded. Return to the conversion results and try again.";
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
  if (video.paused) {
    void play();
  } else {
    video.pause();
  }
}

playButton.addEventListener("click", togglePlayback);
restartButton.addEventListener("click", () => {
  video.currentTime = 0;
  void play();
});
video.addEventListener("loadeddata", () => {
  if (!mediaFailed) status.textContent = "Ready to play";
  refreshControls();
});
video.addEventListener("error", failedMedia);
video.addEventListener("play", refreshControls);
video.addEventListener("pause", () => {
  if (!mediaFailed) status.textContent = "Paused";
  refreshControls();
});
video.addEventListener("ended", () => {
  status.textContent = "Finished — press Play or Restart to watch again";
  refreshControls();
});

function clock(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
function updateTime() {
  time.textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
}
video.addEventListener("timeupdate", updateTime);
video.addEventListener("loadedmetadata", updateTime);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  status.textContent = "This browser cannot create the video screen. Try a browser with WebGL support.";
  playButton.disabled = restartButton.disabled = vrButton.disabled = true;
  throw new Error("WebGL is unavailable");
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
// WebXR local space uses metres, with the viewer's starting head pose as origin.
renderer.xr.setReferenceSpaceType("local");
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#050608");
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
camera.layers.enable(1); // Desktop displays the left-eye screen only.
const texture = new THREE.VideoTexture(video);
texture.colorSpace = THREE.SRGBColorSpace;
const screen = createStereoScreen(texture);
screen.position.set(0, 0, -3); // Three metres in front of the local-space origin.
scene.add(screen);

const position = new THREE.Vector3();
const orientation = new THREE.Quaternion();
const direction = new THREE.Vector3();

function resize() {
  const { width, height } = stage.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(stage);
resize();

for (let index = 0; index < 2; index++) {
  const controller = renderer.xr.getController(index);
  controller.addEventListener("select", togglePlayback);
  scene.add(controller);
}

renderer.xr.addEventListener("sessionend", () => {
  session = null;
  centerOnNextFrame = false;
  video.pause();
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  screen.position.set(0, 0, -3);
  screen.quaternion.identity();
  refreshControls();
});

vrButton.addEventListener("click", async () => {
  if (session) {
    await session.end();
    return;
  }
  if (entering || !xrSupported || mediaFailed) return;
  entering = true;
  refreshControls();
  const wasPaused = video.paused;
  try {
    // Request the session and media playback in the same user gesture.
    const requestedSession = navigator.xr.requestSession("immersive-vr", { requiredFeatures: ["local"] });
    void play();
    session = await requestedSession;
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

renderer.setAnimationLoop((_, frame) => {
  if (centerOnNextFrame && frame) {
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (pose) {
      position.copy(pose.transform.position);
      orientation.copy(pose.transform.orientation);
      direction.set(0, 0, -3).applyQuaternion(orientation);
      screen.position.copy(position).add(direction);
      screen.quaternion.copy(orientation);
      centerOnNextFrame = false;
    }
  }
  renderer.render(scene, camera);
});

async function checkXR() {
  if (!window.isSecureContext || !navigator.xr) {
    xrStatus.textContent = "VR needs a compatible headset browser and an HTTPS connection.";
    return;
  }
  try {
    xrSupported = await navigator.xr.isSessionSupported("immersive-vr");
    xrStatus.textContent = xrSupported ? "Headset ready. Choose Enter VR to watch in 3D." : "Desktop preview available. Open this page in your headset browser to enter VR.";
  } catch {
    xrStatus.textContent = "Headset support could not be checked. Desktop playback is available.";
  }
  refreshControls();
}
window.addEventListener("pagehide", () => video.pause());
if (video.error) failedMedia();
else if (video.readyState >= 2) status.textContent = "Ready to play";
refreshControls();
updateTime();
void checkXR();
