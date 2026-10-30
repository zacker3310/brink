# Measuring the battle on a real iPhone

The battle's performance on a phone can only be measured on a phone. This repository's machines
(and any container or CI runner) draw WebGL in software, with SwiftShader, which Chromium itself
calls a poor experience for WebGL: a frame there takes hundreds of milliseconds of rasterising that
a phone's GPU does in a few. **A container run cannot establish iPhone performance**, in either
direction: it says nothing about GPU time, fill rate, heat, Low Power Mode or memory pressure on
the device. What it can check is behaviour: that the battle draws only when something changes,
that it survives a lost GPU context and a closed page, and that nothing leaks across rebuilds
(`tests/e2e/arena-resilience.spec.ts`). Everything below is done by hand on hardware.

## What the battle does that you are measuring

- **Render on demand** (`apps/web/src/arena/pacing.ts`). The scheduler is in one state at a time:
  Context Lost and Suspended (page hidden) draw nothing; Combat Playback (the film and two seconds
  after it), Camera Transition (the camera moving or easing, and 0.3 s after) and Interaction (an
  order, an overlay or a setting: the frame it asks for) draw every animation frame; Ambient Animation (only
  smoke, fire, rain or snow, turning rotors or moving soldiers in view; idle soldiers count only in
  close views) draws 30 a second for 15 seconds after the last playback, camera move or
  interaction, then holds the picture; Idle draws nothing. A battle left alone draws zero frames
  a second. The shadow map is redrawn only when a shadow caster or the sun's frame moved.
- **Adaptive pixel ratio.** It starts at the quality's cap (Low 1, Balanced 1.6, High 2, never above
  the device's own) and steps down 0.2 (0.4 when frames take over twice as long as they should)
  when the median of the last 60 real frame intervals is over 20.8 ms, to no lower than 1. It
  steps back up when the last 180 intervals keep 60 a second, and stops climbing after it has
  turned back on itself twice ("Frozen"). A steady 33 ms cadence is read as Low Power Mode (iOS
  caps animation frames at 30 a second there) and holds the ratio rather than lowering it.
- **Crash resilience.** A lost WebGL context stops drawing ("Restoring the Battlefield"), and the
  stage is rebuilt from the battle when the context comes back, or after 3 s if it never does. The
  battle is saved as a checked snapshot when it opens, after every order, at the end of every turn,
  when the page is hidden and when the context is lost; a reloaded page offers Resume Battle in
  Skirmish. A war-map battle resumes when the same attack is ordered again on the same turn.

## The frame-time overlay

Battle menu, **Show Frame Time**. It sits at the left under the header and takes no touches. Rows:

| Row | What it is |
|---|---|
| Chart | The last 92 real frame intervals after drawn frames, 0 to 50 ms; dashed lines at 16.7 ms (60 a second) and 33.3 ms (30) |
| Frame | Median and 95th percentile of those intervals: the cadence the display got |
| Drawing | The scheduler state and frames drawn a second |
| JavaScript | Main-thread time of one drawn frame, the whole of it |
| Render Call | Of that, the time in `renderer.render` (submitting the frame to WebGL, shadow pass included) |
| HUD | Of that, the DOM work: badges, arrows, labels, odds |
| Engine | Battle engine calls from the screen (orders, turns, the advice), outside frames |
| Pixel Ratio | The ratio drawn at, of its cap, and Adapting, Frozen, Fixed (Low, or a device at 1) or Low Power |
| Draw Calls | Draw calls and triangles of the last frame |
| Uploaded | Geometries and textures three.js has uploaded |

Two things the overlay does not show, and must not be read as showing:

- **GPU time.** WebGL on iOS has no timer queries. JavaScript time is the CPU's main thread; a frame
  can be cheap in JavaScript and still miss its slot on the GPU. The Frame row (the cadence) is the
  only number that includes the GPU, and only indirectly.
- **Memory.** Geometries and textures are counts of objects three.js has uploaded, not bytes, and
  not the process's or the GPU's memory. Memory comes from Safari's Web Inspector (below).

## Devices and builds

- **Floor device: iPhone 13** (A15, 4 GB). Add any newer phone to hand, and a ProMotion model if
  possible (Safari still runs the page at 60 Hz on it).
