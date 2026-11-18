---
name: planet-game-eval
description: Evaluate tiny-planet / spherical-gravity third-person games, including intuitive WASD movement on a curved surface, jump/gravity, camera follow without flipping, monster AI, collisions, HUD/lifecycle, and visual style.
---

# Planet Game Eval Skill

Use this skill for `frontenjoyai-007` / 球心重力、第三人称、小星球跑酷/收集类游戏.

Default method: Playwright screenshots plus instrumented state sampling when available. Capture initial, started, WASD/Space sequence, movement frames, jump frames, and camera-follow frames. Use machine-readable vectors for movement/camera claims and screenshots for visible orientation/flip evidence.

## Movement Controls: A/D Must Be Intuitive Movement

For `task_id=2`, `WASD 四向移动方向符合直觉` is not satisfied merely because all keys produce some numeric position change.

Hard fail conditions:

- A/D 左右键主要造成镜头/朝向转换，而不是角色在屏幕/当前视角下的直觉横向移动；
- 只有 W/S 或前后键能产生可理解的前后移动，A/D 更像旋转镜头或绕视角漂移；
- A/D 的玩家位移主要投影到相机前后方向，而不是相机右/左方向；
- A/D 触发的相机位移/旋转明显大于玩家的横向位移，导致玩家感觉在“转镜头”而不是“左右移动”；
- 角色移动后方向/视角关系混乱，用户无法通过 WASD 形成稳定的左/右/前/后操作模型。

Recommended movement audit:

- For each key `W/A/S/D`, sample before/mid/after player position and camera position.
- Compute displacement in the local tangent plane.
- Compute dot products against the camera-projected forward and right vectors at key-down start.
- For A/D:
  - expected: `abs(lateralDot)` should dominate `abs(forwardDot)`;
  - fail if `abs(forwardDot) > abs(lateralDot)` for A or D;
  - fail if camera movement is much larger than player movement and the screenshot sequence reads as camera rotation rather than character lateral movement.

Do not mark task 2 pass from `movementAllKeysMove=true` alone. That only proves keys change coordinates; it does not prove intuitive four-direction control.

## Camera Follow: No Flip

For `task_id=3`, the camera must follow smoothly and must not flip.

Hard fail conditions:

- 镜头有翻转、倒置、突然滚转、视角穿过角色/星球导致画面上下颠倒；
- camera `up` is directly lerped to the local sphere normal without a stable roll constraint and the resulting screenshots/sequence show or plausibly expose roll flip;
- distance stays near the player but the horizon/controls flip, making the camera unusable;
- only checking `cameraDistanceStable` or `cameraNearPlayer` is not enough.

Recommended camera audit:

- Capture a movement sequence across W/A/S/D and around curved terrain.
- Save camera position, camera up vector, player normal, and screen screenshots.
- Compare frame-to-frame camera roll/up orientation. A pass needs no visible flip and no large roll discontinuity.
- Source signal `camera.up.lerp(targetUp)` with `targetUp = player normal` should be treated as high-risk; if the rendered sequence has a flip or the user-visible behavior is reported/observed as flip, mark task 3 fail even if distance is stable.

## Reporting

For `task_id=2`, the report reason must explicitly say whether A/D are real left/right movement or only camera/heading conversion. If A/D are unintuitive, mark the corresponding validation point `fail`.

For `task_id=3`, the report reason must explicitly say whether the camera flips. If the camera flips, mark the corresponding validation point `fail`.

## Alignment-Focused Adjudication

Movement claims require a live time series from ordinary gameplay, not only source formulas or a short displacement measurement. Drive the avatar across the top, side, and occluded/back region while sampling player position, planet center, radial distance, orientation/up vector, camera direction, and visible contact shadow. Use these samples plus frames to detect floating, penetration, snapping, sideways-control inversion, delayed response, or drift after key release. For restart, compare a complete inventory before play, after mutations, and after restart—score, collectibles, enemies, player pose, and relevant timers—rather than accepting a changed HUD or a return to the start screen as a full reset.
