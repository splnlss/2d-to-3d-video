# Switching viewer modes

The browser button and floating VR button switch between **Video VR** and
**Live depth**. In VR, point either controller at the button below Bob and press
its trigger. A highlighted button indicates a hit. The controller beam helps
aim; pressing a trigger away from the button still toggles playback.

`/` and `/viewer.html` start in stereo Video VR. `/live-depth.html` starts with
person depth. Both use the same player, scene, cameras, and immersive session.
The ±25° orbit applies only to the depth surface. Recenter resets that orbit
and places the scene in front of the current head position.

## Process and libraries

The change uses the existing pinned Three.js 0.186.0 and WebXR APIs, without
new runtime dependencies. `viewer.js` loads the shared `live-depth-viewer.js`.
`stereo-screen.js` creates separate eye-layer screens; `depth-subject.js`
creates the shared depth geometry. The player toggles the visible surface
without requesting another XR session or moving the world anchor.

`xr-mode-button.js` draws its label to a canvas texture on a shared-eye plane.
It uses tracked controller target rays to hit-test that plane. The plane sits
0.72 display metres below the face anchor and 1.5 metres ahead of the initial
head position; WebXR local axes are X right, Y up, Z toward the viewer. These
are interface placement distances, not measurements of the source scene.

Each mode retains a video element, with only the active one in the page. A
switch pauses the outgoing video, seeks the destination to the same timestamp,
and preserves the paused/playing state. Only the active video drives the canvas
texture and audio. A paused destination is briefly primed with muted playback
because Quest may defer preload until a gesture; it is paused and unmuted once
the desired frame decodes. A short loading gap can occur on the first switch.

While a switch loads, duplicate switches are blocked. A media failure keeps
Exit VR and the switch back available. A depth-loading failure prevents depth
entry while retaining the stereo mode. HTML status text reports loading/errors;
the floating button remains available for recovery inside VR.

## Verification commands

```bash
python3 tools/serve.py
MISE_AUTO_INSTALL=0 mise exec -- pnpm test
VIEWER_BASE_URL=https://2d-to-3d-video.netlify.app \
  MISE_AUTO_INSTALL=0 mise exec -- node --test tests/viewer-modes.test.mjs
```

The suite retains all eleven prior checks and adds five mode checks:

- Every entry page switches both directions in place at a paused timestamp,
  retains the pause state, and changes the rendered pixels.
- Real emulator controller rays/triggers switch both directions while playback
  continues, the previous video's audio stops, and the same XR session stays open.
- A failed destination video still permits switching back and exiting VR.
- An active decoder-error event preserves the recovery timestamp/pause state.
- Switching at the clip's end remains paused and permits Restart.

These run actual media and WebGL with the pinned IWER runtime. Real headset
pointing, loading latency, audio continuity, and comfort require a wearer check.

## Separate hosting project

The standalone static site is `https://2d-to-3d-video.netlify.app`, Netlify site
ID `b8eb660e-923c-4f98-ab0d-1b234517e0ee`, under account `splnlss`. Only `public/`
is uploaded. There is no Git build integration, database, or application secret.

An authenticated deployment uses the existing Netlify CLI:

```bash
netlify deploy --site b8eb660e-923c-4f98-ab0d-1b234517e0ee \
  --dir public --no-build
```

This command creates a draft for review. Publishing uses the same command with
`--prod` when that update is explicitly authorized.