- Record the iOS version, the Safari version and the build (the commit of the deployed page).
- Use the production build: the Pages deployment (https://zacker3310.github.io/brink/), or
  `pnpm build` then `pnpm --filter @brink/web preview -- --host` on the same network.
- Before each run: battery over 80% and not charging (charging heats the phone), brightness fixed
  at 50% with auto-brightness off, other apps closed, the phone at room temperature (note it), and
  the case off if it holds heat.

## Checklist

Run each item on the floor device; tick it and write down what you saw.

- [ ] **Safari tab**, portrait. The battle is played in portrait; it has no landscape layout. Rotate
  once anyway and note whether anything breaks.
- [ ] **Home Screen app** (Share, Add to Home Screen, open from the icon): repeat the whole session.
- [ ] **Low Power Mode off**, then **on** (Settings, Battery): the overlay's Frame row should sit
  near 33 ms with Low Power on, and Pixel Ratio should read Low Power and not fall.
- [ ] **Reduce Motion** on (Settings, Accessibility, Motion): the battle's Motion setting defaults
  from it; check that it does and that nothing animates that should not.
- [ ] **Sustained session, 15 to 20 minutes** (early frame times are not representative; heat
  arrives later). Play Last Stand at Balanced: turns, camera moves, enemy turns, idle spells.
- [ ] **Idle:** put the phone down mid-turn for 60 s. Drawing should read Idle, 0 a second, after at
  most 15 s of Ambient Animation.
- [ ] **Backgrounding and returning:** go to the Home Screen for 10 s, 2 minutes and 10 minutes,
  and lock the screen once; on return the battle is either as it was, or "Restoring the
  Battlefield" brings it back, or (if iOS closed the page) Skirmish offers Resume Battle at the
  last order.
- [ ] **Rapid multitouch:** pinch, twist and pan quickly, with two and three fingers, for 30 s; tap
  units while the camera is still moving.
- [ ] **Interrupted gestures:** start a pinch and lift one finger, start a drag and bring in a second
  finger, drag off the screen's edge, and pull down Control Center mid-gesture.
- [ ] **Memory pressure and recovery:** with a battle open, open the Camera and record 30 s of 4K
  video, open a few heavy web pages in other tabs, then return. Note whether the context was lost
  (the overlay says Context Lost, the screen says Restoring the Battlefield), whether the page
  reloaded, and whether Resume Battle brought the battle back at the last order.
- [ ] **Quality switches:** change quality five times in one battle; the overlay's Uploaded counts
  should come back to the same numbers at the same quality.

## Safari Web Inspector timelines

Connect the phone to a Mac with a cable. On the phone: Settings, Safari, Advanced, Web Inspector
on. On the Mac: Safari, Settings, Advanced, show features for web developers; then Develop, the
phone's name, the page.

1. **Timelines** tab: turn on JavaScript and Events, Rendering Frames, CPU, Memory and Screenshots.
2. Record 60 s windows, each started from a battle at rest:
   - **Camera:** pan, pinch and twist for the whole window.
   - **Enemy turn:** End Turn, End Turn Now, and let the enemy's film play to the end.
   - **Idle:** touch nothing for the whole window.
   - **Input:** tap ten units in turn, then a cell to see a move, then Move.
3. From **Rendering Frames**: frames per second, the share of frames over 16.7 ms and over 33.3 ms,
   and the longest frame. From **CPU**: the main thread's average and peak. From **Memory**: the
   page's footprint, and JavaScript and Layers separately, at the start and the end of the session.
4. **Input latency:** in the JavaScript and Events track, find the `pointerdown` or `touchstart`
   of a tap and the first rendering frame that shows its result (the selection ring, the move
   card). Note the time between, for ten taps; report p50 and p95.
5. **Frame pacing:** from the Rendering Frames track, the p50 and p95 frame durations in each
   window (Camera, Enemy turn, Input), and in the Idle window the number of frames (it should be
   none).
6. **Canvas** tab: record one frame of the battle canvas; note the draw calls and the shader
   programs. Export each timeline (Export in the Timelines tab) and keep the files with the notes.

## What to record

One row per run, at minutes 0, 1, 5, 10, 15 and 20, from the overlay, plus the timelines:

| Field | |
|---|---|
| Device, iOS, Safari, Safari tab or Home Screen, Low Power on or off, Reduce Motion | |
| Battle, quality, minute | |
| Frame p50 / p95 (overlay) | |
| Drawing state and frames a second: camera moving, enemy turn, idle | |
| Pixel ratio, its cap and state (Adapting, Frozen, Low Power) | |
| JavaScript, Render Call, HUD p50 / p95 | |
| Draw calls, triangles, uploaded geometries and textures | |
| Input latency p50 / p95, frame pacing p50 / p95 per window (Web Inspector) | |
| Page memory footprint at start and end (Web Inspector) | |
| Battery at start and end; warmth (cool, warm, hot); any dimming or slowdown from heat | |
| Context lost, page reloaded, battle resumed (and at which order) | |

Pass marks to aim for on the iPhone 13 at Balanced: during camera moves, Frame p50 at 16.7 ms and
p95 under 33 ms after 20 minutes, with the ratio at 1.4 or more; idle at zero frames a second;
enemy turns without a frame over 50 ms; no context lost and no reload in a normal session; a
memory footprint that does not climb across the session. Tune nothing from container numbers.
