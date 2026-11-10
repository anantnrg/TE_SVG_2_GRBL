# TE SVG 2 GRBL

Offline-first desktop web app for arranging SVG vector artwork on a virtual sheet and exporting GRBL-compatible pen-plotter G-code. No plotter connection is made.

## Prerequisites

- Git
- Node.js 18 or newer, with npm 8 or newer

The initial dependency installation needs an internet connection to download Paper.js and esbuild from npm. Once dependencies are installed and the app is built, the application itself makes no network requests and runs fully offline.

## Get started

```sh
git clone https://github.com/anantnrg/TE_SVG_2_GRBL.git
cd TE_SVG_2_GRBL
npm install
npm run serve
```

`npm run serve` builds the Paper.js application bundle into `dist/app.js` before starting the server; `dist/` is generated and intentionally ignored. Open **http://127.0.0.1:4173/**, or use the local URL printed by the server. Keep the server running while using the app. Stop it with **Ctrl+C** in the terminal.

To run the tests:

```sh
npm test
```

### Troubleshooting

- If `npm install` fails, check your internet connection and retry.
- If the build reports that esbuild or Paper.js is unavailable, run `npm install` again, then `npm run serve`.
- If port 4173 is already in use, start the server on another port, for example `PORT=4174 npm run serve`, and open **http://127.0.0.1:4174/**.

## Project layout

- `src/ui/` — DOM controls and canvas view
- `src/document/` — sheet model and object transforms
- `src/svg/` — SVG import and unsupported-content reporting
- `src/gcode/` — plotter coordinate mapping and G-code output
- `tests/` — offline unit tests

The importer retains supported vector paths and reports unsupported SVG elements or effects instead of silently ignoring them. Artwork is plotted as path outlines only: fills, text, raster images, hatching, and plotter control are intentionally out of scope. Export is refused if any flattened path leaves the paper or configured machine area.

Run `npm test` for document and exporter checks. The browser build bundles Paper.js locally, so the editor itself does not fetch any remote assets or make network requests.
