import paper from "paper";
import { DocumentModel, paperDimensions } from "../document/model.js";
import { importSvg } from "../svg/importer.js";
import { estimateCoverage, generateGcode } from "../gcode/exporter.js";
import { PaperCanvas } from "./paper-canvas.js";
import { NotificationHistory } from "./notification-history.js";

const byId = (id) => document.getElementById(id);
const numeric = (id) => Number(byId(id).value);

function boundedNumber(id, label) {
  const value = numeric(id);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be a positive number.`);
  return value;
}

export class AppController {
  constructor() {
    this.model = new DocumentModel();
    this.paperScope = new paper.PaperScope();
    this.canvas = new PaperCanvas(byId("paper-canvas"), this.model, this.paperScope, () => this.update());
    this.aspectLocked = true;
    this.lastGcode = "";
    this.notifications = new NotificationHistory();
    this.activeWarning = "";
    this.warningTimer = null;
    this.canvas.aspectLocked = () => this.aspectLocked;
    this.bindEvents();
    this.update();
    this.fitSheet();
  }

  bindEvents() {
    byId("add-files").addEventListener("click", () => byId("file-input").click());
    byId("browse-files").addEventListener("click", () => byId("file-input").click());
    byId("drop-zone").addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      byId("file-input").click();
    });
    byId("drop-zone").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") byId("file-input").click();
    });
    byId("file-input").addEventListener("change", async (event) => {
      await this.importFiles([...event.target.files]);
      event.target.value = "";
    });
    const dropZone = byId("drop-zone");
    for (const name of ["dragenter", "dragover"]) dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
    for (const name of ["dragleave", "drop"]) dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", async (event) => this.importFiles([...event.dataTransfer.files]));

    byId("paper-size").addEventListener("change", () => {
      byId("custom-size").hidden = byId("paper-size").value !== "custom";
      if (byId("paper-size").value !== "custom") this.applyPaperSettings();
    });
    for (const id of ["orientation", "paper-width", "paper-height"]) byId(id).addEventListener("change", () => this.applyPaperSettings());

    byId("object-list").addEventListener("click", (event) => {
      const row = event.target.closest("[data-object-id]");
      if (!row) return;
      if (event.target.closest(".row-delete")) this.model.remove(row.dataset.objectId);
      else this.model.select(row.dataset.objectId);
      this.update();
    });
    byId("pos-x").addEventListener("change", () => this.setSelected("x", numeric("pos-x")));
    byId("pos-y").addEventListener("change", () => this.setSelected("y", numeric("pos-y")));
    byId("obj-width").addEventListener("change", () => this.resizeSelected("width", numeric("obj-width")));
    byId("obj-height").addEventListener("change", () => this.resizeSelected("height", numeric("obj-height")));
    byId("obj-rotation").addEventListener("change", () => this.setSelected("rotation", numeric("obj-rotation")));
    byId("aspect-lock").addEventListener("click", () => {
      this.aspectLocked = !this.aspectLocked;
      byId("aspect-lock").setAttribute("aria-pressed", String(this.aspectLocked));
      byId("aspect-lock").textContent = this.aspectLocked ? "🔒" : "🔓";
      byId("aspect-lock").title = this.aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio";
    });
    byId("rotate-left").addEventListener("click", () => this.rotateSelected(-90));
    byId("rotate-right").addEventListener("click", () => this.rotateSelected(90));
    byId("duplicate-object").addEventListener("click", () => {
      this.model.duplicate();
      this.update();
    });
    byId("delete-object").addEventListener("click", () => {
      this.model.remove();
      this.update();
    });
    byId("zoom-in").addEventListener("click", () => this.canvas.setZoom(this.canvas.zoom * 1.2));
    byId("zoom-out").addEventListener("click", () => this.canvas.setZoom(this.canvas.zoom / 1.2));
    byId("fit-sheet").addEventListener("click", () => this.fitSheet());
    byId("export-button").addEventListener("click", () => this.export());
    byId("notification-toggle").addEventListener("click", () => this.toggleNotifications());
    byId("clear-notifications").addEventListener("click", () => {
      this.notifications.clear();
      this.renderNotifications();
    });
    byId("close-export").addEventListener("click", () => byId("export-dialog").close());
    byId("download-gcode").addEventListener("click", () => this.download());
    byId("copy-gcode").addEventListener("click", () => this.copyGcode());
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#notification-tray, #notification-toggle")) this.toggleNotifications(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.toggleNotifications(false);
      if ((event.key === "Delete" || event.key === "Backspace") && !event.target.matches("input,textarea,select") && this.model.selected) {
        this.model.remove();
        this.update();
      }
    });
    for (const id of ["machine-width", "machine-height", "origin", "y-direction", "pen-up", "pen-down", "travel-feed", "draw-feed", "tolerance"]) {
      byId(id).addEventListener("change", () => this.update());
    }
  }

  async importFiles(files) {
    if (!files.length) return;
    const errors = [];
    for (const file of files) {
      if (!/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") {
        errors.push(`${file.name}: only SVG vector files are supported.`);
        continue;
      }
      try {
        const object = importSvg(await file.text(), file.name.replace(/\.svg$/i, ""), this.paperScope.project);
        object.x = Math.min(10, Math.max(0, this.model.width - object.width));
        object.y = Math.min(10, Math.max(0, this.model.height - object.height));
        this.model.add(object);
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
        if (error.warnings) errors.push(...error.warnings.map((warning) => `${file.name}: ${warning}`));
      }
    }
    this.update();
    if (errors.length) this.showWarning(errors.join(" "), true);
  }

  applyPaperSettings() {
    try {
      const dimensions = paperDimensions(byId("paper-size").value, byId("orientation").value, numeric("paper-width"), numeric("paper-height"));
      this.model.width = dimensions.width;
      this.model.height = dimensions.height;
      this.update();
    } catch (error) {
      this.showWarning(error.message, true);
    }
  }

  setSelected(property, value) {
    const selected = this.model.selected;
    if (!selected || !Number.isFinite(value)) return;
    selected[property] = value;
    this.update();
  }

  resizeSelected(property, value) {
    const selected = this.model.selected;
    if (!selected || !Number.isFinite(value) || value <= 0) return;
    if (property === "width") {
      selected.width = value;
      if (this.aspectLocked) selected.height = value * selected.geometryHeight / selected.geometryWidth;
    } else {
      selected.height = value;
      if (this.aspectLocked) selected.width = value * selected.geometryWidth / selected.geometryHeight;
    }
    this.update();
  }

  rotateSelected(amount) {
    if (!this.model.selected) return;
    this.model.selected.rotation += amount;
    this.update();
  }

  fitSheet() {
    this.canvas.fit();
    this.update();
  }

  config() {
    return {
      paperWidth: this.model.width,
      paperHeight: this.model.height,
      machineWidth: boundedNumber("machine-width", "Plotter width"),
      machineHeight: boundedNumber("machine-height", "Plotter height"),
      origin: byId("origin").value,
      yDirection: byId("y-direction").value,
      penUp: Number(byId("pen-up").value),
      penDown: Number(byId("pen-down").value),
      travelFeed: boundedNumber("travel-feed", "Travel speed"),
      drawFeed: boundedNumber("draw-feed", "Drawing speed"),
      tolerance: boundedNumber("tolerance", "Curve tolerance")
    };
  }

  export() {
    try {
      this.lastGcode = generateGcode(this.model.objects, this.config());
      byId("gcode-preview").value = this.lastGcode;
      const paths = (this.lastGcode.match(/G1 X/g) ?? []).length;
      byId("export-summary").textContent = `${paths.toLocaleString()} drawing moves · ${this.model.objects.length} object${this.model.objects.length === 1 ? "" : "s"} · ${this.model.width} × ${this.model.height} mm. Review machine limits and pen travel before plotting.`;
      byId("export-dialog").showModal();
      this.showWarning("G-code generated and ready to review.");
    } catch (error) {
      this.showWarning(error.message, true);
    }
  }

  download() {
    if (!this.lastGcode) return;
    try {
      const blob = new Blob([this.lastGcode], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "te-svg-2-grbl.gcode";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.showWarning("G-code download started.");
    } catch (error) {
      this.showWarning(`Could not download G-code: ${error.message}`, true);
    }
  }

  async copyGcode() {
    if (!this.lastGcode) return;
    const button = byId("copy-gcode");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser context.");
      await navigator.clipboard.writeText(this.lastGcode);
      button.textContent = "Copied!";
      this.showWarning("G-code copied to clipboard.");
    } catch (error) {
      button.textContent = "Copy failed";
      this.showWarning(`Could not copy G-code: ${error.message}`, true);
    }
    setTimeout(() => { button.textContent = "Copy G-code"; }, 2000);
  }

  toggleNotifications(force) {
    const tray = byId("notification-tray");
    const open = force ?? tray.hidden;
    tray.hidden = !open;
    byId("notification-toggle").setAttribute("aria-expanded", String(open));
    if (open) this.notifications.markAllRead();
    this.renderNotifications();
  }

  renderNotifications() {
    const list = byId("notification-list");
    list.replaceChildren(...this.notifications.items.map((notification) => {
      const item = document.createElement("li");
      item.className = `notification-item${notification.error ? " error" : ""}`;
      const message = document.createElement("div");
      message.className = "notification-message";
      message.textContent = notification.message;
      const time = document.createElement("time");
      time.className = "notification-time";
      time.dateTime = notification.createdAt.toISOString();
      time.textContent = notification.createdAt.toLocaleString();
      item.append(message, time);
      return item;
    }));
    byId("empty-notifications").hidden = this.notifications.items.length > 0;
    const count = byId("notification-count");
    count.textContent = String(this.notifications.unreadCount);
    count.hidden = this.notifications.unreadCount === 0;
  }

  showWarning(message, error = false) {
    const element = byId("warnings");
    if (!message) {
      this.activeWarning = "";
      return;
    }
    if (message === this.activeWarning) return;
    this.activeWarning = message;
    this.notifications.add(message, error);
    this.renderNotifications();
    element.textContent = message;
    element.hidden = false;
    element.classList.toggle("error", error);
    clearTimeout(this.warningTimer);
    this.warningTimer = setTimeout(() => {
      element.hidden = true;
      this.warningTimer = null;
    }, 5000);
  }

  update() {
    const selected = this.model.selected;
    byId("object-properties").hidden = !selected;
    byId("no-selection").hidden = Boolean(selected);
    byId("export-button").disabled = this.model.objects.length === 0;
    byId("empty-list").hidden = this.model.objects.length > 0;

    if (selected) {
      const fields = {
        "pos-x": selected.x, "pos-y": selected.y, "obj-width": selected.width,
        "obj-height": selected.height, "obj-rotation": selected.rotation
      };
      for (const [id, value] of Object.entries(fields)) {
        if (document.activeElement !== byId(id)) byId(id).value = String(Math.round(value * 100) / 100);
      }
    }

    const list = byId("object-list");
    list.replaceChildren(...this.model.objects.map((object) => {
      const row = document.createElement("li");
      row.className = `object-row${object.id === this.model.selectedId ? " selected" : ""}`;
      row.dataset.objectId = object.id;
      const swatch = document.createElement("span");
      swatch.className = "object-swatch";
      swatch.textContent = "⌁";
      const copy = document.createElement("div");
      copy.className = "object-copy";
      const name = document.createElement("div");
      name.className = "object-name";
      name.textContent = object.name;
      const size = document.createElement("div");
      size.className = "object-size";
      size.textContent = `${object.width.toFixed(1)} × ${object.height.toFixed(1)} mm`;
      copy.append(name, size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "row-delete";
      remove.title = `Delete ${object.name}`;
      remove.setAttribute("aria-label", `Delete ${object.name}`);
      remove.textContent = "×";
      row.append(swatch, copy, remove);
      return row;
    }));

    const format = byId("paper-size").value;
    const orientation = byId("orientation").value;
    const formatName = format === "custom" ? "Custom" : format;
    const orientationName = orientation[0].toUpperCase() + orientation.slice(1);
    byId("paper-summary").textContent = `${this.model.width} × ${this.model.height} mm`;
    byId("canvas-caption").textContent = `${formatName} · ${orientationName}`;
    byId("canvas-dimensions").textContent = `${this.model.width} × ${this.model.height} mm`;
    byId("zoom-level").textContent = `${Math.round(this.canvas.zoom * 100)}%`;
    byId("coverage-label").textContent = `${estimateCoverage(this.model.objects, this.model.width, this.model.height).toFixed(1)}% estimated geometry coverage`;
    this.canvas.draw();
    const bounds = this.model.outOfBounds;
    const importWarnings = this.model.objects.flatMap((object) => object.warnings.map((warning) => `${object.name}: ${warning}`));
    const messages = [
      ...bounds.map((object) => `${object.name} extends beyond the paper edge.`),
      ...importWarnings
    ];
    this.showWarning(messages.join(" "));
  }
}
