import * as THREE from "./lib/three.module.js";
import { createDepthSubject, frameAtTime, clampOrbit } from "./depth-subject.js";
import { createStereoScreen } from "./stereo-screen.js";
import { createXRModeButton } from "./xr-mode-button.js";

let video = document.querySelector("#video");
let mode = document.body.dataset.startMode === "stereo" ? "stereo" : "depth";
const alternateVideo = document.createElement("video");
alternateVideo.hidden = alternateVideo.playsInline = true;
alternateVideo.preload = "auto";
const videos = mode === "depth" ? { depth: video, stereo: alternateVideo } : { stereo: video, depth: alternateVideo };
const modeButton = document.querySelector("#switch-mode");
const modeLabel = document.querySelector("#mode-label");
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
let ready = mode === "stereo";
let switching = false;
let pendingSwitch = null;
let failedPosition = 0;
let failedResume = false;
let centerOnNextFrame = false;
let subject = null;
let spec = null;
let degrees = 0;
let lastTime = null;

function refreshControls() {
  playButton.textContent = video.paused ? "Play" : "Pause";
  // Mobile browsers can defer preload until play() runs within a user gesture.
  playButton.disabled = !ready || failed || switching;
  restartButton.disabled = !ready || failed || switching || video.readyState < 2;
  vrButton.disabled = entering || (!session && (!ready || failed || switching || !xrSupported));
  vrButton.textContent = entering ? "Entering VR…" : session ? "Exit VR" : "Enter VR";
  modeButton.disabled = switching || (mode === "stereo" && !subject);
  orbit.disabled = mode === "stereo";
}
function fail(message) {
  if (!failed) {
    failedPosition = pendingSwitch?.time ?? video.currentTime;
    failedResume = pendingSwitch?.resume ?? !video.paused;
  }
  pendingSwitch = null;
  switching = false;
  failed = true;
  video.pause();
  status.textContent = message;
  refreshControls();
}
async function play() {
  const playingVideo = video;
  try {
    await playingVideo.play();
    if (video === playingVideo && !failed && !switching) status.textContent = "Playing";
  } catch (error) {
    if (video === playingVideo && !failed && !switching && error.name !== "AbortError") status.textContent = `Playback could not start. Press Play to retry. ${error.message}`;
  }
  refreshControls();
}
function togglePlayback() {
  if (!ready || failed || switching) return;
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
function clock(seconds) {
  return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00";
}
function updateTime() {
  time.textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local");
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#050608");
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 20);
camera.layers.enable(1); // Desktop stereo preview uses the left eye.
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
const screen = createStereoScreen(colorTexture);
screen.position.z = -1.2; // Together with the anchor, 3 display metres ahead.
anchor.add(screen);
const xrModeButton = createXRModeButton();
anchor.add(xrModeButton.mesh);

function showMode() {
  const stereo = mode === "stereo";
  ready = stereo || !!subject;
  screen.visible = stereo;
  if (subject) subject.visible = !stereo;
  modeLabel.textContent = stereo ? "Video VR" : "Live depth";
  document.querySelector("h1").textContent = `Bob · ${modeLabel.textContent}`;
  const label = stereo ? "Switch to Live depth" : "Switch to Video VR";
  modeButton.textContent = label;
  xrModeButton.setLabel(label);
  depthStatus.textContent = stereo ? "Video VR · stereo cinema screen" : "Loading person depth…";
  refreshControls();
}
function finishSwitch() {
  if (!pendingSwitch || video.readyState < 2) return;
  const targetTime = Math.min(pendingSwitch.time, video.duration);
  // Silent priming can advance while decoding/main-thread work runs. Stop it
  // first and seek back precisely, rather than freezing an advanced frame.
  if (!pendingSwitch.resume && !video.paused) {
    video.pause();
    video.currentTime = targetTime;
    return;
  }
  if (video.seeking || video.currentTime < targetTime - 0.1) return;
  const resume = pendingSwitch.resume;
  pendingSwitch = null;
  switching = false;
  if (!resume) video.pause();
  video.muted = false;
  drawFrame(video.currentTime);
  status.textContent = resume ? "Playing" : "Paused";
  updateTime();
  refreshControls();
}
function switchMode() {
  if (switching || (mode === "stereo" && !subject)) return;
  const targetMode = mode === "depth" ? "stereo" : "depth";
  const source = video;
  const job = { time: failed ? failedPosition : source.currentTime, resume: failed ? failedResume : !source.paused };
  switching = true;
  source.pause();
  source.remove();
  source.removeAttribute("id");
  video = videos[targetMode];
  video.id = "video";
  stage.insertAdjacentElement("afterend", video);
  mode = targetMode;
  failed = false;
  pendingSwitch = job;
  context.fillStyle = "black";
  context.fillRect(0, 0, 960, 540);
  colorTexture.needsUpdate = true;
  if (!video.getAttribute("src") || video.error) {
    video.src = mode === "depth" ? "./Bob_live_rgb.mp4" : "./Bob_DA3_stereo.mp4";
    video.load();
  }
  // Setting currentTime before metadata stores the default playback start time.
  video.currentTime = job.time;
  video.muted = !job.resume;
  showMode();
  status.textContent = `Switching to ${modeLabel.textContent}…`;
  // Prime a paused destination silently as well: Quest may defer preload until
  // play() is invoked by this gesture. Pause and restore audio after decoding.
  void video.play().catch((error) => {
    if (pendingSwitch === job && error.name !== "AbortError") fail(`Playback could not start. Press Play to retry. ${error.message}`);
  });
  finishSwitch();
}
modeButton.addEventListener("click", switchMode);

function drawFrame(mediaTime) {
  if (video.readyState < 2 || switching) return;
  context.drawImage(video, 0, 0, 960, 540);
  colorTexture.needsUpdate = true;
  if (mode === "depth" && subject && spec) {
    const shot = subject.setFrame(frameAtTime(mediaTime, spec));
    depthStatus.textContent = shot.talking ? "Person depth applied · move your head or orbit" : "Cutaway · flat video; person depth resumes when Bob returns";
  }
}
// Paused, hidden videos do not reliably issue a new compositor callback after
// seeking. At seeked the requested frame is decoded and can be captured safely.
function bindVideo(element) {
  element.addEventListener("error", () => {
    if (element === video) fail("The video could not be loaded. Switch modes or reload to retry.");
  });
  for (const name of ["loadeddata", "seeked", "canplay"])
    element.addEventListener(name, () => {
      if (element !== video) return;
      finishSwitch();
      drawFrame(video.currentTime);
      if (name === "loadeddata" && ready && !failed && !switching) status.textContent = video.paused ? "Ready to play" : "Playing";
      refreshControls();
    });
  element.addEventListener("play", () => {
    if (element === video) refreshControls();
  });
  element.addEventListener("pause", () => {
    if (element !== video) return;
    if (!failed && !switching) status.textContent = "Paused";
    refreshControls();
  });
  element.addEventListener("ended", () => {
    if (element !== video) return;
    status.textContent = "Finished — press Restart to watch again";
    refreshControls();
  });
  for (const name of ["timeupdate", "loadedmetadata"])
    element.addEventListener(name, () => {
      if (element === video) updateTime();
    });
  if (element.requestVideoFrameCallback) {
    const decoded = (_, metadata) => {
      if (element === video) {
        finishSwitch();
        const stalePausedFrame = video.paused && Math.abs(metadata.mediaTime - video.currentTime) > 1 / 12;
        if (!video.seeking && !stalePausedFrame) drawFrame(metadata.mediaTime);
      }
      element.requestVideoFrameCallback(decoded);
    };
    element.requestVideoFrameCallback(decoded);
  }
}
Object.values(videos).forEach(bindVideo);

function resize() {
  const { width, height } = stage.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(stage);
resize();
const controllers = [];
for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  controller.addEventListener("select", () => {
    if (xrModeButton.hit(controller)) switchMode();
    else togglePlayback();
  });
  controller.addEventListener("squeezestart", recenter);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: "#a9ddff", depthTest: false }));
  ray.visible = false;
  controller.add(ray);
  controllers.push({ controller, ray });
  scene.add(controller);
}
renderer.xr.addEventListener("sessionend", () => {
  session = null;
  centerOnNextFrame = false;
  lastTime = null;
  if (pendingSwitch) pendingSwitch.resume = false;
  video.pause();
  xrModeButton.mesh.visible = false;
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
    xrModeButton.mesh.visible = true;
    session.addEventListener("visibilitychange", () => {
      if (session?.visibilityState === "hidden") {
        if (pendingSwitch) pendingSwitch.resume = false;
        video.pause();
      }
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
    if (mode === "depth" && Number.isFinite(x) && Math.abs(x) > 0.15) setOrbit(degrees + x * 45 * dt);
  }
  let hovering = false;
  for (const { controller, ray } of controllers) {
    ray.visible = !!session;
    const hit = session ? xrModeButton.hit(controller) : null;
    ray.scale.z = hit?.distance ?? 3;
    hovering ||= !!hit;
  }
  xrModeButton.highlight(hovering && !modeButton.disabled);
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
    subject.visible = mode === "depth";
    ready = true;
    drawFrame(video.currentTime);
    if (!failed) status.textContent = "Ready to play";
    refreshControls();
  } catch (error) {
    depthStatus.textContent = "Depth unavailable";
    if (mode === "depth") fail(`Depth could not be loaded. Reload to retry. ${error.message}`);
    else refreshControls();
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
window.addEventListener("pagehide", () => {
  if (pendingSwitch) pendingSwitch.resume = false;
  Object.values(videos).forEach((element) => element.pause());
});
showMode();
drawFrame(video.currentTime);
void initializeDepth();
void checkXR();
if (video.error) fail("The video could not be loaded. Reload the page to retry.");
refreshControls();
