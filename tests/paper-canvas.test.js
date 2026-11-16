import test from "node:test";
import assert from "node:assert/strict";
import { PaperCanvas } from "../src/ui/paper-canvas.js";

function drawPaper(plotterWidth, plotterHeight) {
  const paths = [];
  class Rectangle {
    constructor(x, y, width, height) {
      Object.assign(this, { x, y, width, height });
    }
  }
  class RectanglePath {
    constructor(rectangle) {
      this.rectangle = rectangle;
      this.data = {};
      paths.push(this);
    }
  }

  const canvas = Object.create(PaperCanvas.prototype);
  Object.assign(canvas, {
    model: { width: 210, height: 297, objects: [], selected: null },
    scope: {
      Path: { Rectangle: RectanglePath },
      Rectangle,
      Matrix: class {},
      project: { activeLayer: { removeChildren() {} }, view: { update() {} } },
      view: { viewSize: { width: 600, height: 800 } }
    },
    canvas: { dataset: {} },
    plotterWidth,
    plotterHeight,
    zoom: 1,
    panX: 0,
    panY: 0
  });
  canvas.draw();
  return paths;
}

test("paper preview marks the portion that fits the plotter", () => {
  const paths = drawPaper(120, 180);

  assert.equal(paths.length, 2);
  assert.deepEqual(
    [paths[1].rectangle.x, paths[1].rectangle.y, paths[1].rectangle.width, paths[1].rectangle.height],
    [45, 58.5, 120, 180]
  );
  assert.equal(paths[1].data.role, "plotter-bounds");
  assert.ok(paths[1].dashArray.length > 0);
});

test("paper preview omits a separate boundary when the whole sheet is plottable", () => {
  const paths = drawPaper(300, 400);

  assert.equal(paths.length, 1);
});

function makeInteractionCanvas(object) {
  const model = {
    width: 200,
    height: 100,
    objects: [object],
    selectedId: object.id,
    get selected() {
      return this.objects.find((item) => item.id === this.selectedId) ?? null;
    },
    select(id) {
      this.selectedId = id;
    }
  };
  const canvas = Object.create(PaperCanvas.prototype);
  Object.assign(canvas, {
    model,
    canvas: { setPointerCapture() {}, dataset: {} },
    scale: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    aspectLocked: () => true,
    nextPoint: { x: 0, y: 0 },
    screenPoint: () => ({ x: 0, y: 0 }),
    screenToPaper() {
      return this.nextPoint;
    },
    draw() {},
    onChange() {}
  });
  return canvas;
}

function squareObject() {
  return {
    id: "object",
    x: 20,
    y: 30,
    width: 40,
    height: 20,
    geometryWidth: 40,
    geometryHeight: 20,
    rotation: 0,
    paths: []
  };
}

test("moving snaps each axis independently and both axes together to the sheet center", () => {
  const object = squareObject();
  const canvas = makeInteractionCanvas(object);
  canvas.drag = { mode: "move", x: 20, y: 30, start: { x: 0, y: 0 } };
  canvas.nextPoint = { x: 64, y: 0 };

  canvas.pointerMove({});

  assert.equal(object.x, 80);
  assert.equal(object.y, 30);
  assert.deepEqual(canvas.snapGuides, { x: true, y: false });

  canvas.drag = { mode: "move", x: 20, y: 30, start: { x: 0, y: 0 } };
  canvas.nextPoint = { x: 64, y: 16 };

  canvas.pointerMove({});

  assert.equal(object.x, 80);
  assert.equal(object.y, 40);
  assert.deepEqual(canvas.snapGuides, { x: true, y: true });
});

test("all four resize handles keep the opposite corner fixed", () => {
  for (let corner = 0; corner < 4; corner += 1) {
    const object = squareObject();
    object.rotation = 30;
    const canvas = makeInteractionCanvas(object);
    const corners = canvas.objectCorners(object);
    const anchorIndex = (corner + 2) % 4;
    const anchor = corners[anchorIndex];
    const signX = corner === 0 || corner === 3 ? -1 : 1;
    const signY = corner === 0 || corner === 1 ? -1 : 1;
    const angle = object.rotation * Math.PI / 180;
    canvas.nextPoint = corners[corner];

    canvas.pointerDown({ pointerId: corner });
    canvas.nextPoint = {
      x: anchor.x + signX * 50 * Math.cos(angle) - signY * 25 * Math.sin(angle),
      y: anchor.y + signX * 50 * Math.sin(angle) + signY * 25 * Math.cos(angle)
    };
    canvas.pointerMove({});

    const resizedCorners = canvas.objectCorners(object);
    assert.ok(Math.abs(object.width - 50) < 1e-8, `corner ${corner}: ${object.width} × ${object.height}`);
    assert.ok(Math.abs(object.height - 25) < 1e-8, `corner ${corner}: ${object.width} × ${object.height}`);
    assert.ok(Math.abs(resizedCorners[anchorIndex].x - anchor.x) < 1e-8);
    assert.ok(Math.abs(resizedCorners[anchorIndex].y - anchor.y) < 1e-8);
  }
});
