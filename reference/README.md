# Reference

`yuruyurau-2111422380442804599.html` is the p5.js sketch posted by @yuruyurau on X
(https://x.com/yuruyurau/status/2111422380442804599, 2026-10-17, #つぶやきProcessing),
verbatim, wrapped in a page that loads p5 from cdnjs. It is the visual target for
the renderer, not code to reuse. `*-frames.png` is five frames from the original video.

Unpacked:

```js
let t = 0;
function draw() {
  if (!t) createCanvas(400, 400);
  background(9);          // clear to near-black every frame
  stroke(255, 46);        // white at ~18% alpha
  t += PI / 90;
  for (let i = 20000; i--;) {
    const y = i / 898;                                   // 0 .. 22
    const k = ((y > 9 ? 4 : 8 - y) + sin(y)) * cos(i / 7);
    const e = y / 5 - 9;
    const d = mag(k, e) - 4;                             // sqrt(k²+e²) - 4
    const c = d / 2 - t / 4;
    point(
      (89 + 2 * k * k) * sin(c) + 200,
      79 * cos(c) + 200 + d * d * sin(3 * t - 2 * d) + 6 * sin(3 * k)
        + (y / 19) * k * e * (1 - sin(3 * e - 2 * d))
    );
  }
}
```

Why it reads as flowing silk: 20k one-pixel points at low alpha, so point density
is brightness; the base shape is an ellipse in `c` that rotates with `-t/4`;
`cos(i/7)` fans consecutive particles sideways so a strand becomes a sheet; nested
sines at different rates (`3t` vs `t/4`) make it ripple and drift at once. Pure
function of (i, t): no state, no physics.
