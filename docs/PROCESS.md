# Process, libraries, and commands

## Conversion process

1. Decode the separately supplied Bob video into a 960 × 540, 12 fps
   intermediate. Keep the original file for audio muxing.
2. Use the official DA3-SMALL model to infer all intermediate frames
   independently at `process_res=504`. The example has 209 frames with
   504 × 280 depth maps.
3. Run the network in CPU float32. The script overrides the stock API's
   CUDA-oriented autocast selection without modifying the network.
4. Save depth, confidence, intrinsics, extrinsics, timestamps, and units in a
   compressed NPZ under ignored `outputs/`.
5. Visualize inverse depth with one fixed clip-wide 2nd–98th percentile range.
6. Project pixels horizontally using inverse depth, resolve collisions in favor
   of nearer pixels, and fill small gaps using OpenCV Telea inpainting. Limit
   shifts to four pixels per eye and pack the views as half SBS, left first.
7. Encode H.264 video and mux source audio as AAC at 192 kb/s. Export a
   first-frame point cloud with DA3's official GLB exporter.
8. View the stereo video on a 3.2 × 1.8 metre screen, three metres from the
   starting head pose in WebXR `local` space. Three routes each video half to
   its matching eye. Desktop rendering uses the left half.

## Libraries and revisions

| Component                                                                            | Version or revision                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------ |
| Official [Depth Anything 3 code](https://github.com/ByteDance-Seed/Depth-Anything-3) | `3d835ec1a5802d64a8b8b15f817a1ab54809bfe4` |
| Official [DA3-SMALL model](https://huggingface.co/depth-anything/DA3-SMALL)          | `e08cab65ca0ec38e7826075418411ab90cab4da3` |
| PyTorch / torchvision                                                                | `2.1.1` / `0.16.1`, CPU                    |
| NumPy                                                                                | `1.24.0`                                   |
| OpenCV headless                                                                      | `4.11.0.86`                                |
| ImageIO / imageio-ffmpeg                                                             | `2.37.0` / `0.4.7`                         |
| Hugging Face Hub / safetensors                                                       | `0.36.2` / `0.7.0`                         |
| OmegaConf / einops / addict                                                          | `2.3.1` / `0.8.2` / `2.4.0`                |
| trimesh                                                                              | `4.12.2`                                   |
| Three.js                                                                             | `0.186.0`, vendored with its license       |
| Playwright / IWER                                                                    | `1.62.1` / `2.5.0`, test dependencies      |
| Netlify CLI                                                                          | `27.3.0` for the existing hosted preview   |

The original conversion ran on Python 3.9 and Linux CPU. Use Python 3.9–3.11
for the pinned Torch version. Additional import dependencies are pinned in
`requirements-cpu.txt`; upstream's full optional GPU/app dependency set is not
needed for this CPU example. A clean installation on every operating system
has not been verified.

## Prepare the CPU converter

Run these commands from the repository root. On Linux or Windows, install
the CPU Torch wheels from the official wheel index:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install torch==2.1.1 torchvision==0.16.1 \
  --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements-cpu.txt
```

On macOS, install the same Torch/torchvision versions from PyPI instead of
the CPU wheel index. This script deliberately runs on CPU. Windows activation
uses `.venv\Scripts\activate`.

Fetch the exact upstream code and model revisions:

```bash
mkdir -p vendor models
git clone https://github.com/ByteDance-Seed/Depth-Anything-3 \
  vendor/Depth-Anything-3
git -C vendor/Depth-Anything-3 checkout \
  3d835ec1a5802d64a8b8b15f817a1ab54809bfe4
python - <<'PY'
from pathlib import Path
from huggingface_hub import snapshot_download
revision = "e08cab65ca0ec38e7826075418411ab90cab4da3"
snapshot_download(
    repo_id="depth-anything/DA3-SMALL", revision=revision,
    local_dir="models/da3-small",
    allow_patterns=["config.json", "model.safetensors"],
)
Path("models/da3-small/revision.txt").write_text(revision + "\n")
PY
```

## Convert the supplied Bob source

Put the original video at `input/Bob.mp4`. It is deliberately not committed.
Generate the intermediate, then run inference and stereo synthesis:

```bash
mkdir -p input outputs
video_ffmpeg="$(python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
"$video_ffmpeg" -y -i input/Bob.mp4 \
  -vf 'fps=12,scale=960:540' -an -c:v libx264 -crf 18 \
  -pix_fmt yuv420p outputs/Bob_preview_input.mp4
DA3_LOG_LEVEL=WARN OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 \
  python tools/convert_da3.py input/Bob.mp4
```

This reproduces the fixed Bob trial; it is not a general video conversion
service. It keeps the whole clip's predictions in memory. Audio muxing expects
an audio stream in the source. New outputs remain in ignored `outputs/` so the
included sample is preserved until you deliberately copy replacements to
`public/`.

## Units and coordinates

Depth and camera translations are in relative model units, without a surveyed
datum or calibrated metre scale. Each independently inferred frame has its
own camera and scale. Raw camera axes are X right, Y down, Z forward;
intrinsics use pixels at processed resolution, and extrinsics are
world-to-camera matrices. Rotation is dimensionless.

The first-frame GLB uses glTF axes X right, Y up, Z backward and remains in
relative units. The viewer's separate flat-screen placement uses metres in
WebXR local space. Neither output has a geospatial reference.

## Commands at a glance

```bash
python3 tools/serve.py                 # Local viewer, port 55000
python3 tools/serve.py --port 55002    # Explicit alternate viewer port
MISE_AUTO_INSTALL=0 mise exec -- pnpm install --frozen-lockfile        # Test dependencies
MISE_AUTO_INSTALL=0 mise exec -- pnpm exec playwright install chromium
MISE_AUTO_INSTALL=0 mise exec -- pnpm test                             # Requires local server on port 55000
netlify deploy --site <site-id> --dir public --no-build
```

The server and viewer require no API keys. Model setup downloads the pinned
public checkpoint; Netlify upload uses the CLI's own authenticated session.
