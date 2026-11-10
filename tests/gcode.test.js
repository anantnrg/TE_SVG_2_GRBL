import test from "node:test";
import assert from "node:assert/strict";
import { generateGcode } from "../src/gcode/exporter.js";
import { flattenCubicPaths } from "../src/svg/importer.js";

const config = {
  paperWidth: 210, paperHeight: 297, machineWidth: 210, machineHeight: 297,
  origin: "bottom-left", yDirection: "up", penUp: 5, penDown: 0,
  travelFeed: 3000, drawFeed: 1200, tolerance: 0.25
};
const square = {
  id: "square", name: "Square", x: 10, y: 20, width: 10, height: 10,
  geometryWidth: 10, geometryHeight: 10, rotation: 0,
  paths: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true }]
};

test("exports a closed outline in absolute millimetre coordinates with safe pen moves", () => {
  const output = generateGcode([square], config);
  assert.match(output, /G21 ; millimetres/);
  assert.match(output, /G90 ; absolute coordinates/);
  assert.match(output, /G0 Z5 F3000/);
  assert.match(output, /G1 Z0 F1200/);
  assert.match(output, /G1 X20 Y277 F1200/);
  assert.match(output, /M2 ; end of job/);
  assert.ok(output.indexOf("G0 Z5") < output.indexOf("G1 Z0"));
});

test("maps top-left downward machine coordinates and rejects inconsistent Y axes", () => {
  const topLeft = generateGcode([square], { ...config, origin: "top-left", yDirection: "down" });
  assert.match(topLeft, /G0 X10 Y20/);
  assert.throws(() => generateGcode([square], { ...config, origin: "top-left", yDirection: "up" }), /outside plotter bounds/);
});

test("refuses any geometry outside paper or machine bounds", () => {
  assert.throws(() => generateGcode([{ ...square, x: 205 }], config), /extends beyond/);
  assert.throws(() => generateGcode([square], { ...config, machineWidth: 15 }), /extends beyond/);
});

test("refuses non-finite geometry and out-of-range flattening tolerance", () => {
  assert.throws(() => generateGcode([{ ...square, x: Number.NaN }], config), /finite number/);
  assert.throws(() => generateGcode([square], { ...config, tolerance: 0.001 }), /between 0.01 and 5/);
});

test("applies object scaling and rotation before export", () => {
  const output = generateGcode([{ ...square, x: 30, y: 30, width: 20, height: 20, rotation: 90 }], config);
  assert.match(output, /G0 X50 Y267/);
});

test("curve flattening honors tighter tolerance with denser samples", () => {
  const path = { cubic: true, closed: false, points: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }] };
  const coarse = flattenCubicPaths([path], 1)[0].points;
  const fine = flattenCubicPaths([path], 0.1)[0].points;
  assert.ok(fine.length > coarse.length);
  assert.deepEqual(fine[0], path.points[0]);
  assert.deepEqual(fine.at(-1), path.points.at(-1));
});
