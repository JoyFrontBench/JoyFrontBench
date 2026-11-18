---
name: rps-training-dashboard-eval
description: Evaluate rock-paper-scissors AI training dashboards with deterministic rounds, prediction snapshots, replay scrubbing, linked charts and history, filtered statistics, challenge state, import/export replay, persistence, and large-session behavior.
---

# RPS Training Dashboard Eval Skill

Use this skill for `frontenjoyai-014` and similar local-AI training dashboards. Treat it as an analytics/state-replay application, not a three-button game.

Default method: run declared engineering commands, inspect importable domain/state code, then use Playwright with DOM, download, localStorage, and timing evidence. Judge requirements are authoritative; reference test IDs and field names below are optional hooks, not a mandated React structure.

## Project And Target Discovery

- Confirm Vite + React + TypeScript multi-file structure, required files/scripts, importable domain logic, no `dangerouslySetInnerHTML` or string-template page, and local-simulation disclosure.
- Verify the first screen is a training-analysis dashboard with distinct play, AI state/distribution, statistics, history, replay, and settings regions rather than a plain three-button game.
- Run `build`, `test`, and `typecheck` plus declared lint/UI tests. Confirm at least 12 Vitest cases and 2 UI-level tests cover core behavior, including snapshot scrub and filtered derived statistics.
- Prefer roles/labels and visible headings. When present, useful reference hooks include `play-rock|paper|scissors`, `ai-status`, `prediction-distribution`, `replay-slider`, `replay-position`, `chart-HIT|CONF|STRAT`, `chart-tooltip`, `history-round-N`, `filter-result`, `filter-strategy`, `filtered-hit-count`, `stats-scope`, `challenge-progress`, `import-file`, `reset-session`, and `restore-banner`.
- Discover the storage key and exported filename from the candidate's source rather than hard-coding reference implementation names.

## Domain Invariants

- Identify the canonical round/session types. Every round must retain id, player, AI, result, predicted move, strategy, confidence, explanation, and the pre-round distribution/snapshot needed for replay.
- Exercise all three moves and verify exactly one accepted round each; rapidly repeat one submission and require the reducer/lock to append only one round. Recompute result from the full RPS matrix.
- In best-of-15, prove round 15 settles and round 16 is rejected. After reset, endless must accept round 16.
- Sum displayed/raw distribution to `1` or `100%` within rounding tolerance. After a controlled repeated sequence, require strategy, top prediction, confidence, or distribution to update from history.
- Inspect the live AI status card for strategy label, highest prediction, confidence, explanation, and recent-hit state. The explanation must describe the local prediction/strategy source rather than placeholder prose.
- Validate stored `statisticsAfter`/challenge snapshots against the round prefix when such fields exist. Do not trust duplicated cached totals without recomputation.

## Snapshot And Time-Machine Audit

Play at least eight controlled rounds and save each live pre-round AI card plus exported/session data. At round `k`:

1. statistics, challenge, recent sequence, three charts, and history/highlight must use rounds `1..k`;
2. the AI card must equal the snapshot used to predict round `k`, computed from rounds `1..k-1`, not from all later history;
3. backward/forward, start/latest, play/pause, slider, and position display must agree;
4. returning latest must restore the full state exactly.

Prefer exported/session JSON and domain state for exact comparison. A slider thumb moving is not proof of reconstruction.

## Charts, Filters, And Challenge

- Require an explicit expand/collapse control for the training view and three round-backed timelines: hit/miss, confidence, and strategy. Always-visible charts do not satisfy a hard toggle requirement.
- Compare represented real round IDs/counts before and after adding two rounds; sampled charts must preserve exact ID mapping, with readable labels, legends, and values.
- Hover round `k` on any chart. All three charts and the table must highlight `k`, with a shared-aligned crosshair/tooltip. The tooltip itself must expose player, AI, result, predicted, and confidence; fields elsewhere on the page are not a substitute.
- On pointer leave, transient hover highlighting must clear. Scrubbing to `k` must select the same round across views.
- Require the history table itself to display round, player, AI, predicted, result, strategy, and confidence fields.
- Filter result and strategy, then sort by round/confidence/result. Require a visible filtered-result count equal to the current filtered row count; accept an equivalent clear label. Calculate prediction-hit rate separately from correct predictions in that subset, rather than treating it as the row count. Recompute cards from that same subset and require a visible filtered/global scope.
- Verify empty filters produce zero counts and an explicit empty state.
- Read the current pre-round top prediction. Avoid it to increment the visibly reported challenge progress, then match it before completion to reset to zero; repeat five consecutive avoids to produce one visible completion transition.

## Export, Persistence, Scale

- Capture the actual download and validate mode, seed, filters, rounds, explanations, and pre-round snapshots. Import after reset and compare recorded AI move, snapshot, result, and statistics round-by-round; no new randomness is allowed.
- Reload a saved session, test restore/discard, inject malformed, old-version, and missing-field storage, and require safe fallback.
- Reset must clear history, snapshots, charts, filters, challenge, settlement, replay position, and persisted draft.
- Generate 300+ endless rounds through public controls or a documented import/evaluator path. Seeding data proves scale behavior, not the ordinary round-generation closure.
- Measure scrub/filter/scroll responsiveness and verify sampled/virtualized chart points still map to real rounds.
- At desktop and `360px`, capture play controls, AI distribution, challenge, statistics, recent rounds, and replay.
- Verify reduced-motion lowers animation while preserving visible state changes.
- Read README and require run/build/test instructions, modules/data model, pre-round snapshots and time travel, chart linkage, filtered derivations, seed/replay/reset, large-session optimization, known limitations, and the local-not-LLM statement.

## High-Risk False Passes

- Replay shows historical rows but statistics and AI card remain at the latest state.
- AI snapshot is recomputed from full history instead of stored before the round.
- Three charts exist but cannot be expanded/collapsed or do not share one round/tooltip.
- Tooltip omits required round fields while the table happens to contain them.
- Filtered rows change while hit denominator or summary cards remain global.
- Import regenerates random AI moves rather than replaying recorded rounds.
- LocalStorage contains rounds, but reload offers no restore/discard decision or bad JSON whitescreens.

## Recommended Evidence

- `rps-target-map.json`, `rps-rounds-and-outcomes.json`
- `rps-snapshot-scrub-audit.json`
- `rps-chart-linkage.json`
- `rps-filter-statistics.json`
- captured exported/imported session JSON and storage snapshots
- desktop/mobile dashboard screenshots

## Alignment-Focused Adjudication

For learning and strategy claims, use controlled repeated rounds instead of a single favorable outcome. Record the player's sequence, AI choices, transition/count updates, prediction display, and charts before and after enough observations to distinguish adaptation from randomness. Test reset, undo, import/export, and configuration changes as state transformations with exact pre/post snapshots. If a criterion combines displayed statistics with the underlying decision behavior, verify both from the same run; source formulas, labels, or plausible percentages do not substitute for runtime consistency.
