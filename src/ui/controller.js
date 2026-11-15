import paper from "paper";
import { DocumentModel, paperDimensions } from "../document/model.js";
import { importSvg } from "../svg/importer.js";
import { parseOpenTypeFont, generateTextSvg, TEXT_FONT_CATEGORIES, TEXT_FONTS } from "../text/generator.js";
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
    this.pendingImageTrace = null;
    this.pendingImageTraceResolve = null;
    this.imageTraceWorker = null;
    this.imageTraceRequestId = 0;
    this.imageTraceTimer = null;
    this.textFontPromises = new Map();
    this.pendingTextResult = null;
    this.textPreviewRequest = 0;
    this.canvas.aspectLocked = () => this.aspectLocked;
    this.bindEvents();
    this.populateTextFonts();
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

    byId("text-tool-button").addEventListener("click", () => {
      byId("text-dialog").showModal();
      this.updateTextPreview();
      byId("text-input").focus();
    });
    byId("text-category").addEventListener("change", () => {
      this.populateTextFonts();
      this.updateTextPreview();
    });
    for (const id of ["text-input", "text-font", "text-size", "text-letter-spacing", "text-line-spacing", "text-alignment"]) {
      byId(id).addEventListener(id === "text-input" ? "input" : "change", () => this.updateTextPreview());
    }
    byId("text-cancel").addEventListener("click", () => byId("text-dialog").close());
    byId("text-close").addEventListener("click", () => byId("text-dialog").close());
    byId("text-insert").addEventListener("click", () => this.insertTextObject());
    byId("text-dialog").addEventListener("close", () => {
      this.pendingTextResult = null;
    });

    for (const id of ["trace-threshold", "trace-mode", "trace-grayscale", "trace-invert", "trace-despeckle", "trace-speck-size", "trace-detail", "trace-smoothing"]) {
      byId(id).addEventListener(id === "trace-threshold" || id === "trace-speck-size" || id === "trace-detail" || id === "trace-smoothing" ? "input" : "change", () => this.updateImageTracePreview());
    }
    byId("trace-despeckle").addEventListener("change", () => {
      byId("trace-speck-size").disabled = !byId("trace-despeckle").checked;
    });
    byId("image-trace-cancel").addEventListener("click", () => this.finishImageTrace(false));
    byId("image-trace-close").addEventListener("click", () => this.finishImageTrace(false));
    byId("image-trace-insert").addEventListener("click", () => this.insertImageTrace());
    byId("image-trace-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      this.finishImageTrace(false);
    });
    byId("image-trace-dialog").addEventListener("close", () => {
      if (this.pendingImageTraceResolve) this.finishImageTrace(false);
    });

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
      const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
      const isRaster = /\.(png|jpe?g)$/i.test(file.name) || ["image/png", "image/jpeg"].includes(file.type);
      if (!isSvg && !isRaster) {
        errors.push(`${file.name}: only SVG, PNG, and JPEG files are supported.`);
        continue;
      }
      try {
        if (isRaster) {
          await this.openImageTrace(file);
        } else {
          const object = importSvg(await file.text(), file.name.replace(/\.svg$/i, ""), this.paperScope.project);
          object.x = Math.min(10, Math.max(0, this.model.width - object.width));
          object.y = Math.min(10, Math.max(0, this.model.height - object.height));
          this.model.add(object);
        }
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
        if (error.warnings) errors.push(...error.warnings.map((warning) => `${file.name}: ${warning}`));
      }
    }
    this.update();
    if (errors.length) this.showWarning(errors.join(" "), true);
  }

  populateTextFonts() {
    const categoryId = byId("text-category").value || TEXT_FONT_CATEGORIES[0].id;
    const category = TEXT_FONT_CATEGORIES.find((item) => item.id === categoryId) ?? TEXT_FONT_CATEGORIES[0];
    if (byId("text-category").options.length === 0) {
      byId("text-category").replaceChildren(...TEXT_FONT_CATEGORIES.map((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.label;
        return option;
      }));
      byId("text-category").value = category.id;
    }
    byId("text-font").replaceChildren(...category.fonts.map((font) => {
      const option = document.createElement("option");
      option.value = font.id;
      option.textContent = font.label;
      return option;
    }));
    byId("text-font-description").textContent = category.description;
  }

  async loadTextFont(fontId) {
    const fontInfo = TEXT_FONTS.find((item) => item.id === fontId);
    if (!fontInfo) throw new Error("Select an available font.");
    if (fontInfo.kind === "hershey") return null;
    if (!this.textFontPromises.has(fontId)) {
      const load = fetch(fontInfo.source).then(async (response) => {
        if (!response.ok) throw new Error(`${fontInfo.label} font could not be loaded (${response.status}).`);
        return parseOpenTypeFont(await response.arrayBuffer());
      });
      this.textFontPromises.set(fontId, load);
      load.catch(() => this.textFontPromises.delete(fontId));
    }
    return this.textFontPromises.get(fontId);
  }

  textOptions() {
    return {
      fontSize: Number(byId("text-size").value),
      letterSpacing: Number(byId("text-letter-spacing").value),
      lineSpacing: Number(byId("text-line-spacing").value),
      alignment: byId("text-alignment").value
    };
  }

  async updateTextPreview() {
    const request = ++this.textPreviewRequest;
    const text = byId("text-input").value;
    const fontId = byId("text-font").value;
    const preview = byId("text-preview");
    const status = byId("text-preview-status");
    const error = byId("text-preview-error");
    const insert = byId("text-insert");
    this.pendingTextResult = null;
    insert.disabled = true;
    error.hidden = true;
    preview.replaceChildren();
    status.textContent = "Preparing vector preview…";
    try {
      const font = await this.loadTextFont(fontId);
      if (request !== this.textPreviewRequest) return;
      const result = generateTextSvg(fontId, font, text, this.textOptions());
      this.pendingTextResult = result;
      preview.innerHTML = result.svg;
      const selected = TEXT_FONTS.find((item) => item.id === fontId);
      status.textContent = `${selected.label} · ${result.pathCount} ${result.pathCount === 1 ? "path" : "paths"} · ${result.width.toFixed(1)} × ${result.height.toFixed(1)} mm`;
      insert.disabled = false;
    } catch (previewError) {
      if (request !== this.textPreviewRequest) return;
      status.textContent = "";
      error.textContent = previewError.message;
      error.hidden = false;
    }
  }

  insertTextObject() {
    if (!this.pendingTextResult) return;
    try {
      const value = byId("text-input").value.trim().replace(/\s+/g, " ");
      const label = value.length > 28 ? `${value.slice(0, 27)}…` : value;
      const object = importSvg(this.pendingTextResult.svg, `Text: ${label}`, this.paperScope.project);
      const availableWidth = Math.max(0.1, this.model.width - Math.min(20, this.model.width * 0.1));
      const availableHeight = Math.max(0.1, this.model.height - Math.min(20, this.model.height * 0.1));
      const scale = Math.min(1, availableWidth / object.width, availableHeight / object.height);
      object.width *= scale;
      object.height *= scale;
      object.x = Math.min(10, Math.max(0, this.model.width - object.width));
      object.y = Math.min(10, Math.max(0, this.model.height - object.height));
      this.model.add(object);
      this.update();
      this.showWarning(`Inserted ${object.paths.length} vector paths of text.`);
      byId("text-dialog").close();
    } catch (error) {
      byId("text-preview-error").textContent = `Could not insert text: ${error.message}`;
      byId("text-preview-error").hidden = false;
    }
  }

  async openImageTrace(file) {
    if (typeof createImageBitmap !== "function") {
      throw new Error("This browser cannot decode local images for tracing.");
    }
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 4_000_000) {
        throw new RangeError("Images larger than 4 megapixels are not supported. Resize the image and try again.");
      }
      const source = document.createElement("canvas");
      source.width = bitmap.width;
      source.height = bitmap.height;
      const context = source.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Could not create an image-processing canvas.");
      context.drawImage(bitmap, 0, 0);
      const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
      this.pendingImageTrace = { file, width: bitmap.width, height: bitmap.height, pixels: imageData.data, trace: null };
    } finally {
      bitmap.close();
    }

    byId("trace-threshold").value = "128";
    byId("trace-threshold-value").textContent = "128";
    byId("trace-mode").value = "centerline";
    byId("trace-grayscale").checked = true;
    byId("trace-invert").checked = false;
    byId("trace-despeckle").checked = false;
    byId("trace-speck-size").value = "3";
    byId("trace-speck-size").disabled = true;
    byId("trace-detail").value = "6";
    byId("trace-detail-value").textContent = "6";
    byId("trace-smoothing").value = "1";
    byId("trace-smoothing-value").textContent = "1 px";
    byId("image-trace-error").hidden = true;
    byId("image-trace-dialog").showModal();
    this.updateImageTracePreview();
    return new Promise((resolve) => { this.pendingImageTraceResolve = resolve; });
  }

  imageTraceOptions() {
    return {
      threshold: Number(byId("trace-threshold").value),
      mode: byId("trace-mode").value,
      grayscale: byId("trace-grayscale").checked,
      invert: byId("trace-invert").checked,
      despeckle: byId("trace-despeckle").checked,
      maxSpeckSize: Number(byId("trace-speck-size").value),
      detail: Number(byId("trace-detail").value),
      smoothing: Number(byId("trace-smoothing").value)
    };
  }

  updateImageTracePreview() {
    const pending = this.pendingImageTrace;
    if (!pending) return;
    byId("trace-threshold-value").textContent = byId("trace-threshold").value;
    byId("trace-speck-value").textContent = `${byId("trace-speck-size").value} px`;
    byId("trace-detail-value").textContent = byId("trace-detail").value;
    byId("trace-smoothing-value").textContent = `${byId("trace-smoothing").value} px`;
    const status = byId("image-trace-status");
    const error = byId("image-trace-error");
    const addButton = byId("image-trace-insert");
    const requestId = ++this.imageTraceRequestId;
    pending.trace = null;
    pending.requestId = requestId;
    addButton.disabled = true;
    error.hidden = true;
    byId("image-trace-preview").replaceChildren();
    status.textContent = `Tracing ${pending.file.name} · ${pending.width} × ${pending.height} px…`;
    if (this.imageTraceTimer) clearTimeout(this.imageTraceTimer);
    this.imageTraceTimer = setTimeout(() => {
      try {
        if (!this.imageTraceWorker) {
          this.imageTraceWorker = new Worker("./dist/image-trace-worker.js", { type: "module" });
          this.imageTraceWorker.addEventListener("message", (event) => this.receiveImageTrace(event.data));
          this.imageTraceWorker.addEventListener("error", (workerError) => {
            const active = this.pendingImageTrace;
            if (active) this.failImageTrace(active.requestId, workerError);
          });
        }
        const pixels = pending.pixels.slice();
        this.imageTraceWorker.postMessage({
          id: requestId,
          pixels: pixels.buffer,
          width: pending.width,
          height: pending.height,
          options: this.imageTraceOptions()
        }, [pixels.buffer]);
      } catch (workerError) {
        this.failImageTrace(requestId, workerError);
      }
    }, 120);
  }

  receiveImageTrace({ id, result, error: message }) {
    const pending = this.pendingImageTrace;
    if (!pending || pending.requestId !== id) return;
    if (message) {
      this.failImageTrace(id, new Error(message));
      return;
    }
    try {
      const document = new DOMParser().parseFromString(result.svg, "image/svg+xml");
      if (document.documentElement.localName !== "svg" || document.querySelector("parsererror")) {
        throw new Error("The tracing engine returned invalid SVG.");
      }
      const preview = byId("image-trace-preview");
      preview.replaceChildren(document.importNode(document.documentElement, true));
      pending.trace = result;
      byId("image-trace-status").textContent = `${pending.file.name} · ${pending.width} × ${pending.height} px · ${result.pathCount} ${result.pathCount === 1 ? "path" : "paths"}`;
      byId("image-trace-error").hidden = true;
      byId("image-trace-insert").disabled = false;
    } catch (previewError) {
      this.failImageTrace(id, previewError);
    }
  }

  failImageTrace(requestId, traceError) {
    const pending = this.pendingImageTrace;
    if (!pending || pending.requestId !== requestId) return;
    pending.trace = null;
    byId("image-trace-status").textContent = `${pending.file.name} · ${pending.width} × ${pending.height} px`;
    byId("image-trace-error").textContent = traceError.message || "Image tracing failed.";
    byId("image-trace-error").hidden = false;
    byId("image-trace-insert").disabled = true;
    byId("image-trace-preview").replaceChildren();
  }

  insertImageTrace() {
    const pending = this.pendingImageTrace;
    if (!pending?.trace) return;
    try {
      const name = pending.file.name.replace(/\.(png|jpe?g)$/i, "");
      const object = importSvg(pending.trace.svg, name, this.paperScope.project);
      const availableWidth = Math.max(0.1, this.model.width - Math.min(20, this.model.width * 0.1));
      const availableHeight = Math.max(0.1, this.model.height - Math.min(20, this.model.height * 0.1));
      const scale = Math.min(1, availableWidth / object.width, availableHeight / object.height);
      object.width *= scale;
      object.height *= scale;
      object.x = Math.min(10, Math.max(0, this.model.width - object.width));
      object.y = Math.min(10, Math.max(0, this.model.height - object.height));
      this.model.add(object);
      this.update();
      this.showWarning(`Traced ${pending.file.name} into editable vector artwork.`);
      this.finishImageTrace(true);
    } catch (error) {
      this.showWarning(`Could not import traced image: ${error.message}`, true);
    }
  }

  finishImageTrace(accepted) {
    if (this.imageTraceTimer) clearTimeout(this.imageTraceTimer);
    this.imageTraceTimer = null;
    this.imageTraceRequestId += 1;
    const resolve = this.pendingImageTraceResolve;
    this.pendingImageTraceResolve = null;
    this.pendingImageTrace = null;
    resolve?.(accepted);
    const dialog = byId("image-trace-dialog");
    if (dialog.open) dialog.close();
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
