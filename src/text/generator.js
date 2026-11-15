import opentype from "opentype.js";
import { hersheyFonts } from "./hershey-fonts.js";

export const TEXT_FONT_CATEGORIES = Object.freeze([
  {
    id: "outline",
    label: "Outline / block fonts",
    description: "Glyph contours; letters are drawn around their outlines.",
    fonts: [
      { id: "anton", label: "Anton", kind: "outline", source: "./assets/fonts/anton/Anton-Regular.ttf" },
      { id: "bungee", label: "Bungee", kind: "outline", source: "./assets/fonts/bungee/Bungee-Regular.ttf" },
      { id: "russo-one", label: "Russo One", kind: "outline", source: "./assets/fonts/russoone/RussoOne-Regular.ttf" }
    ]
  },
  {
    id: "stroke",
    label: "Single-line / stroke fonts",
    description: "Real Hershey engraving-font centreline strokes.",
    fonts: [
      { id: "hershey-simplex", label: "Hershey Simplex (Sans)", kind: "hershey", data: "futural" },
      { id: "hershey-gothic", label: "Hershey Gothic English", kind: "hershey", data: "gothiceng" },
      { id: "hershey-script", label: "Hershey Script Simplex", kind: "hershey", data: "scripts" }
    ]
  },
  {
    id: "handwriting",
    label: "Handwriting fonts",
    description: "Handwritten glyph contours; these are not single-line strokes.",
    fonts: [
      { id: "kalam", label: "Kalam", kind: "outline", source: "./assets/fonts/kalam/Kalam-Regular.ttf" },
      { id: "patrick-hand", label: "Patrick Hand", kind: "outline", source: "./assets/fonts/patrickhand/PatrickHand-Regular.ttf" }
    ]
  }
]);

export const TEXT_FONTS = Object.freeze(TEXT_FONT_CATEGORIES.flatMap((category) =>
  category.fonts.map((font) => Object.freeze({ ...font, category: category.id }))
));

export function parseOpenTypeFont(buffer) {
  return opentype.parse(buffer);
}

function assertTextOptions(text, { fontSize, letterSpacing, lineSpacing, alignment }) {
  if (!text.trim()) throw new Error("Enter some text to preview and insert.");
  if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 500) {
    throw new RangeError("Font size must be greater than 0 and no more than 500 mm.");
  }
  if (!Number.isFinite(letterSpacing) || Math.abs(letterSpacing) > 500) {
    throw new RangeError("Letter spacing must be between −500 and 500 mm.");
  }
  if (!Number.isFinite(lineSpacing) || lineSpacing < 0.5 || lineSpacing > 4) {
    throw new RangeError("Line spacing must be between 0.5× and 4×.");
  }
  if (!["left", "center", "right"].includes(alignment)) {
    throw new RangeError("Text alignment must be left, center, or right.");
  }
}

function normalizedLines(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
}

