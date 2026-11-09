const SUPPORTED = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const NON_RENDERING = new Set(["title", "desc", "metadata", "defs", "lineargradient", "radialgradient", "stop", "clippath", "symbol"]);
const URL_REFERENCE = /url\(\s*(['"]?)(?!#)[^)]+\1\s*\)/i;
const UNSUPPORTED_STYLES = new Set(["clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end", "stroke-dasharray"]);
const LENGTH_UNITS = Object.freeze({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 });

function physicalLength(value, fallback) {
  if (!value) return fallback;
  const match = String(value).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(mm|cm|in|pt|pc|px)?$/i);
  if (!match) return fallback;
  return Number(match[1]) * (LENGTH_UNITS[match[2]?.toLowerCase() ?? "px"] ?? 1);
}

function cleanSvg(source) {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") {
    throw new Error("This file is not a valid SVG document.");
  }
  const warnings = new Set();
  for (const element of [...parsed.querySelectorAll("*")].reverse()) {
    const tag = element.localName.toLowerCase();
    if (tag === "style") {
      if (/@import|url\(\s*(['"]?)(?!#)/i.test(element.textContent)) {
        warnings.add("External CSS resources were removed; only local vector geometry is imported.");
        element.remove();
      }
      continue;
    }
    if (NON_RENDERING.has(tag)) continue;
    if (!SUPPORTED.has(tag)) {
      warnings.add(`Unsupported <${tag}> content was excluded.`);
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        warnings.add("Embedded event handlers were removed.");
      } else if (name === "href" || name.endsWith(":href")) {
        if (!value.startsWith("#")) {
          element.removeAttribute(attribute.name);
          warnings.add("External image or linked artwork was removed.");
        } else {
          element.removeAttribute(attribute.name);
          warnings.add("Referenced artwork (<use>) is not supported and was excluded.");
        }
      } else if (URL_REFERENCE.test(value)) {
        element.removeAttribute(attribute.name);
        warnings.add("External paint or filter resources were removed.");
      } else if (UNSUPPORTED_STYLES.has(name)) {
        warnings.add(`The SVG ${name} effect is not represented in pen-plotter output.`);
      } else if (name === "style" && [...UNSUPPORTED_STYLES].some((property) => new RegExp(`(?:^|;)\\s*${property}\\s*:`).test(value))) {
        warnings.add("Unsupported SVG effects or dashed strokes are not represented in pen-plotter output.");
      }
    }
  }
  const root = parsed.documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const fallbackWidth = viewBox?.length === 4 && viewBox[2] > 0 ? viewBox[2] * LENGTH_UNITS.px : 100;
  const fallbackHeight = viewBox?.length === 4 && viewBox[3] > 0 ? viewBox[3] * LENGTH_UNITS.px : 100;
  const width = physicalLength(root.getAttribute("width"), fallbackWidth);
  const height = physicalLength(root.getAttribute("height"), fallbackHeight);
  if (!root.hasAttribute("viewBox") && !(root.hasAttribute("width") && root.hasAttribute("height"))) {
    warnings.add("No SVG viewBox or physical size was supplied; using the visible artwork bounds.");
  }
  return { source: new XMLSerializer().serializeToString(parsed), width, height, warnings: [...warnings] };
}

function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
  };
}

function transformedPoint(path, point) {
  const global = path.localToGlobal(point);
  return { x: global.x, y: global.y };
}

function collectPaths(item) {
  const shapes = item.className === "Path" ? [item] : item.getItems({ match: (child) => child.className === "Path" });
  const paths = [];
  for (const shape of shapes) {
    const curves = shape.curves;
    if (!curves.length) {
      const points = shape.segments.map((segment) => transformedPoint(shape, segment.point));
      if (points.length) paths.push({ points, closed: shape.closed });
      continue;
    }
    const points = [];
    for (const curve of curves) {
      const [a, b] = curve.segments;
      const p0 = transformedPoint(shape, a.point);
      const p1 = transformedPoint(shape, a.point.add(a.handleOut));
      const p3 = transformedPoint(shape, b.point);
      const p2 = transformedPoint(shape, b.point.add(b.handleIn));
      if (!points.length) points.push(p0);
      points.push(p1, p2, p3);
    }
    paths.push({ points, closed: shape.closed, cubic: true });
  }
  return paths;
}

export function importSvg(source, name, paperProject, makeId = () => crypto.randomUUID()) {
  const safe = cleanSvg(source);
  let item;
  try {
    item = paperProject.importSVG(safe.source, { insert: false, expandShapes: true });
  } catch (error) {
    error.warnings = safe.warnings;
    throw error;
  }
  if (!item || !item.bounds || item.bounds.width <= 0 || item.bounds.height <= 0) {
    const error = new Error("The SVG contains no supported visible vector geometry.");
    error.warnings = safe.warnings;
    throw error;
  }
  const bounds = item.bounds.clone();
  const scale = Math.min(safe.width / bounds.width, safe.height / bounds.height);
  item.scale(scale, bounds.topLeft);
  const normalizedBounds = item.bounds.clone();
  item.position = item.position.subtract(normalizedBounds.topLeft);
  const paths = collectPaths(item).map((path) => ({
    ...path,
    points: path.points.map((point) => ({ x: point.x, y: point.y }))
  }));
  if (paths.length === 0) {
    item.remove();
    const error = new Error("The SVG contains no supported visible vector paths.");
    error.warnings = safe.warnings;
    throw error;
  }
  const result = {
    id: makeId(),
    name,
    x: 10,
    y: 10,
    width: item.bounds.width,
    height: item.bounds.height,
    geometryWidth: item.bounds.width,
    geometryHeight: item.bounds.height,
    rotation: 0,
    paths,
    warnings: safe.warnings
  };
  item.remove();
  return result;
}

export function flattenCubicPaths(paths, tolerance) {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError("Curve tolerance must be greater than zero.");
  return paths.map((path) => {
    if (!path.cubic) return { points: path.points.map((p) => ({ ...p })), closed: path.closed };
    const points = [path.points[0]];
    for (let i = 1; i + 2 < path.points.length; i += 3) {
      const p0 = points.at(-1), p1 = path.points[i], p2 = path.points[i + 1], p3 = path.points[i + 2];
      const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      const polygon = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
      const steps = Math.max(2, Math.min(256, Math.ceil(Math.sqrt(Math.max(0, polygon - chord) / (8 * tolerance)) * 4)));
      for (let step = 1; step <= steps; step += 1) points.push(cubicAt(p0, p1, p2, p3, step / steps));
    }
    return { points, closed: path.closed };
  });
}
