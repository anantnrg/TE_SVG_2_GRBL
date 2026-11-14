const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1], [1, 0],
  [1, 1], [0, 1], [-1, 1], [-1, 0]
];

function validateRaster(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 4_000_000 || rgba.length !== width * height * 4) {
    throw new RangeError("Image dimensions or pixel data are not supported.");
  }
}

function removeSmallComponents(binary, width, height, maxArea) {
  if (!Number.isInteger(maxArea) || maxArea < 1) throw new RangeError("Noise removal area must be a positive integer.");
  const seen = new Uint8Array(binary.length);
  const queue = new Int32Array(binary.length);
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || seen[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (binary[next] && !seen[next]) {
            seen[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    if (tail <= maxArea) for (let index = 0; index < tail; index += 1) binary[queue[index]] = 0;
  }
  return binary;
}

export function thresholdImage(rgba, width, height, {
  threshold = 128,
  invert = false,
  grayscale = true,
  despeckle = false,
  maxSpeckArea = 3
} = {}) {
  validateRaster(rgba, width, height);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError("Image threshold must be between 0 and 255.");
  }
  const binary = new Uint8Array(width * height);
  for (let pixel = 0; pixel < binary.length; pixel += 1) {
    const offset = pixel * 4;
    const alpha = rgba[offset + 3] / 255;
    const red = rgba[offset] * alpha + 255 * (1 - alpha);
    const green = rgba[offset + 1] * alpha + 255 * (1 - alpha);
    const blue = rgba[offset + 2] * alpha + 255 * (1 - alpha);
    const intensity = grayscale
      ? Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722)
      : Math.max(red, green, blue);
    binary[pixel] = (intensity < threshold) !== invert ? 1 : 0;
  }
  return despeckle ? removeSmallComponents(binary, width, height, maxSpeckArea) : binary;
}

function neighborsOf(index, binary, width, height, visit) {
  const x = index % width, y = Math.floor(index / width);
  for (let direction = 0; direction < NEIGHBORS.length; direction += 1) {
    const [dx, dy] = NEIGHBORS[direction];
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const next = ny * width + nx;
    if (binary[next]) visit(next, direction);
  }
}

function skeletonize(binary, width, height) {
  const skeleton = Uint8Array.from(binary);
  const marked = [];
  let changed = true, iteration = 0;
  while (changed && iteration < 64) {
    changed = false;
    iteration += 1;
    for (let step = 0; step < 2; step += 1) {
      marked.length = 0;
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (!skeleton[index]) continue;
          const p = [
            skeleton[index - width],
            skeleton[index - width + 1],
            skeleton[index + 1],
            skeleton[index + width + 1],
            skeleton[index + width],
            skeleton[index + width - 1],
            skeleton[index - 1],
            skeleton[index - width - 1]
          ];
          const count = p.reduce((sum, value) => sum + value, 0);
          if (count < 2 || count > 6) continue;
          let transitions = 0;
          for (let neighbor = 0; neighbor < 8; neighbor += 1) {
            if (!p[neighbor] && p[(neighbor + 1) % 8]) transitions += 1;
          }
          if (transitions !== 1) continue;
          const [north, , east, , south, , west] = p;
          if (step === 0 ? north * east * south || east * south * west : north * east * west || north * south * west) continue;
          marked.push(index);
        }
      }
      if (marked.length) {
        changed = true;
        for (const index of marked) skeleton[index] = 0;
      }
    }
  }
  if (changed) throw new Error("Centerline tracing did not converge. Resize the image or use outline tracing.");
  return skeleton;
}

function traceSkeleton(binary, width, height) {
  const visited = new Uint8Array(binary.length);
  const paths = [];
  const markEdge = (from, direction, to) => {
    visited[from] |= 1 << direction;
    visited[to] |= 1 << ((direction + 4) % 8);
  };
  const edgeVisited = (from, direction) => Boolean(visited[from] & (1 << direction));
  const degree = (index) => {
    let count = 0;
    neighborsOf(index, binary, width, height, () => { count += 1; });
    return count;
  };
  const walk = (start, first, firstDirection) => {
    const indexes = [start];
    let previous = start, current = first, direction = firstDirection;
    markEdge(previous, direction, current);
    indexes.push(current);
    let closed = false;
    while (degree(current) === 2) {
      let next = -1, nextDirection = -1;
      neighborsOf(current, binary, width, height, (candidate, candidateDirection) => {
        if (candidate !== previous) {
          next = candidate;
          nextDirection = candidateDirection;
        }
      });
      if (next < 0 || edgeVisited(current, nextDirection)) break;
      markEdge(current, nextDirection, next);
      previous = current;
      current = next;
      if (current === start) {
        closed = true;
        break;
      }
      indexes.push(current);
    }
    if (indexes.length > 1) {
      paths.push({
        points: indexes.map((index) => ({ x: index % width + 0.5, y: Math.floor(index / width) + 0.5 })),
        closed
      });
    }
  };

  for (let index = 0; index < binary.length; index += 1) {
    if (!binary[index]) continue;
    const nodeDegree = degree(index);
    if (nodeDegree === 0) continue;
    if (nodeDegree === 2) continue;
    neighborsOf(index, binary, width, height, (next, direction) => {
      if (!edgeVisited(index, direction)) walk(index, next, direction);
    });
  }
  for (let index = 0; index < binary.length; index += 1) {
    if (!binary[index]) continue;
    neighborsOf(index, binary, width, height, (next, direction) => {
      if (!edgeVisited(index, direction)) walk(index, next, direction);
    });
  }
  return paths;
}

