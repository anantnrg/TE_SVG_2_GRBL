# TE SVG 2 GRBL

Offline-first desktop web app for arranging SVG vector artwork on a virtual sheet and exporting GRBL-compatible pen-plotter G-code. No plotter connection is made.

## Run locally

```sh
npm install
npm run build
npm run serve
```

Open the local URL printed by the server. Paper.js and esbuild are bundled from local dependencies into `dist/app.js`; after install/build, the application makes no network requests and can be served entirely offline. `dist/` is generated and intentionally ignored.

## Project layout

- `src/ui/` — DOM controls and canvas view
- `src/document/` — sheet model and object transforms
- `src/svg/` — SVG import and unsupported-content reporting
- `src/gcode/` — plotter coordinate mapping and G-code output
- `tests/` — offline unit tests
