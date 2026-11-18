---
name: wildlife-alert-review-eval
description: Evaluate frontenjoyai-022 wildlife review workbenches with recognizable generated scenes, frame-driven detections, one authoritative review state, traceable alert derivation, camera-species-window suppression, deterministic in-place retry, species correction, persistence, and offline-camera behavior.
---

# Wildlife Alert Review Eval Skill

Use this skill for `frontenjoyai-022` and similar monitoring/review workbenches.

The task judge is normative. Use a reference implementation only to discover testable seams; alternate selectors and architectures are valid. Combine Playwright, frame screenshots, state/storage snapshots, and domain tests. Do not infer cross-view consistency from matching labels alone.

## Locate Stable Anchors

Prefer role/name and labels. Reference anchors, when available:

- frame player and controls: `模拟帧播放器`, `播放`/`暂停`, slider `帧跳转`;
- overlay/review: `detection-overlay`, `overlay-review-status`, `mark-false-positive`;
- event rows/status: `event-row-<eventId>`, `event-status-<eventId>`;
- statistics: `stat-progress`, `stat-fp-rate`, `stat-high-risk`, `stat-success`;
- rule preview: `rule-enabled-<ruleId>`, `rule-threshold-<ruleId>`, `preview-count`, `queue-count`, `suppressed-count`, `apply-rules`;
- timeline/camera/filter: `全天事件时间轴`, slider `拖动全天时间轴`, `相机列表`, `事件筛选`;
- queue: rows under the delivery table and button `Retry`.

Capture one authoritative snapshot after each mutation:

```json
{
  "selectedEventId": "event-id",
  "currentCameraId": "camera-id",
  "filters": {},
  "event": {
    "species": "label",
    "review": "needs_review",
    "scene": "animal",
    "box": {}
  },
  "deliveries": [
    {
      "id": "alert-id",
      "eventId": "event-id",
      "cameraId": "camera-id",
      "species": "label",
      "minute": 0,
      "status": "pending",
      "attempts": 0,
      "suppressedReason": null
    }
  ],
  "stats": {}
}
```

Candidate source anchors include `framesForEvent`, `createPlaybackClock`/playback cleanup, `reviewReducer`, `deriveAlerts`, `retryAlert`, `filterEvents`, `deriveStats`, and persistence parsing. Names are examples, not requirements.

## Verify Frame Semantics

1. Use filters/list data to locate normal, low-confidence, duplicate, missed-detection, and false-positive events. Record event id, camera, minute, scene, subject, confidence, and box geometry.
2. Normal, low-confidence, and duplicate frames must contain a recognizable animal and a box enclosing that animal.
3. Missed detection must contain a recognizable animal and no detection overlay.
4. False positive must contain a non-animal distractor such as rock or foliage, with the erroneous box around that distractor.
5. Reject empty backgrounds plus rectangles, animal-shaped false positives, and boxes visibly detached from the subject.

Use screenshots or SVG/Canvas inspection to prove subject pixels/shapes and overlay geometry. An accessible label is supporting evidence, not visual proof by itself.

## Verify Playback Lifecycle

- Step or play through adjacent frame ids. Require scene content and detection geometry/pose to change with frame state; a static rectangle over an unchanged scene fails.
- Pause and sample frame id plus overlay geometry across at least two expected ticks; both must stop.
- Run rapid `Play -> Pause -> Play` sequences and compare frame rate against a single-play baseline. Exactly one clock may advance the player.
- Pause, switch camera/event, and unmount/navigate if applicable. Verify no old event continues ticking and no orphan timer remains.
- Inspect effect cleanup or timer instrumentation. A unit test of a standalone clock helper is insufficient unless the mounted player actually uses that helper/lifecycle.

## Verify One Review State

For one selected event, record its list row, timeline marker, overlay status, and all four statistics. Then:

1. Mark it false positive. Require the event state, active list row, timeline style, overlay status, review progress, false-positive rate, and risk statistics to update from one reducer/store transition.
2. Recompute false-positive rate as false-positive reviewed events divided by all reviewed events.
3. Change it back to needs review. Require all views and statistics to revert without stale classes, queue state, or counts.
4. Inspect source/state ownership and reject separate mutable copies for list, timeline, overlay, and stats.

## Verify Alert Derivation And Suppression

