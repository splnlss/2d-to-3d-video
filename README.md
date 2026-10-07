# 2D video to depth-based stereo

A small Depth Anything 3 conversion example with two WebXR video viewers. The Bob
sample is converted to half side-by-side stereo: each eye receives its own
synthesized view on a flat cinema screen. Depth is baked into the video; the
stereo viewer displays that converted video on a flat screen.

The second viewer, [`public/live-depth.html`](public/live-depth.html), applies
per-frame depth to a 3D surface during playback. Physical head movement gives
parallax around Bob's face and upper body. The right controller's thumbstick
orbits ±25°; either trigger toggles playback, and either grip recenters.
Desktop users can try the orbit slider. Background is removed with a rough
depth matte; outdoor cutaways remain flat. Depth inference happens offline,
and unseen surfaces are approximated. See [the live-depth guide](docs/LIVE_DEPTH.md).

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

| Path                                                                                 | Contents                                                         |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `public/index.html`, `public/viewer.html`                                            | Basic WebXR player                                               |
| `public/viewer.js`, `public/stereo-screen.js`                                        | Playback, XR sessions, and per-eye video sampling                |
| `public/live-depth.html`, `public/live-depth-viewer.js`, `public/depth-subject.js`   | Live depth geometry, head parallax, and bounded orbit            |
| `public/Bob_live_rgb.mp4`, `public/Bob_live_depth.png`, `public/Bob_live_depth.json` | Aligned color video, lossless depth atlas, and frame metadata    |
| `tools/export_live_depth.py`                                                         | Export the fixed Bob sample for the live-depth viewer            |
| `public/lib/`                                                                        | Three.js 0.186.0 modules and their MIT license                   |
| `public/Bob_DA3_stereo.mp4`                                                          | 960 × 540, 12 fps half SBS video, left eye first, with AAC audio |
| `public/Bob_DA3_depth.mp4`                                                           | Grayscale inverse depth; brighter is nearer                      |
| `public/Bob_DA3_comparison.mp4`                                                      | Source and depth comparison                                      |
| `public/Bob_DA3_preview.jpg`                                                         | Beginning, middle, and end depth comparisons                     |
| `public/first-frame-3d/scene.glb`                                                    | First-frame colored point cloud                                  |
| `tools/convert_da3.py`                                                               | CPU conversion of a separately supplied Bob source clip          |
| `docs/PROCESS.md`                                                                    | Conversion process, libraries, setup, and commands               |
| `docs/conversion-metadata.json`                                                      | Model/code revisions and conversion settings                     |
| `docs/conversion-verification.json`                                                  | Original media/array verification results                        |

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
results and limitations. The second viewer adds rendered near/far parallax,
color/depth seeking and restart, missing-depth handling, and bounded XR
thumbstick orbit checks. Chrome is used when available; otherwise the suite
uses Playwright's installed Chromium.
The live-depth suite also covers VR entry when mobile video preload is deferred.

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
In the stereo viewer, leaning changes your position relative to the virtual
screen. In the live-depth viewer, leaning changes your view of the depth surface;
it can expose holes and stretched pixels at larger angles. Neither recovers
unseen anatomy. The full sample is approximately 17.4 seconds.

An actual Quest 3S reported an active VR session and playing, unmuted video.
Subjective stereo comfort, audible headset output, and device frame time still
require a wearer check.
