# 2D video to depth-based stereo

A small Depth Anything 3 conversion example and a WebXR video viewer. The Bob
sample is converted to half side-by-side stereo: each eye receives its own
synthesized view on a flat cinema screen. Depth is baked into the video; the
viewer does not build a live depth mesh or recover unseen surfaces.

[Open the deployed viewer](https://6ac67acad7e6a99d5f8c0a09--100th-meridian-prototype.netlify.app/viewer.html).
No Conductor login is required. In a Quest browser, choose **Enter VR**; either
controller's trigger toggles playback. Use the headset menu to exit. Desktop
controls provide play/pause and restart.

## Run locally

Python 3.9 or newer is sufficient to serve the included sample; no model or
Python packages are needed for viewing.

```bash
python3 tools/serve.py
```

Open <http://localhost:55000>. The server listens only on loopback and supports
byte ranges for video seeking. For a Quest connected through ADB, forward that
port from the headset to the serving computer:

```bash
adb reverse tcp:55000 tcp:55000
adb shell am start -n com.oculus.vrshell/.MainActivity \
  -a android.intent.action.VIEW -d com.oculus.browser \
  -e uri http://localhost:55000
```

Choose a device with `adb -s <serial>` if both USB and wireless devices appear.
Keep the server and ADB connection running. For an ordinary network URL, use
HTTPS so the browser can expose WebXR.

## Files

| Path                                          | Contents                                                         |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `public/index.html`, `public/viewer.html`     | Basic WebXR player                                               |
| `public/viewer.js`, `public/stereo-screen.js` | Playback, XR sessions, and per-eye video sampling                |
| `public/lib/`                                 | Three.js 0.186.0 modules and their MIT license                   |
| `public/Bob_DA3_stereo.mp4`                   | 960 × 540, 12 fps half SBS video, left eye first, with AAC audio |
| `public/Bob_DA3_depth.mp4`                    | Grayscale inverse depth; brighter is nearer                      |
| `public/Bob_DA3_comparison.mp4`               | Source and depth comparison                                      |
| `public/Bob_DA3_preview.jpg`                  | Beginning, middle, and end depth comparisons                     |
| `public/first-frame-3d/scene.glb`             | First-frame colored point cloud                                  |
| `tools/convert_da3.py`                        | CPU conversion of a separately supplied Bob source clip          |
| `docs/PROCESS.md`                             | Conversion process, libraries, setup, and commands               |
| `docs/conversion-metadata.json`               | Model/code revisions and conversion settings                     |
| `docs/conversion-verification.json`           | Original media/array verification results                        |

The original input, model weights, upstream source checkout, virtual
environment, and large raw depth archive are excluded from Git.

`public/results.html` contains the source/depth comparison and sample downloads.

## Checks

Use the pinned Node 22.23.2 and pnpm 10.12.1 from `mise.toml` and its checksummed
lock. Install the test dependencies and Chromium,
then keep the local Python server running while executing the suite:

```bash
mise trust
mise install
MISE_AUTO_INSTALL=0 mise exec -- pnpm install --frozen-lockfile
MISE_AUTO_INSTALL=0 mise exec -- pnpm exec playwright install chromium
MISE_AUTO_INSTALL=0 mise exec -- pnpm test
```

The suite checks actual media playback, pause, seeking, restart, byte ranges,
missing-media behavior, and rendered eye separation. It also uses the
checksum-pinned IWER 2.5.0 emulator to exercise VR entry, controller triggers,
exit/reentry, and exit after media failure. See `docs/VERIFICATION.md` for
results and limitations. Chrome is used when available; otherwise the suite
uses Playwright's installed Chromium.

## Hosting

The viewer is static. A new Netlify deployment only needs `public/`; the
included `netlify.toml` sets that publish directory. To upload a preview to
your chosen existing site from an authenticated Netlify CLI session:

```bash
netlify deploy --site <site-id> --dir public --no-build
```

This creates an unpublished draft. The linked demo is a standalone draft;
copying this repository does not change its deployment.

## Limits

The conversion uses independent monocular frame predictions and relative
depth, without temporal alignment or calibrated metric depth. Fine hair,
glasses, subtitles, occlusion boundaries, and filled gaps can show artifacts.
Leaning changes your position relative to the virtual screen, without revealing
new views of the filmed scene. The full sample is approximately 17.4 seconds.

An actual Quest 3S reported an active VR session and playing, unmuted video.
Subjective stereo comfort, audible headset output, and device frame time still
require a wearer check.
