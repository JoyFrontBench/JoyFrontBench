---
name: pixel-rpg-eval
description: Evaluate canvas pixel RPG / creature catcher games with grid movement, map warps, random encounters, battle commands, menu subpages, inventory/pokedex consistency, save/load, and file import/export.
---

# Pixel RPG Eval Skill

Use this skill for canvas/browser RPG games whose acceptance criteria mention grid movement, WASD/J/K/L controls, houses or map transitions, tall grass encounters, turn-based battle commands, party/items/dex, and localStorage save files.

Do not evaluate these pages by only pressing a few keys and taking screenshots. Use a mixed test:

1. Black-box keyboard checks for the public control scheme.
2. Runtime state snapshots for deterministic assertions.
3. Screenshots for every visible state.
4. Download/import fixtures for save-file claims.

## Instrumentation Pattern

If game state is hidden in a single inline script or closure, use Playwright `page.route()` before page load and inject a debug object immediately before the game loop starts. Label this evidence as instrumented.

Expose only evaluation helpers:

- `snapshot()`: scene, player tile, map/interior state, menu state, battle state, party, items, seen/caught dex sets, localStorage keys.
- `prepareExploreAt(x, y, mapId, inInterior, interiorId)`: move to a safe location without changing product code permanently.
- `enterHouse()` / `exitHouse()`: trigger the real warp handler and assert map/player state.
- `forceGrassEncounter()`: place player on an encounter tile and patch randomness only for the encounter call.
- battle helpers for `FIGHT`, `PARTY/MON`, `ITEM`, and `RUN`, using the page's own functions.
- `catchCreature()`: patch catch randomness only for the catch call, then assert party/dex/item changes.
- `saveLoadAudit()`, `callExportSave()`, `callImportSave()`: diagnostic helpers only. They may prove that internal functions exist, but a file import/export `pass` still needs the public interaction path from the corresponding `criteria` validation point.

Instrumentation proves internal logic, not natural reachability by itself. Pair it with black-box controls and screenshots before marking playability as passed.

## Required Checks

For movement:

- Short key holds only; long holds can accidentally walk multiple tiles.
- Verify W/A/S/D each changes tile coordinates by exactly one expected grid step.
- Verify `L` opens the menu, `K` cancels/closes, and `J` confirms/interacts.
- For walk animation, do not rely only on millisecond timing screenshots. Add a frame probe that advances or samples update frames and records `walkFrame` changing, such as `0,0,0,1,1,1,1,0`.

For maps:

- Enter and exit at least one house using the real warp/check handler.
- Verify `inInterior`, `interiorId`, `currentMap`, and player coordinates after both transitions.
- Trigger tall-grass encounter deterministically and assert battle scene starts.
- If the criterion requires a transition effect, explicitly inspect transition state or capture consecutive frames. Direct `EXPLORE -> BATTLE` with no transition is a fail for that subitem.

For battles:

- Capture the battle main menu screenshot.
- Assert `FIGHT` reduces PP and enemy HP and queues narrative messages.
- Assert `PARTY` or `MON` changes active party member. If the UI label differs from the requirement, make a model-judged/readability verdict from the screenshot and explain the mismatch.
- Assert `ITEM` reduces item count and changes HP/status.
- Assert `RUN` reaches escaped/result state and returns to exploration.
- Do not mark HP-bar animation as pass from a single screenshot. Use consecutive frames or a state tween, then make a model-judged animation verdict; use `fail` only when frame evidence is unavailable or too sparse.

For menu/data:

- Open DEX, PARTY, ITEM, OPTION, and EXIT separately.
- Verify DEX uses the same `seen/caught` state as battle/catch.
- Verify PARTY shows creatures with HP/level from the same party array.
- Verify ITEM count changes after use.
- If OPTION only exposes import/export and no adjustable settings such as text speed/audio, fail the "settings adjustable" criterion.

For save files:

- Verify `saveGame()` writes localStorage.
- Mutate state, load, and assert position/map/party are restored.
- Trigger the real export path from the user-visible UI/keyboard menu described by the same `criteria` validation point, then save the Playwright download.
- Do **not** mark "可导出存档为文件" pass from `window.__creatureDebug.callExportSave()`, direct `exportSave()`, evaluator-injected `a.click()`, or localStorage/Blob inspection alone. Those are only diagnostics. A pass requires that the evaluator executes the menu/button flow a user can operate and observes a browser download file.
- The exported file must exist on disk, have a save-file extension/type such as `.json`, parse successfully, and contain the actual saved progress (player/map/party/items/dex as applicable). If the flow only writes localStorage, opens a canvas label, or exposes an internal helper without producing a downloadable file, mark the export validation point `fail`.
- Trigger the real import file chooser when possible; if browser blocks it, record the error and use a direct localStorage+load fallback only as fail evidence.
- For `frontenjoyai-008` / task_id `7`, keep the known manual calibration: the save-system task must be `fail` when the export-file validation point cannot prove a real downloadable save archive/file. Do not let an instrumented helper download such as `callExportSave()` turn validation point 2 into `pass`; report "不能导出存档文件" on the 7.2 child row and the task 7 summary.

## Observation Protocol

Animation claims need consecutive frames or interpolated state samples, never one screenshot.

- For hit feedback and health-bar changes, capture a frame sequence across the attack, or sample the bar value at short intervals through the transition.
- A health bar that moves through intermediate values is animated; one that jumps between two values is not. Decide the point from that sequence.
- When the frames or samples do show the hit animation and the gradual bar change, pass the point. Do not fall back to `fail` out of caution once the motion evidence exists.

## Reporting

Every criterion gets its own result row. Attach screenshots for visible state and a debug JSON file for internal assertions.

Never claim "played the game" if only injected helpers were used. Say "black-box controls were exercised" and "instrumented triggers verified state changes."

Subjective visual items such as retro beauty should be judged by the model from screenshots first. Originality and copyright still need source review or explicit provenance evidence; use `fail` only when that non-visual evidence is unavailable.

## Alignment-Focused Adjudication

Capture combat at a cadence high enough to separate hit feedback from HP-bar interpolation. A hit flash, shake, damage text, delayed bar, CSS transition, or other visibly progressive health feedback may establish animation; do not require a particular implementation or reject it merely because the numeric HP state commits before the visual bar finishes. Conversely, verify all four battle commands through their intended user paths and resulting turn/state changes; opening a submenu or finding a handler in source is not functional proof. Reset encounters between command checks so prior HP, inventory, switch, or escape state cannot mask a broken command.
