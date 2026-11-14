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

`npm run serve` builds the Paper.js application and the raster-processing worker into `dist/` before starting the server; `dist/` is generated and intentionally ignored. The VTracer and OpenCV WebAssembly runtimes are bundled locally under `assets/wasm/`. Open **http://127.0.0.1:4173/**, or use the local URL printed by the server. Keep the server running while using the app. Stop it with **Ctrl+C** in the terminal.

To run the tests:

```sh
npm test
```

### Troubleshooting

- If `npm install` fails, check your internet connection and retry.
- If the build reports that esbuild or Paper.js is unavailable, run `npm install` again, then `npm run serve`.
- Rebuilding the checked-in raster WASM assets is optional for app use. It requires Rust with the `wasm32-unknown-unknown` target and `wasm-pack` for VTracer, plus Emscripten and CMake for OpenCV; run `tools/build-vtracer-wasm.sh` and `tools/build-opencv-thinning-wasm.sh` from an environment with network access.
- If port 4173 is already in use, start the server on another port, for example `PORT=4174 npm run serve`, and open **http://127.0.0.1:4174/**.

## Project layout

- `src/ui/` — DOM controls and canvas view
- `src/document/` — sheet model and object transforms
- `src/image/` — raster preprocessing, centerline graph conversion, and the off-main-thread vectorization worker
- `src/text/` — offline font rendering and Hershey stroke-font data
- `src/svg/` — SVG import and unsupported-content reporting
- `src/gcode/` — plotter coordinate mapping and G-code output
- `tests/` — offline unit tests

SVG artwork retains supported vector paths and reports unsupported elements or effects instead of silently ignoring them. PNG and JPEG files can be traced into editable vector artwork before insertion. The trace dialog offers threshold, inversion, grayscale/color, noise removal, detail, and smoothing controls, and previews the exact SVG that will be inserted. Outline mode uses VTracer 1.0.0-alpha.4's spline vectorizer; centerline mode thresholds locally, uses OpenCV 4.13.0 `ximgproc::thinning` (Guo-Hall) and converts the skeleton into separate plotter paths with optional short-spur pruning. Both processors run in a Web Worker; all runtimes are local, and images above 4 megapixels are rejected. Trace results use the same SVG importer, object transforms, and G-code pipeline as other artwork. VTracer is MIT-licensed; OpenCV core/imgproc uses Apache-2.0 and ximgproc uses BSD-3-Clause. Notices are in `assets/licenses/`.

Export is refused if any flattened path leaves the paper or configured machine area.

Use **Text** to create multiline plotter text. The bundled outline and handwriting fonts are Anton, Bungee, Russo One, Kalam, and Patrick Hand (SIL Open Font License 1.1; license notices are in `assets/licenses/fonts/`). The stroke category uses public-domain Hershey Simplex, Gothic English, and Script Simplex data, with attribution/license notices in `assets/licenses/hershey-fonts.txt`; these are actual separate centreline strokes, not regular-font outlines. Font outlines are rendered locally with opentype.js (MIT, notice in `assets/licenses/opentype.js-MIT.txt`), and inserted text is converted through the normal SVG importer into editable geometry. The text tool currently supports printable ASCII plus spaces, tabs, and newlines; unsupported glyphs are reported instead of silently dropped.

Run `npm test` for document, exporter, WASM image-tracing, and text-rendering checks. The browser build bundles Paper.js and opentype.js locally; fonts, Hershey data, and raster-processing WASM are served from this repository, so the editor itself does not fetch remote assets or make network requests.
