# Verification and review

## Switching modes inside VR

Both entry pages now share a player with browser and floating VR mode buttons.
Tracked controller rays select the floating button. The same session and world
anchor remain active while stereo/depth visibility and the video change. The
inactive video is paused, and the destination seeks to the previous timestamp.

All sixteen local checks passed: the unchanged eleven previous checks plus
five mode-switch checks for paused timestamp/rendering on every entry route,
controller selection/same-session playback, failed destination recovery,
active-media error recovery, and switching/restart at the end of the clip.
The first three tests failed against the previous player before implementation.
The decoder-error regression uses an error event on a real decoded video;
it does not simulate a physical hardware decoder failure.

Review findings and dispositions:

1. **Active-video failure resets recovery time. Resolved.** The initial handler
   saved a recovery position only during a pending switch. The reviewer
   reproduced 13 seconds resetting to zero. A regression confirmed that failure;
   the handler now captures either the pending timestamp or active media time
   and play/pause state before stopping playback. Duplicate failures preserve
   the first snapshot.
2. **Paused silent priming advances the timestamp. Resolved.** A repeated full
   run observed 13 seconds becoming 13.184. Once decoding is available, the
   destination is paused and seeks back to the exact saved time before completing
   the switch. Playing transitions allow their clock to advance naturally;
   they no longer require the time to remain inside a small completion window.

An independent read-only reviewer reran all sixteen checks successfully and
confirmed the recovery finding was resolved, with no remaining critical or
important findings. No previous assertion was removed or weakened.

The floating button is shared between the eyes; stereo screens retain their
separate eye layers. There are no new runtime packages or changes to Three.
The separate Netlify project is `2d-to-3d-video`, site ID
`b8eb660e-923c-4f98-ab0d-1b234517e0ee`, under `splnlss`. Wearer verification of
physical controller aim, loading gaps, audio handoff, and comfort remains open.
See [VIEWER_MODES.md](VIEWER_MODES.md) for controls and commands.

Runtime commit `d920aeac398b7eab7cb2eac5f6df01a5f326c441` passed the complete
sixteen-check local suite and was published to the new site as deploy
`6ac6a6f8bc45321583eb4852`. All five mode checks passed against
<https://2d-to-3d-video.netlify.app>. Nine runtime/media/depth file hashes matched
the tested bundle. The Netlify API confirmed this deploy is published on the
new site, while the original application's published deploy remained
`6ac6750279b50dda762ee91a`. An ADB launch opened the new live-depth URL on the
connected Quest 3S; this does not establish successful wearer interaction.

## Live-depth prototype

The second viewer follows the approved bounded design: physical head
translation creates parallax, right-thumbstick orbit is limited to ±25°, and
the talking person is favored over the background. Inference remains offline;
depth displaces a shared 192 × 108 surface during playback. The original stereo
viewer is retained and links to the new page.

- All eleven local tests passed, including the preserved six stereo checks and
  five new live-depth checks. An independent read-only reviewer ran all eleven
  and also passed them without finding critical or important defects.
- The rendered-pixel test moves a camera between two positions and confirms
  nearer geometry shifts more than farther geometry. A flat textured plane
  fails this check. The orbit check also confirms changed rendered pixels,
  rather than merely a changed readout.
- Quest controller emulation reaches both ±25° bounds, remains clamped, and
  resets to zero. Missing depth prevents VR entry with a visible explanation.
- Actual Quest 3S inspection found deferred media preload: readiness stayed 0
  until a user playback gesture. Disabling Play/VR until readiness 2 stranded
  the user. A new test starts real video from `preload="none"` and verifies VR
  entry, playback, and exit. It failed before removing those readiness gates;
  the corrected controls wait for depth and headset support, then initiate
  media loading from the user's gesture. Restart still waits for decoded media.
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

### Hosted live-depth preview

Runtime commit `090c3e46d6d740745706fdfbc1b3d5be4f4534aa` was uploaded as
unpublished Netlify draft `6ac69592c300af97c882301e`. All five live-depth checks
passed against HTTPS, including deferred-preload startup and emulated controller
orbit. All five new runtime/depth/color files matched the final uploaded bytes;
Three distributions also matched in the initial preview. Netlify rewrites HTML navigation
links to its equivalent pretty URLs, so those HTML bytes differ intentionally.

The connected Quest 3S opened the corrected page with WebXR present, both Play
and Enter VR enabled, and media readiness 0 before a gesture. Automated VR entry
did not remain active; it interrupted the pending playback attempt, and a
subsequent remote playback inspection timed out. This is not evidence of a
successful physical immersive session. A wearer must choose Enter VR and check
head parallax, thumbstick orbit, comfort, audio, and sustained frame rate.

The existing site's published deploy remained `6ac6750279b50dda762ee91a`
after the final live-depth upload. The static previews are separate drafts.

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
