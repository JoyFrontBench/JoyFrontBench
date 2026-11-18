---
name: iphone-product-site-eval
description: Evaluate code-drawn iPhone product sites with multi-view galleries, color/model/capacity configuration, price linkage, scroll-aware navigation, component completeness, and responsive Apple-like visual polish.
---

# iPhone Product Site Eval Skill

Use this skill for `frontenjoyai-003` and similar premium product sites whose phone, logo, icons, and decoration must be drawn with CSS, inline SVG, or Canvas rather than external media.

Default method: Playwright desktop/mobile screenshots plus source, DOM, computed-style, Canvas-pixel, and network evidence. Treat the task judge as the contract; selectors below are discovery hints from one reference implementation, not required component names.

## Discover Stable Targets

Prefer roles, accessible names, anchor `href`s, section headings, selected-state attributes, and visible labels. When present, useful candidates include:

- sections `#overview`, `#gallery`, `#experience`, `#specs`, `#buy`;
- gallery `#gallery-swatches`, `#gallery-color-name`, `.gallery-products .front/.back`;
- configurator `#model-options`, `#capacity-options`, `#buy-colors`, `#buy-phone`, `#total-price`;
- navigation `#nav`, `.nav-links a[href^="#"]`;
- interactive visual `#canvas-wrap`, `#flow-canvas`.

First save a target map explaining which semantic locator was selected and why. Do not fail a valid implementation merely because these reference selectors are absent.

## Hard Checks

- Audit HTML/CSS/JS and all requests. Reject external raster/vector image files, video used for required visuals, or 3D/model files. Inline SVG, CSS drawing, and Canvas are allowed. Verify the phone, brand mark, icons, and decorative graphics are actually code-drawn rather than omitted or replaced by external media. Record fonts and other requests, but do not fail them unless the task separately bans network assets. Inspect `url(...)`, `src`, `href`, module imports, and requests rather than relying on extension search alone.
- Inventory navigation, buttons, product cards, comparison/specification content, configurator, and footer.
- Require a dedicated gallery/display region with a genuine back/side/oblique view or a genuine multi-form/color presentation, plus an actual display-item switch with a smooth rendered transition. Simultaneous front/back rendering can prove angle coverage, but it does not replace the required switching interaction.
- Exercise every gallery/display switch and record the selected value, rendered phone geometry/color, and transition. Several controls showing the same front rendering do not establish multi-angle coverage.
- Read the implementation's product/model/capacity data, then exercise a model change and a capacity change across at least two valid combinations. The displayed price must equal the selected data row, not merely change; do not require every model to expose two capacities when the task data does not.
- For two colors, compare the actual product rendering before/after using computed CSS custom properties, SVG fill/stroke, Canvas pixels, or screenshot crops. Selected text/class alone is insufficient.

## Navigation And Interactive Closure

1. Click every in-page navigation link and verify the intended section enters the viewport with smooth movement when motion is enabled.
2. At overview, gallery, experience, specs, and buy positions, record the matching link's class/attribute and computed color, weight, decoration, or background. A header becoming glassy/compact is a separate scroll-state requirement and is not current-section evidence.
3. Manually scroll across section boundaries and require active navigation to follow without another click.
4. Record the header and target section before/after scrolling. Require the separate glass/compact/shadow header state and reasonable section-entry feedback; neither substitutes for the active navigation item.
5. Drag/pointer-move and scroll through the experience area. For Canvas, compare nonblank pixels or sampled regions before/after input; for DOM/SVG, compare geometry/attributes. A changing instruction label is not proof.
6. Capture desktop and narrow layouts, including the full configurator and navigation. Check overflow, overlap, usable controls, and hover/focus/active feedback.

Model-judge restrained spacing, typography hierarchy and font treatment, product prominence, consistency, refined drawing, and absence of an obvious generic AI-template look. Keep these claims separate:

- technical compliance: no forbidden external visual assets;
- gallery completeness: genuine multi-angle or multi-form presentation;
- state linkage: UI selection and rendered phone/price change together;
- navigation/interaction: section highlight and visual response are observable;
- visual quality: refined, coherent, responsive presentation.

## High-Risk False Passes

- Counting repeated front phones, recolors, or duplicated slides as multiple angles.
- Passing color linkage because a swatch receives `active` while the phone remains unchanged.
- Passing price linkage because the number changes without checking the internal model/capacity table.
- Treating a scrolled/glass header class as proof that one navigation item is active.
- Treating source complexity, transitions, or Canvas animation loops as proof of a visible polished result.

## Recommended Evidence

- `iphone-target-map.json`, `iphone-network-audit.json`
- `iphone-gallery-render-states.json`, `iphone-configurator-matrix.json`
- `iphone-navigation-sections.json`, `iphone-interaction-pixels.json`
- hero/gallery/configurator screenshots at `1440x900` and `390x844`

## Alignment-Focused Adjudication

Separate three questions that are easy to conflate: content variation, viewing-angle variation, and visual finish. Color/model changes prove multiple forms but do not by themselves prove multiple angles; judge refinement from rendered silhouette, internal detail, material treatment, spacing, and hierarchy at a stable scale. Conversely, when a criterion is primarily about the interactive graphic, do not fail it solely for a navigation-state omission unless the criterion explicitly makes navigation highlighting a required conjunct. Exercise the named input (drag, pointer move, or scroll), capture a short frame sequence, and judge continuity from the graphic's state changes rather than from a single final screenshot.
