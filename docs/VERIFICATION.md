# Verification and review

## Live-depth prototype

The second viewer follows the approved bounded design: physical head
translation creates parallax, right-thumbstick orbit is limited to ±25°, and
the talking person is favored over the background. Inference remains offline;
depth displaces a shared 192 × 108 surface during playback. The original stereo
viewer is retained and links to the new page.

- All ten local tests passed, including the preserved six stereo checks and
  four new live-depth checks. An independent read-only reviewer ran all ten
  and also passed them without finding critical or important defects.
- The rendered-pixel test moves a camera between two positions and confirms
  nearer geometry shifts more than farther geometry. A flat textured plane
  fails this check. The orbit check also confirms changed rendered pixels,
  rather than merely a changed readout.
- Quest controller emulation reaches both ±25° bounds, remains clamped, and
  resets to zero. Missing depth prevents VR entry with a visible explanation.
- Talking/cutaway transitions and restart select the correct geometry mode.
  A paused-seek regression exposed Chrome's missing hidden-video compositor
  callback and a deferred pause event disabling controls while readiness was
  temporarily 1. Refreshing the decoded frame on `seeked` and transport controls
  on `canplay` resolves both, without weakening the checks.
- All 209 RGB frames decode at 960 × 540 with AAC audio. Every atlas tile has
  finite display distance in range; all talking frames have a nonempty person
  matte, and all cutaways are flat and opaque. Recorded measurements are in
  [live-depth-verification.json](live-depth-verification.json).

The reviewer checked aligned DA3 preprocessing, atlas addressing, world-fixed
placement, and active-session exit availability. Automated timing checks cover
shot transitions rather than every frame's pixel correspondence. Visible edge
holes, warped subtitles, and stretched side views are accepted rough-prototype
limits. Hardware observations for the original stereo viewer below do not
establish live-depth tracking quality, audible output, comfort, or frame rate.

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
- Authored-file whitespace checks passed. The byte-preserved upstream
  `public/lib/three.core.js` has one existing space-before-tab warning at
  line 49957; its distribution was retained unchanged.

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
