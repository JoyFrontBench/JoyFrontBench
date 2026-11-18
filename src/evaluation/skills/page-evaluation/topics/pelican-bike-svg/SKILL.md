---
name: pelican-bike-svg-eval
description: Evaluate SVG illustrations of a pelican riding a bicycle, including pelican/bicycle recognizability, throat pouch proportion, SVG grouping, visual style, looping cycling animation, and responsive scaling.
---

# Pelican Bike SVG Eval Skill

Use this skill for `frontenjoyai-005` / “鹈鹕骑自行车” SVG illustration tasks.

Default method: Playwright screenshots plus SVG DOM audit. Capture the initial illustration, animation frames, long-running frame, and narrow viewport screenshot. Use model-judged visual verdicts for anatomy/proportion/style, supported by SVG structure and bbox data when available.

## Proportion and Throat-Pouch Rules

For `task_id=2` / 比例协调, **喉囊袋畸大 is a hard fail condition**.

The pelican must have a recognizable throat pouch, but it should not dominate the character:

- The throat pouch should read as a pouch under the beak, not as the largest or most visually dominant body part.
- Fail the proportion criterion when the pouch is visually oversized, for example:
  - pouch height is close to the body height;
  - pouch area is around half of the body area or larger;
  - pouch is larger than the head/neck visual mass and becomes the main focal point;
  - pouch makes the pelican look like a generic orange bag/ball attached to a small bird.
- The high-frequency negative example in the Excel criterion, `喉囊袋畸大`, must be explicitly checked and mentioned in the reason.
- Do **not** pass “比例协调” only because the bird sits on the bicycle and the wheels/frame are aligned. Throat-pouch scale is a separate required part of the same validation point.

Recommended SVG bbox audit when IDs are available:

```js
const bbox = (selector) => {
  const el = document.querySelector(selector);
  if (!el || typeof el.getBBox !== 'function') return null;
  const b = el.getBBox();
  return { x: b.x, y: b.y, width: b.width, height: b.height, area: b.width * b.height };
};
const pouch = bbox('#pouch');
const body = bbox('#body');
const head = bbox('#head');
```

Use bbox as supporting evidence, not as the only signal. A practical fail threshold is:

- `pouch.area / body.area >= 0.45`, or
- `pouch.height / body.height >= 0.75`, or
- model-judged screenshot clearly shows the pouch overpowering head/body proportions.

If the page lacks stable `#pouch` / `#body` IDs, crop the bird area and make a model-judged visual verdict from the crop.

## `task_id=2` Expected Subchecks

Keep these points distinct in the report:

1. **比例协调**: bird-to-bike size, pelican body/head/leg/wing proportions, and especially throat-pouch size. `喉囊袋畸大` => `fail`.
2. **无穿模/无断裂**: legs, pedals, frame, wheels, body, beak, and pouch should connect naturally without visible clipping or broken parts.
3. **构图**: subject placement, comfortable whitespace, no cropping.
4. **自适应**: SVG viewBox/responsive scaling, no stretch/crop at narrow viewport.

Do not merge item 1 and item 2 if the Excel `criteria` lists them separately; if the evaluator returns one combined row, its reason must still explicitly cover throat-pouch size and clipping/connection.

## Reporting

For any `pass` on proportion:

- cite the screenshot/crop evidence;
- state that the throat pouch is not oversized;
- include bbox ratios if available.

For the current known failure pattern where the pouch occupies about half of body area or nearly body height, mark the proportion subcriterion `fail` with a concrete reason such as:

> model-judged + bbox：喉囊袋视觉占比过大，面积约为身体 52%、高度约为身体 84%，成为鸟身主视觉焦点，命中 criteria 反例“喉囊袋畸大”。

## Cycling Animation: Feet Must Stay on Pedals

For `task_id=4` / 踏板-双腿联动, **脚始终踩在踏板上随其运动 is a hard pass requirement**.

The following must be true for a `pass`:

- both feet are visibly on their pedals, not floating near the crank;
- feet move with the pedals throughout the cycle, not merely legs swinging near a rotating crank;
- pedal rotation, leg motion, and foot positions stay synchronized across multiple frames;
- if one foot is occluded, the visible foot still must remain attached and the hidden/occluded state must be explainable from frame evidence.

Hard fail patterns:

- 脚悬空，没有落在踏板上；
- 脚和踏板分离，踏板自顾自转动；
- 腿绕髋部摆动，但脚没有绑定/贴近踏板轨迹；
- only the crank/pedals rotate while the feet follow a different arc or stay too far from pedal centers;
- a single static frame looks close, but sequence frames show the feet drifting away.

Recommended evidence:

- Capture at least three frames across one crank cycle, such as `t0`, `t250ms`, `t500ms`, `t750ms`.
- Save a foot-pedal audit JSON containing left/right foot bounding boxes, pedal bounding boxes, and min foot-to-pedal distances per frame.
- As a practical screen-space threshold, every visible foot should be close to a pedal in every sampled frame. If a foot-to-nearest-pedal center distance repeatedly exceeds about `24px` at the standard 1440px viewport, treat it as detached unless the screenshot clearly proves contact.
- If SVG structure shows feet are in independent leg groups while pedals are in a rotating crank group, do not rely on structure alone; verify the actual animated frame positions.

For the known failure pattern where `#leftLeg` / `#rightLeg` feet animate independently from `#crankGroup`, mark the linked subcriterion `fail` with a concrete reason such as:

> 多帧 foot-pedal audit 显示脚到最近踏板距离多次超过 24px，最大约 50px；脚路径在 leg group 内绕髋部摆动，踏板在 crankGroup 内独立旋转，不能证明“脚始终踩在踏板上随其运动”。
