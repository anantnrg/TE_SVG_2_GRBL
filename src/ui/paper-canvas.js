import { flattenCubicPaths } from "../svg/importer.js";

function objectPoint(object, point) {
  const x = point.x * object.width / object.geometryWidth;
  const y = point.y * object.height / object.geometryHeight;
  const angle = object.rotation * Math.PI / 180;
  const cx = object.width / 2, cy = object.height / 2;
  return {
    x: object.x + cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
    y: object.y + cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)
  };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function containsPoint(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export class PaperCanvas {
  constructor(canvas, model, scope, onChange) {
    this.canvas = canvas;
    this.model = model;
    this.scope = scope;
    this.onChange = onChange;
    this.aspectLocked = () => true;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.drag = null;
    this.scale = 1;
    scope.setup(canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement.parentElement);
    canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    canvas.addEventListener("pointercancel", () => { this.drag = null; });
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.parentElement.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = width;
    this.canvas.height = height;
    this.scope.view.viewSize = new this.scope.Size(width, height);
    this.draw();
  }

  fit() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.draw();
  }

  setZoom(value, anchor = null) {
    const next = Math.min(5, Math.max(0.25, value));
    if (anchor) {
      const paperPoint = this.screenToPaper(anchor.x, anchor.y);
      this.zoom = next;
      const matrix = this.matrix();
      this.panX = anchor.x - paperPoint.x * matrix.scale - (matrix.width - this.model.width * matrix.scale) / 2;
      this.panY = anchor.y - paperPoint.y * matrix.scale - (matrix.height - this.model.height * matrix.scale) / 2;
    } else {
      this.zoom = next;
    }
    this.draw();
  }

  matrix() {
    const { width, height } = this.scope.view.viewSize;
    const fitScale = Math.min((width - 72) / this.model.width, (height - 72) / this.model.height);
    const scale = Math.max(0.05, fitScale * this.zoom);
    return {
      scale,
      width,
      height,
      x: (width - this.model.width * scale) / 2 + this.panX,
      y: (height - this.model.height * scale) / 2 + this.panY
    };
  }

  screenToPaper(x, y) {
    const matrix = this.matrix();
    return { x: (x - matrix.x) / matrix.scale, y: (y - matrix.y) / matrix.scale };
  }

  screenPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  draw() {
    const project = this.scope.project;
    project.activeLayer.removeChildren();
    const matrix = this.matrix();
    this.scale = matrix.scale;
    project.view.matrix = new this.scope.Matrix(matrix.scale, 0, 0, matrix.scale, matrix.x, matrix.y);
    const sheet = new this.scope.Path.Rectangle(new this.scope.Rectangle(0, 0, this.model.width, this.model.height));
    sheet.fillColor = "#fff";
    sheet.strokeColor = "#d9dcd7";
    sheet.strokeWidth = 0.22 / matrix.scale;
    sheet.data.role = "sheet";
    for (const object of this.model.objects) {
      for (const path of object.paths) {
        const geometry = flattenCubicPaths([path], 0.2)[0];
        if (geometry.points.length < 2) continue;
        const rendered = geometry.points.map((point) => objectPoint(object, point));
        const shape = new this.scope.Path();
        shape.add(new this.scope.Point(rendered[0].x, rendered[0].y));
        for (const point of rendered.slice(1)) shape.add(new this.scope.Point(point.x, point.y));
        if (geometry.closed) shape.closePath();
        shape.strokeColor = object.id === this.model.selectedId ? "#d26a42" : "#37413b";
        shape.strokeWidth = (object.id === this.model.selectedId ? 1.35 : 0.8) / matrix.scale;
        shape.fillColor = null;
        shape.data.objectId = object.id;
      }
    }
    const selected = this.model.selected;
    if (selected) this.drawHandles(selected, matrix.scale);
    project.view.update();
    this.canvas.dataset.zoom = String(this.zoom);
  }

  objectCorners(object) {
    const angle = object.rotation * Math.PI / 180;
    const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
    return [[object.x, object.y], [object.x + object.width, object.y],
      [object.x + object.width, object.y + object.height], [object.x, object.y + object.height]]
      .map(([x, y]) => ({
        x: cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
        y: cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)
      }));
  }

  drawHandles(object, scale) {
    const corners = this.objectCorners(object);
    const outline = new this.scope.Path();
    corners.forEach((point) => outline.add(new this.scope.Point(point.x, point.y)));
    outline.closePath();
    outline.strokeColor = "#d26a42";
    outline.strokeWidth = 0.55 / scale;
    outline.dashArray = [2 / scale, 2 / scale];
    outline.data.handle = "outline";
    const resizePoint = corners[2];
    const handle = new this.scope.Path.Circle(new this.scope.Point(resizePoint.x, resizePoint.y), 4.5 / scale);
    handle.fillColor = "#fff";
    handle.strokeColor = "#d26a42";
    handle.strokeWidth = 1 / scale;
    handle.data.handle = "resize";
    const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const rotationPoint = { x: topMid.x, y: topMid.y - 12 / scale };
    const connector = new this.scope.Path.Line(new this.scope.Point(topMid.x, topMid.y), new this.scope.Point(rotationPoint.x, rotationPoint.y));
    connector.strokeColor = "#d26a42";
    connector.strokeWidth = 0.7 / scale;
    const rotation = new this.scope.Path.Circle(new this.scope.Point(rotationPoint.x, rotationPoint.y), 3.5 / scale);
    rotation.fillColor = "#d26a42";
    rotation.data.handle = "rotate";
  }

  hitTest(point) {
    const tolerance = 7 / this.scale;
    const selected = this.model.selected;
    if (selected) {
      const corners = this.objectCorners(selected);
      const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      if (distance(point, { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 - 12 / this.scale }) < tolerance) return { object: selected, handle: "rotate" };
      if (distance(point, corners[2]) < tolerance) return { object: selected, handle: "resize" };
    }
    for (const object of [...this.model.objects].reverse()) {
      const paths = flattenCubicPaths(object.paths, Math.max(0.05, 0.5 / this.scale));
      for (const path of paths) {
        const points = path.points.map((item) => objectPoint(object, item));
        for (let index = 1; index < points.length; index += 1) {
          if (distanceToSegment(point, points[index - 1], points[index]) <= tolerance) return { object, handle: null };
        }
        if (path.closed && points.length > 2 && distanceToSegment(point, points.at(-1), points[0]) <= tolerance) return { object, handle: null };
        if (path.closed && containsPoint(point, points)) return { object, handle: null };
      }
    }
    return null;
  }

  pointerDown(event) {
    const screen = this.screenPoint(event);
    const point = this.screenToPaper(screen.x, screen.y);
    const hit = this.hitTest(point);
    if (hit) {
      this.model.select(hit.object.id);
      const object = hit.object;
      this.drag = {
        mode: hit.handle ?? "move",
        start: point,
        x: object.x, y: object.y, width: object.width, height: object.height,
        rotation: object.rotation,
        aspect: object.width / object.height,
        center: { x: object.x + object.width / 2, y: object.y + object.height / 2 },
        startAngle: Math.atan2(point.y - (object.y + object.height / 2), point.x - (object.x + object.width / 2))
      };
    } else {
      this.model.select(null);
      this.drag = { mode: "pan", screen, panX: this.panX, panY: this.panY };
    }
    this.canvas.setPointerCapture(event.pointerId);
    this.draw();
    this.onChange();
  }

  pointerMove(event) {
    if (!this.drag) return;
    const screen = this.screenPoint(event);
    if (this.drag.mode === "pan") {
      this.panX = this.drag.panX + screen.x - this.drag.screen.x;
      this.panY = this.drag.panY + screen.y - this.drag.screen.y;
    } else {
      const object = this.model.selected;
      const point = this.screenToPaper(screen.x, screen.y);
      if (this.drag.mode === "move") {
        object.x = this.drag.x + point.x - this.drag.start.x;
        object.y = this.drag.y + point.y - this.drag.start.y;
      } else if (this.drag.mode === "rotate") {
        const angle = Math.atan2(point.y - this.drag.center.y, point.x - this.drag.center.x);
        object.rotation = this.drag.rotation + (angle - this.drag.startAngle) * 180 / Math.PI;
      } else if (this.drag.mode === "resize") {
        const angle = -this.drag.rotation * Math.PI / 180;
        const dx = point.x - this.drag.center.x, dy = point.y - this.drag.center.y;
        let width = Math.max(1, 2 * (dx * Math.cos(angle) + dy * Math.sin(angle)));
        let height = Math.max(1, 2 * (-dx * Math.sin(angle) + dy * Math.cos(angle)));
        if (this.onAspectLocked()) height = width / this.drag.aspect;
        object.width = width;
        object.height = height;
        object.x = this.drag.center.x - width / 2;
        object.y = this.drag.center.y - height / 2;
      }
      this.onChange();
    }
    this.draw();
  }

  onAspectLocked() {
    return this.aspectLocked?.() ?? true;
  }

  pointerUp() {
    if (!this.drag) return;
    this.drag = null;
    this.onChange();
  }

  wheel(event) {
    event.preventDefault();
    const point = this.screenPoint(event);
    this.setZoom(this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), point);
    this.onChange();
  }
}
