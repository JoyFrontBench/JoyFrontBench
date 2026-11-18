---
name: baseball-simulator-eval
description: Evaluate frontenjoyai-025 Vite/React/TypeScript deterministic pitch-by-pitch baseball simulators with count/inning/lineup rules, ability-driven matchups, contextual base-running invariants, fatigue and legal substitutions, event-derived win probability and player box scores, snapshot replay, same-seed reset, responsive broadcast visuals, and required tests/docs.
---

# Baseball Simulator Eval Skill

Use this skill for `frontenjoyai-025` and similar baseball game engines.

The task judge is normative. Use controlled domain fixtures for rare baseball situations and Playwright for scorebug, roster, strategy, replay linkage, and responsive presentation. Save seed plus the complete ordered action sequence for every reproducibility claim. Reference names below are evidence anchors, not a required architecture.

## Preflight And Stable Anchors

Run declared `dev`, `build`, `test`, and `typecheck` scripts; run `lint` when present. Record exits. Confirm a multi-file Vite + React + TypeScript project with importable simulation/domain modules and no string-template page or `dangerouslySetInnerHTML` shortcut.

Prefer role/name and labels. Reference anchors, when available:

- controls: `sim-pitch`, `sim-atbat`, `sim-half`, `reset-seed`;
- scorebug/state: `scorebug`, `away-score`, `home-score`, `outs`, labels for count and inning;
- bases: `base-first`, `base-second`, `base-third`, plus `球场垒包状态`;
- substitutions: `sub-pitcher-<playerId>` and semantic `换投`/`代打`/`代跑` buttons;
- derived views: `win-probability`, `event-log`, `box-score`;
- strategy controls by visible option names and selected state.

Capture the authoritative `GameState` or equivalent:

```json
{
  "initialSeed": 0,
  "rngState": 0,
  "inning": { "number": 1, "half": "top", "outs": 0 },
  "score": { "away": 0, "home": 0 },
  "bases": { "first": null, "second": null, "third": null },
  "atBat": { "batterId": "", "pitcherId": "", "balls": 0, "strikes": 0 },
  "lineupIndex": { "away": 0, "home": 0 },
  "pitchers": {},
  "strategy": {},
  "substitutions": {},
  "events": [],
  "winProbability": [],
  "status": "pregame",
  "winner": null
}
```

Candidate source anchors include deterministic RNG, `deriveMatchupProbabilities`, `forceWalk`, `advanceRunners`, duplicate-runner checks, lineup validation, pitch/at-bat/half-inning simulation, substitutions, strategy changes, win-probability derivation, box-score derivation, replay snapshots, and same-seed reset.

## Core Pitch, Inning, And Lineup Engine

1. Step pitches and record count, outs, inning, batter, pitcher, lineup index, bases, score, RNG state, and emitted event.
2. Verify balls/strikes, foul-at-two-strikes behavior, four-ball walk, three-strike strikeout, and plate-appearance count reset.
3. At three outs, switch half inning, clear bases/count, select the correct batting/pitching teams, and preserve each team's next lineup index across innings.
4. Simulate through regulation. Verify top/bottom ninth early-finish/walk-off behavior and a documented tied-game policy such as extra innings.
5. Submit the judge-required missing-player and duplicate-player lineups and reject them with a visible/domain error while preserving the prior valid state. Exercise unknown-player, pitcher, or position validation only where those rules exist; do not require Sol's exact validation matrix.
6. Require the event log as a whole to provide stable identity plus enough outcome, scoring, participant, deterministic RNG/action, and snapshot or state-delta metadata to reconstruct plays for replay and box score. Event variants may carry different fields. A field such as `seedState` is one valid representation, not a mandatory name or schema.

## Ability-Driven Matchup

- Capture batter contact/power/discipline, pitcher control/velocity/base stamina, current stamina, strategy, seed, and full probability vector.
- Compare strong/weak batter and pitcher fixtures. Higher power must increase extra-base/home-run tendency; discipline must affect balls/walks; control must reduce balls; velocity/contact and fatigue must move outcomes directionally.
- Change lineup/player and pitcher while holding seed/action count fixed. The probability vector must change; do not require a short sampled discrete outcome sequence to differ when changed probabilities can still map the same random draws to the same outcomes.
- Lower stamina through real pitches and compare the same matchup. Fatigue must degrade relevant pitcher probabilities, not only the displayed bar.
- Reset the same seed and replay identical substitutions, strategy actions, and simulations. Probability/outcome/event sequences must match.
- Reject fixed weight tables where ratings are display-only.

## Contextual Base-Running Invariants

Use direct fixtures with deterministic rolls and save before/after bases, outs, runs, RBI, thrown-out runner, and event:

- runner on first, fewer than two outs, groundout: a double-play path records two outs and clears/advances bases correctly;
- runner on third, fewer than two outs, flyout: sacrifice tag-up scores one run and RBI;
- bases loaded walk: forced runner scores, other forced runners advance, non-forced runners do not;
- aggressive running: one deterministic fixture succeeds in taking an extra base and another is thrown out;
- after every transition, all occupied runner ids are unique and no two players share a base.

Reject universal “every runner advances N bases” logic.

## Fatigue And Roster Transactions

