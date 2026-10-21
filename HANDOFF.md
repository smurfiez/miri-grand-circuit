# Agent Handoff Document: Miri Grand Circuit (Cel-Shaded Auto-Racer)

## 1. Project Overview & Core Constraints

Concept: A 100% self-playing ("Attract / Spectator Mode") cel-shaded arcade street racing simulation set in Miri, Sarawak, Malaysia.

Tech Stack: Single-file HTML5 (`index.html`), vanilla JavaScript (ES Modules), and Three.js (v0.160.0) via CDN import map.

Strict Dependency Rule: Zero external 3D models, image textures, or audio files. Every mesh, material, texture, landmark, particle system, and sound is procedural.

Debug hook: `window.__miri = { THREE, scene, camera, racers, trackCurve, renderer }` is exposed at the end of the module for inspection/testing (harmless in play).

## 2. Architecture & Implemented Systems

### A. Cel-Shading & Visual Pipeline
- 4-step toon gradient map (`[55, 125, 200, 255]`, NearestFilter) on all `MeshToonMaterial`.
- Inverted-hull ink outlines via `addInkOutline(mesh, scale)`.
- 2D radial speed-lines canvas overlay above 165 KM/H.
- Atmosphere toggle: Miri Golden Sunset / Miri Night Touge.

### B. Track, Asphalt & Banking
- Closed 18-waypoint `CatmullRomCurve3` (`trackCurve`), Y 3→92, ~3.85 km, 900-sample ribbon.
- **FIXED (important)**: the original asphalt + curb triangles were wound backwards — normals faced down, so the road and curbs were backface-culled and invisible from above (pre-existing bug; the cars drove on "grass"). Index order is now `(b, b+1, b+2, b+1, b+3, b+2)` for the asphalt and `(v0, v1, v2, v1, v3, v2)` for the curbs. **Do not revert these windings.**
- Banking: each cross-section sample looks ahead `t + 0.025` and tilts `right` by `clamp(-bankCross * 0.16, -0.18, 0.18)` rad around the tangent (`upSlope = cross(right, tan)`, i.e. +up). Cars use the identical bank math (`rightVec` + `root.rotateZ(bank)`) so they sit flush on the tilted surface.
- 3B: four overhead gantries — JKR green signs at t=0.24 (`PUJUT / PERMYJAYA`), 0.48 (`BANDARAYA MIRI`), 0.68 (`MARINA BAY / LUAK`), plus a checker `START - FINISH` banner at t=0.90. Panels use `panel.rotation.y = Math.PI` so text reads from approaching traffic. Posts are anchored to the ground (`postH = max(pt.y + 10.5, 10.5)`).

### C. Miri Landmarks
Sectors 1–4: Grand Old Lady derrick, MIRI sign, Bulatan Park, City Fan, Tua Pek Kong Temple, Seahorse Lighthouse, offshore rigs.

### D. JDM Racers & Broadcast Director
6 AI cars (RX-7 FD, GT-R R34, Supra A80, NSX NA1, Silvia S15, Evo IX), tangent-lookahead steering, drift slip angle + smoke, overtaking, 4-mode camera director, Neo-Brutalist HUD.

**Orientation (fixed — cars used to drive tail-first):**
- Car model front is **local −Z** (headlights at z −2.48, exhaust at +2.52, wing at +2.15).
- Body extrusion must use `bodyGeo.rotateY(-Math.PI / 2)`: the profile nose (x −2.45) then maps to z −2.45. `+PI/2` puts the nose at +Z and scrambles the body against the lights/wing.
- `Object3D.lookAt` aims local **+Z at the target** (meshes), so the sim must look *backwards*: `lookTarget = worldPos - tan`. Aiming at `worldPos + tan` makes every car drive in reverse. Verified numerically: headlights `dot(tan) > 0`, taillight `< 0`.
- With that orientation local +X = car right, so `rotateZ(bank)` tilts the same way as the road and positive drift/chassis yaw turns the nose left.

### E. Night Touge Lighting
- Two additive headlight cones per car (`ConeGeometry(4.2, 30, 20, 1, true)`, opacity 0.15, tip at headlight).
- 60 streetlight cones (`streetBeams[]`, opacity 0.12).
- Additive brake flare behind the tail bar, visible while `brakeFlare` condition holds (AI: hard corner braking; manual: braking or drifting).
- All beams toggle with `btnTime` / `isNightMode`.

