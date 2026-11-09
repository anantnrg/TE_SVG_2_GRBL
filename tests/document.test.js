import test from "node:test";
import assert from "node:assert/strict";
import { DocumentModel, paperDimensions } from "../src/document/model.js";

test("A-series paper dimensions respect orientation", () => {
  assert.deepEqual(paperDimensions("A4", "landscape"), { width: 297, height: 210 });
  assert.deepEqual(paperDimensions("A3", "portrait"), { width: 297, height: 420 });
});

test("custom dimensions reject invalid values", () => {
  assert.throws(() => paperDimensions("custom", "portrait", 0, 100), /positive finite/);
});

test("document selection, duplication and removal stay consistent", () => {
  const document = new DocumentModel();
  document.add({ id: "one", name: "Square", x: 1, y: 1, width: 10, height: 10, rotation: 0, paths: [{ points: [{ x: 0, y: 0 }] }] });
  const copy = document.duplicate("one", () => "two");
  assert.equal(document.selectedId, "two");
  assert.equal(copy.x, 6);
  assert.equal(copy.paths[0].points[0].x, 0);
  document.remove();
  assert.equal(document.selectedId, "one");
});

test("rotated object extents are included in paper overflow", () => {
  const document = new DocumentModel(20, 20);
  document.add({ id: "wide", name: "Wide", x: 2, y: 2, width: 18, height: 3, rotation: 45 });
  assert.equal(document.outOfBounds.length, 1);
});
