---
name: waste-sorting-game-eval
description: Evaluate frontenjoyai-021 waste-sorting games with executable drag/keyboard equivalence, invalid-drag rollback, reducer-owned combo and outcomes, MistakeRecord-derived replay, idempotent badges, deterministic leaderboard, persistence/reset boundaries, accessibility, and responsive play.
---

# Waste Sorting Game Eval Skill

Use this skill for `frontenjoyai-021` and similar educational classification games.

Treat the task judge as the contract. A reference implementation may expose the selectors and function names below, but do not require those exact names or copy its behavior when it conflicts with the judge. Use Playwright for real pointer/keyboard flows and source/domain tests for transitions that are slow or difficult to stage.

## Locate The Evidence Surface

Prefer role/name or label locators. Reference anchors, when present:

- current item: `[data-testid="waste-card"]` or button name beginning `当前物品：`;
- bins: `[data-bin="<category>"]` or buttons named `1号桶` through `4号桶`;
- score/feedback/summary: `score`, `feedback`, and `summary`;
- review/map/leaderboard: `待复习区域`, `打开关卡地图`, `排行榜`;
- pause and nickname: `暂停游戏`, `我的昵称`.

Capture the authoritative state before and after each action. A useful shape is:

```json
{
  "session": {
    "levelId": 1,
    "currentIndex": 0,
    "score": 0,
    "correct": 0,
    "attempts": 0,
    "combo": { "current": 0, "best": 0 },
    "status": "playing",
    "outcome": null,
    "mistakes": []
  },
  "progress": {
    "nickname": "",
    "unlockedLevel": 1,
    "levels": {},
    "badgeIds": [],
    "leaderboard": []
  }
}
```

Candidate source anchors include `categoryMatches`, `scoreForCorrect`, `nextCombo`, `levelSucceeded`, `upsertMistake`, `deriveReplayItemIds`, `removeReviewedMistake`, `unlockBadgeIds`, `sortLeaderboard`, `mergePlayerResult`, `gameReducer`, `hitTestBins`, and the persistence parser. Equivalent implementations are valid.

## Execute Input And Rollback Checks

1. On level one, snapshot item identity, score, both combo values, mistake ids/counts, `currentIndex`, `correct`, and `attempts`.
2. Drag the current item to its canonical correct bin. Require exactly one classification transition and synchronized item/progress/score/combo updates.
3. Classify the next item through `1-4`, then another through an arrow key. Verify keyboard and drag use the same category rule and produce equivalent authoritative transitions; they may use different input adapters or action names.
4. For separate fresh snapshots, release on blank space, outside the viewport, and dispatch a real `pointercancel` while pointer capture is active.
5. After each invalid path, require the card transform/drag flag to reset, the same item to remain usable, and score, combos, mistakes, `currentIndex`, `correct`, and `attempts` to remain unchanged. Feedback may be dismissed; do not incorrectly require the entire object to be byte-identical.

Save one transition record per input path with `input`, `itemId`, `chosenCategory`, `correctCategory`, and before/after state.

## Combo, Mistakes, And Replay

- Drive correct classifications to combo 3 and then 4. Require `current` to increment once per correct answer and `best = max(previousBest, current)`.
- Misclassify the next item. Require current combo `0`, unchanged best combo, zero score gain, and feedback containing both the correct category and the item-specific reason.
- Rebuild a combo of at least 2, then pause/resume and open/close review, replay, and summary-related UI. Non-classification actions must not mutate either combo.
- Create at least two distinct `MistakeRecord`s. Verify replay item ids are derived from the current records, normally by item id and deterministic ordering, with no second static replay bank.
- In replay, answer one correctly and one incorrectly. Only the correctly answered record is removed; the incorrect record remains and the visible review count agrees.
- Clear the last record. Require `replayCleared` or equivalent completion state and exactly one review-completion badge id. Re-entering the flow must not duplicate the badge or reward.

## Levels, Outcomes, And Exits