- Throw enough pitches to reduce stamina and show the matchup vector changing.
- Allow pitching changes only between plate appearances. Verify current pitcher, at-bat pitcher id, pitcher state, lineup/roster, and an immutable substitution event update together.
- Attempt to re-enter the removed pitcher; UI must disable the choice or domain validation must reject it without mutation.
- Exercise pinch hitter and pinch runner between plate appearances. Update the active batter/base runner and lineup state; removed players become unavailable and cannot return.
- Verify substitution ids and strategy changes persist for the current game, replay/action log, and same-seed action sequence. Do not invent a localStorage requirement unless the product provides one.

## Win Probability And Box Score

- After every pitch/play, recompute home win probability from inning/half, score differential, base occupancy, outs, and final state. Source and UI sequence must be deterministic.
- Produce a scoring play and a meaningful out/base change. The curve adds points, highlights high-leverage turns, and displays the current value.
- Hover/focus/click a curve point and require linkage to the corresponding event and inning/half without mutating live history. If the product presents historical scorebug/base/count snapshots, verify they agree too, but do not require every panel to enter replay mode.
- Derive batting `AB/H/R/RBI/BB/K` and pitching `IP/H/R/ER/BB/K` per player from events. Cross-check walks, strikeouts, hits, sacrifice, earned/unearned runs, and outs-to-IP formatting.
- Replay and same-seed rerun must reproduce the complete probability series and box score.

## Replay, Strategy, And Determinism

1. Record a sequence containing pitches, one pitching change, one batting/running substitution if reachable, and strategy changes.
2. Snapshot prior event objects before each strategy change. Strategy actions may append an event and affect only future probabilities; existing events/snapshots must remain byte-equivalent.
3. Reset same seed and repeat the exact action sequence. Compare event type/description, deterministic RNG/replay metadata, snapshots, score, lineup, substitutions, probability series, and box score.
4. Replay must clone/read recorded snapshots or event-derived state and must not call RNG or mutate the live game.

## Responsive, Motion, Visuals, And Coverage

- At desktop, keep scorebug, field/bases, matchup, core controls, win probability, event log, roster, and box score usable. At `360px`, require the judge-specified scorebug, field, win probability, and core controls without overlap or horizontal overflow; additional panels may use secondary navigation.
- Emulate reduced motion. Decorative field/chart transitions reduce while all state changes and replay indicators remain clear.
- Judge a coherent television-broadcast scorebug/ballpark/game-book presentation, not a generic admin dashboard.
- Count at least 12 Vitest tests and 2 Playwright tests. Verify coverage includes ability probabilities, count/inning/lineup, double play, sacrifice, forced walk, aggressive running, fatigue/substitutions, win probability, box score, replay, same-seed reset, and invalid lineup.
- Read README and require run/build/test instructions, modules/data model, ability and base-running models, fatigue, win-probability model, RNG seed, reset/replay semantics, and known limitations.

## Reject These False Passes

- Count rules work but lineup index resets each inning.
- Ratings/stamina change labels while probabilities remain fixed.
- Rare base-running outcomes are hard-coded descriptions without correct state transitions.
- Removed players can re-enter or substitution updates only one UI panel.
- Win probability is a decorative/static line or ignores base-out context.
- Box score is team totals, stale mutable counters, or hard-coded rows rather than event-derived player lines.
- Hovering replay rerolls or changes live state.
- Same-seed reset omits substitutions/strategy from the reproduced action sequence.
- Reduced-motion is declared but not observable.

## Readable Values And State-Machine Reliability

- When the judge says a value is read directly — pitcher stamina, pitch count, score — that value must be rendered in the running UI. Locate and screenshot it before scoring. Stamina that exists only in the store, or that must be inferred from matchup behaviour, fails the point asking for the readout.
- Base-running invariants are proved by batched multi-seed replay, not by one observed play. Run a large seed sweep and assert the mutually exclusive invariants on every sample: a runner is never both recorded out and left on a base, two runners never occupy one base, forced and unforced advancement stay consistent.
- Any invariant violation in the sweep fails the point even when the feature is broadly present and the common path looks right. Report the violation count alongside the sample size.

## Required Evidence

- `baseball-script-results.json`
- `baseball-pitch-inning-lineup.json`
- `baseball-matchup-probabilities.json`
- `baseball-base-running-fixtures.json`
- `baseball-roster-fatigue.json`
- `baseball-winprob-boxscore.json`
- `baseball-replay-seed.json`
- desktop, `360px`, reduced-motion, scorebug, field, turning-point replay, roster, and box-score screenshots

Report test counts and distinguish domain-fixture proof from UI closure. A deterministic helper test alone does not prove that the mounted app uses it.

## Alignment-Focused Adjudication

Use seeded, replayable at-bat sequences and independently calculate base/out/score transitions. To establish player ability effects, compare repeated distributions under controlled roster substitutions rather than a single plate appearance or the presence of ratings. Verify win probability and box score after concrete events and trace each displayed delta to the event log; team totals do not substitute for required player lines. Test replay/reset with full state snapshots. For automated-test criteria, count only tests whose assertions exercise resulting baseball state, not file names, test titles, or shallow existence checks.
