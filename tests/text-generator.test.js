import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  generateHersheyTextSvg,
  generateOutlineTextSvg,
  parseOpenTypeFont,
  TEXT_FONTS
} from "../src/text/generator.js";
import { hersheyFonts } from "../src/text/hershey-fonts.js";

const options = { fontSize: 12, letterSpacing: 0, lineSpacing: 1.2, alignment: "left" };

async function loadFont(id) {
  const info = TEXT_FONTS.find((font) => font.id === id);
  const bytes = await readFile(new URL(`../assets/fonts/${info.source.replace("./assets/fonts/", "")}`, import.meta.url));
  return parseOpenTypeFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

test("outline and handwriting fonts convert text to self-contained glyph paths", async () => {
  for (const id of ["anton", "bungee", "russo-one", "kalam", "patrick-hand"]) {
    const font = await loadFont(id);
    const result = generateOutlineTextSvg(font, "Plotter 1!\nAV", options);
    assert.match(result.svg, /^<svg[^>]+viewBox=/);
    assert.match(result.svg, /<path d="M/);
    assert.ok(result.pathCount > 7);
    assert.equal(result.width > 0, true);
    assert.equal(result.height > 12, true);
  }
});

test("outline glyph paths preserve counters and alignment and spacing settings", async () => {
  const font = await loadFont("anton");
  const counter = generateOutlineTextSvg(font, "O", options);
  const left = generateOutlineTextSvg(font, "I\nWW", options);
  const center = generateOutlineTextSvg(font, "I\nWW", { ...options, alignment: "center", lineSpacing: 1.8 });
  const right = generateOutlineTextSvg(font, "I\nWW", { ...options, alignment: "right", letterSpacing: 2 });
  const firstPath = (svg) => Number(svg.match(/<path d="M([\d.-]+)/)[1]);

  const firstGlyph = counter.svg.match(/<path d="([^"]+)"/)[1];
  assert.equal((firstGlyph.match(/M/g) ?? []).length, 2);
  assert.ok(center.height > left.height);
  assert.ok(firstPath(center.svg) > firstPath(left.svg));
  assert.ok(firstPath(right.svg) > firstPath(left.svg));
});

test("unsupported conventional glyphs are reported instead of omitted", async () => {
  const font = await loadFont("anton");
  assert.throws(() => generateOutlineTextSvg(font, "A🙂B", options), /does not support.*U\+1F642/);
});

test("Hershey Simplex, Gothic, and Script emit separate real open strokes", () => {
  for (const id of ["futural", "gothiceng", "scripts"]) {
    const result = generateHersheyTextSvg(hersheyFonts[id], "A 1!?\nB", options);
    const paths = [...result.svg.matchAll(/<path\b/g)];
    assert.equal(paths.length, result.pathCount);
    assert.ok(paths.length > 7);
    assert.match(result.svg, /fill="none" stroke="#000"/);
    assert.doesNotMatch(result.svg, /fill="#000"/);
  }
});

test("stroke fonts reject unsupported characters and invalid layout options", () => {
  assert.throws(() => generateHersheyTextSvg(hersheyFonts.futural, "A λ", options), /does not support.*U\+3BB/);
  assert.throws(() => generateHersheyTextSvg(hersheyFonts.futural, "   ", options), /Enter some text/);
  assert.throws(() => generateHersheyTextSvg(hersheyFonts.futural, "A", { ...options, lineSpacing: 0 }), /Line spacing/);
});

