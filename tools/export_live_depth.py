"""Prepare the Bob prototype's aligned RGB clip and lossless animated depth atlas."""
from pathlib import Path
import argparse
import json
import subprocess
import sys

import cv2
import imageio
import imageio_ffmpeg
import numpy as np
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'vendor/Depth-Anything-3/src'))
from depth_anything_3.utils.io.input_processor import InputProcessor

TILE_W, TILE_H, COLUMNS = 192, 108, 16
NEAR, FAR, ANCHOR = 0.7, 3.5, 1.8
# Explicit annotations for this fixed Bob sample. The outdoor inserts stay flat.
SHOTS = [
    dict(start=0, end=50, talking=True, center=[0.64, 0.38], face=[.50, .20, .77, .55]),
    dict(start=50, end=144, talking=False, center=[0.5, 0.5]),
    dict(start=144, end=209, talking=True, center=[0.56, 0.30], face=[.42, .12, .70, .47]),
]


def person_mask(depth, anchor, shot):
    h, w = depth.shape
    near = (depth < anchor * 1.45).astype(np.uint8)
    # A rough depth-connected matte constrained to the seated person's region.
    # It is deliberately not an anatomical reconstruction or a learned segmenter.
    if shot['start'] == 0:
        points = [[.32,0],[.91,0],[.91,.38],[.78,.60],[1,.94],[1,1],
                  [.10,1],[.20,.83],[.44,.62],[.36,.48],[.32,.22]]
    else:
        points = [[.20,0],[.85,0],[.82,.37],[.69,.54],[1,.84],[1,1],
                  [.05,1],[.14,.78],[.40,.54],[.25,.38]]
    roi = np.zeros_like(near)
    polygon = np.rint(np.array(points) * [w - 1, h - 1]).astype(np.int32)
    cv2.fillPoly(roi, [polygon], 1)
    near *= roi
    near = cv2.morphologyEx(near, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8))
    count, labels = cv2.connectedComponents(near)
    x0,y0,x1,y1 = shot['face']
    face_labels = labels[int(y0*h):int(y1*h), int(x0*w):int(x1*w)]
    sizes = np.bincount(face_labels.ravel(), minlength=count)
    sizes[0] = 0
    if sizes.max() == 0:
        raise ValueError('No foreground component overlaps the annotated face')
    mask = (labels == int(sizes.argmax())).astype(np.uint8) * 255
    return cv2.GaussianBlur(mask, (3,3), .65)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--depths', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True, help='The original 12 fps intermediate')
    parser.add_argument('--audio-source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'public')
    args = parser.parse_args()
    torch.set_num_threads(4)
    args.output.mkdir(parents=True, exist_ok=True)
    with np.load(args.depths) as raw:
        depths = raw['depths']
        intrinsics = raw['intrinsics']
        fps = float(raw['fps'])
    if depths.shape != (209,280,504) or fps != 12:
        raise ValueError('This annotated prototype expects the 209-frame, 12 fps Bob conversion')
    if not np.isfinite(depths).all() or not (depths > 0).all():
        raise ValueError('Depth must be finite and positive')
    rows = (len(depths) + COLUMNS - 1) // COLUMNS
    atlas = np.zeros((rows*TILE_H, COLUMNS*TILE_W, 4), dtype=np.uint8)
    atlas[:,:,3] = 255
    for shot in SHOTS:
        section = depths[shot['start']:shot['end']]
        K = np.median(intrinsics[shot['start']:shot['end']], axis=0)
        shot['intrinsics'] = [float(K[0,0]/504),float(K[1,1]/280),float(K[0,2]/504),float(K[1,2]/280)]
        distances, masks = [], []
        for depth in section:
            if shot['talking']:
                x0,y0,x1,y1 = shot['face']
                anchor = float(np.median(depth[int(y0*280):int(y1*280),int(x0*504):int(x1*504)]))
                mask = person_mask(depth, anchor, shot)
                distance = np.clip(depth / anchor * ANCHOR, NEAR, FAR)
            else:
                distance = np.full_like(depth, ANCHOR)
                mask = np.full(depth.shape, 255, dtype=np.uint8)
            distances.append(cv2.resize(distance,(TILE_W,TILE_H),interpolation=cv2.INTER_AREA))
            masks.append(cv2.resize(mask,(TILE_W,TILE_H),interpolation=cv2.INTER_AREA))
        distances = np.stack(distances)
        if shot['talking']:
            # Smooth geometry within a shot, never across a camera cut.
            padded = np.pad(distances,((1,1),(0,0),(0,0)),mode='edge')
            distances = padded[:-2]*.25 + padded[1:-1]*.5 + padded[2:]*.25
        for offset,(distance,mask) in enumerate(zip(distances,masks)):
            index = shot['start'] + offset
            packed = np.rint((distance-NEAR)/(FAR-NEAR)*65535).astype(np.uint16)
            tile = np.stack([packed >> 8, packed & 255, mask, np.full(mask.shape,255)],axis=-1).astype(np.uint8)
            x,y = index % COLUMNS*TILE_W, index // COLUMNS*TILE_H
            atlas[y:y+TILE_H,x:x+TILE_W] = tile
    Image.fromarray(atlas).save(args.output/'Bob_live_depth.png',optimize=True)

    processor = InputProcessor()
    capture = cv2.VideoCapture(str(args.input))
    silent = args.output/'Bob_live_rgb_silent.mp4'
    writer = imageio.get_writer(str(silent),fps=fps,codec='libx264',macro_block_size=1,
                               ffmpeg_params=['-crf','18','-pix_fmt','yuv420p','-movflags','+faststart'])
    frames = 0
    try:
        while True:
            ok,bgr = capture.read()
            if not ok: break
            normalized,_,_ = processor([cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)],process_res=504,num_workers=1)
            rgb = normalized[0].numpy().transpose(1,2,0)
            rgb = np.clip((rgb*np.array([.229,.224,.225])+np.array([.485,.456,.406]))*255,0,255).astype(np.uint8)
            assert rgb.shape[:2] == (280,504)
            writer.append_data(cv2.resize(rgb,(960,540),interpolation=cv2.INTER_CUBIC))
            frames += 1
    finally:
        capture.release()
        writer.close()
    if frames != len(depths): raise ValueError('RGB and depth frame counts differ')
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-hide_banner','-loglevel','error','-y',
                    '-i',str(silent),'-i',str(args.audio_source),'-map','0:v:0','-map','1:a:0',
                    '-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',
                    str(args.output/'Bob_live_rgb.mp4')],check=True)
    silent.unlink()
    spec = dict(version=1,frames=frames,fps=fps,tileWidth=TILE_W,tileHeight=TILE_H,
                columns=COLUMNS,rows=rows,near=NEAR,far=FAR,anchorDepth=ANCHOR,
                shots=[{k:v for k,v in s.items() if k!='face'} for s in SHOTS],
                depthEncoding='16-bit RG high/low bytes; B foreground opacity; A 255',
                depthUnits='display metres after per-frame relative-depth normalization; not calibrated scene metres',
                coordinates='WebXR local metres; X right, Y up, Z toward the viewer',
                sourceDepthShape=list(depths.shape),
                model='depth-anything/DA3-SMALL',
                modelRevision='e08cab65ca0ec38e7826075418411ab90cab4da3',
                codeRevision='3d835ec1a5802d64a8b8b15f817a1ab54809bfe4')
    (args.output/'Bob_live_depth.json').write_text(json.dumps(spec,indent=2)+'\n')
    print(json.dumps({'frames':frames,'atlas':list(atlas.shape),'output':str(args.output)}))


if __name__ == '__main__':
    main()
