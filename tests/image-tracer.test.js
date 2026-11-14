import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { thresholdImage, prepareVectorPixels, traceSkeleton, buildCenterlineTrace } from "../src/image/tracer.js";

const width = 24;
const height = 18;
let vtracer;
let openCv;

function raster(imageWidth, imageHeight, draw) {
  const rgba = new Uint8ClampedArray(imageWidth * imageHeight * 4);
  for (let pixel = 0; pixel < imageWidth * imageHeight; pixel += 1) {
    rgba[pixel * 4] = rgba[pixel * 4 + 1] = rgba[pixel * 4 + 2] = 255;
    rgba[pixel * 4 + 3] = 255;
  }
  draw((x, y, color = [0, 0, 0]) => {
    const offset = (y * imageWidth + x) * 4;
    rgba.set([...color, 255], offset);
  });
  return rgba;
}

function rectangle(draw, left, top, right, bottom, color) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) draw(x, y, color);
  }
}

function line(draw, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    draw(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const twiceError = 2 * error;
    if (twiceError >= dy) {
      error += dy;
      x0 += sx;
    }
    if (twiceError <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function pixelsWithThickLine() {
  return raster(width, height, (set) => rectangle(set, 3, 7, 20, 10));
}

function pathCount(svg) {
  return (svg.match(/<path\b/gi) ?? []).length;
}

before(async () => {
  const [vtracerModule, vtracerWasm] = await Promise.all([
    import("../assets/wasm/vtracer/te_svg_vtracer_wasm.js"),
    readFile(new URL("../assets/wasm/vtracer/te_svg_vtracer_wasm_bg.wasm", import.meta.url))
  ]);
  await vtracerModule.default({ module_or_path: vtracerWasm });
  vtracer = vtracerModule;

  const openCvModule = await import("../assets/wasm/opencv-thinning.mjs");
  openCv = await openCvModule.default({
    wasmBinary: await readFile(new URL("../assets/wasm/opencv-thinning.wasm", import.meta.url))
  });
});

test("binary preprocessing handles threshold, inversion, alpha, and despeckling", () => {
  const rgba = pixelsWithThickLine();
  const normal = thresholdImage(rgba, width, height, { threshold: 128 });
  assert.equal(normal[7 * width + 3], 1);
  assert.equal(normal[0], 0);
  assert.equal(thresholdImage(rgba, width, height, { threshold: 128, invert: true })[0], 1);

  const speckled = raster(5, 3, (set) => {
    set(1, 1);
    set(3, 1);
    set(4, 1);
  });
  const clean = thresholdImage(speckled, 5, 3, { despeckle: true, maxSpeckArea: 1 });
  assert.equal(clean[6], 0);
  assert.equal(clean[8], 1);

  const transparent = raster(1, 1, (set) => set(0, 0));
  transparent[3] = 0;
  assert.equal(thresholdImage(transparent, 1, 1)[0], 0);
});

test("raster preparation preserves color or applies grayscale and inversion", () => {
  const rgba = raster(1, 1, (set) => set(0, 0, [180, 40, 20]));
  const color = prepareVectorPixels(rgba, 1, 1, { grayscale: false });
  const gray = prepareVectorPixels(rgba, 1, 1);
  const inverted = prepareVectorPixels(rgba, 1, 1, { invert: true });
  assert.deepEqual([...color.slice(0, 3)], [180, 40, 20]);
  assert.ok(gray[0] === gray[1] && gray[1] === gray[2]);
  assert.deepEqual([...inverted.slice(0, 3)], [255 - gray[0], 255 - gray[1], 255 - gray[2]]);
});

test("OpenCV Zhang-Suen skeletonizes a thick line to one centerline path", () => {
  const binary = thresholdImage(pixelsWithThickLine(), width, height);
  const skeleton = openCv.thin(binary, width, height, 0).pixels;
  const trace = buildCenterlineTrace(skeleton, width, height, { smoothing: 0.6 });

  assert.equal(trace.paths.length, 1);
  assert.equal(trace.paths[0].closed, false);
  assert.ok(trace.paths[0].points.length >= 2);
  assert.match(trace.svg, /stroke="#000"/);
  assert.doesNotMatch(trace.svg, /<image\b/i);
});

test("OpenCV preserves a thin handwriting-like stroke as a single centerline path", () => {
  const pixels = raster(width, height, (set) => {
    const points = [[2, 13], [5, 6], [8, 4], [11, 12], [14, 11], [17, 5], [21, 12]];
    for (let index = 1; index < points.length; index += 1) {
      line(set, ...points[index - 1], ...points[index]);
    }
  });
  const skeleton = openCv.thin(thresholdImage(pixels, width, height), width, height, 1).pixels;
  const trace = buildCenterlineTrace(skeleton, width, height, { branchPruneLength: 1, smoothing: 0.4 });
  assert.equal(trace.paths.length, 1);
  assert.equal(trace.paths[0].closed, false);
  assert.ok(trace.paths[0].points.length > 4);
});

test("OpenCV Guo-Hall skeletonization preserves connected branches as distinct paths", () => {
  const pixels = raster(width, height, (set) => {
    rectangle(set, 3, 7, 20, 9);
    rectangle(set, 10, 2, 12, 9);
  });
  const skeleton = openCv.thin(thresholdImage(pixels, width, height), width, height, 1).pixels;
  const trace = buildCenterlineTrace(skeleton, width, height);

  assert.equal(trace.paths.length, 3);
  assert.ok(trace.paths.every(({ closed, points }) => !closed && points.length > 2));
});

test("OpenCV skeletonizes a filled ring into a connected loop rather than outline boundaries", () => {
  const pixels = raster(width, height, (set) => {
    for (let y = 3; y <= 14; y += 1) {
      for (let x = 5; x <= 18; x += 1) {
        if (x < 8 || x > 15 || y < 6 || y > 11) set(x, y);
      }
    }
  });
  const skeleton = openCv.thin(thresholdImage(pixels, width, height), width, height, 1).pixels;
  const trace = buildCenterlineTrace(skeleton, width, height, { branchPruneLength: 3 });
  assert.equal(trace.paths.length, 1);
  assert.equal(trace.paths[0].closed, true);
});

test("short terminal skeleton spurs can be pruned without removing the main path", () => {
  const binary = new Uint8Array(width * height);
  for (let x = 4; x <= 19; x += 1) binary[8 * width + x] = 1;
  binary[7 * width + 11] = 1;
  binary[6 * width + 11] = 1;
  const unpruned = traceSkeleton(binary, width, height);
  const pruned = traceSkeleton(binary, width, height, { branchPruneLength: 3 });
  assert.equal(unpruned.length, 3);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].points.length, 16);
});

test("VTracer emits vector outlines for line art, a ring, and color shapes", () => {
  const lineArt = pixelsWithThickLine();
  const outline = vtracer.vectorize_rgba(prepareVectorPixels(lineArt, width, height), width, height, {
    clustering: "bw",
    mode: "spline",
    binaryThreshold: 128,
    filterSpeckle: 0,
    simplify: 0.5
  });
  assert.ok(pathCount(outline) > 0);
  assert.doesNotMatch(outline, /<image\b/i);
  assert.match(outline, /<svg\b/);

  const ring = raster(width, height, (set) => {
    for (let y = 3; y <= 14; y += 1) {
      for (let x = 5; x <= 18; x += 1) {
        if (x < 8 || x > 15 || y < 6 || y > 11) set(x, y);
      }
    }
  });
  const ringSvg = vtracer.vectorize_rgba(prepareVectorPixels(ring, width, height), width, height, {
    clustering: "bw",
    mode: "spline",
    binaryThreshold: 128,
    filterSpeckle: 0
  });
  const ringPath = ringSvg.match(/<path\b[^>]*\bd="([^"]+)"/i)?.[1] ?? "";
  assert.ok((ringPath.match(/[Mm]/g) ?? []).length >= 2, "the ring's inner contour should remain a separate subpath");

  const colors = raster(width, height, (set) => {
    rectangle(set, 2, 4, 9, 13, [220, 30, 30]);
    rectangle(set, 14, 4, 21, 13, [20, 60, 220]);
  });
  const colorSvg = vtracer.vectorize_rgba(prepareVectorPixels(colors, width, height, { grayscale: false }), width, height, {
    clustering: "color-cluster",
    mode: "spline",
    filterSpeckle: 0,
    colorPrecision: 8,
    maxColors: 4
  });
  assert.ok(pathCount(colorSvg) >= 2);
  assert.doesNotMatch(colorSvg, /<image\b/i);
});

test("tracing reports empty, invalid, and unsupported input instead of returning success-shaped output", () => {
  assert.throws(() => thresholdImage(new Uint8Array(4), 4, 4), /dimensions or pixel data/);
  assert.throws(() => thresholdImage(pixelsWithThickLine(), width, height, { threshold: 300 }), /threshold/);
  assert.throws(() => buildCenterlineTrace(new Uint8Array(width * height), width, height), /No traceable centerline/);
  assert.match(openCv.thin(new Uint8Array(2), width, height, 0).error, /dimensions/);
});
