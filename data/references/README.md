# Reference images

This directory provides **67 PNGs across 64 scenes** for the **15 questions**
with `pairwise_gsb` tasks. No reference application needs to be installed or run.

`manifest.json` lists the questions and their task/criterion mappings. Each
question directory contains:

```text
<question_id>/
  scenes.json
  images/
    <scene_id>-01.png
    <scene_id>-02.png
```

`scenes.json` records viewports, themes, initial states, interaction steps,
criterion IDs, frame order and comparison limits. Filename gaps are intentional.

## Using the images

The evaluator selects these images automatically for pairwise tasks, using the
`frozen-visual` protocol. It copies the selected question's images and scene
index into `<output>/screenshots/reference/<question_id>/` for the report.

- Reproduce the listed semantic states on the candidate with matching viewing
  conditions; elapsed times are sampling notes, not performance requirements.
- Compare visible appearance. Still images and finite sequences cannot prove
  unseen states, persistence, source-level requirements or continuous behavior.
- Keep the original criteria. If missing evidence determines a comparison,
  report `needs_review` rather than guessing. Test candidate functionality separately.
- Do not treat a reference image as a guaranteed perfect solution.
- Custom references are experimental. Do not combine frozen-image comparisons
  with `live-workspace` comparisons.

## Check the files

```bash
node src/evaluation/scripts/cli.mjs references:verify
```

The checker validates question mappings, scene coverage, image paths, PNG
headers and dimensions. During evaluation, the runner directly compares file
contents to ensure the selected references and report copies stay unchanged.