- Choose a matching event with a pending delivery. Mark false positive and require the same delivery record to become `suppressed` with reason `false-positive`; it must not be deleted.
- For sent/failed deliveries, false-positive review must preserve the historical row and mark it as an already-delivered false positive. It is excluded from pending work but remains explainable in success statistics.
- Confirmed and needs-review decisions must not receive false-positive suppression. A needs-review event matching a high/critical rule contributes to unresolved high risk.
- Build fixtures around the dedupe key `(cameraId, species)` and the configured `suppressionWindowMinutes`. Within one window only the first alert remains active; later matches are `suppressed` with a duplicate reason.
- Shrink and enlarge the rule window and compare the suppressed event-id set. Test just inside and just outside the documented boundary.
- Hold time close while changing camera, then species. Different keys must never suppress each other.
- Save alert id, event id, key fields, timestamp/minute, matched rule ids, risk, status, attempts, reason, and prior/next state.

If several rules match, verify the resulting risk and suppression behavior are deterministic and traceable; do not impose a particular merge policy or documentation format unless the implementation defines one.

## Verify Retry And Species Correction

- Find a failed row and snapshot queue ids/count, attempts, status, success rate, and unrelated rows.
- Retry once, then rapidly click while a send is in flight if the UI simulates latency. Attempts and status update on the original id; total ids/count do not change and concurrent duplicate sends are prevented.
- Continue to the seed-defined finite success attempt. The row becomes sent and success rate rises. Recreate the same seed and require the same attempt sequence.
- Correct a species to one that changes rule matching. Require event species, box label, preview, risk stats, timeline/list, and queue to update together.
- Because species belongs to the dedupe key, compare group membership before/after correction. A duplicate may become active or an active alert may become suppressed.
- Historical sent/failed rows must not disappear. If the corrected event no longer qualifies, preserve the row as suppressed with a traceable reason.

## Verify Persistence And Offline Cameras

- Change reviews, filters, current camera, and rule enabled states. Reload and compare state plus list/timeline/overlay/statistics. Check selected-event restoration only if it is part of the persisted review session. Discover the actual storage key from the candidate.
- Inject non-JSON, missing arrays/ids, invalid enum values, invalid confidence ranges, and unknown cameras. Require a safe default and no uncaught exception or white screen.
- Select a seed-defined offline camera. Historical frames and detections remain visible, but no new detection is generated and manual/add-label controls are disabled or absent.
- Verify offline status is a stable camera property, not inferred from current filters.

## Reject These False Passes

- Scene labels claim an animal/distractor that is not visibly rendered.
- Playback changes a frame counter while the scene and box remain static.
- Review state changes only one view or statistics use a separate stale array.
- Dedupe keys by event id, uses a hard-coded window, or suppresses across cameras/species.
- False-positive review deletes sent/failed history.
- Retry appends rows, changes unrelated rows, or succeeds nondeterministically.
- Species correction changes text only and skips rule/risk/dedupe recomputation.
- Persistence restores controls but not the authoritative event/delivery state.
- Offline cameras expose active generation or manual-box controls.

## Playback Gate

Click Play and assert the frame index actually advances before scoring the player.

- If playback never starts, every point depending on it fails — frame-driven detection boxes, pause, seeking, and the single-timer check — with the reason `播放器不可用`. Attach the screenshot showing the unchanged frame.
- A `createPlaybackClock` helper or frame-generation code in the source does not carry these points.

## Whole-Ledger Consistency

The four-surface coherence point asks whether timeline, overlay, list, and stat cards all agree. One correct ratio does not settle it: confirming `false positives / reviewed = 1/1 = 100%` proves only that one card is self-consistent.

Before passing, also verify:

- unrelated alerts keep their `sent`/`failed` values across a review action, with no wholesale recomputation;
- the delivery success rate does not jump globally when the first review happens;
- the list's alert-status column resolves against fields that actually exist on the event;
- suppression after a false-positive mark matches what the queue really does.

Any one of these inconsistencies fails the coherence point.

## Required Evidence

- `wildlife-frame-semantics.json`
- `wildlife-playback-lifecycle.json`
- `wildlife-review-consistency.json`
- `wildlife-alert-derivation.json`
- `wildlife-retry-species.json`
- `wildlife-persistence-offline.json`
- screenshots for all five scene semantics, timeline/list/overlay synchronization, rule preview, queue reasons, and offline camera

Report UI, state, storage, source, and test evidence separately. Do not grant a pass from source plausibility without exercising the corresponding interaction.

## Alignment-Focused Adjudication

For shared-state criteria, capture the same event identifier across timeline, frame overlay, list, and statistics before and after one review action, and hand-calculate the expected denominators. For duplicate suppression, inspect the stored/generated alert records—not only badges or wording—and test same/different camera, species, and boundary timestamps around the configured window. `suppressed` may be represented by an equivalent explicit state, but a cosmetic “duplicate” tag without suppression semantics is insufficient. Persistence recovery must be tested with malformed JSON and structurally valid-but-invalid payloads; verify safe defaults and absence of uncaught errors, not just a non-white first frame.
