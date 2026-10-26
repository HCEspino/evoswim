# evoswim — starting brief

Harrison saw https://x.com/yuruyurau/status/2111422380442804599 (a hand-tuned,
tweet-sized p5.js point-cloud animation, see `reference/`) and asked: can something
like this be *evolved* to swim forward / toward a goal instead of being hand-tuned?

Answer we are building: yes, if the motion is produced by a body with physics, so
that "forward" cannot be faked by adding `v*t` to x. Three layers, built in order.

## 1. Body + physics (first, with a boring line render)

- 2D creature: a chain of N segments (start N≈12), or a thin sheet.
- Controller: a central pattern generator, a travelling sine of lateral
  displacement along the body with parameters: frequency, amplitude envelope
  (head→tail), wavelength, phase lag, plus a steering bias driven by the angle to
  the goal.
- Fluid: resistive drag per segment, perpendicular drag coefficient >> parallel
  (anguilliform swimming). That asymmetry is what turns undulation into thrust.
  Integrate the body's position and heading from the net force/torque.
- Deterministic: seeded RNG, fixed timestep, injectable time, so a run is
  reproducible and a frame can be frozen with `?t=N` for screenshots.

## 2. Evolution on the controller

- Genome ≈ 10 floats (the CPG parameters above + steering gain).
- Fitness: distance closed toward the goal in T steps, minus an energy term so it
  does not thrash. Later: multiple goals / goal that moves on click.
- Algorithm: start with a (μ,λ) evolution strategy; CMA-ES if plain ES stalls.
  Each evaluation is a few thousand arithmetic ops, so hundreds of generations per
  second in the browser is the target. Show generation 0 flailing and generation
  ~200 swimming, live.
- Prior art to keep in mind: Sims 1994 (virtual creatures), Ijspeert salamander
  CPG, Lighthill elongated-body theory (only if resistive drag looks wrong).

## 3. The yuruyurau skin (last)

- Sample thousands of points along the evolved body, fan each one out around the
  body with the `cos(i/7)` trick, plot at low alpha on canvas 2D. Density =
  brightness. The silk look comes from the renderer, so it survives the swap from
  formula to simulation.
- Must work on the site's light theme too (paper `#f6f6f3` / ink `#1b1d1f` /
  accent `#c43c2c`) and its dark theme (`#141516` / `#e9e7e2` / `#e2543f`): ink
  points on paper, not only white on black.
- Honour `prefers-reduced-motion` (show a settled frame, no loop).

## Where it ends up

A dedicated page/route on harrisonespino.com (`/data/projects/personal-website`:
Vite + React 19 + TypeScript, deployed as a Cloudflare Worker). Develop it here
first as framework-free TypeScript modules (`sim`, `evolve`, `render`) with a thin
local demo page, so the port is a `<canvas>` React wrapper, not a rewrite. No p5
in the final; canvas 2D only. The existing hero on that site
(`src/components/ascii/PlannerHero.tsx`) shows the house style for a canvas hero:
rAF loop capped per frame, IntersectionObserver pause, theme via `data-theme`
MutationObserver, `?t=` freeze harness.

## Constraints

- Verify step 1 actually learns to swim (plot best fitness per generation, watch
  the line render) before touching the skin.
- Any visible copy on the page is Harrison's words; do not write prose in his
  voice (see vault `feedback-no-invented-copy`).
- The X API is not available (dead token, no credits); the reference is already
  saved locally, do not re-fetch.