### F. Web Audio Procedural Synthesizer
- `SOUND: OFF/ON` button; `AudioContext` created on first click (autoplay-safe), suspend/resume on toggle.
- Engine: 2 detuned saws + square sub → lowpass, RPM 1900–6700 mapped from gear position (`kmh % 38`).
- **Per-car character** (`char` on each roster entry, read as `fCar.audioChar`): `fMul` pitch, `cutoffBase/Span`, `q`, plus `lfoRate`/`lfoDepth` LFO modulating the filter (RX-7 rotary wobble = 38 Hz / 55; NSX = 12 Hz / 10; others 0).
- BOV chirp on downshift (bandpass 2400→550 Hz sweep, 0.2 s).
- Tire screech: looped white noise → Q-7 bandpass, gain follows `fCar.isDrifting`.

### G. Manual Drive (optional, AI takeover on idle)
- `W/↑` throttle, `S/↓` brake, `A/D` or `←/→` steer. Speed clamp 8–88 m/s; lateral clamp ±13 m; steer input also drives the drift slip angle (0.34 × speed factor).
- Works on the focused car only; all other cars stay AI.
- 3 s without input auto-returns to AI (`manualArmed`, `MANUAL_TIMEOUT`). `DRIVE: AI (WASD/ARROWS)` button toggles immediately; `#manual-pill` shows while manual.

### H. Coastline
- Sea is a 1900×3000 / 72×72 plane with per-frame sine wave displacement + recomputed normals.
- Shore foam: procedural speckle canvas strip (46×4500) at the waterline, scrolling texture offset + opacity pulse; dimmed at night via `foamBaseOpacity`.
- `townGround` was moved east (x=1795) so the beach and sea are no longer buried under it.

### I. Terrain
- Canada Hill ridge = four truncated cones sized/placed to stay clear of the elevated road corridor (road flies above them on pillars). Summit mound at (255,-565,r110,h88) sits under the Grand Old Lady group. Clearance was verified by raycast sampling (397/401 road samples clear; the 4 flagged hits are the intentional gantry beams and one palm frond).

## 3. Known Limitations / Technical Debt

1. Palm fronds can overhang the road by ~3 m near the t≈0.11 hairpin (scenery placement is distance-based, not corridor-aware).
   - Smoke is emitted at `worldPos - tan * 2.2`, which is the car's rear only because the root looks backwards along the tangent; if the orientation convention ever changes, the smoke offset must flip with it.
2. Streetlight beams point straight down regardless of road direction (arm orientation is world −X by design).
3. No wet-road reflections; night beams are additive cones only.
4. Audio is focused-car only (by design); no spatial panning or exhaust crackles.
5. Gantry posts are simple towers; on the t=0.90 climb they pierce the hillside.
6. Static offshore rigs (no bobbing).
7. `shortcut`: road banking is a single look-ahead sample (0.025 of arc length), not curvature-integrated — tight S-bends may bank slightly late. Upgrade by integrating signed curvature over a window.

## 4. Backlog

- [DONE] Priority 1 — Night Touge lighting & headlight cones.
- [DONE] Priority 2 — Web Audio procedural synthesizer.
- [DONE] Priority 3 — Track banking & overhead JKR gantries + start/finish banner.
- [DONE] Priority 4 — Optional manual drive with idle-timeout AI takeover.
- [DONE] Per-car engine character (audio signature per roster entry).
- [DONE] Animated sea + shoreline foam.
- [Idea] Corridor-aware scenery placement (keep trees/poles out of the road + shoulder).
- [Idea] Wet-road additive reflections at night; brake-light glow pools on the asphalt.
- [Idea] Minimap sector highlight + start/finish line marker.

## 5. Quick-Start Prompt for the Next Agent

"You are taking over the Miri Grand Circuit Cel-Shaded Auto-Racer (`index.html`), a zero-dependency single-file Three.js app. Read `HANDOFF.md` and `index.html`. Preserve: the corrected road/curb triangle windings, the banked cross-section math shared by road and cars, the gantry orientation, the Web Audio character fields, the manual-drive state machine, and `window.__miri`. Verify changes with the debug hook + a headless Chrome raycast/pixel probe before claiming success. Wait for my next feature request or pick an item from the backlog."
