# evoswim: how it works

Reference notes on the method, written for Harrison to rewrite in his own words.
Numbers are the shipped values as of 2026-10-26.

## 1. The question

The starting point was a tweet-sized p5.js sketch by @yuruyurau: 20,000 one-pixel points
drawn at low alpha, positions given by a hand-tuned formula of (index, time). It looks like
silk because point density is brightness and the formula folds a 2-D sheet onto the plane.
The question was whether something like it could be evolved to swim toward a goal instead
of being tuned by hand.

Evolving the display formula directly is pointless: an optimizer asked for "forward"
just adds velocity × time to x. So forward motion has to come from a body in a fluid,
and the point cloud becomes a skin drawn over that body. Three layers, built in order:
physics, evolution, skin.

## 2. The body

- A spine of 8 to 14 rigid segments, total length 1 (one "body length", BL, is the unit).
- Up to four limb slots. An enabled slot grows a limb at a chosen spine joint with a rest
  angle (0.3 to 2.3 rad off the spine), a length (0.12 to 0.9 BL), 1 to 4 segments, a
  stroke amplitude, a phase relative to the spine wave, a phase lag per distal joint, a
  "whip" factor for the distal joints, and a mirror flag that adds the same limb on the
  other side with its own pair phase.
- Joints are not positioned directly. Each is a critically damped spring driven toward a
  target angle, and the target is shifted by the fluid torque on everything distal to the
  joint divided by a stiffness. So a tail swept through water lags and whips. Stiffness
  for spine and limbs and the spring's response frequency are genes (0.2 to 5, 0.1 to 2.5,
  1.5 to 4 Hz). Joint rate is capped at 10 rad/s as a muscle limit.

## 3. The controller

A central pattern generator sets each spine joint's target:

    φ(t)   = 2π f t                               phase, f ∈ [0.2, 1.5] Hz
    s      = j / (n−1)                            position along the spine
    A(s)   = A_head + (A_tail − A_head) s^p       amplitude envelope
    w      = sin(φ − k s) + a₂ sin(2(φ − k s) + φ₂)   travelling wave plus a harmonic
    θ_j    = A(s) · w · asym + bias

- `k` is the total phase lag head to tail (0 to 3π): one wavelength on the body is 2π.
- Steering: `bias = clamp(offset + gain × b, ±π/n)` where `b` is the bearing to the goal
  (clamped to ±1.5 rad and low-passed with a 0.3 s time constant). The cap means the
  whole body can bend at most a semicircle to steer. `asym` scales one half-stroke
  relative to the other by `1 + c·b·sign(w)`, kept in [0.3, 1.7], so a creature can also
  steer by beating harder on one side.
- The sum of wave amplitudes over the spine is capped at 6 rad so a body cannot coil.
- Limb joint k: `θ_k = ±amp · sin(φ + phase − lag·k)`, scaled by `whip` past the root.

Ten controller genes drive this (frequency, two amplitudes, envelope power, wavelength,
harmonic amplitude and phase, steering gain, offset and asymmetry) plus three compliance
genes. All genes are unit floats mapped to these ranges.

## 4. The fluid

Resistive-force theory, the standard low-fidelity model for slender swimmers.

- Every segment feels a drag force proportional to its velocity through the water, with
  coefficient 1.0 per unit length for motion across the segment and 0.1 along it. That
  10:1 anisotropy is the whole propulsion mechanism: a segment tilted by the travelling
  wave pushes hard broadside and slips lengthwise, and the broadside push has a backward
  component that does not cancel over a beat.
- Body mass is 0.14 per unit length, isotropic. (An anisotropic added-mass tensor was
  tried and removed: carrying momentum through a tensor that rotates with the segment
  sheds it wrongly and spikes velocity when a segment turns edge-on.)
- Each step (dt = 1/60 s) the controller sets the shape, then one 3×3 linear solve gives
  the body's rigid velocity (vx, vy, ω) from momentum balance with drag treated
  implicitly, so the step is unconditionally stable. Momentum is tracked about the head
  joint. Drag dissipation Σ vᵀDv is integrated as the energy cost.
- A test checks Purcell's scallop theorem: with mass set to zero, rigid paddles stroking
  back and forth produce no net motion, while jointed paddles with a phase lag swim.
- Not modelled: pressure and vortex wakes, added mass, self-interaction with the wake.

## 5. Fitness

A genome is evaluated on two mirrored courses of three goals each, 12 simulated seconds
per course. Reaching a goal (centroid within 0.25 BL) spawns the next, so only genuine
steering pays. Fitness is

    distance closed  − 0.1 × drag dissipation  − 3 × CoV(speed)  − 0.3 × RMS(yaw rate)

The last two terms are steadiness: within-beat speed surging and heading oscillation are
penalised, which is what real swimmers minimise too and what makes the motion read as
smooth. Three exploits shaped this function, each found by watching the line render:

