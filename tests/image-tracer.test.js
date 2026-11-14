import test from "node:test";
import assert from "node:assert/strict";
import { thresholdImage, traceImage } from "../src/image/tracer.js";

function raster(width, height, points = []) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = rgba[pixel * 4 + 1] = rgba[pixel * 4 + 2] = 255;
    rgba[pixel * 4 + 3] = 255;
  }
  for (const [x, y] of points) {
    const offset = (y * width + x) * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
  }
  return rgba;
}

test("thresholding supports inversion, luminance mode, and despeckling", () => {
  const rgba = raster(5, 3, [[1, 1], [3, 1], [4, 1]]);
  rgba[(1 * 5 + 2) * 4] = 200;
  const normal = thresholdImage(rgba, 5, 3, { threshold: 128 });
  assert.equal(normal[6], 1);
  assert.equal(normal[7], 0);
  assert.equal(thresholdImage(rgba, 5, 3, { threshold: 128, invert: true })[6], 0);
  const cleaned = thresholdImage(rgba, 5, 3, { threshold: 128, despeckle: true, maxSpeckArea: 1 });
  assert.equal(cleaned[6], 0);
  assert.equal(cleaned[8], 1);
  const colored = raster(1, 1);
  colored[0] = 90;
  colored[1] = 30;
  colored[2] = 30;
  assert.equal(thresholdImage(colored, 1, 1, { threshold: 50, grayscale: true })[0], 1);
  assert.equal(thresholdImage(colored, 1, 1, { threshold: 50, grayscale: false })[0], 0);
  const transparent = raster(1, 1);
  transparent[0] = transparent[1] = transparent[2] = 0;
  transparent[3] = 0;
  assert.equal(thresholdImage(transparent, 1, 1)[0], 0);
});

test("centerline tracing reduces a thick line to one open path", () => {
  const points = [];
  for (let y = 3; y <= 5; y += 1) for (let x = 2; x <= 10; x += 1) points.push([x, y]);
  const trace = traceImage(raster(14, 9, points), 14, 9, { mode: "centerline", threshold: 128 });

  assert.equal(trace.paths.length, 1);
  assert.equal(trace.paths[0].closed, false);
  assert.ok(trace.paths[0].points.length >= 5);
  assert.match(trace.svg, /stroke="#000"/);
  assert.doesNotMatch(trace.svg, /fill="#000"/);
});

test("centerline tracing preserves a branch without duplicate diagonal segments", () => {
  const points = [];
  for (let y = 5; y <= 7; y += 1) for (let x = 5; x <= 19; x += 1) points.push([x, y]);
  for (let y = 5; y <= 19; y += 1) for (let x = 11; x <= 13; x += 1) points.push([x, y]);
  const trace = traceImage(raster(25, 25, points), 25, 25, { mode: "centerline", threshold: 128 });

  assert.equal(trace.paths.length, 3);
  assert.ok(trace.paths.every(({ points: line }) => line.length > 3));
});

test("outline tracing follows both boundaries of a filled logo and emits curves", () => {
  const points = [];
  for (let y = 1; y <= 9; y += 1) {
    for (let x = 1; x <= 9; x += 1) {
      if (x <= 2 || x >= 8 || y <= 2 || y >= 8) points.push([x, y]);
    }
  }
  const trace = traceImage(raster(11, 11, points), 11, 11, { mode: "outline", threshold: 128 });

  assert.equal(trace.paths.length, 2);
  assert.ok(trace.paths.every(({ closed }) => closed));
  assert.match(trace.svg, /fill-rule="evenodd"/);
  assert.match(trace.svg, / C /);
});

test("trace errors are explicit for blank and invalid input", () => {
  assert.throws(() => traceImage(raster(4, 4), 4, 4), /No traceable artwork/);
  assert.throws(() => thresholdImage(new Uint8Array(4), 4, 4), /dimensions or pixel data/);
  assert.throws(() => traceImage(raster(4, 4, [[1, 1]]), 4, 4, { mode: "unknown" }), /Trace mode/);
});
