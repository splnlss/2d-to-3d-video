"""Reproduce the DA3-SMALL CPU conversion of the Bob clip."""
from pathlib import Path
import argparse
import json
import subprocess
import sys
import time
import types

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'vendor/Depth-Anything-3/src'))

import cv2
import imageio
import imageio_ffmpeg
import numpy as np
import torch
from depth_anything_3.api import DepthAnything3
from depth_anything_3.utils.export.glb import export_to_glb

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path, help='Original Bob video, with audio')
args = parser.parse_args()
SOURCE = args.source.expanduser().resolve()
OUT = ROOT / 'outputs'
OUT.mkdir(exist_ok=True)
INPUT = OUT / 'Bob_preview_input.mp4'
FPS = 12
PROCESS_RES = 504
torch.set_num_threads(4)
torch.set_num_interop_threads(1)


@torch.inference_mode()
def cpu_forward(self, image, extrinsics=None, intrinsics=None,
                export_feat_layers=None, infer_gs=False, use_ray_pose=False,
                ref_view_strategy='saddle_balanced'):
    # DA3's stock API selects CUDA autocast settings. Use its unmodified network
    # directly in float32 for this CPU-only environment.
    return self.model(image.float(), extrinsics, intrinsics, export_feat_layers,
                      infer_gs, use_ray_pose, ref_view_strategy)


def writer(path):
    return imageio.get_writer(str(path), fps=FPS, codec='libx264',
                             macro_block_size=1, ffmpeg_params=[
                                 '-crf', '18', '-pix_fmt', 'yuv420p',
                                 '-movflags', '+faststart'])


def add_audio(silent, output):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel',
                    'error', '-y', '-i', str(silent), '-i', str(SOURCE),
                    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
                    '-c:a', 'aac', '-b:a', '192k', '-shortest',
                    '-movflags', '+faststart', str(output)], check=True)


def warp_eye(rgb, shift):
    """Forward-project with a depth-priority buffer; inpaint uncovered pixels."""
    h, w = rgb.shape[:2]
    yy, xx = np.indices((h, w))
    dst_x = np.rint(xx + shift).astype(np.int32)
    valid = (dst_x >= 0) & (dst_x < w)
    src_index = np.flatnonzero(valid.ravel())
    destination = (yy[valid] * w + dst_x[valid])
    # Higher inverse depth is nearer. The shift's absolute direction is
    # supplied separately below via the depth-priority array.
    order = np.lexsort((CURRENT_INVERSE.ravel()[src_index], destination))
    destination, src_index = destination[order], src_index[order]
    keep = np.r_[destination[1:] != destination[:-1], True]
    destination, src_index = destination[keep], src_index[keep]
    result = np.zeros_like(rgb).reshape(-1, 3)
    result[destination] = rgb.reshape(-1, 3)[src_index]
    holes = np.ones(h * w, dtype=np.uint8) * 255
    holes[destination] = 0
    result = result.reshape(h, w, 3)
    return cv2.inpaint(result, holes.reshape(h, w), 3, cv2.INPAINT_TELEA)


start = time.time()
model = DepthAnything3.from_pretrained(str(ROOT / 'models/da3-small')).to('cpu').eval()
model.forward = types.MethodType(cpu_forward, model)
capture = cv2.VideoCapture(str(INPUT))
assert capture.isOpened()
expected = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
print(f'Processing {expected} frames with DA3-SMALL, CPU float32, res={PROCESS_RES}', flush=True)
depths, confidences, images, intrinsics, extrinsics = [], [], [], [], []
first_prediction = None
while True:
    ok, frame = capture.read()
    if not ok:
        break
    pred = model.inference([cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)],
                           process_res=PROCESS_RES)
    assert np.isfinite(pred.depth).all() and (pred.depth > 0).all()
    depths.append(pred.depth[0])
    confidences.append(pred.conf[0])
    images.append(pred.processed_images[0])
    intrinsics.append(pred.intrinsics[0])
    extrinsics.append(pred.extrinsics[0])
    if first_prediction is None:
        first_prediction = pred
    if len(depths) % 12 == 0:
        print(f'Depth: {len(depths)}/{expected}; elapsed={time.time()-start:.1f}s', flush=True)
capture.release()
assert len(depths) == expected
depths = np.stack(depths)
confidences = np.stack(confidences)
images = np.stack(images)
intrinsics, extrinsics = np.stack(intrinsics), np.stack(extrinsics)
np.savez_compressed(OUT / 'Bob_DA3_depths.npz', depths=depths, confidence=confidences,
                    intrinsics=intrinsics, extrinsics=extrinsics, fps=np.float32(FPS),
                    timestamps=np.arange(len(depths), dtype=np.float64) / FPS,
                    is_metric=np.bool_(False),
                    reference_frame='per-frame predicted camera; X right, Y down, Z forward',
                    depth_units='relative model units; not calibrated metres')
