---
name: magic-skill-tree-eval
description: Evaluate magic-academy skill-tree workbenches with 24 dependency nodes, derived mastery states, deterministic practice scoring, route recommendations, weighted exams, remedial paths, badges, logs, persistence, and responsive graph navigation.
---

# Magic Skill Tree Eval Skill

Use this skill for `frontenjoyai-015` and similar dependency-driven learning maps.

Default method: source/domain tests plus Playwright interactions. Save mastery and derived-state snapshots before/after practice, route switches, exams, remediation, reset, and reload. The task judge is the contract; reference selectors and formulas are evidence hints, not a required component architecture.

## Target And Graph Inventory

- The task explicitly requires stable `data-testid` hooks for `skill-tree`, `spell-node`, `node-detail`, `practice-panel`, `route-selector`, `exam-panel`, `rubric-breakdown`, `remedial-list`, `achievement-list`, `learning-log`, and `reset-student`, plus stable `data-node-id` values. Verify those exact test IDs; use accessible names as additional interaction evidence.
- Require element, illusion, alchemy, and defense with six stable node IDs each. Some responsive implementations render desktop and mobile copies simultaneously in the DOM: count unique node IDs per active view, not raw `spell-node` elements.
- Extract node ID, track, tier, prerequisites/thresholds, practice type, and mastery. Compare every rendered edge or equivalent prerequisite marker with the data graph.
- Click nodes across tracks and verify detail name, track, mastery, state, prerequisite gap, unlock explanation, practice type, and recommendation reason all change with selection.
- Exercise desktop pan/zoom or an equivalent complete-graph browser and mobile direction browsing at `390x844`; state must remain identical across representations.

## Derived State Rules

Audit pure derivation and live DOM together:

- `mastered` wins at `100`; an unmet prerequisite must remain `locked` even if a route recommends it; among eligible nodes, `recommended` precedes ordinary `unlocked`;
- all four states need text/icon/shape cues, not color alone;
- test exact prerequisite boundary `59` versus `60` in the pure function, then observe an immediate UI unlock when a practice crosses `60`;
- mastery is clamped at `100` and never regresses through route changes, failed exams, practice, or reload;
- only `unlocked` and `recommended` nodes may complete practice; both `locked` and already `mastered` nodes must reject it, while mastered mastery remains exactly `100`;
- construct/inspect a cyclic graph and require explicit error or safe fallback, never recursive failure.

Save the graph input and derived state output for boundary cases.

## Three Practice Closures

Rune ordering, element mixing, and defense reaction must be meaningfully different interactions.

For each type:

1. Choose an eligible node and record initial mastery/log/badges.
2. Complete the actual interaction.
3. Capture score, speed bonus, mistake penalty, final delta, and new mastery.
4. Start from the task formula `score * 0.55 + speedBonus - mistakePenalty`; if coefficients are intentionally tuned, require the README and tests to document them. Recompute independently and require a deterministic result with minimum delta `12`.
5. Repeat the same input after reset and compare output.
6. Verify tree, details, overview, recommendation, badges, and log update from the same mastery state.

Attempt practice on locked and mastered nodes. Both must be prevented; locked feedback must name the missing prerequisites, and mastered mastery must remain `100`.

## Routes, Exams, And Remediation

- Switch among element specialization, defense preference, and balanced routes while snapshotting mastery, mastered IDs, badges, and logs.
- Require recommendation/highlight/explanation to change while mastery, mastered nodes, badges, and logs remain unchanged.
- Reject an unexplained recommendation of an unreachable locked node.
- Run a single-track house exam and a cross-track final. Verify pass boundaries `70` and `82`, including exact-boundary and just-below tests.
- Recompute accuracy, speed, strategy, and mistakes from raw values with weights `40/25/20/15`; displayed total and verdict must agree.
- Repeat identical state/input and require identical score.
- On failure, require remediation limited to that exam's scope with mastery strictly below `80`; each item must show node, track, mastery, gap, and practice recommendation.
- Click a remediation item, verify tree selection/detail and transient highlight, complete practice, then retest and require fresh score/remediation from current mastery. Passing must remove failure remediation.

## Progress, Badges, Logs, Persistence