- Clear progress and inspect every map node. Only level one is playable; locked/playable/completed state and best score must come from saved game data.
- Test reducer/domain fixtures immediately below and above target-correct and accuracy thresholds, plus timeout/question exhaustion. Success unlocks only the next level; failure does not change `unlockedLevel`.
- Complete one passing and one failing UI run. Verify the summary status agrees with the reducer result.
- On success, verify replay current, next level when one exists, and return map. On failure, next level must not be an available action; replay current and map must work.
- Returning to the map after success must show completed state and the actual best score, not a transient label.

## Badges, Leaderboard, And Persistence

- Inventory all badge definitions and conditions. The wall must show every badge, visibly distinguish earned/locked, gray locked entries, and display each condition.
- Trigger at least one condition twice and assert unique badge ids and no repeated reward. Cover combo, hazardous-item completion, and review completion with domain fixtures.
- Enter a recognizable nickname, complete a level, and inspect leaderboard from both map and summary. Seed rows remain deterministic; the current row uses the nickname and is highlighted.
- Sort tie fixtures by score descending, completion time ascending, player name, then a stable id if needed. Repeated sorts must be identical.
- Generate completed level, badge, mistakes, nickname, and player score; reload and compare all persisted fields using the storage key discovered from the candidate.
- Inject non-JSON, missing fields, invalid versions, and out-of-range values. Require safe defaults and no white screen.
- Reset is judge-specific: clear level progress, badges, mistakes, and current-player leaderboard rows; retain nickname and deterministic seed players; return to only level one playable. Reject implementations that clear the nickname even if a reference solution does so.

## Visual And Interaction Closure

- Verify each bin has stable color, distinct icon, and text label; grayscale must remain understandable.
- Confirm item/bin art is local SVG/Canvas/CSS and no external image/audio request is needed.
- Measure item and bin hit targets at approximately `>=56px`. Complete a level at desktop and `360px` with no horizontal overflow or covered controls.
- Emulate `prefers-reduced-motion: reduce`; entrance/reward motion must reduce while drag, keyboard, replay, and completion still work.
- Tab through interactive controls and capture visible focus, including the item, bins, pause, map, and dialogs.

## Reject These False Passes

- Keyboard, click, and drag use divergent scoring or validation rules.
- An invalid drop visually snaps back after already incrementing attempts/progress.
- `INVALID_DROP` clears or mutates gameplay fields beyond transient drag/feedback state.
- Replay is a hand-authored item array or removes a record after another wrong answer.
- Best combo is reset by a mistake or changed by opening a panel.
- Completion UI unlocks the next level independently of reducer outcome.
- Leaderboard seed is regenerated randomly, or reset removes seed rows/preserves current-player rows.
- Persistence exists, but reset violates the judge's nickname-retention boundary.

## Combo Readouts Must Be Visible

The combo points require current combo and best combo to be observable in the interface. Locate and screenshot both readouts before running the sequence.

- If best combo is never surfaced, the increment, reset-on-error, and no-op-on-non-sorting points cannot be verified and all fail, with the reason `UI 无最高连击展示`.
- A `combo.best` field in the reducer, a store snapshot, or persisted state does not satisfy a point that asks for an observable value.
- When both readouts exist, drive the full sequence — consecutive correct sorts, one wrong sort, then pause/resume and panel open/close — and read the values from the rendered UI at each step.

## Required Evidence

- `waste-input-transitions.json`
- `waste-combo-replay.json`
- `waste-level-outcomes.json`
- `waste-badge-leaderboard.json`
- `waste-persistence-reset.json`
- desktop and `360px` screenshots for gameplay, summary, map, badge wall, leaderboard, focus, and reduced motion

Report which claims came from UI interaction, state/storage snapshots, source inspection, and domain tests. A passing source test without the corresponding user-visible closure is insufficient.

## Alignment-Focused Adjudication

Leaderboard and scoring rules need deterministic black-box checks, not source sort code alone. Complete a real round under a distinctive nickname, verify the result is written and highlighted through every required entry point, then inject or create tied records and compare repeated reload/order results. Preserve the original seed roster while checking merge behavior. Test score, time, and name tie-breaks independently so stable output caused by input insertion order is not mistaken for the specified ordering.
