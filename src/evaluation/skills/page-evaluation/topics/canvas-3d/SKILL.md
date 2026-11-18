---
name: canvas-3d-eval
description: Evaluate WebGL/canvas/3D pages with particle morphing, shape switches, auto-cycle, drag rotation, wheel zoom, dark starry visual style, glow/overexposure, and screenshot-based evidence.
---

# Canvas 3D Eval Skill

Use this skill for WebGL, canvas, Three.js, particle, 3D, dark starry, glow, and visual-interaction pages.

Default browser method: Playwright isolated Chrome. Use screenshots as primary evidence for visual states. Capture initial, after auto-cycle, after each explicit switch, after drag, and after wheel zoom.

For full-screen 3D demos, also capture cropped detail screenshots around the actual subject/effect. Full `1440x900` screenshots often make the object look tiny in Markdown/Typora, especially when the canvas has large empty dark areas or a fixed control panel. Keep full screenshots for layout/control evidence, but reference the detail crops in phase, physics, material, lighting, and animation criterion rows.

## Strong Automated Checks

- A `canvas` exists and has nonzero size.
- Expected control buttons exist.
- Clicking each shape/style button changes visible label, active state, or control text.
- Auto-cycle changes current form label after the expected wait.
- Pointer drag and wheel events do not crash the page.
- Dark scene pages expose expected labels/controls such as shape switch, density slider, status panel, or console text.
- Overexposure can be approximated with pixel stats or screenshots; no massive white screen.

## WebGL Caveat

Canvas readback can return black/transparent in headless or GPU-restricted environments even when screenshots show rendered content. Do not fail a 3D task solely because `drawImage(canvas)` pixel stats are black.

Use this evidence hierarchy:

1. Screenshots before/after.
2. DOM/control state changes.
3. Page does not crash.
4. Pixel stats only as supplementary evidence.

## Canvas Game State Instrumentation

For canvas/WebGL games, do not assume state is impossible to inspect. Check in this order:

1. `window` / `globalThis` keys for obvious debug/state objects (`game`, `state`, `store`, `player`, `scene`, `THREE`, `__debug`, etc.).
2. `localStorage` / `sessionStorage` for score, save data, leaderboard, progress, or settings.
3. Inline scripts and bundle text for closed-over variables and functions such as `score`, `playerPos`, `rings`, `monsters`, `startGame`, `endGame`, `updateHUD`, `checkCollision`.
4. If state lives in an IIFE/closure, use Playwright route instrumentation: intercept the HTML before script execution, inject a small `window.__gameDebug` object inside the closure, and expose read-only snapshots plus controlled helpers.

Instrumentation is allowed for evaluation, but label it clearly as instrumented evidence. It can prove internal logic such as collision, HUD updates, localStorage persistence, leaderboard writes, gravity vectors, or camera distances. It does not by itself prove a normal user can naturally reach that state through controls, so combine it with black-box keyboard/mouse tests when scoring playability.

Useful instrumented checks:

- Move the player to a ring position, call the app's ring/collision update, and assert score/ring HUD changes.
- Move a monster to the player position, call collision detection, and assert game-over UI and leaderboard update.
- Sample player radius before/during/after jump to verify return to planet surface.
- Sample monster-player distance over time to verify chase behavior.
- Sample camera position/up vector relative to the player surface normal for follow behavior.

## Drag And Zoom

Use fixed viewport and calculated canvas center:

1. Move to canvas center.
2. Mouse down.
3. Move by a clear delta with multiple steps.
4. Mouse up.
5. Wheel up/down.
6. Capture screenshot.

For `criteria` items such as "鼠标自由旋转视角", "鼠标拖拽旋转球体", or "OrbitControls 可旋转/缩放", judge the interaction capability separately from visual clarity:

- A drag/zoom pass needs an observable response, not just sent events: before/after screenshot pixel change, exposed camera/control state delta, canvas transform/state delta, or clear visible orientation/scale change.
- If the scene is continuously animated, collect a no-input baseline pair when practical, or cite stronger evidence such as app text/code showing drag/zoom support plus a drag/wheel-specific changed frame. Do not rely on a single changed frame if it could only be idle animation.
- Do not fail the drag/zoom capability merely because the subject is overexposed, a glowing solid ball, or the internal structure/nodes are hard to see. Put those findings under the separate visual/Bloom/structure clarity `criteria` items.
- If the criterion explicitly says "从不同角度清晰观察结构", split the verdict in the reason: interaction may pass, while structure observability can fail only when that exact child criterion requires it.
- Fail drag/zoom only when there is no canvas/interactive target, the page crashes, no pointer/wheel support or hint/code is present, or the captured/control evidence shows no response.

Pass means the interaction path runs and visible/control state supports the behavior. Exact 3D camera delta should be model-judged from before/after screenshots unless the app exposes camera state; use `fail` only when the camera change is not visible or evidence is too sparse.

## Observation Protocol

Frame the subject before judging its shape. Initial framing is often zoomed in far enough that only a fragment of the geometry is visible.

- Scroll-zoom out until the whole form is inside the frame, then capture the screenshot used for the shape verdict.
- Judge sphere/star morphology from that full-form capture, not from the default view.
- State in the reason that the verdict came from a zoomed-out capture, and attach it.

## Reporting

- Shape switch and auto-cycle can be deterministic pass/fail.
- "Filmic", "beautiful", "glow not too strong", and "connection clarity" should be model-judged from screenshots/crops first, with concrete visual observations in the reason.
- Always list screenshot paths for visual scoring.
- For staged animation demos, capture every named stage with a DOM/status wait when possible, not fixed sleeps. Store the observed status text and screenshot path in a JSON audit so missed short-lived stages are visible.

## Alignment-Focused Adjudication

Before judging a particle silhouette, normalize the observation: wait for morph convergence, use wheel/zoom or camera controls to fit the whole subject, and reduce bloom/exposure only through controls the product provides. Use frame differences or particle-position/state samples to establish that a morph is generated and interpolated; do not fail named shapes solely because one overexposed screenshot obscures them. Visual recognizability still needs at least one settled, properly framed view per shape. For node ripples, capture the clicked node, ripple origin, and successive radii in close frames; origin/state instrumentation may support an effect that is brief, but source code or a transient glow alone cannot prove spatial propagation.
