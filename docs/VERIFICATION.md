# Verification and review

## Standalone export

The export preserves the previously reviewed viewer and its six test cases.
Paths now resolve inside this repository, and a separately supplied source
video is passed to the CPU converter on the command line. Model weights,
upstream source, virtual environments, raw depth archives, local environment
files, and test screenshots are ignored. The included videos and licensed
Three files match the original verified sample byte for byte.

## Checks

- All six local viewer tests passed at <http://localhost:55000> after relocation.
  A separate read-only reviewer independently ran the same suite: 6/6 passed.
- The relocated converter completed the full 209-frame clip in CPU float32.
  All three videos decoded 209 frames and contained AAC audio. The raw depth
  shape was `(209, 280, 504)`, float32, finite, positive, and marked nonmetric.
  See `relocated-conversion-verification.json` for the recorded result.
- The model/code revisions and existing CPU dependencies were reused for that
  run. A fresh Python dependency installation was not repeated.
- Python syntax, targeted formatting, local links, and the staged file list
  were checked before committing the export.

## Review findings

1. **Missing verification document. Resolved.** The README initially linked to
   this document before it was written. This file now records the evidence and
   limitations.
2. **Conversion-results navigation reloads viewer. Resolved.** The initial
   standalone homepage duplicated the viewer while preserving its original
   results backlink. `public/results.html` now contains the existing source
   and depth comparison page and only links to included assets. Both viewer
   entry points link to it.

No test assertion was removed or weakened during the export. The reviewer
confirmed the unchanged viewer implementation, preserved tests, matching
sample/library hashes, portable paths, and excluded local-only artifacts.

## Hosted and headset observations

The existing Netlify preview is an unpublished standalone static deployment,
independent of the original application's published production deploy. All
eight original hosted viewer file hashes matched the verified bundle.

Five of six hosted checks passed. The range test passed correct prefix/suffix
206 responses and an invalid-range 416 status, then failed because Netlify
omits the expected `Content-Range` header on that 416 response. Normal
playback, seeking, restart, rendered eye separation, emulated VR controls,
and missing-media behavior passed. The local server supplies that header and
passes the unchanged test. This hosting limitation remains open.

The actual device reported **Quest 3S**. Its browser loaded the viewer over
HTTPS with WebXR available and video readiness 4. A subsequent inspection
reported an active VR session (`Exit VR`), video time 4.463645 seconds,
`paused=false`, `ended=false`, `muted=false`, no media error, and `Playing`.
Subjective stereo comfort, audible speaker output, tracking quality, and
device frame time remain unverified.