function svgRoot(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function alignmentOffset(alignment, containerWidth, lineWidth) {
  if (alignment === "center") return (containerWidth - lineWidth) / 2;
  if (alignment === "right") return containerWidth - lineWidth;
  return 0;
}

function validateGlyph(font, character) {
  const glyph = font.charToGlyph(character);
  if (!glyph || glyph.index === 0) {
    throw new Error(`The selected font does not support “${character}” (U+${character.codePointAt(0).toString(16).toUpperCase()}).`);
  }
  return glyph;
}

export function generateOutlineTextSvg(font, text, options) {
  const settings = { fontSize: 12, letterSpacing: 0, lineSpacing: 1.2, alignment: "left", ...options };
  assertTextOptions(text, settings);
  const scale = settings.fontSize / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const lineHeight = (font.ascender - font.descender) * scale * settings.lineSpacing;
  const lines = normalizedLines(text).map((line) => {
    const characters = [...line];
    const glyphs = characters.map((character) => validateGlyph(font, character));
    let width = 0;
    for (let index = 0; index < glyphs.length; index += 1) {
      width += glyphs[index].advanceWidth * scale;
      if (index + 1 < glyphs.length) {
        width += (font.getKerningValue?.(glyphs[index], glyphs[index + 1]) ?? 0) * scale + settings.letterSpacing;
      }
    }
    return { glyphs, width };
  });
  const width = Math.max(...lines.map((line) => line.width), settings.fontSize * 0.25);
  const height = Math.max(settings.fontSize, lineHeight * lines.length);
  const body = [];
  let pathCount = 0;
  lines.forEach((line, lineIndex) => {
    let x = alignmentOffset(settings.alignment, width, line.width);
    const baseline = ascent + lineIndex * lineHeight;
    line.glyphs.forEach((glyph, index) => {
      if (glyph.index !== font.charToGlyph(" ").index && glyph.path.commands.length) {
        const path = glyph.getPath(x, baseline, settings.fontSize).toPathData(3);
        if (path) {
          body.push(`<path d="${path}" fill="#000" fill-rule="evenodd"/>`);
          pathCount += glyph.path.commands.filter((command) => command.type === "M").length;
        }
      }
      x += glyph.advanceWidth * scale;
      if (index + 1 < line.glyphs.length) {
        x += (font.getKerningValue?.(glyph, line.glyphs[index + 1]) ?? 0) * scale + settings.letterSpacing;
      }
    });
  });
  if (!pathCount) throw new Error("The text contains no drawable glyphs in this font.");
  return { svg: svgRoot(width, height, body.join("")), width, height, pathCount };
}

function hersheyCharacter(font, character) {
  if (character === " ") return { data: null, advance: 10 };
  const code = character.codePointAt(0);
  if (code < 33 || code > 126) {
    throw new Error(`The selected Hershey font does not support “${character}” (U+${code.toString(16).toUpperCase()}).`);
  }
  const data = font.chars[String(code - 33)];
  if (!data) {
    throw new Error(`The selected Hershey font does not support “${character}” (U+${code.toString(16).toUpperCase()}).`);
  }
  return { data, advance: Number(data.o) };
}

function hersheyStrokes(data, xOffset, yOffset, scale) {
  const strokes = [];
  for (const match of data.matchAll(/([ML])\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
    const [, command, x, y] = match;
    const point = `${(xOffset + Number(x) * scale).toFixed(3)} ${(yOffset + Number(y) * scale).toFixed(3)}`;
    if (command === "M") strokes.push(`M ${point}`);
    else strokes[strokes.length - 1] += ` L ${point}`;
  }
  return strokes.filter((stroke) => /L/.test(stroke));
}

export function generateHersheyTextSvg(fontData, text, options) {
  const settings = { fontSize: 12, letterSpacing: 0, lineSpacing: 1.2, alignment: "left", ...options };
  assertTextOptions(text, settings);
  const scale = settings.fontSize / 22;
  const lineHeight = settings.fontSize * settings.lineSpacing;
  const lines = normalizedLines(text).map((line) => {
    const characters = [...line].map((character) => hersheyCharacter(fontData, character));
    const width = characters.reduce((sum, character, index) =>
      sum + character.advance * scale + (index + 1 < characters.length ? settings.letterSpacing : 0), 0);
    return { characters, width };
  });
  const width = Math.max(...lines.map((line) => line.width), settings.fontSize * 0.25);
  const height = Math.max(settings.fontSize, lineHeight * lines.length);
  const body = [];
  for (const [lineIndex, line] of lines.entries()) {
    let x = alignmentOffset(settings.alignment, width, line.width);
    for (let index = 0; index < line.characters.length; index += 1) {
      const { data, advance } = line.characters[index];
      if (data?.d) {
        const y = lineIndex * lineHeight;
        for (const stroke of hersheyStrokes(data.d, x, y, scale)) {
          body.push(`<path d="${stroke}" fill="none" stroke="#000" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
      }
      x += advance * scale + (index + 1 < line.characters.length ? settings.letterSpacing : 0);
    }
  }
  if (!body.length) throw new Error("The text contains no drawable strokes in this font.");
  return { svg: svgRoot(width, height, body.join("")), width, height, pathCount: body.length };
}

export function generateTextSvg(fontId, font, text, options) {
  const selected = TEXT_FONTS.find((item) => item.id === fontId);
  if (!selected) throw new Error("Select an available text font.");
  return selected.kind === "hershey"
    ? generateHersheyTextSvg(hersheyFonts[selected.data], text, options)
    : generateOutlineTextSvg(font, text, options);
}
