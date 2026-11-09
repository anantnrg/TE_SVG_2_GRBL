export const PAPER_FORMATS = Object.freeze({
  A4: Object.freeze({ width: 210, height: 297 }),
  A3: Object.freeze({ width: 297, height: 420 })
});

export class DocumentModel {
  constructor(width = 210, height = 297) {
    this.width = width;
    this.height = height;
    this.objects = [];
    this.selectedId = null;
  }

  add(object) {
    if (this.objects.some((existing) => existing.id === object.id)) {
      throw new Error(`Duplicate object id: ${object.id}`);
    }
    this.objects.push(object);
    this.selectedId = object.id;
  }

  get selected() {
    return this.objects.find((object) => object.id === this.selectedId) ?? null;
  }

  select(id) {
    if (id !== null && !this.objects.some((object) => object.id === id)) {
      throw new Error(`Unknown object: ${id}`);
    }
    this.selectedId = id;
  }

  remove(id = this.selectedId) {
    const index = this.objects.findIndex((object) => object.id === id);
    if (index < 0) return null;
    const [removed] = this.objects.splice(index, 1);
    if (this.selectedId === id) this.selectedId = this.objects[index]?.id ?? this.objects[index - 1]?.id ?? null;
    return removed;
  }

  duplicate(id = this.selectedId, makeId = () => crypto.randomUUID()) {
    const source = this.objects.find((object) => object.id === id);
    if (!source) return null;
    const copy = {
      ...source,
      id: makeId(),
      name: `${source.name} copy`,
      x: source.x + 5,
      y: source.y + 5,
      paths: source.paths.map((path) => ({ ...path, points: path.points.map((point) => ({ ...point })) }))
    };
    this.add(copy);
    return copy;
  }

  get outOfBounds() {
    return this.objects.filter((object) => {
      const { x, y, width, height, rotation = 0 } = object;
      const radians = rotation * Math.PI / 180;
      const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
      const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
      const minX = x + (width - rotatedWidth) / 2;
      const minY = y + (height - rotatedHeight) / 2;
      return minX < 0 || minY < 0 || minX + rotatedWidth > this.width || minY + rotatedHeight > this.height;
    });
  }
}

export function paperDimensions(format, orientation, customWidth, customHeight) {
  let { width, height } = format === "custom"
    ? { width: Number(customWidth), height: Number(customHeight) }
    : PAPER_FORMATS[format] ?? PAPER_FORMATS.A4;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("Paper dimensions must be positive finite numbers.");
  }
  if (orientation === "landscape" && height > width) [width, height] = [height, width];
  if (orientation === "portrait" && width > height) [width, height] = [height, width];
  return { width, height };
}