function edgeKey(x, y) {
  return `${x},${y}`;
}

function traceBoundaries(binary, width, height) {
  const edges = [];
  const outgoing = new Map();
  const add = (x1, y1, x2, y2, direction) => {
    if (edges.length >= 200_000) {
      throw new Error("This image has too much outline detail to trace. Resize it or remove small details and try again.");
    }
    const edge = { x1, y1, x2, y2, direction, start: edgeKey(x1, y1) };
    const index = edges.push(edge) - 1;
    if (!outgoing.has(edge.start)) outgoing.set(edge.start, []);
    outgoing.get(edge.start).push(index);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!binary[y * width + x]) continue;
      if (y === 0 || !binary[(y - 1) * width + x]) add(x, y, x + 1, y, 0);
      if (x === width - 1 || !binary[y * width + x + 1]) add(x + 1, y, x + 1, y + 1, 1);
      if (y === height - 1 || !binary[(y + 1) * width + x]) add(x + 1, y + 1, x, y + 1, 2);
      if (x === 0 || !binary[y * width + x - 1]) add(x, y + 1, x, y, 3);
    }
  }
  const used = new Uint8Array(edges.length);
  const contours = [];
  for (let initial = 0; initial < edges.length; initial += 1) {
    if (used[initial]) continue;
    const points = [];
    let edgeIndex = initial;
    const start = edges[initial].start;
    while (!used[edgeIndex]) {
      const edge = edges[edgeIndex];
      used[edgeIndex] = 1;
      points.push({ x: edge.x1, y: edge.y1 });
      const end = edgeKey(edge.x2, edge.y2);
      if (end === start) break;
      const candidates = (outgoing.get(end) ?? []).filter((candidate) => !used[candidate]);
      if (!candidates.length) break;
      const turnPriority = [1, 0, 3, 2];
      candidates.sort((a, b) => {
        const turnA = (edges[a].direction - edge.direction + 4) % 4;
        const turnB = (edges[b].direction - edge.direction + 4) % 4;
        return turnPriority.indexOf(turnA) - turnPriority.indexOf(turnB);
      });
      edgeIndex = candidates[0];
    }
    if (points.length >= 3 && edgeKey(points.at(-1).x, points.at(-1).y) !== start) {
      const finalEdge = edges[edgeIndex];
      if (finalEdge && edgeKey(finalEdge.x2, finalEdge.y2) !== start) continue;
    }
    if (points.length >= 3) contours.push(simplifyContour(points));
  }
  return contours.filter((contour) => contour.length >= 3);
}

function simplifyContour(points) {
  const simplified = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);
    if (cross !== 0) simplified.push(current);
  }
  return simplified;
}

function svgPathData(points) {
  if (points.length < 3) return "";
  const controls = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    return {
      incoming: {
        x: point.x - (next.x - previous.x) / 12,
        y: point.y - (next.y - previous.y) / 12
      },
      outgoing: {
        x: point.x + (next.x - previous.x) / 12,
        y: point.y + (next.y - previous.y) / 12
      }
    };
  });
  let data = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    data += ` C ${controls[index].outgoing.x} ${controls[index].outgoing.y} ${controls[next].incoming.x} ${controls[next].incoming.y} ${points[next].x} ${points[next].y}`;
  }
  return `${data} Z`;
}

function makeSvg(paths, width, height, mode) {
  const body = paths.map(({ points, closed }) => {
    const commands = `M ${points[0].x} ${points[0].y}${points.slice(1).map(({ x, y }) => ` L ${x} ${y}`).join("")}${closed ? " Z" : ""}`;
    if (mode === "outline") return `<path d="${svgPathData(points)}" fill="#000" fill-rule="evenodd"/>`;
    return `<path d="${commands}" fill="none" stroke="#000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

export function traceImage(rgba, width, height, options = {}) {
  const binary = thresholdImage(rgba, width, height, options);
  const mode = options.mode ?? "centerline";
  if (!["centerline", "outline"].includes(mode)) throw new RangeError("Trace mode must be centerline or outline.");
  const paths = mode === "centerline"
    ? traceSkeleton(skeletonize(binary, width, height), width, height)
    : traceBoundaries(binary, width, height).map((points) => ({ points, closed: true }));
  if (!paths.length) throw new Error("No traceable artwork was found. Adjust the threshold or image settings.");
  return { paths, svg: makeSvg(paths, width, height, mode), width, height, mode };
}