print('Raw depth data saved.', flush=True)
export_to_glb(first_prediction, str(OUT / 'first-frame-3d'),
              show_cameras=False, export_depth_vis=False, num_max_points=100000)

# Use one fixed visualization range across the clip to avoid display-normalization
# flicker. Each frame's monocular model prediction can still vary in scale.
inverse = 1 / np.maximum(depths, 1e-6)
low, high = np.percentile(inverse[:, ::4, ::4], [2, 98])
convergence = float(np.median(inverse[:, ::4, ::4]))
depth_writer = writer(OUT / 'Bob_DA3_depth_silent.mp4')
comparison_writer = writer(OUT / 'Bob_DA3_comparison_silent.mp4')
stereo_writer = writer(OUT / 'Bob_DA3_stereo_silent.mp4')
preview_indices = {0, len(depths)//2, len(depths)-1}
previews = []
try:
    for index, (rgb, inv) in enumerate(zip(images, inverse)):
        rgb = cv2.resize(rgb, (960, 540), interpolation=cv2.INTER_CUBIC)
        normalized = np.clip((inv - low) / max(high-low, 1e-6), 0, 1)
        gray = np.rint(normalized * 255).astype(np.uint8)
        color = cv2.cvtColor(cv2.applyColorMap(gray, cv2.COLORMAP_INFERNO), cv2.COLOR_BGR2RGB)
        color = cv2.resize(color, (960, 540), interpolation=cv2.INTER_CUBIC)
        gray_rgb = cv2.cvtColor(cv2.resize(gray, (960, 540)), cv2.COLOR_GRAY2RGB)
        comparison = np.concatenate([rgb, color], axis=1)
        cv2.putText(comparison, 'SOURCE', (15, 30), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (255,255,255), 2)
        cv2.putText(comparison, 'DA3 DEPTH: BRIGHTER = NEARER', (975, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2)
        CURRENT_INVERSE = cv2.resize(inv, (960, 540), interpolation=cv2.INTER_LINEAR)
        disparity = np.clip((CURRENT_INVERSE - convergence) / max(high-low, 1e-6),
                            -0.5, 0.5) * 16
        left, right = warp_eye(rgb, disparity / 2), warp_eye(rgb, -disparity / 2)
        # Half side-by-side packing: each eye occupies half the video width.
        stereo = np.concatenate([cv2.resize(left, (480, 540)),
                                 cv2.resize(right, (480, 540))], axis=1)
        depth_writer.append_data(gray_rgb)
        comparison_writer.append_data(comparison)
        stereo_writer.append_data(stereo)
        if index in preview_indices:
            previews.append(cv2.resize(comparison, (1280, 360)))
finally:
    depth_writer.close()
    comparison_writer.close()
    stereo_writer.close()
cv2.imwrite(str(OUT / 'Bob_DA3_preview.jpg'),
            cv2.cvtColor(np.concatenate(previews, axis=0), cv2.COLOR_RGB2BGR))
for kind in ['depth', 'comparison', 'stereo']:
    add_audio(OUT / f'Bob_DA3_{kind}_silent.mp4', OUT / f'Bob_DA3_{kind}.mp4')
metadata = {
    'source': SOURCE.name,
    'model': 'depth-anything/DA3-SMALL',
    'model_revision': (ROOT/'models/da3-small/revision.txt').read_text().strip(),
    'code_revision': subprocess.check_output(['git','-C',str(ROOT/'vendor/Depth-Anything-3'),
                                               'rev-parse','HEAD'], text=True).strip(),
    'device': 'cpu', 'precision': 'float32', 'fps': FPS, 'frames': len(depths),
    'duration_seconds': len(depths)/FPS, 'model_depth_shape': list(depths.shape),
    'process_res': PROCESS_RES, 'video_resolution': [960,540],
    'inference_mode': 'independent monocular frames; no cross-frame pose alignment',
    'depth_reference_frame': 'per-frame predicted camera; X right, Y down, Z forward',
    'depth_units': 'relative model units, not calibrated metres',
    'stereo_format': 'half side-by-side; left eye first; synthesized views',
    'stereo_max_absolute_disparity_pixels_per_eye': 4,
    'stereo_hole_fill': 'OpenCV Telea inpainting',
    'visualization': 'inverse depth; fixed global 2nd and 98th percentile range',
    'audio': 'source audio re-encoded to AAC 192k',
    'elapsed_seconds': time.time()-start,
}
(OUT/'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')
print(json.dumps(metadata, indent=2), flush=True)