1. A single goal with a fixed horizon was solved by a timed orbit that passed the goal at
   the deadline. Fix: sequential goals.
2. A penalty on joint rate let a standing-wave "paddle" slip through the massless fluid at
   69 BL/s. Fix: charge dissipation, cap joint rate, add mass.
3. The heading function pointed tail-ward, so the bearing wrapped by 2π every half beat
   when aligned and the joints slammed. Fix: heading tail→head. A later sweep of 300
   random creatures found steering-curl spin-ups, which is where the semicircle cap and
   the asymmetry clamp come from.

## 6. The search

MAP-Elites rather than a single optimum, because the goal is variety, not speed.

- Genome: 66 unit floats (13 controller, 1 spine segment count, 4 × 10 limb slot genes,
  12 plumage genes).
- Archive: a 9 × 8 grid, limb count (0 to 8) by longest limb (0.12 to 0.90 BL in
  0.0975 steps). Each cell keeps its fittest swimmer; 65 of 72 cells are reachable.
- Proposals: pick a random elite, 30% chance of uniform crossover with another, perturb
  each gene with probability 0.3 by N(0, 0.1²) reflected into [0, 1], 15% chance of
  re-rolling an entire limb slot, 5% fully random genomes.
- 500,000 evaluations on 24 threads, about 6 minutes. The in-page search was removed
  after it caused visible restarts; the shipped archive is fixed.
- Lineage: when a new elite displaces one, the old one is kept in the cell's history,
  thinned to nine entries with the first and latest always retained. That history is the
  "progression" shown on the page, the first entry usually a near-random flailer.
- Observed: every elite sits at the 1.5 Hz frequency cap (fitness is distance in fixed
  time), elites choose maximum spine stiffness and near-minimum limb stiffness (stiff
  body, floppy limbs as passive fins), and limbed creatures out-swim the plain eel.

## 7. The cast and the routes

- Ten swimmers are chosen from the archive by farthest-point selection over
  (limb count, longest limb, surface pattern, hue, spine segments, log stiffness),
  seeded from the best swimmer. The shipped cast spans limb counts 0, 1, 2, 3, 5, 6, 7, 8.
- Each follows its own closed loop in a 13 × 7.3 BL tank, an eight or an oval, scaled,
  rotated and placed on a jittered grid, shrunk or rounded until it fits and bends no
  tighter than 0.5 BL. Steering is pure pursuit: the goal is a point 0.9 BL ahead on the
  loop, found by a local search in the route parameter so progress never jumps. The
  archive transfers to route following without re-evolving.
- Playback runs at 0.45 simulated seconds per real second; the time unit is arbitrary.

## 8. The skin

- The renderer keeps 6 s of body history and draws a point sheet with two axes: position
  along a chain (slow) and an angle θ = i / fan that loops out through the chain's wake
  and back (fast), with fan periods 7 and 11 as genes. Each point sits at
  `history(s, age) + normal × ((width + veil·age) cos θ + ripple) + tangent × along`.
  Folds of this sheet pile up into bright edges, which is what reads as silk in the
  original.
- Shading: each loop is lit as a tube, normal = (chain normal · cos θ, sin θ), light from
  the top left and above the plane.
- Texture: a pattern in (s, θ), stripes along the body, rings around it, spots, or a
  head-to-tail gradient, plus a fine ripple; type, frequency and contrast are genes.
- Colour: two hues mixed by the texture, pulled toward the theme's ink by a "colour"
  gene, faded toward paper down the wake. Hues, saturation and colour amount are genes.
  Plumage genes are fitness-neutral and drift freely, so cells look different.
- Pixels: points accumulate into a 2 px grid; each cell takes the coverage-weighted mean
  colour, a Bayer 8×8 offset, and snaps to the nearest of ten palette colours built from
  paper, ink, the two hues and their mixes. Cells dominated by different swimmers use
  their own palettes. The lens re-renders the water under the pointer at 3× with 1 px
  cells; the close-up frames the chosen swimmer at 2.6 BL wide with 3 px cells.
- Rendering sits one simulation step behind and interpolates, so slow playback does not
  judder. Everything reads the site's CSS tokens live, so light and dark both work.

## 9. Numbers at a glance

| quantity | value |
|---|---|
| spine segments | 8 to 14 |
| limb slots | 4, each optionally mirrored |
| drag across / along | 1.0 / 0.1 per unit length |
| body mass | 0.14 per unit length |
| timestep | 1/60 s, implicit 3×3 solve |
| genome | 66 unit floats |
| archive | 9 × 8 cells, 65 reachable, 500k evaluations |
| evaluation | 2 courses × 12 s × 3 goals |
| cast | 10, farthest-point over body and plumage |
| tank | 13 × 7.3 BL, loops with turn radius ≥ 0.5 BL |
| points per frame | up to 42k tank, 30k close-up, 3.5k per lineage mini |
| playback | 0.45× simulated time |
