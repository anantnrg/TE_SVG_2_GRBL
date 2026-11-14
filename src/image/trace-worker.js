import { buildCenterlineTrace, prepareVectorPixels, thresholdImage } from "./tracer.js";

let vtracerPromise;
let openCvPromise;

async function loadVTracer() {
  if (!vtracerPromise) {
    vtracerPromise = (async () => {
      const moduleUrl = new URL("../assets/wasm/vtracer/te_svg_vtracer_wasm.js", self.location.href);
      const wasmUrl = new URL("../assets/wasm/vtracer/te_svg_vtracer_wasm_bg.wasm", self.location.href);
      const module = await import(moduleUrl.href);
      await module.default({ module_or_path: wasmUrl });
      return module;
    })();
  }
  return vtracerPromise;
}

async function loadOpenCvThinning() {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      const moduleUrl = new URL("../assets/wasm/opencv-thinning.mjs", self.location.href);
      const module = await import(moduleUrl.href);
      return module.default({
        locateFile: (path) => new URL(`../assets/wasm/${path}`, self.location.href).href
      });
    })();
  }
  return openCvPromise;
}

function traceOptions(options) {
  const detail = Math.max(1, Math.min(10, Math.round(options.detail ?? 6)));
  const smoothing = Math.max(0, Number(options.smoothing) || 0);
  const filterSpeckle = options.despeckle ? Math.max(1, Number(options.maxSpeckSize) || 1) : 0;
  return {
    detail,
    smoothing,
    filterSpeckle,
    maxSpeckArea: filterSpeckle ** 2
  };
}

async function outlineTrace(pixels, width, height, options) {
  const prepared = prepareVectorPixels(pixels, width, height, options);
  const { detail, smoothing, filterSpeckle } = traceOptions(options);
  const vtracer = await loadVTracer();
  const svg = vtracer.vectorize_rgba(prepared, width, height, {
    clustering: options.grayscale ? "bw" : "color-cluster",
    mode: "spline",
    binaryThreshold: Number(options.threshold),
    filterSpeckle,
    colorPrecision: Math.max(1, Math.min(8, 1 + Math.round((detail - 1) * 7 / 9))),
    ...(options.grayscale ? {} : { maxColors: 2 + Math.floor((detail - 1) * 6 / 9) }),
    simplify: smoothing
  });
  if (/<image\b/i.test(svg)) throw new Error("Vectorizer returned embedded raster content instead of paths.");
  const pathCount = (svg.match(/<path\b/gi) ?? []).length;
  if (!pathCount) throw new Error("No outline paths were found. Adjust threshold or detail settings.");
  return { svg, pathCount, width, height, mode: "outline" };
}

async function centerlineTrace(pixels, width, height, options) {
  const { detail, smoothing, maxSpeckArea } = traceOptions(options);
  const binary = thresholdImage(pixels, width, height, {
    threshold: Number(options.threshold),
    invert: Boolean(options.invert),
    grayscale: true,
    despeckle: Boolean(options.despeckle),
    maxSpeckArea
  });
  const openCv = await loadOpenCvThinning();
  const thinning = openCv.thin(binary, width, height, 1);
  if (thinning.error) throw new Error(thinning.error);
  const skeleton = thinning.pixels;
  const trace = buildCenterlineTrace(skeleton, width, height, {
    branchPruneLength: Math.round((10 - detail) / 2),
    smoothing
  });
  return { ...trace, pathCount: trace.paths.length };
}

async function processTrace({ id, pixels: buffer, width, height, options }) {
  try {
    const pixels = new Uint8ClampedArray(buffer);
    if (options.mode === "outline") {
      self.postMessage({ id, result: await outlineTrace(pixels, width, height, options) });
    } else if (options.mode === "centerline") {
      self.postMessage({ id, result: await centerlineTrace(pixels, width, height, options) });
    } else {
      throw new RangeError("Trace mode must be centerline or outline.");
    }
  } catch (error) {
    self.postMessage({ id, error: error.message || "Image tracing failed." });
  }
}

let latestRequest = null;
let processing = false;
self.addEventListener("message", ({ data }) => {
  latestRequest = data;
  if (processing) return;
  processing = true;
  void (async () => {
    while (latestRequest) {
      const request = latestRequest;
      latestRequest = null;
      await processTrace(request);
    }
    processing = false;
  })();
});
