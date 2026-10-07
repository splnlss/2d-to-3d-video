# Live depth prototype

Open `/live-depth.html` from the local server or an HTTPS static deployment.
The original stereo viewer remains at `/viewer.html`.

## Controls

- **Enter VR:** places Bob in front of the current headset position. The surface
  stays fixed in the room; physical head translation creates parallax. Turning
  your head changes where you look without steering the orbit.
- **Right thumbstick:** orbit the surface around its face anchor, limited to
  −25° through +25°. Desktop users have the same range on the orbit slider.
- **Either trigger:** play/pause, including the original audio.
- **Either grip / Recenter:** reset orbit and place Bob in front of you again.
- **Restart:** return to the beginning. **Exit VR** or the headset menu ends VR.

## Process and libraries

This is a fixed-sample prototype using the existing DA3-SMALL predictions;
it does not run inference on the headset. The pinned model, upstream code,
Python packages, Node toolchain, and Three.js release are listed in
[PROCESS.md](PROCESS.md). No new runtime dependency is required.

1. Load all 209 relative-depth frames and camera intrinsics from the raw NPZ.
2. Annotate Bob's two talking shots: frames 0–49 and 144–208. Frames 50–143 are
   outdoor cutaways and use a flat surface with their complete image.
3. Normalize each talking frame's face depth to 1.8 display metres, constrain a
   rough depth-connected person matte, and smooth geometry over three frames
   within each talking shot. The matte favors the face and upper body.
4. Reduce depth to 192 × 108 samples per frame. Pack 16-bit distance into PNG
   red/green bytes and foreground opacity into blue. The 3072 × 1512 atlas
   contains all frames without a separately playing depth video.
5. Export aligned 960 × 540 RGB at 12 fps using the same DA3 image preprocessing
   as inference. Preserve the source audio as AAC.
6. Capture each decoded RGB frame into a canvas texture and select its depth
   tile using the same frame timestamp. Paused seeking also refreshes the
   decoded frame and controls. This avoids independent RGB/depth playback clocks.
7. A Three.js vertex shader reconstructs visible points from normalized camera
   intrinsics and sampled distance. Both eyes render the same geometry from
   their WebXR cameras. The subject remains world-fixed after initial placement;
   controller orbit rotates the surface about its face anchor.

## Reproduce the assets

First follow [PROCESS.md](PROCESS.md) to install Python dependencies, fetch
the pinned DA3 code/model, and run the existing conversion on `input/Bob.mp4`.
Then, with that Python environment active:

```bash
python tools/export_live_depth.py \
  --depths outputs/Bob_DA3_depths.npz \
  --input outputs/Bob_preview_input.mp4 \
  --audio-source input/Bob.mp4 \
  --output outputs/live-depth
```

Copy `Bob_live_rgb.mp4`, `Bob_live_depth.png`, and `Bob_live_depth.json` together
from `outputs/live-depth/` into `public/` to replace the included sample.
The exporter requires this clip's 209 frames at 12 fps and its shot annotations;
it is not a general-purpose person segmentation or video processing service.

```bash
python3 tools/serve.py
MISE_AUTO_INSTALL=0 mise exec -- pnpm test
netlify deploy --site <existing-site-id> --dir public --no-build
```

Visit <http://localhost:55000/live-depth.html>. The test suite needs the local
server running. The Netlify command uploads an unpublished static draft.

## Scale and limitations

Depth remains monocular and relative. Normalization assigns display distances
in WebXR local metres, with X right, Y up, and Z toward the viewer; it does not
measure Bob's real-world distance or supply a geospatial reference.

The model saw one camera view. Sideways head movement and orbit therefore show
an approximate visible-surface reconstruction, with stretching, gaps, edge
flicker, and imperfect hair/hat/body mattes. Subtitles are baked into the source
image. ±25° is a controller limit, not a guarantee of accurate side anatomy.
The dark background intentionally keeps attention on the talking person.
Headset comfort and sustained device frame rate require a wearer check.