- Recompute overall/per-track mastery, mastered count, badge count, and next recommendations from the mastery map.
- Inventory at least six distinct badge conditions and trigger one condition twice; badge count and achievement log must stay idempotent.
- Verify practice, exam, achievement, and reset produce stable ordered traceable log events.
- Discover the persistence key from source. One reference uses `astral-academy-student`; never require that literal key.
- Reload and compare mastery, route, selected node, badges, practice/exam records, and logs. Inject malformed/legacy values and require clamp/filter/migrate or safe default rather than a white screen.
- Reset must clear prior progress persistently and create only the task's intended reset state/log.

## Engineering, Tests, And README

These are task-level completeness checks that support the audit. Do not turn them into extra child criteria or use them to override a narrower `criteria` item.

- Require `package.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, and `README.md`, with working `dev`, `build`, `test`, and `typecheck` scripts.
- Inspect typed, separated data/domain/state/component/persistence responsibilities. Dependency derivation, cycle detection, practice scoring, exam scoring, badge unlocks, remediation, and recommendations must be importable logic rather than duplicated component rules; reject `dangerouslySetInnerHTML` and whole-page string templates.
- Run Vitest and verify coverage of cycle detection, four-state priority, `59/60` and `100` boundaries, all three practice calculations and the `12` floor, house/final rubric boundaries, remediation `<80`, badge idempotence, route invariance, corrupt-field fallback, and legacy-log migration.
- Require at least two Playwright flows: practice unlocking a successor, and failed-final remediation navigation/highlight. If desktop plus `390x844` are not both covered, the README must disclose that E2E limitation.
- Read the README for all scripts, fixed thresholds/weights/formula, four tracks and 24 nodes, route-versus-track semantics, state derivation and non-regression, exam/remediation/graduation rules, badge/log/reset/persistence recovery, and visual/responsive/motion limitations.

## Visual Judgment

Model-judge desktop and mobile screenshots for a coherent dark celestial/manuscript academy style, readable nodes/edges/mastery/exam data, and a graph-first presentation rather than an ordinary admin table or course-card wall.

## Interactivity Gate

Run this gate before scoring anything that depends on interaction, and record its result in the report.

1. Load the page, wait for the skill graph to render, then click a node, a practice entry, and a route control.
2. After each click assert a concrete downstream delta: node detail text, route highlight, store snapshot, or a changed DOM attribute.
3. Log the outcome with a screenshot and the observed or absent delta.

When the gate fails and clicks produce no response at all:

- every point requiring a click, drag, input, exercise, or exam fails, with the reason `页面不可交互/无响应`;
- points provable from static DOM, initial render, or source-only inspection are still scored on their own evidence, so a task can end up mixed rather than uniformly failed;
- code that appears to implement the behaviour never substitutes for the gate. Deterministic rubric tests, reducer unit tests, and a clean state shape do not prove the mounted app responds.

Say explicitly in each affected row that the verdict came from the interactivity gate rather than from missing coverage.

## High-Risk False Passes

- Twenty-four cards exist but prerequisite edges do not match data.
- A route switch silently rewrites mastery to create recommendations.
- Three practices are one “gain points” button with different labels.
- A mastered node still accepts practice because only the locked state was guarded.
- Exam total is displayed but cannot be recomputed from the fixed rubric.
- Failed-exam remedial links show weak nodes but do not navigate or update after practice.
- Raw desktop/mobile duplicate nodes are counted as 48 and mistaken for a bad catalog.

## Recommended Evidence

- `skill-tree-target-and-graph-audit.json`
- `skill-tree-state-boundaries.json`
- `skill-tree-practice-results.json`
- `skill-tree-exam-rubric.json`
- `skill-tree-remediation.json`, `skill-tree-persistence.json`
- graph/detail/exam/mobile screenshots

## Alignment-Focused Adjudication

Use a fresh save and perform the curriculum in prerequisite order through visible controls. For each criterion, record availability before action, resource/prerequisite state, the attempted action, feedback, and downstream unlock/exam result. Do not treat nodes, handlers, modal markup, or seed data in source as proof that a learner can complete the flow. Visual completeness requires rendered, readable connections and states at the specified viewport; interaction completeness requires the acquired state to persist into later lessons and assessment. When a required route is blocked, keep later dependent criteria unproven rather than assembling passes from isolated source branches.
