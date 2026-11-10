import test from "node:test";
import assert from "node:assert/strict";
import { AppController } from "../src/ui/controller.js";

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

function installDocument(elements, createElement = () => ({})) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById: (id) => elements[id],
      createElement
    }
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  };
}

function makeExportController(elements) {
  const controller = Object.create(AppController.prototype);
  controller.model = { objects: [square], width: 210, height: 297 };
  controller.config = () => config;
  controller.showWarning = () => {};
  return controller;
}

test("export opens a read-only preview without downloading", () => {
  let opened = false;
  const elements = {
    "gcode-preview": { value: "" },
    "export-summary": { textContent: "" },
    "export-dialog": { showModal: () => { opened = true; } }
  };
  const restore = installDocument(elements);
  try {
    const controller = makeExportController(elements);
    let downloadCount = 0;
    controller.download = () => { downloadCount += 1; };

    controller.export();

    assert.equal(opened, true);
    assert.match(elements["gcode-preview"].value, /G21 ; millimetres/);
    assert.match(elements["export-summary"].textContent, /drawing moves/);
    assert.equal(downloadCount, 0);
  } finally {
    restore();
  }
});

test("copy action writes the generated G-code to the clipboard", async () => {
  const writes = [];
  const messages = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text) => writes.push(text) } }
  });
  const elements = { "copy-gcode": { textContent: "Copy G-code" } };
  const restore = installDocument(elements);
  try {
    const controller = Object.create(AppController.prototype);
    controller.lastGcode = "G21\nM2\n";
    controller.showWarning = (message) => messages.push(message);

    await controller.copyGcode();

    assert.deepEqual(writes, ["G21\nM2\n"]);
    assert.deepEqual(messages, ["G-code copied to clipboard."]);
  } finally {
    restore();
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  }
});

test("copy action reports when clipboard access is unavailable", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {}
  });
  const elements = { "copy-gcode": { textContent: "Copy G-code" } };
  const restore = installDocument(elements);
  try {
    const controller = Object.create(AppController.prototype);
    controller.lastGcode = "G21\nM2\n";
    let warning = "";
    controller.showWarning = (message, error) => { warning = { message, error }; };

    await controller.copyGcode();

    assert.match(warning.message, /Clipboard access is unavailable/);
    assert.equal(warning.error, true);
    assert.equal(elements["copy-gcode"].textContent, "Copy failed");
  } finally {
    restore();
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  }
});

test("download action creates the G-code file only when invoked", () => {
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  const previousSetTimeout = globalThis.setTimeout;
  let clicked = false;
  let warning = "";
  URL.createObjectURL = (blob) => {
    assert.equal(blob.type, "text/plain;charset=utf-8");
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  globalThis.setTimeout = (callback) => { callback(); };
  const restore = installDocument({}, () => ({
    click: () => { clicked = true; }
  }));
  try {
    const controller = Object.create(AppController.prototype);
    controller.lastGcode = "G21\nM2\n";
    controller.showWarning = (message) => { warning = message; };

    controller.download();

    assert.equal(clicked, true);
    assert.equal(warning, "G-code download started.");
  } finally {
    restore();
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
    globalThis.setTimeout = previousSetTimeout;
  }
});
