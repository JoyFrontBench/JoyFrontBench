---
name: evidence-timeline-review-eval
description: Evaluate evidence-review workbenches with precise paragraph-offset annotations, stable events and bidirectional citations, structured contradiction derivation, reasoned confirm/reject/merge actions, cascade deletion, bounded undo/redo, derived summaries, robust persistence, and responsive local-only workflows.
---

# Evidence Timeline Review Eval Skill

Use this skill for `frontenjoyai-030` and similar document/timeline/citation review applications.

Default method: source/domain tests plus Playwright using real text selection ranges. Save complete normalized state snapshots after annotation, citation, contradiction action, deletion, undo/redo, and reload.

The task judge is authoritative. Reference selectors and field names are optional evidence entrances and must not replace behavioral proof.

## Stable Evidence Entrypoints

- paragraphs `[data-paragraph-id]` with a structured text descendant such as `[data-paragraph-text]`;
- highlights `mark[data-span-id]` or stable source ids;
- timeline cards `[data-event-id]`;
- semantic regions named document reader, unified timeline, contradiction panel, annotation editor, summary, and material catalog;
- accessible filters for person/type/review/confidence and named undo/redo, save annotation, add/link event, disposition, delete, export-preview, and recovery actions.

Use real DOM `Range` selection over text nodes. Do not synthesize an annotation by calling internal reducers unless separately testing domain logic.
## Seed And Selection Contract

- Confirm stable seed counts and ids required by the task, such as people, documents, spans, and events.
- Render text through structured React/text nodes rather than `dangerouslySetInnerHTML`.
- Make a legal selection inside one paragraph, length `1-500`, and compare start/end offsets plus selected text with the original paragraph.
- Save person, time, location, type, confidence, sequence, Annotation id, and Span id.
- Attempt blank, cross-paragraph, out-of-range, exact duplicate, and partial overlap with a custom span.
- Every invalid attempt must leave no half-created Annotation/Span and must provide recoverable feedback.

For this task, the clean seed must contain at least 4 people, 6 documents, 36 seed spans, and 14 events; extra valid seed records are allowed. A successful custom annotation increments annotations and spans atomically by one, uses one monotonic sequence, and satisfies `paragraph.text.slice(startOffset,endOffset) === selectedText`.

Inspect state equivalent to:

- span: id/document/paragraph/start/end/kind/optional annotation id;
- annotation: id/span id/sequence/type/person ids/start/end/location/canonical location/confidence/note/created time;
- event: id/start/end/location/canonical location/person ids/type/confidence/origin/optional annotation id/citation ids;
- citation: id/event/document/span/label/optional annotation id;
- claim: stable id/signature/person/two event ids/citation ids/overlap interval/two locations/status/reason/merged target.

## Events, Filters, And Bidirectional Citations

- Verify timeline ordering by start, end, then stable id.
- Combine person, type, confidence, and review-status filters and compare the intersection.
- Generate an annotation-origin event from a span once; a repeat must not duplicate it.
- Link the same span to an existing event without overwriting that event's time/location/people.
- Reject duplicate `(span,event)` citation while allowing the span to cite another event.
- From event/summary citation, jump to exact document and highlighted span; from the span, reveal associated events.
- Save focus/current-document/current-event state to prove both directions.

Citation integrity invariants: ids are unique; each event citation id resolves to a citation whose `eventId` points back; each citation resolves to an existing event/document/span; `(eventId,spanId)` is unique. Clicking each individual citation must focus its own span, not merely the event's first source.

## Structured Contradiction Derivation

Construct a matrix:

- same person + strictly overlapping half-open intervals + different canonical locations + citations on both sides -> claim;
- touching endpoints -> no claim;
- whitespace/punctuation/location aliases resolving to one canonical location -> no claim;
- different person -> no claim;
- missing citation on either side -> no claim.

Location must be normalized structurally, not inferred from arbitrary document text.

Confirm a claim, add an unrelated citation, and require stable id/manual status while the claim signature is unchanged. Change signature-defining event data and require a new suggested claim.

Compute expected conflicts independently with half-open overlap:

`a.start < b.end && b.start < a.end`

Then require shared person, different canonical locations, and at least one citation on both events. Touching endpoints, alias-equivalent locations, different people, or either uncited side must produce no claim.

## Disposition, Merge, And Cascade

