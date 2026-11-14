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
- `src/image/` — offline raster thresholding, cleanup, and vector tracing
- `src/text/` — offline font rendering and Hershey stroke-font data
- `src/svg/` — SVG import and unsupported-content reporting
- `src/gcode/` — plotter coordinate mapping and G-code output
- `tests/` — offline unit tests

SVG artwork retains supported vector paths and reports unsupported elements or effects instead of silently ignoring them. PNG and JPEG files can be traced into editable vector artwork before insertion. The trace dialog offers threshold, inversion, grayscale, and small-speck removal controls, plus centerline tracing for single-stroke line art or outline tracing for filled regions. Image processing is local and offline; images above 4 megapixels are rejected. Centerline tracing is best for clean, narrow strokes, while rasterized outlines are approximations and overly detailed outlines are rejected rather than exhausting memory. G-code export continues to use the same vector paths for both imported SVG and traced images; fills, text, hatching, and plotter control are not generated.

Export is refused if any flattened path leaves the paper or configured machine area.

Use **Text** to create multiline plotter text. The bundled outline and handwriting fonts are Anton, Bungee, Russo One, Kalam, and Patrick Hand (SIL Open Font License 1.1; license notices are in `assets/licenses/fonts/`). The stroke category uses public-domain Hershey Simplex, Gothic English, and Script Simplex data, with attribution/license notices in `assets/licenses/hershey-fonts.txt`; these are actual separate centreline strokes, not regular-font outlines. Font outlines are rendered locally with opentype.js (MIT, notice in `assets/licenses/opentype.js-MIT.txt`), and inserted text is converted through the normal SVG importer into editable geometry. The text tool currently supports printable ASCII plus spaces, tabs, and newlines; unsupported glyphs are reported instead of silently dropped.

Run `npm test` for document, exporter, image-tracing, and text-rendering checks. The browser build bundles Paper.js and opentype.js locally; fonts and Hershey data are served from this repository, so the editor itself does not fetch remote assets or make network requests.
