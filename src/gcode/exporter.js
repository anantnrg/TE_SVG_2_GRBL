import { flattenCubicPaths } from "../svg/importer.js";

function assertPositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be a positive finite number.`);
}

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number.`);
}

function transformedPath(object, path) {
  const scaleX = object.width / object.geometryWidth;
  const scaleY = object.height / object.geometryHeight;
  const angle = object.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = object.width / 2, cy = object.height / 2;
  return {
    points: path.points.map(({ x, y }) => {
      const localX = x * scaleX - cx;
      const localY = y * scaleY - cy;
      return {
        x: object.x + cx + localX * cos - localY * sin,
        y: object.y + cy + localX * sin + localY * cos
      };
    }),
    closed: path.closed
  };
}

function physicalPoint(point, config) {
  const originY = config.origin === "bottom-left" ? config.machineHeight : 0;
  const machineY = originY + (config.yDirection === "up" ? -point.y : point.y);
  return { x: point.x, y: machineY };
}

function nearestOrdered(paths) {
  const remaining = paths.filter((path) => path.points.length > 1).map((path) => ({ ...path, points: [...path.points] }));
  const ordered = [];
  let current = { x: 0, y: 0 };
  while (remaining.length) {
    let bestIndex = 0, reverse = false, bestDistance = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const path = remaining[index];
      const first = path.points[0], last = path.points.at(-1);
      const startDistance = (first.x - current.x) ** 2 + (first.y - current.y) ** 2;
      const endDistance = (last.x - current.x) ** 2 + (last.y - current.y) ** 2;
      const reverseCandidate = !path.closed && endDistance < startDistance;
      const distance = Math.min(startDistance, endDistance);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
        reverse = reverseCandidate;
      }
    }
    const [path] = remaining.splice(bestIndex, 1);
    if (reverse) path.points.reverse();
    ordered.push(path);
    current = path.points.at(-1);
  }
  return ordered;
}

function fmt(value) {
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function generateGcode(objects, config) {
  assertPositive(config.paperWidth, "Paper width");
  assertPositive(config.paperHeight, "Paper height");
  assertPositive(config.machineWidth, "Plotter width");
  assertPositive(config.machineHeight, "Plotter height");
  assertPositive(config.travelFeed, "Travel speed");
  assertPositive(config.drawFeed, "Drawing speed");
  if (!Number.isFinite(config.tolerance) || config.tolerance < 0.01 || config.tolerance > 5) {
    throw new RangeError("Curve tolerance must be between 0.01 and 5 mm.");
  }
  if (!Number.isFinite(config.penUp) || !Number.isFinite(config.penDown) || config.penUp === config.penDown) {
    throw new RangeError("Pen-up and pen-down positions must be finite and different.");
  }
  if (!["bottom-left", "top-left"].includes(config.origin)) throw new RangeError("Origin must be top-left or bottom-left.");
  if (!["up", "down"].includes(config.yDirection)) throw new RangeError("Y direction must be up or down.");

  const workWidth = Math.min(config.paperWidth, config.machineWidth);
  const workHeight = Math.min(config.paperHeight, config.machineHeight);
  const flattened = [];
  for (const object of objects) {
    assertPositive(object.width, `Width of ${object.name}`);
    assertPositive(object.height, `Height of ${object.name}`);
    assertPositive(object.geometryWidth, `Geometry width of ${object.name}`);
    assertPositive(object.geometryHeight, `Geometry height of ${object.name}`);
    assertFinite(object.x, `X position of ${object.name}`);
    assertFinite(object.y, `Y position of ${object.name}`);
    assertFinite(object.rotation, `Rotation of ${object.name}`);
    const scale = Math.max(object.width / object.geometryWidth, object.height / object.geometryHeight);
    const paths = flattenCubicPaths(object.paths, config.tolerance / scale).map((path) => transformedPath(object, path));
    for (const path of paths) {
      if (path.points.length < 2) continue;
      for (const point of path.points) {
        const epsilon = 1e-7;
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
            point.x < -epsilon || point.y < -epsilon || point.x > workWidth + epsilon || point.y > workHeight + epsilon) {
          throw new RangeError(`“${object.name}” extends beyond the paper or plotter bounds; move or resize it before export.`);
        }
        const outputPoint = physicalPoint(point, config);
        if (outputPoint.y < -epsilon || outputPoint.y > config.machineHeight + epsilon) {
          throw new RangeError(`The selected origin and Y direction place “${object.name}” outside plotter bounds.`);
        }
      }
      flattened.push(path);
    }
  }
  if (!flattened.length) throw new Error("There are no drawable paths to export.");

  const ordered = nearestOrdered(flattened);
  const lines = [
    "; TE SVG 2 GRBL — pen plotter job",
    `; Sheet ${fmt(config.paperWidth)} x ${fmt(config.paperHeight)} mm`,
    `; Plotter ${fmt(config.machineWidth)} x ${fmt(config.machineHeight)} mm`,
    `; Curve tolerance ${fmt(config.tolerance)} mm`,
    "G21 ; millimetres",
    "G90 ; absolute coordinates",
    "G17 ; XY plane",
    "G94 ; feed per minute",
    `G0 Z${fmt(config.penUp)} F${fmt(config.travelFeed)}`,
    "G0 X0 Y0"
  ];
  for (const path of ordered) {
    const start = physicalPoint(path.points[0], config);
    if (path.closed && path.points.length > 2) path.points.push({ ...path.points[0] });
    lines.push(`G0 X${fmt(start.x)} Y${fmt(start.y)}`);
    lines.push(`G1 Z${fmt(config.penDown)} F${fmt(config.drawFeed)}`);
    for (const point of path.points.slice(1)) {
      const output = physicalPoint(point, config);
      lines.push(`G1 X${fmt(output.x)} Y${fmt(output.y)} F${fmt(config.drawFeed)}`);
    }
    lines.push(`G0 Z${fmt(config.penUp)} F${fmt(config.travelFeed)}`);
  }
  lines.push("M2 ; end of job", "");
  return lines.join("\n");
}

export function estimateCoverage(objects, paperWidth, paperHeight) {
  const area = paperWidth * paperHeight;
  if (area <= 0) return 0;
  let length = 0;
  for (const object of objects) {
    const scale = Math.max(object.width / object.geometryWidth, object.height / object.geometryHeight);
    for (const path of flattenCubicPaths(object.paths, 0.25 / scale)) {
      for (let index = 1; index < path.points.length; index += 1) {
        const a = path.points[index - 1], b = path.points[index];
        length += Math.hypot(
          (b.x - a.x) * object.width / object.geometryWidth,
          (b.y - a.y) * object.height / object.geometryHeight
        );
      }
      if (path.closed && path.points.length > 1) {
        const first = path.points[0], last = path.points.at(-1);
        length += Math.hypot(
          (first.x - last.x) * object.width / object.geometryWidth,
          (first.y - last.y) * object.height / object.geometryHeight
        );
      }
    }
  }
  return Math.min(100, length * 0.3 / area * 100);
}