- Confirm/reject require nonempty reasons and append history.
- Merge only compatible claims; validate target, mark source merged/mergedInto, retain target citations, and avoid duplicate summary entries.
- Delete a user annotation that created one event and also cites another:
  - remove its annotation-origin event;
  - remove only its citation from unrelated existing events;
  - rederive contradictions and summary;
  - preserve seed spans/events and unrelated links.
- Undo the deletion and require the complete chain to return.

After deletion, assert set differences explicitly: remove the custom annotation/span, its annotation-origin event, and citations using that span; retain seed spans/events and unrelated citations; scrub removed citation ids from surviving events; then rederive claims and summary.

## Undo, Redo, And Summary

- Facts such as annotation/link/disposition/deletion enter bounded history up to the specified limit.
- Navigation, filters, selection, and timeline view do not.
- Undo/redo must restore complete citation and claim integrity.
- A new fact after undo clears redo.
- Derive conclusions only from confirmed claims; reject/merged claims do not duplicate them.
- Suggested/uncertain/low-confidence evidence creates pending questions.
- Every support-chain link must navigate to its source.

History invariant: `past.length <= 30`; fact actions snapshot the complete present; filters, selected document/span/event, mobile tab, and timeline view do not add history. Reload restores persisted present/UI but starts with empty past/future when that is the documented boundary.

## Persistence And Recovery

- Persist version, seed identity, present state, filters, current document, and timeline view.
- Reload and require present/UI restoration while past/future follow the documented reset boundary.
- Validate ids, offsets, times, citations, and expected seed quantities.
- Inject invalid JSON/version, duplicate ids, dangling citations, and bad offsets; require seed fallback, a recovery banner/action, and no white screen.
- Verify the application is local-only with no real cases, OCR/AI, remote documents/images, or service requests.

When present, inspect `localStorage["mirror-lake-review-r17"]` for `schemaVersion`, seed identity, `present`, filters, current document, and timeline view. Inject malformed JSON, wrong version/seed, duplicate ids, bad offsets, invalid intervals, duplicate event citation ids, and dangling event/span/document references. Syntax-only validation is insufficient.

For export, inspect the local preview/print output and all support-chain identifiers. A dialog opening or `window.print()` call alone does not prove the summary matches current derived state.

## Visual And Responsive Judgment

At desktop, require a four-region review workbench with paper-like reading hierarchy and restrained short feedback for selection, annotation placement, timeline changes, citation links, and contradiction focus. Motion must not continuously disturb reading.

At `360px` and reduced-motion, complete annotation-to-summary/source jump without overlap; static connection lines/focus outlines must preserve relationships. Verify the fictional/non-legal and local-draft boundaries are clear.

## High-Risk False Passes

- Selection text is stored without exact paragraph offsets.
- Timeline event is created twice from the same span.
- Contradiction detection uses substring search instead of structured person/time/location/citation fields.
- Merge drops source citations or duplicates conclusions.
- Undo restores visible cards but leaves dangling citation ids.
- Reload trusts JSON syntax without structural validation.
- Event-card tests jump to one highlighted source but never exercise every citation button independently.
- Claim status is preserved by id even after signature-defining time/location/citation data changed.
- Delete removes the visible annotation but leaves a generated event, dangling citation id, stale claim, or duplicate summary entry.
- Mobile tabs hide regions successfully but lose selection/focus state during annotation-to-summary round trips.

## Recommended Evidence

- `evidence-selection-offset-audit.json`
- `evidence-citation-roundtrip.json`
- `evidence-contradiction-matrix.json`
- `evidence-disposition-cascade.json`
- `evidence-history-summary.json`
- `evidence-persistence-corruption.json`
- desktop/mobile review screenshots

## Alignment-Focused Adjudication

Complex domain criteria require an end-to-end UI/domain trace from a fresh seed, not isolated helper invocation. Create or edit the prerequisite annotation/event/citation through the supported workflow, record stable IDs, then observe claims, summary, deletion cascades, history, persistence, and reload in the running application. Test positive and negative matrices for person/location/citation conditions and verify unchanged unrelated seed entities by exact ID sets. For undo/redo and reload, compare complete `present`, `past`, `future`, filters, selected document, and timeline view before and after the boundary. Unit-level source calls may diagnose behavior but cannot alone prove wiring, persistence, or user-reachable semantics.
