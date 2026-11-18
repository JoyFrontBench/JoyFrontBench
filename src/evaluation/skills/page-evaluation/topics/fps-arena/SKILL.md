---
name: fps-arena-eval
description: Evaluate frontenjoyai-023 browser FPS survival arenas with full-viewport readable WebGL, pointer-lock camera-relative controls, freeze-safe input, swept collision and support geometry, authoritative weapon transactions, active two-class enemy AI, physical occluded projectiles, weapon progression, HUD statistics, and lifecycle cleanup.
---

# FPS Arena Eval Skill

Use this skill for `frontenjoyai-023` and similar first-person WebGL combat games.

The task judge is the contract. Run in a real desktop browser that can grant Pointer Lock; synthetic key events without pointer-lock state are insufficient for camera/input claims. Use video or consecutive screenshots, debug-state sampling, and source/domain tests. Reference implementation names below are optional anchors, not a required architecture.

## Locate Stable Anchors

Prefer role/name and semantics. Reference anchors, when present:

- Canvas: `[data-testid="game-canvas"]`;
- start: heading `PULSE ARENA` and button containing `START GAME`;
- HUD/debug: `player-hp`, `player-position`, `ammo`, `reserve-ammo`, `score`, `wave`, `threat-level`, `enemy-count`, `weapon-level`, `weapon-damage`, `game-state`, `shots-fired`, `shots-hit`;
- visual HUD: `.topbar`, `.vitals`, `.weapon`, `.crosshair`, pause button/name;
- dialogs: `PAUSED`, `RESUME`, `RESTART RUN`, `RUN ENDED`, `RESTART`.

The task requires an openable Debug Panel showing player HP/position, ammo/reserve, score, wave, threat, enemy count, weapon level/damage, game state, and shots fired/hit. Harness instrumentation may supplement these values but does not excuse a missing panel. A useful authoritative snapshot contains:

```json
{
  "phase": "playing",
  "runId": 1,
  "hp": 100,
  "ammo": 30,
  "reserve": 120,
  "score": 0,
  "wave": 1,
  "threat": 1,
  "remaining": 3,
  "kills": 0,
  "weaponLevel": 1,
  "shotsFired": 0,
  "shotsHit": 0,
  "reloading": false,
  "playerPosition": { "x": 0, "y": 0, "z": 0 }
}
```

Candidate source anchors include weapon constants, `consumeAmmo`, `reloadAmmo`, `applyWeaponUpgrade`, `sweptPlayerMove`, `supportHeight`, `sweptWorldHit`, `sweptSphereHit`, the central game store, player controller, and enemy/projectile manager.

## Start, Scene, And HUD

1. Clear the record storage and open the ordinary URL at `1440x900`.
2. Require title, controls, best score/wave, and a start action. Clicking Start Game must enter the playable phase and Pointer Lock as required by the judge.
3. Measure Canvas against viewport bounds. It must be the main full-viewport scene, not a small card preview.
4. At spawn and after movement, visually identify lit ground, central ramp, at least eight covers, high platform, boundary structure, and enemy silhouettes. Use canvas pixel statistics plus screenshots; reject black/blank output.
5. Capture consecutive frames showing real changes in enemies, weapon recoil/muzzle state, projectiles, or effects.
6. Trigger and distinguish player damage, Scout/Heavy, projectile types, hit marker, wave transition, threat escalation, and weapon evolution.
7. Measure top status, HP, ammo/weapon progression, and crosshair rectangles. All stay inside the viewport, do not overlap incoherently, and produce no horizontal scroll.

## Input And Freeze Semantics

- Acquire Pointer Lock and sample camera yaw/pitch plus player position.
- Move the mouse horizontally and vertically. Yaw must change; pitch must clamp before inversion.
- Turn roughly 90 degrees, then test W/A/S/D. Position deltas must follow camera forward/right vectors. Compare equal-duration W and Shift+W; sprint is materially faster.
- Hold and rapidly repeat Space. Only a grounded edge triggers jump; vertical velocity cannot accumulate into repeated midair jumps.
- During pointer unlock/Escape, window blur, pause, wave transition, and game over, sample position, ammo, shots, enemy positions, projectiles, reload timer, and HP across time. Simulation/input must stop as required.
- Release keys/buttons while frozen, then resume/refocus. No queued movement, shot, reload, or jump may execute in a burst.
- Inspect key-state clearing and phase guards. Merely hiding the HUD or menu does not prove freeze semantics.

## Collision And Support

- Sprint repeatedly into a thin obstacle and boundary wall. Record position deltas and require sub-stepped/swept blocking with no tunneling or map exit.
- Traverse the ramp/stairs to the high platform, jump to a box top, move on it, and descend. Support height and grounded state must follow geometry.
- Create a slight edge overlap and move away. Penetration depth must decrease and the player must escape.
- Domain tests should cover large displacement, thin colliders, map bounds, standable heights, and overlap escape. Also perform black-box movement because a pure helper test does not prove runtime use.

