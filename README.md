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

The importer retains supported vector paths and reports unsupported SVG elements or effects instead of silently ignoring them. Artwork is plotted as path outlines only: fills, text, raster images, hatching, and plotter control are intentionally out of scope. Export is refused if any flattened path leaves the paper or configured machine area.

Run `npm test` for document and exporter checks. The browser build bundles Paper.js locally, so the editor itself does not fetch any remote assets or make network requests.
