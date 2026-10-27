# evoswim

## Layout

- `src/sim` body, fluid, controller, routes, scene. No DOM.
- `src/evolve` MAP-Elites archive and a (μ,λ) evolution strategy. No DOM.
- `src/render` point sheet, pixel renderer, camera, debug lines. Canvas 2D only.
- `src/app` the aquarium controller and the movement write-up; framework-free.
- `src/main.ts`, `index.html` a local demo page around the controller.
- `scripts/` headless archive build, evolution CLI, screenshots, sync to a host site.
- `test/` physics, evolution, route and archive tests (`node:test`).

## Run

```sh
npm install
npm run dev          # local demo at http://127.0.0.1:5173
npm test             # physics and search tests
npm run map -- 500000 1 24   # rebuild src/evolve/archive.json: evaluations, seed, threads
npm run build        # static build in dist/
```

Demo page parameters: `?t=N` freezes a frame at N simulated seconds, `?seed=N`
changes the cast's routes, `?cast=N` the number of swimmers, `?speed=S` the playback
rate, `?mode=lines` shows the debug polylines, `?theme=light|dark`.

Any change to how genes map to body or controller values invalidates the archive;
rebuild it with `npm run map`.

## Embedding

`scripts/sync-to-site.sh <dir>` copies `src/{sim,evolve,render,app}` and a typed
copy of the archive into another project. The controller in `src/app/aquarium.ts`
takes a canvas, a container for the lineage tanks and a palette getter, and emits
state for the host to render as text; see `src/main.ts` for a minimal host.