## Weapon Transaction And Occlusion

Audit LV1: magazine `30`, reserve `120`, damage `25`, about `6` shots/s, and about `1.5s` reload.

1. Compare legal shot count, ammo decrement, `shotsFired`, and fire timestamps. Each accepted shot changes all once; cooldown rejects extra events.
2. Attempt fire at empty magazine and during reload, pause, wave transition, and game over. Ammo and shot statistics remain unchanged.
3. Reload a partial magazine with high, low, and zero reserve. Transfer only the deficit, never make reserve negative, block firing until complete, and reject full-magazine/no-reserve reload.
4. Compare crosshair center, camera ray direction, first world intersection, first enemy intersection, target HP, and `shotsHit`.
5. Place world geometry between crosshair and enemy. The world hit must win and enemy HP/`shotsHit` must not change.

Save a machine-readable transaction per attempted shot/reload.

## Enemy AI And Physical Projectiles

- Verify Scout and Heavy have visibly distinct geometry/materials and baseline stats: Scout HP `75`, faster/lower damage; Heavy HP `150`, slower/higher damage.
- Observe or instrument Spawn, Patrol, Chase, Attack, and Dead transitions. Both types must actively approach and periodically attack.
- Sample spawn positions over multiple waves/runs. Enemies maintain a minimum player distance and do not spawn or remain inside colliders.
- Kill one enemy. It must leave the active collection, decrement enemy count, and stop movement, attack, collision, projectile creation, and damage.
- Record projectile position every frame before player damage. Scout/Heavy projectiles must be visibly distinguishable through one or more of color, size, speed, or trail and must visibly travel.
- HP changes only after swept projectile/player collision. Ground, walls, platform, and cover intercept projectiles; hit/timeout removes them.
- Pause and wave transition freeze in-flight projectiles. Restart/run-id change clears every old enemy/projectile before the new run.

## Upgrade And Statistics

- Test kill boundaries `0/5/6/15/16/31/32/54/55` against all five weapon records. LV5 is Max Level and LV6 must not exist.
- Crossing a threshold atomically updates real damage, fire rate, magazine, reload duration, ammo fill, reserve bonus, and reload cancellation exactly once.
- Kill one Scout and one Heavy. Check that each base kill award follows the implementation's consistent, inspectable rule; the task does not fix numeric base awards. Check any combo, speed, or accuracy bonus separately. The total score change may exceed the base award when a permitted bonus is granted; verify the bonus and total against the run state. Also check kills, remaining enemies, shots fired/hit, and accuracy `hit/fired` against that same state.
- Compare HUD name/level/damage/progress and Weapon Evolved feedback with the authoritative weapon object before and after a threshold.
- Verify highest score/wave persist across reload, appear on Start/Game Over, and can be cleared through Reset Records. A reference key may be `pulse-arena-records`.

## Reject These False Passes

- Canvas exists in DOM but is blank, dark, clipped, or only a decorative preview.
- WASD changes world coordinates without respecting camera yaw.
- Pointer unlock or pause leaves held input/projectiles active, or resume replays old input.
- Runtime bypasses the tested swept collision/support helpers.
- Fire visuals decrement ammo but raycast/hit statistics use another path.
- Enemy attack cooldown directly subtracts HP without projectile collision.
- Dead enemies remain in an active ref/list and can still attack.
- Upgrade changes HUD text while combat still reads LV1 constants.
- Randomized spawn/AI data prevents a claimed deterministic assertion; only claim determinism where the contract and implementation support it.

## Observation Protocol

Enemy-lifecycle claims are settled by driving the interaction and sampling state, not by inspecting the spawn or damage code.

- Kill an enemy, then confirm it leaves the active set and stops moving, attacking, and colliding, and no longer deals damage. Use before/after state samples or the debug store together with a frame sequence.
- Pass the removal point once those samples show the enemy gone and inert. Do not fall back to `fail` because a single screenshot cannot capture the transition.
- Keep this separate from the visual points about enemy appearance and spawn safety; each is scored on its own evidence.

## Required Evidence

- `fps-scene-hud-bounds.json`
- `fps-input-freeze-samples.json`
- `fps-collision-support.json`
- `fps-weapon-transactions.json`
- `fps-enemy-projectiles.json`
- `fps-upgrade-statistics.json`
- start, spawn, movement, projectile/occlusion, pause, transition, upgrade, and game-over screenshots/video

Report real-browser interactions, debug/store samples, source paths, and test results separately. A smoke test that only reaches `playing` is not sufficient.

## Alignment-Focused Adjudication

Use ordinary gameplay sequences long enough to expose enemies, projectile travel, damage, hit markers, wave transitions, and weapon evolution. Record time-series positions/states and frames; do not demand that every feedback type appear in one screenshot, but require each named class to be observed or deterministically triggered. For input freezing, hold and release controls across pointer-lock loss, blur, pause, transition, and game over, then sample movement/shots immediately after resume to detect queued input. For save/reset/replay, compare complete state inventories rather than individual HUD labels.
