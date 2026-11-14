const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1], [1, 0],
  [1, 1], [0, 1], [-1, 1], [-1, 0]
];

export function validateRaster(rgba, width, height) {
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
  maxSpeckArea = 9
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

export function prepareVectorPixels(rgba, width, height, { grayscale = true, invert = false } = {}) {
  validateRaster(rgba, width, height);
  const pixels = new Uint8Array(rgba.length);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] / 255;
    let red = rgba[offset] * alpha + 255 * (1 - alpha);
    let green = rgba[offset + 1] * alpha + 255 * (1 - alpha);
    let blue = rgba[offset + 2] * alpha + 255 * (1 - alpha);
    if (grayscale) {
      red = green = blue = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    }
    if (invert) {
      red = 255 - red;
      green = 255 - green;
      blue = 255 - blue;
    }
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

function forEachNeighbor(index, binary, width, height, visit) {
  const x = index % width, y = Math.floor(index / width);
  for (let direction = 0; direction < NEIGHBORS.length; direction += 1) {
    const [dx, dy] = NEIGHBORS[direction];
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    if (dx && dy && (binary[y * width + nx] || binary[ny * width + x])) continue;
    const next = ny * width + nx;
    if (binary[next]) visit(next, direction);
  }
}

function pixelDegree(index, binary, width, height) {
  let count = 0;
  forEachNeighbor(index, binary, width, height, () => { count += 1; });
  return count;
}

function pruneShortTerminalBranches(binary, width, height, maxLength) {
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError("Branch pruning length must be a non-negative integer.");
  }
  if (maxLength === 0) return binary;
  let changed = true;
  while (changed) {
    changed = false;
    for (let endpoint = 0; endpoint < binary.length; endpoint += 1) {
      if (!binary[endpoint] || pixelDegree(endpoint, binary, width, height) !== 1) continue;
      const branch = [endpoint];
      let previous = endpoint, current = -1;
      forEachNeighbor(endpoint, binary, width, height, (next) => { current = next; });
      while (current >= 0) {
        const degree = pixelDegree(current, binary, width, height);
        if (degree !== 2) {
          if (degree >= 3 && branch.length <= maxLength) {
            for (const index of branch) binary[index] = 0;
            changed = true;
          }
          break;
        }
        branch.push(current);
        let next = -1;
        forEachNeighbor(current, binary, width, height, (candidate) => {
          if (candidate !== previous) next = candidate;
        });
        previous = current;
        current = next;
      }
    }
  }
  return binary;
}

function simplifyOpenPath(points, tolerance) {
  if (tolerance <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const a = points[start], b = points[end];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    let maximum = tolerance, selected = -1;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      const distance = length === 0
        ? Math.hypot(point.x - a.x, point.y - a.y)
        : Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / length;
      if (distance > maximum) {
        maximum = distance;
        selected = index;
      }
    }
    if (selected >= 0) {
      keep[selected] = 1;
      stack.push([start, selected], [selected, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function pathData(points, closed) {
  if (points.length < 2) return "";
  const commands = points.slice(1).map(({ x, y }) => `L${x.toFixed(2)} ${y.toFixed(2)}`).join("");
  return `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}${commands}${closed ? "Z" : ""}`;
}

export function traceSkeleton(skeleton, width, height, {
  branchPruneLength = 0,
  smoothing = 0
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || skeleton.length !== width * height) {
    throw new RangeError("Skeleton dimensions or pixel data are not supported.");
  }
  const binary = Uint8Array.from(skeleton, (pixel) => Number(pixel !== 0));
  pruneShortTerminalBranches(binary, width, height, branchPruneLength);
  const visited = new Uint8Array(binary.length);
  const paths = [];
  const markEdge = (from, direction, to) => {
    visited[from] |= 1 << direction;
    visited[to] |= 1 << ((direction + 4) % 8);
  };
  const edgeVisited = (from, direction) => Boolean(visited[from] & (1 << direction));
  const walk = (start, first, firstDirection) => {
    const indexes = [start];
    let previous = start, current = first, direction = firstDirection;
    markEdge(previous, direction, current);
    indexes.push(current);
    let closed = false;
    while (pixelDegree(current, binary, width, height) === 2) {
      let next = -1, nextDirection = -1;
      forEachNeighbor(current, binary, width, height, (candidate, candidateDirection) => {
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
      const points = indexes.map((index) => ({
        x: index % width + 0.5,
        y: Math.floor(index / width) + 0.5
      }));
      paths.push({
        points: closed ? points : simplifyOpenPath(points, smoothing),
        closed
      });
    }
  };

  for (let index = 0; index < binary.length; index += 1) {
    if (!binary[index]) continue;
    const degree = pixelDegree(index, binary, width, height);
    if (degree === 0 || degree === 2) continue;
    forEachNeighbor(index, binary, width, height, (next, direction) => {
      if (!edgeVisited(index, direction)) walk(index, next, direction);
    });
  }
  for (let index = 0; index < binary.length; index += 1) {
    if (!binary[index]) continue;
    forEachNeighbor(index, binary, width, height, (next, direction) => {
      if (!edgeVisited(index, direction)) walk(index, next, direction);
    });
  }
  return paths;
}

export function makeCenterlineSvg(paths, width, height) {
  const body = paths.map(({ points, closed }) => {
    const d = pathData(points, closed);
    return `<path d="${d}" fill="none" stroke="#000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

export function buildCenterlineTrace(skeleton, width, height, options = {}) {
  const paths = traceSkeleton(skeleton, width, height, options);
  if (!paths.length) throw new Error("No traceable centerline was found. Adjust threshold or noise settings.");
  return { paths, svg: makeCenterlineSvg(paths, width, height), width, height, mode: "centerline" };
}
