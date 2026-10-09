/* ========================================================================== 
   AWS COMMONPLACE — NOTES IMAGE ANNOTATION ADD-ON
   --------------------------------------------------------------------------
   Features:
   - Freehand pen, straight line, arrow, rectangle, ellipse/circle, eraser
   - Undo and clear
   - Color and stroke width
   - Freehand line/circle/ellipse recognition with optional "Perfect it"
   - Inline SVG annotations persisted in the existing body_html
   - Preserves the image's pre-wrap layout and rendered width
   - Removes editor-only state from saved/published HTML

   Expected existing elements/integration:
   #editorBody, #editor-overlay, .editor-toolbar,
   button[onclick*="triggerImageInsert"], #imageFileInput,
   #imageStylePicker, and (optionally) window.publishArticle().
   No Supabase schema change is required.
   ========================================================================== */

(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const HISTORY_LIMIT = 40;
  const LAYOUTS = new Set([
    "normal",
    "float-left",
    "float-right",
    "center-small",
    "full",
  ]);
  const TOOLS = new Set(["pen", "line", "arrow", "rect", "ellipse", "eraser"]);

  const state = {
    wrapper: null,
    svg: null,
    tool: "pen",
    color: "#b23a39",
    width: 4,
    drawing: false,
    pointerId: null,
    points: [],
    preview: null,
    history: [],
    suggestion: null,
    savedImageSelection: null,
    pendingImageDataUrl: null,
    selectedWrapper: null,
  };

  // Runtime-only binding state must never be stored in saved HTML attributes.
  const boundSvgs = new WeakSet();
  const observedOverlays = new WeakSet();
  let imageInsertOverridesInstalled = false;
  let publishSanitizerInstalled = false;
  let initObserver = null;

  /* ------------------------------------------------------------------------
     Basic helpers
     ------------------------------------------------------------------------ */

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const formatNumber = (value) => Number(value.toFixed(3));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const average = (values) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function setStatus(message) {
    if (typeof window.setEditorStatus === "function") {
      window.setEditorStatus(message);
    }
  }

  function getEditor() {
    return document.getElementById("editorBody");
  }

  function createSvgElement(tag, attrs = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });
    return element;
  }

  function getLayoutFromClass(classValue = "") {
    const tokens = Array.isArray(classValue)
      ? classValue
      : String(classValue).split(/\s+/).filter(Boolean);

    if (tokens.includes("float-left")) return "float-left";
    if (tokens.includes("float-right")) return "float-right";
    if (tokens.includes("center-small")) return "center-small";
    if (tokens.includes("full")) return "full";
    return "normal";
  }

  function getSavedLayout(wrapper) {
    if (!wrapper?.dataset.annotationLayout) return null;
    try {
      const layout = JSON.parse(wrapper.dataset.annotationLayout);
      if (!layout || typeof layout !== "object") return null;
      if (!LAYOUTS.has(layout.layout)) layout.layout = "normal";
      return layout;
    } catch (_error) {
      return null;
    }
  }

  function getImageInWrapper(wrapper) {
    return (
      wrapper?.querySelector(
        ":scope > .note-image-annotation-inner > img.note-img",
      ) ||
      wrapper?.querySelector("img.note-img") ||
      null
    );
  }

  /* ------------------------------------------------------------------------
     Capture image layout BEFORE wrapping it
     ------------------------------------------------------------------------ */

  function captureImageLayout(image) {
    if (!image) return null;

    const parent = image.parentElement;
    const computed = window.getComputedStyle(image);
    const parentComputed = parent ? window.getComputedStyle(parent) : null;
    const rect = image.getBoundingClientRect();

    let layout = getLayoutFromClass(image.className || "");
    if (layout === "normal") {
      if (computed.float === "left") layout = "float-left";
      else if (computed.float === "right") layout = "float-right";
    }

    return {
      layout,
      widthPx: rect.width,
      heightPx: rect.height,
      width: computed.width,
      maxWidth: computed.maxWidth,
      minWidth: computed.minWidth,
      height: computed.height,
      maxHeight: computed.maxHeight,
      minHeight: computed.minHeight,
      display: computed.display,
      float: computed.float,
      clear: computed.clear,
      verticalAlign: computed.verticalAlign,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      parentTextAlign: parentComputed?.textAlign || "left",
      parentDisplay: parentComputed?.display || "block",
      inlineFloat: image.style.float,
      inlineClear: image.style.clear,
      inlineWidth: image.style.width,
      inlineMaxWidth: image.style.maxWidth,
      inlineHeight: image.style.height,
      inlineMarginTop: image.style.marginTop,
      inlineMarginRight: image.style.marginRight,
      inlineMarginBottom: image.style.marginBottom,
      inlineMarginLeft: image.style.marginLeft,
      inlineDisplay: image.style.display,
    };
  }

  function applyAnnotationLayout(wrapper, image) {
    if (!wrapper || !image) return;

    let savedLayout = getSavedLayout(wrapper);
    if (!savedLayout) {
      savedLayout = captureImageLayout(image);
      const wrapperLayout = wrapper.dataset.layout;
      if (wrapperLayout && LAYOUTS.has(wrapperLayout)) {
        savedLayout.layout = wrapperLayout;
      }
      if (savedLayout) {
        wrapper.dataset.annotationLayout = JSON.stringify(savedLayout);
      }
    }
    if (!savedLayout) return;

    const layout = LAYOUTS.has(savedLayout.layout)
      ? savedLayout.layout
      : "normal";
    wrapper.dataset.layout = layout;
    wrapper.style.position = "relative";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.overflow = "visible";
    wrapper.style.maxWidth = "100%";

    ["float-left", "float-right", "center-small", "full"].forEach((name) => {
      wrapper.classList.remove(name);
    });
    if (layout !== "normal") wrapper.classList.add(layout);

    const widthPx = Number(savedLayout.widthPx);
    const hasWidth = Number.isFinite(widthPx) && widthPx > 0;
    const marginTop = savedLayout.marginTop || "0px";
    const marginBottom = savedLayout.marginBottom || "0px";
    const marginLeft = savedLayout.marginLeft || "0px";
    const marginRight = savedLayout.marginRight || "0px";

    if (layout === "normal") {
      wrapper.style.float = "none";
      wrapper.style.clear = savedLayout.clear || "none";
      wrapper.style.width = hasWidth ? `${widthPx}px` : "fit-content";
      wrapper.style.marginTop = marginTop;
      wrapper.style.marginBottom = marginBottom;

      if (savedLayout.parentTextAlign === "center") {
        wrapper.style.display = "block";
        wrapper.style.marginLeft = "auto";
        wrapper.style.marginRight = "auto";
      } else if (savedLayout.parentTextAlign === "right") {
        wrapper.style.display = "block";
        wrapper.style.marginLeft = "auto";
        wrapper.style.marginRight = "0px";
      } else {
        wrapper.style.display = "inline-block";
        wrapper.style.marginLeft = marginLeft;
        wrapper.style.marginRight = marginRight;
      }
    } else if (layout === "float-left" || layout === "float-right") {
      wrapper.style.display = "block";
      wrapper.style.float = layout === "float-left" ? "left" : "right";
      wrapper.style.clear = savedLayout.clear || "none";
      wrapper.style.width = hasWidth ? `${widthPx}px` : "min(48%, 620px)";
      wrapper.style.marginTop = marginTop;
      wrapper.style.marginRight = marginRight;
      wrapper.style.marginBottom = marginBottom;
      wrapper.style.marginLeft = marginLeft;
    } else if (layout === "center-small") {
      wrapper.style.display = "block";
      wrapper.style.float = "none";
      wrapper.style.clear = savedLayout.clear || "none";
      wrapper.style.width = hasWidth ? `${widthPx}px` : "min(70%, 760px)";
      wrapper.style.marginTop = marginTop;
      wrapper.style.marginBottom = marginBottom;
      wrapper.style.marginLeft = "auto";
      wrapper.style.marginRight = "auto";
    } else if (layout === "full") {
      wrapper.style.display = "block";
      wrapper.style.float = "none";
      wrapper.style.clear = savedLayout.clear || "none";
      wrapper.style.width = "100%";
      wrapper.style.marginTop = marginTop;
      wrapper.style.marginRight = marginRight;
      wrapper.style.marginBottom = marginBottom;
      wrapper.style.marginLeft = marginLeft;
    }

    const inner = wrapper.querySelector(
      ":scope > .note-image-annotation-inner",
    );
    if (inner) {
      inner.style.position = "relative";
      inner.style.display = "block";
      inner.style.boxSizing = "border-box";
      inner.style.width = "100%";
      inner.style.maxWidth = "100%";
      inner.style.height = "auto";
      inner.style.margin = "0";
      inner.style.padding = "0";
      inner.style.lineHeight = "0";
      inner.style.overflow = "visible";
    }

    image.classList.add("annotation-contained-image");
    image.style.float = "none";
    image.style.clear = "none";
    image.style.margin = "0";
    image.style.display = "block";
    image.style.width = "100%";
    image.style.maxWidth = "100%";
    image.style.height = "auto";
    image.style.verticalAlign = "top";

    const svg =
      wrapper.querySelector(
        ":scope > .note-image-annotation-inner > .note-annotation-layer",
      ) || wrapper.querySelector(".note-annotation-layer");

    if (svg) {
      svg.style.position = "absolute";
      svg.style.top = "0";
      svg.style.right = "0";
      svg.style.bottom = "0";
      svg.style.left = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.display = "block";
      svg.style.boxSizing = "border-box";
      svg.style.overflow = "visible";
      svg.style.setProperty("z-index", "50", "important");
      svg.style.setProperty("touch-action", "none", "important");
      const isActiveDrawingLayer = state.drawing && state.wrapper === wrapper;
      svg.style.setProperty(
        "pointer-events",
        isActiveDrawingLayer ? "all" : "none",
        "important",
      );
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");
    }
  }

  /* ------------------------------------------------------------------------
     SVG wrapper and layer creation
     ------------------------------------------------------------------------ */

  function bindSvg(svg) {
    if (!svg || boundSvgs.has(svg)) return;
    boundSvgs.add(svg);
    svg.addEventListener("pointerdown", beginPointer);
    svg.addEventListener("pointermove", movePointer);
    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", cancelPointer);
  }

  function ensureAnnotationLayer(wrapper) {
    if (!wrapper) return null;
    wrapper.setAttribute("contenteditable", "false");

    let inner = wrapper.querySelector(":scope > .note-image-annotation-inner");
    let image = getImageInWrapper(wrapper);
    let svg =
      wrapper.querySelector(
        ":scope > .note-image-annotation-inner > .note-annotation-layer",
      ) || wrapper.querySelector(".note-annotation-layer");

    if (!inner) {
      inner = document.createElement("div");
      inner.className = "note-image-annotation-inner";
      while (wrapper.firstChild) inner.appendChild(wrapper.firstChild);
      wrapper.appendChild(inner);
    }

    if (!svg) {
      svg = createSvgElement("svg", {
        class: "note-annotation-layer",
        viewBox: "0 0 100 100",
        preserveAspectRatio: "none",
        "aria-hidden": "true",
      });
      inner.appendChild(svg);
    } else if (svg.parentElement !== inner) {
      inner.appendChild(svg);
    }

    if (!wrapper.dataset.layout) {
      wrapper.dataset.layout = getLayoutFromClass(image?.className || "");
    }

    if (image) applyAnnotationLayout(wrapper, image);
    bindSvg(svg);
    return svg;
  }

  function ensureAnnotationWrapper(image) {
    if (!image) return null;

    const existing = image.closest(".note-image-annotation");
    if (existing) {
      ensureAnnotationLayer(existing);
      return existing;
    }

    const parent = image.parentNode;
    if (!parent) return null;

    // Capture the rendered geometry before inserting a formatting context.
    const originalLayout = captureImageLayout(image);
    if (!originalLayout) return null;

    const wrapper = document.createElement("div");
    const inner = document.createElement("div");
    const svg = createSvgElement("svg", {
      class: "note-annotation-layer",
      viewBox: "0 0 100 100",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    });

    wrapper.className = "note-image-annotation";
    wrapper.dataset.annotationImage = "true";
    wrapper.dataset.layout = originalLayout.layout || "normal";
    wrapper.dataset.annotationLayout = JSON.stringify(originalLayout);
    wrapper.setAttribute("contenteditable", "false");
    inner.className = "note-image-annotation-inner";

    parent.insertBefore(wrapper, image);
    inner.appendChild(image);
    inner.appendChild(svg);
    wrapper.appendChild(inner);

    applyAnnotationLayout(wrapper, image);
    ensureAnnotationLayer(wrapper);
    return wrapper;
  }

  /* ------------------------------------------------------------------------
     Saving / sanitizing editor-only state
     ------------------------------------------------------------------------ */

  function removeEditorOnlyState(wrapper) {
    if (!wrapper) return;
    wrapper.classList.remove("is-selected", "is-drawing");
    wrapper.removeAttribute("data-selected");
    wrapper.removeAttribute("data-drawing");
    wrapper
      .querySelectorAll('[data-preview="true"]')
      .forEach((node) => node.remove());
    wrapper.querySelectorAll("[data-annotation-bound]").forEach((node) => {
      node.removeAttribute("data-annotation-bound");
    });
    wrapper.querySelectorAll(".note-annotation-layer").forEach((svg) => {
      svg.style.setProperty("pointer-events", "none", "important");
      svg.style.setProperty("touch-action", "none", "important");
    });
  }

  function sanitizeAnnotationTree(root) {
    root
      .querySelectorAll(".note-image-annotation")
      .forEach(removeEditorOnlyState);
    root
      .querySelectorAll('[data-preview="true"]')
      .forEach((node) => node.remove());
  }

  function cleanAnnotationEditorDom() {
    const editor = getEditor();
    if (editor) sanitizeAnnotationTree(editor);
  }

  function getCleanEditorHtml() {
    const editor = getEditor();
    if (!editor) return "";
    const clone = editor.cloneNode(true);
    sanitizeAnnotationTree(clone);
    return clone.innerHTML;
  }

  window.getCleanAnnotationEditorHtml = getCleanEditorHtml;
  window.prepareAnnotationHtmlForSave = getCleanEditorHtml;

  /* ------------------------------------------------------------------------
     Stroke helpers and point simplification
     ------------------------------------------------------------------------ */

  function setStrokeStyle(element, color = state.color, width = state.width) {
    element.setAttribute("fill", "none");
    element.setAttribute("stroke", color);
    element.setAttribute("stroke-width", String(width));
    element.setAttribute("stroke-linecap", "round");
    element.setAttribute("stroke-linejoin", "round");
    element.setAttribute("opacity", "0.92");
    element.setAttribute("vector-effect", "non-scaling-stroke");
  }

  function pointsToPath(points) {
    return points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${formatNumber(point.x)} ${formatNumber(point.y)}`,
      )
      .join(" ");
  }

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1)
      total += distance(points[i - 1], points[i]);
    return total;
  }

  function simplifyPoints(points, tolerance = 0.45) {
    if (points.length <= 8) return points;
    const sqTolerance = tolerance * tolerance;

    const sqSegDist = (point, start, end) => {
      let x = start.x;
      let y = start.y;
      let dx = end.x - x;
      let dy = end.y - y;

      if (dx !== 0 || dy !== 0) {
        const t =
          ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
          x = end.x;
          y = end.y;
        } else if (t > 0) {
          x += dx * t;
          y += dy * t;
        }
      }
      dx = point.x - x;
      dy = point.y - y;
      return dx * dx + dy * dy;
    };

    const markers = new Uint8Array(points.length);
    const last = points.length - 1;
    const stack = [[0, last]];
    markers[0] = 1;
    markers[last] = 1;

    while (stack.length) {
      const [startIndex, endIndex] = stack.pop();
      let maxDistance = 0;
      let maxIndex = 0;

      for (let i = startIndex + 1; i < endIndex; i += 1) {
        const sqDistance = sqSegDist(
          points[i],
          points[startIndex],
          points[endIndex],
        );
        if (sqDistance > maxDistance) {
          maxDistance = sqDistance;
          maxIndex = i;
        }
      }

      if (maxDistance > sqTolerance) {
        markers[maxIndex] = 1;
        stack.push([startIndex, maxIndex], [maxIndex, endIndex]);
      }
    }
    return points.filter((_point, index) => markers[index]);
  }

  /* ------------------------------------------------------------------------
     Drawing input and history
     ------------------------------------------------------------------------ */

  function pointFromEvent(event, svg) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  function snapshot() {
    if (!state.svg) return;
    state.history.push(state.svg.innerHTML);
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
  }

  function clearPreview() {
    if (state.preview?.parentNode) state.preview.remove();
    state.preview = null;
  }

  function setPreview(points) {
    clearPreview();
    if (!state.svg || points.length < 2) return;
    const preview = buildShape(state.tool, points);
    if (!preview) return;
    preview.setAttribute("data-preview", "true");
    state.svg.appendChild(preview);
    state.preview = preview;
  }

  function eraseAtTarget(target) {
    const group = target?.closest?.("[data-annotation-kind]");
    if (
      !group ||
      group.getAttribute("data-preview") === "true" ||
      !state.svg?.contains(group)
    )
      return;
    snapshot();
    group.remove();
    if (state.suggestion?.group === group) {
      state.suggestion = null;
      hideSuggestion();
    }
  }

  function beginPointer(event) {
    if (!state.drawing || !state.svg || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    state.pointerId = event.pointerId;
    state.points = [pointFromEvent(event, state.svg)];

    try {
      state.svg.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is a convenience; drawing can continue without it.
    }

    if (state.tool === "eraser") {
      const target =
        document.elementFromPoint(event.clientX, event.clientY) || event.target;
      eraseAtTarget(target);
      state.points = [];
      return;
    }
    setPreview(state.points);
  }

  function movePointer(event) {
    if (!state.drawing || state.pointerId !== event.pointerId || !state.svg)
      return;
    event.preventDefault();
    event.stopPropagation();

    if (state.tool === "eraser") {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      eraseAtTarget(target);
      return;
    }

    const point = pointFromEvent(event, state.svg);
    if (state.tool === "pen") state.points.push(point);
    else if (state.points.length) state.points = [state.points[0], point];
    setPreview(state.points);
  }

  function endPointer(event) {
    if (!state.drawing || state.pointerId !== event.pointerId || !state.svg)
      return;
    event.preventDefault();
    event.stopPropagation();

    if (state.tool === "eraser") {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      eraseAtTarget(target);
      state.pointerId = null;
      state.points = [];
      return;
    }

    const finalPoint = pointFromEvent(event, state.svg);
    if (state.tool === "pen") state.points.push(finalPoint);
    else if (state.points.length) state.points = [state.points[0], finalPoint];

    const points = state.points.slice();
    const tool = state.tool;
    clearPreview();

    // Use path length rather than endpoint distance so closed circles are accepted.
    if (points.length >= 2 && pathLength(points) > 0.25) {
      snapshot();
      const group = buildShape(tool, points);
      if (group) {
        state.svg.appendChild(group);
        if (tool === "pen") suggestPerfectShape(group, points);
      }
    }

    state.pointerId = null;
    state.points = [];
  }

  function cancelPointer(event) {
    if (
      event &&
      state.pointerId !== null &&
      event.pointerId !== state.pointerId
    )
      return;
    clearPreview();
    state.pointerId = null;
    state.points = [];
  }

  /* ------------------------------------------------------------------------
     Shape builders
     ------------------------------------------------------------------------ */

  function createGroup(kind) {
    return createSvgElement("g", {
      class: "annotation-group",
      "data-annotation-kind": kind,
    });
  }

  function buildArrow(group, start, end) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const headLength = 3.8;
    const spread = Math.PI / 7;
    const left = {
      x: end.x - headLength * Math.cos(angle - spread),
      y: end.y - headLength * Math.sin(angle - spread),
    };
    const right = {
      x: end.x - headLength * Math.cos(angle + spread),
      y: end.y - headLength * Math.sin(angle + spread),
    };

    const segments = [
      [start.x, start.y, end.x, end.y],
      [end.x, end.y, left.x, left.y],
      [end.x, end.y, right.x, right.y],
    ];
    segments.forEach(([x1, y1, x2, y2]) => {
      const line = createSvgElement("line", {
        x1: formatNumber(x1),
        y1: formatNumber(y1),
        x2: formatNumber(x2),
        y2: formatNumber(y2),
      });
      setStrokeStyle(line);
      group.appendChild(line);
    });
  }

  function buildShape(tool, points) {
    if (!points?.length) return null;
    const simplified = simplifyPoints(points);
    const start = simplified[0];
    const end = simplified[simplified.length - 1] || start;
    const group = createGroup(tool);

    if (tool === "pen") {
      const path = createSvgElement("path", { d: pointsToPath(simplified) });
      setStrokeStyle(path);
      group.appendChild(path);
      return group;
    }

    if (tool === "line") {
      const line = createSvgElement("line", {
        x1: formatNumber(start.x),
        y1: formatNumber(start.y),
        x2: formatNumber(end.x),
        y2: formatNumber(end.y),
      });
      setStrokeStyle(line);
      group.appendChild(line);
      return group;
    }

    if (tool === "arrow") {
      buildArrow(group, start, end);
      return group;
    }

    if (tool === "rect") {
      const rect = createSvgElement("rect", {
        x: formatNumber(Math.min(start.x, end.x)),
        y: formatNumber(Math.min(start.y, end.y)),
        width: formatNumber(Math.abs(end.x - start.x)),
        height: formatNumber(Math.abs(end.y - start.y)),
      });
      setStrokeStyle(rect);
      group.appendChild(rect);
      return group;
    }

    if (tool === "ellipse") {
      const ellipse = createSvgElement("ellipse", {
        cx: formatNumber((start.x + end.x) / 2),
        cy: formatNumber((start.y + end.y) / 2),
        rx: formatNumber(Math.max(0.3, Math.abs(end.x - start.x) / 2)),
        ry: formatNumber(Math.max(0.3, Math.abs(end.y - start.y) / 2)),
      });
      setStrokeStyle(ellipse);
      group.appendChild(ellipse);
      return group;
    }

    return null;
  }

  /* ------------------------------------------------------------------------
     Shape recognition and optional perfection
     ------------------------------------------------------------------------ */

  function perpendicularDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    return (
      Math.abs(
        dy * point.x - dx * point.y + end.x * start.y - end.y * start.x,
      ) / length
    );
  }

  function classifyStroke(points) {
    if (points.length < 10 || !state.svg) return null;
    const rect = state.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    // Measure in physical pixels so a circle on a wide image is not called an ellipse.
    const pixelPoints = points.map((point) => ({
      x: (point.x * rect.width) / 100,
      y: (point.y * rect.height) / 100,
    }));
    const start = pixelPoints[0];
    const end = pixelPoints[pixelPoints.length - 1];
    const totalLength = pathLength(pixelPoints);
    const endpointDistance = distance(start, end);

    if (totalLength > 16) {
      let maxDeviation = 0;
      pixelPoints.forEach((point) => {
        maxDeviation = Math.max(
          maxDeviation,
          perpendicularDistance(point, start, end),
        );
      });
      const straightness = endpointDistance / totalLength;
      const deviationLimit = Math.max(
        3.5,
        Math.min(rect.width, rect.height) * 0.012,
      );
      if (straightness >= 0.94 && maxDeviation <= deviationLimit) {
        return {
          kind: "line",
          originalStart: points[0],
          originalEnd: points[points.length - 1],
        };
      }
    }

    if (
      endpointDistance > Math.min(rect.width, rect.height) * 0.18 ||
      totalLength < 36
    )
      return null;

    const xs = pixelPoints.map((point) => point.x);
    const ys = pixelPoints.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const widthPx = maxX - minX;
    const heightPx = maxY - minY;
    if (widthPx < 20 || heightPx < 20) return null;

    const centerPx = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const normalizedRadii = pixelPoints.map((point) => {
      const nx = (point.x - centerPx.x) / (widthPx / 2);
      const ny = (point.y - centerPx.y) / (heightPx / 2);
      return Math.hypot(nx, ny);
    });
    const meanRadius = average(normalizedRadii);
    const meanError = average(
      normalizedRadii.map((radius) => Math.abs(radius - meanRadius)),
    );
    if (meanRadius < 0.72 || meanRadius > 1.28 || meanError > 0.17) return null;

    const aspectRatio = widthPx / heightPx;
    return {
      kind: aspectRatio >= 0.78 && aspectRatio <= 1.28 ? "circle" : "ellipse",
      center: {
        x: (centerPx.x / rect.width) * 100,
        y: (centerPx.y / rect.height) * 100,
      },
      width: (widthPx / rect.width) * 100,
      height: (heightPx / rect.height) * 100,
      radiusPx: Math.min(widthPx, heightPx) / 2,
    };
  }

  function getGroupStrokeStyle(group) {
    const stroked = group?.querySelector("[stroke]");
    if (!stroked) return { color: state.color, width: state.width };
    const parsedWidth = Number(stroked.getAttribute("stroke-width"));
    return {
      color: stroked.getAttribute("stroke") || state.color,
      width:
        Number.isFinite(parsedWidth) && parsedWidth > 0
          ? parsedWidth
          : state.width,
    };
  }

  function suggestPerfectShape(group, points) {
    const detected = classifyStroke(points);
    if (!detected || !group) {
      state.suggestion = null;
      hideSuggestion();
      return;
    }

    state.suggestion = { group, detected };
    const text = document.getElementById("annotationStatusText");
    const accept = document.getElementById("acceptAnnotationSuggestionBtn");
    if (text) {
      text.textContent =
        detected.kind === "line"
          ? "Straight line detected."
          : detected.kind === "circle"
            ? "Circle detected."
            : "Ellipse detected.";
    }
    if (accept) {
      accept.textContent =
        detected.kind === "line"
          ? "Straighten line"
          : detected.kind === "circle"
            ? "Perfect circle"
            : "Perfect ellipse";
    }
    const row = document.getElementById("annotationStatusRow");
    if (row) row.style.display = "flex";
  }

  function hideSuggestion() {
    const row = document.getElementById("annotationStatusRow");
    if (row) row.style.display = "none";
  }

  function perfectShape(detected, style) {
    const group = createGroup(`${detected.kind}-perfect`);
    if (detected.kind === "line") {
      const line = createSvgElement("line", {
        x1: formatNumber(detected.originalStart.x),
        y1: formatNumber(detected.originalStart.y),
        x2: formatNumber(detected.originalEnd.x),
        y2: formatNumber(detected.originalEnd.y),
      });
      setStrokeStyle(line, style.color, style.width);
      group.appendChild(line);
      return group;
    }

    const rect = state.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const isCircle = detected.kind === "circle";
    const rx = isCircle
      ? (detected.radiusPx / rect.width) * 100
      : detected.width / 2;
    const ry = isCircle
      ? (detected.radiusPx / rect.height) * 100
      : detected.height / 2;
    const ellipse = createSvgElement("ellipse", {
      cx: formatNumber(detected.center.x),
      cy: formatNumber(detected.center.y),
      rx: formatNumber(rx),
      ry: formatNumber(ry),
    });
    setStrokeStyle(ellipse, style.color, style.width);
    group.appendChild(ellipse);
    return group;
  }

  window.acceptAnnotationSuggestion = () => {
    if (!state.suggestion || !state.svg) return;
    const { group, detected } = state.suggestion;
    const replacement = perfectShape(detected, getGroupStrokeStyle(group));
    if (!replacement) return;
    snapshot();
    group.replaceWith(replacement);
    state.suggestion = null;
    hideSuggestion();
  };

  window.dismissAnnotationSuggestion = () => {
    state.suggestion = null;
    hideSuggestion();
  };

  /* ------------------------------------------------------------------------
     Toolbar and image selection
     ------------------------------------------------------------------------ */

  function updateToolbar() {
    const toolbar = document.getElementById("annotationToolbar");
    const launch = document.getElementById("annotationLaunchBtn");
    if (toolbar) toolbar.style.display = state.wrapper ? "block" : "none";
    if (launch) launch.classList.toggle("is-active", state.drawing);

    document.querySelectorAll("[data-annotation-tool]").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.getAttribute("data-annotation-tool") === state.tool,
      );
    });

    const color = document.getElementById("annotationColor");
    const width = document.getElementById("annotationWidth");
    if (color && color.value !== state.color) color.value = state.color;
    if (width && Number(width.value) !== state.width)
      width.value = String(state.width);

    document
      .querySelectorAll(".note-image-annotation .note-annotation-layer")
      .forEach((svg) => {
        const active = Boolean(
          state.drawing && state.wrapper && state.wrapper.contains(svg),
        );
        svg.style.setProperty(
          "pointer-events",
          active ? "all" : "none",
          "important",
        );
        svg.style.setProperty("z-index", "50", "important");
        svg.style.setProperty("touch-action", "none", "important");
      });
  }

  function selectImageWrapper(wrapper) {
    if (!wrapper) return;
    ensureAnnotationLayer(wrapper);

    document
      .querySelectorAll(".note-image-annotation.is-selected")
      .forEach((other) => {
        if (other !== wrapper)
          other.classList.remove("is-selected", "is-drawing");
      });

    wrapper.classList.add("is-selected");
    state.wrapper = wrapper;
    state.selectedWrapper = wrapper;
    state.svg = wrapper.querySelector(".note-annotation-layer");
    state.history = [];
    state.suggestion = null;
    hideSuggestion();
    if (state.svg) bindSvg(state.svg);
    updateToolbar();
  }

  window.toggleAnnotationMode = () => {
    if (!state.wrapper) {
      const editor = getEditor();
      const selectedImage = editor?.querySelector(
        ".note-image-annotation.is-selected img.note-img",
      );
      const image = selectedImage || editor?.querySelector("img.note-img");
      if (!image) {
        setStatus(
          "Insert or select an image first, then click the marker tool.",
        );
        return;
      }
      const wrapper = ensureAnnotationWrapper(image);
      if (!wrapper) {
        setStatus("Could not prepare this image for annotation.");
        return;
      }
      selectImageWrapper(wrapper);
    }

    state.drawing = !state.drawing;
    if (state.wrapper)
      state.wrapper.classList.toggle("is-drawing", state.drawing);
    if (!state.drawing) {
      clearPreview();
      state.pointerId = null;
      state.points = [];
      state.suggestion = null;
      hideSuggestion();
    }
    updateToolbar();
  };

  window.finishAnnotationMode = () => {
    clearPreview();
    state.drawing = false;
    state.wrapper?.classList.remove("is-drawing", "is-selected");
    state.wrapper = null;
    state.selectedWrapper = null;
    state.svg = null;
    state.history = [];
    state.suggestion = null;
    state.pointerId = null;
    state.points = [];
    hideSuggestion();
    updateToolbar();
  };

  window.setAnnotationTool = (tool) => {
    if (!TOOLS.has(tool)) return;
    state.tool = tool;
    state.drawing = true;
    state.wrapper?.classList.add("is-drawing");
    state.suggestion = null;
    hideSuggestion();
    updateToolbar();
  };

  window.setAnnotationColor = (value) => {
    // The toolbar is a color input, but validate the public function too.
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value))
      state.color = value;
    updateToolbar();
  };

  window.setAnnotationWidth = (value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) state.width = clamp(numeric, 1, 10);
    updateToolbar();
  };

  window.undoAnnotation = () => {
    if (!state.svg || !state.history.length) return;
    state.svg.innerHTML = state.history.pop();
    state.suggestion = null;
    hideSuggestion();
  };

  window.clearAnnotations = () => {
    if (!state.svg || !state.svg.children.length) return;
    snapshot();
    state.svg.innerHTML = "";
    state.suggestion = null;
    hideSuggestion();
  };

  /* ------------------------------------------------------------------------
     Insert-image flow
     ------------------------------------------------------------------------ */

  function installImageInsertOverrides() {
    if (imageInsertOverridesInstalled) return;
    imageInsertOverridesInstalled = true;
    const originalCancel = window.cancelPendingImage;

    window.triggerImageInsert = () => {
      const body = getEditor();
      if (!body) return;
      body.focus();
      const selection = window.getSelection();
      state.savedImageSelection = selection?.rangeCount
        ? selection.getRangeAt(0).cloneRange()
        : null;
      document.getElementById("imageFileInput")?.click();
    };

    window.handleImageFileChosen = (event) => {
      const file = event?.target?.files?.[0];
      if (event?.target) event.target.value = "";
      if (!file) return;
      if (!file.type || !file.type.startsWith("image/")) {
        alert("Please select a valid image file.");
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const result = loadEvent?.target?.result;
        if (typeof result !== "string" || !result.startsWith("data:image/")) {
          state.pendingImageDataUrl = null;
          setStatus("The selected file could not be read as an image.");
          return;
        }
        state.pendingImageDataUrl = result;
        const picker = document.getElementById("imageStylePicker");
        if (picker) picker.style.display = "flex";
      };
      reader.onerror = () => {
        state.pendingImageDataUrl = null;
        setStatus("Failed to read image file.");
      };
      reader.readAsDataURL(file);
    };

    window.cancelPendingImage = () => {
      state.pendingImageDataUrl = null;
      state.savedImageSelection = null;
      const picker = document.getElementById("imageStylePicker");
      if (picker) picker.style.display = "none";
      try {
        if (typeof originalCancel === "function") originalCancel.call(window);
      } catch (_error) {
        // Existing optional cancel cleanup must not break this add-on.
      }
    };

    window.insertPendingImage = (styleClass) => {
      if (!state.pendingImageDataUrl) return;
      const body = getEditor();
      if (!body) return;

      body.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      if (state.savedImageSelection && selection) {
        try {
          selection.addRange(state.savedImageSelection.cloneRange());
        } catch (_error) {
          // If the saved range became invalid, keep the editor's current caret.
        }
      }

      const layout = getLayoutFromClass(styleClass || "");
      const imageClasses =
        layout === "normal" ? "note-img" : `note-img ${layout}`;
      const safeClasses = escapeHtml(imageClasses);
      const safeSrc = escapeHtml(state.pendingImageDataUrl);
      const id = `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const imageHtml = `
        <div class="note-image-annotation" data-annotation-image="true" data-annotation-id="${id}" data-layout="${layout}" contenteditable="false">
          <div class="note-image-annotation-inner">
            <img class="${safeClasses}" src="${safeSrc}" alt="" draggable="false" />
            <svg class="note-annotation-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          </div>
        </div>
        <p><br></p>
      `;

      let inserted = false;
      try {
        inserted = document.execCommand("insertHTML", false, imageHtml);
      } catch (_error) {
        inserted = false;
      }
      if (!inserted) {
        setStatus(
          "The browser could not insert the image at the current cursor. Click inside the editor and try again.",
        );
        return;
      }

      const wrapper = body.querySelector(
        `.note-image-annotation[data-annotation-id="${id}"]`,
      );
      if (wrapper) {
        wrapper.removeAttribute("data-annotation-id");
        const image = getImageInWrapper(wrapper);
        if (!image) {
          setStatus("The inserted image element could not be found.");
        } else {
          const activateWhenReady = () => {
            if (!wrapper.isConnected) return;
            if (!image.naturalWidth || !image.naturalHeight) {
              setStatus(
                "The image was inserted but did not finish loading. Try inserting it again.",
              );
              return;
            }

            // Capture only after the image has intrinsic dimensions.
            const initialLayout = captureImageLayout(image);
            if (initialLayout) {
              initialLayout.layout = layout;
              if (!(initialLayout.widthPx > 0)) {
                // Normal images can use their intrinsic width; preset layouts
                // must keep their CSS width rules instead of being forced to
                // the image's potentially very large natural pixel width.
                initialLayout.widthPx =
                  layout === "normal" ? image.naturalWidth : 0;
              }
              if (!(initialLayout.heightPx > 0))
                initialLayout.heightPx = image.naturalHeight;
              wrapper.dataset.annotationLayout = JSON.stringify(initialLayout);
              wrapper.dataset.layout = layout;
            }
            ensureAnnotationLayer(wrapper);
            selectImageWrapper(wrapper);
          };

          if (image.complete) activateWhenReady();
          else {
            image.addEventListener("load", activateWhenReady, { once: true });
            image.addEventListener(
              "error",
              () => {
                setStatus("Failed to load the inserted image.");
              },
              { once: true },
            );
          }
        }
      } else {
        setStatus(
          "The image was inserted, but its annotation wrapper could not be found.",
        );
      }

      window.cancelPendingImage();
    };
  }

  /* ------------------------------------------------------------------------
     Toolbar injection
     ------------------------------------------------------------------------ */

  function injectToolbarButton() {
    if (document.getElementById("annotationLaunchBtn")) return;
    const toolbar = document.querySelector(".editor-toolbar");
    const imageButton = toolbar?.querySelector(
      '[onclick*="triggerImageInsert"]',
    );
    if (!toolbar || !imageButton || !imageButton.parentElement) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tb-btn annotation-launch-btn";
    button.id = "annotationLaunchBtn";
    button.title = "Draw / annotate selected image";
    button.setAttribute("aria-label", "Draw / annotate selected image");
    button.innerHTML = '<i class="fa-solid fa-marker" aria-hidden="true"></i>';
    button.addEventListener("click", window.toggleAnnotationMode);
    imageButton.parentElement.insertBefore(button, imageButton.nextSibling);
  }

  function injectAnnotationToolbar() {
    if (document.getElementById("annotationToolbar")) return;
    const editorBody = getEditor();
    if (!editorBody) return;

    const toolbar = document.createElement("div");
    toolbar.className = "annotation-toolbar";
    toolbar.id = "annotationToolbar";
    toolbar.style.display = "none";
    toolbar.innerHTML = `
      <div class="annotation-toolbar-main">
        <span class="annotation-tool-label">Draw on image</span>
        <div class="annotation-tool-group">
          <button type="button" class="annotation-tool-btn is-active" data-annotation-tool="pen" title="Freehand marker" aria-label="Freehand marker"><i class="fa-solid fa-pen" aria-hidden="true"></i><span>Pen</span></button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="line" title="Straight line" aria-label="Straight line"><i class="fa-solid fa-minus" aria-hidden="true"></i><span>Line</span></button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="arrow" title="Arrow" aria-label="Arrow"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><span>Arrow</span></button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="rect" title="Rectangle" aria-label="Rectangle"><i class="fa-regular fa-square" aria-hidden="true"></i><span>Box</span></button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="ellipse" title="Ellipse / circle" aria-label="Ellipse / circle"><i class="fa-regular fa-circle" aria-hidden="true"></i><span>Circle</span></button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="eraser" title="Erase annotation" aria-label="Erase annotation"><i class="fa-solid fa-eraser" aria-hidden="true"></i><span>Erase</span></button>
        </div>
        <label class="annotation-control" title="Marker color"><span>Color</span><input id="annotationColor" type="color" value="#b23a39" /></label>
        <label class="annotation-control annotation-width-control" title="Marker thickness"><span>Size</span><input id="annotationWidth" type="range" min="1" max="10" step="0.5" value="4" /></label>
        <button type="button" class="annotation-action-btn" id="annotationUndoBtn" title="Undo last annotation" aria-label="Undo last annotation"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
        <button type="button" class="annotation-action-btn" id="annotationClearBtn" title="Clear annotations from this image" aria-label="Clear annotations from this image"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
        <button type="button" class="annotation-done-btn" id="annotationDoneBtn" title="Finish drawing"><i class="fa-solid fa-check" aria-hidden="true"></i><span>Done</span></button>
      </div>
      <div class="annotation-status-row" id="annotationStatusRow" style="display:none">
        <span id="annotationStatusText"></span>
        <div class="annotation-suggestion-actions">
          <button type="button" id="acceptAnnotationSuggestionBtn" class="annotation-suggestion-btn is-primary">Perfect it</button>
          <button type="button" id="dismissAnnotationSuggestionBtn" class="annotation-suggestion-btn">Keep freehand</button>
        </div>
      </div>
    `;

    const imagePicker = document.getElementById("imageStylePicker");
    if (imagePicker) imagePicker.insertAdjacentElement("afterend", toolbar);
    else editorBody.insertAdjacentElement("beforebegin", toolbar);

    toolbar.querySelectorAll("[data-annotation-tool]").forEach((button) => {
      button.addEventListener("click", () =>
        window.setAnnotationTool(button.getAttribute("data-annotation-tool")),
      );
    });
    toolbar
      .querySelector("#annotationColor")
      ?.addEventListener("input", (event) => {
        window.setAnnotationColor(event.target.value);
      });
    toolbar
      .querySelector("#annotationWidth")
      ?.addEventListener("input", (event) => {
        window.setAnnotationWidth(event.target.value);
      });
    toolbar
      .querySelector("#annotationUndoBtn")
      ?.addEventListener("click", window.undoAnnotation);
    toolbar
      .querySelector("#annotationClearBtn")
      ?.addEventListener("click", window.clearAnnotations);
    toolbar
      .querySelector("#annotationDoneBtn")
      ?.addEventListener("click", window.finishAnnotationMode);
    toolbar
      .querySelector("#acceptAnnotationSuggestionBtn")
      ?.addEventListener("click", window.acceptAnnotationSuggestion);
    toolbar
      .querySelector("#dismissAnnotationSuggestionBtn")
      ?.addEventListener("click", window.dismissAnnotationSuggestion);
  }

  /* ------------------------------------------------------------------------
     Editor events
     ------------------------------------------------------------------------ */

  function initEditorBinding() {
    const editor = getEditor();
    if (!editor || editor.dataset.annotationAddonBound === "true") return;
    editor.dataset.annotationAddonBound = "true";

    editor.addEventListener("click", (event) => {
      const target = event.target;
      const image = target?.closest?.("img.note-img");
      if (!image || !editor.contains(image) || state.drawing) return;
      const wrapper = ensureAnnotationWrapper(image);
      if (!wrapper) return;
      event.preventDefault();
      event.stopPropagation();
      selectImageWrapper(wrapper);
    });

    editor.addEventListener("mousedown", (event) => {
      if (state.drawing && event.target?.closest?.(".note-image-annotation"))
        event.preventDefault();
    });

    editor.addEventListener("dragstart", (event) => {
      if (event.target?.closest?.("img.note-img")) event.preventDefault();
    });
  }

  /* ------------------------------------------------------------------------
     Publish/save sanitization
     ------------------------------------------------------------------------ */

  function installGlobalPublishWrapper() {
    if (typeof window.publishArticle !== "function") return false;
    if (window.publishArticle.__annotationSanitized === true) return true;

    const originalPublishArticle = window.publishArticle;
    const wrappedPublish = async function (...args) {
      const editor = getEditor();
      const targets =
        editor?.querySelectorAll?.(
          ".note-image-annotation.is-selected, .note-image-annotation.is-drawing",
        ) || [];
      const restoreState = Array.from(targets).map((wrapper) => ({
        wrapper,
        selected: wrapper.classList.contains("is-selected"),
        drawing: wrapper.classList.contains("is-drawing"),
      }));

      cleanAnnotationEditorDom();
      try {
        return await originalPublishArticle.apply(this, args);
      } finally {
        const overlay = document.getElementById("editor-overlay");
        if (overlay?.classList.contains("active")) {
          restoreState.forEach(({ wrapper, selected, drawing }) => {
            if (!wrapper?.isConnected) return;
            wrapper.classList.toggle("is-selected", selected);
            wrapper.classList.toggle("is-drawing", drawing);
          });
          updateToolbar();
        }
      }
    };
    wrappedPublish.__annotationSanitized = true;
    window.publishArticle = wrappedPublish;
    return true;
  }

  function installPublishSanitizer() {
    if (publishSanitizerInstalled) return;
    publishSanitizerInstalled = true;

    installGlobalPublishWrapper();

    // Retry at click time in case the main editor script defined publishArticle later.
    document.addEventListener(
      "click",
      (event) => {
        const publishButton = event.target?.closest?.("#publishBtn");
        if (!publishButton) return;
        installGlobalPublishWrapper();
        // If the function is wrapped, it sanitizes and restores state around publishing.
        // Fallback is for legacy pages whose publish action reads editorBody.innerHTML directly.
        if (window.publishArticle?.__annotationSanitized !== true)
          cleanAnnotationEditorDom();
      },
      true,
    );
  }

  /* ------------------------------------------------------------------------
     Editor overlay observation and initialization
     ------------------------------------------------------------------------ */

  function handleEditorOverlayChange(overlay) {
    const active = overlay.classList.contains("active");
    if (!active) {
      clearPreview();
      state.drawing = false;
      state.wrapper?.classList.remove("is-selected", "is-drawing");
      state.wrapper = null;
      state.selectedWrapper = null;
      state.svg = null;
      state.history = [];
      state.suggestion = null;
      state.pointerId = null;
      state.points = [];
      hideSuggestion();
      updateToolbar();
      return;
    }

    initEditorBinding();
    const editor = getEditor();
    editor?.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
      ensureAnnotationLayer(wrapper);
    });
    editor?.querySelectorAll("img.note-img").forEach((image) => {
      if (image.closest(".note-image-annotation")) return;
      // Existing article content may contain images without annotation wrappers.
      // Keep them untouched until the user selects one.
    });
    updateToolbar();
  }

  function observeEditorOverlay() {
    const overlay = document.getElementById("editor-overlay");
    if (!overlay || observedOverlays.has(overlay)) return;
    observedOverlays.add(overlay);
    const observer = new MutationObserver(() =>
      handleEditorOverlayChange(overlay),
    );
    observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    if (overlay.classList.contains("active"))
      handleEditorOverlayChange(overlay);
  }

  function init() {
    injectToolbarButton();
    injectAnnotationToolbar();
    initEditorBinding();
    installImageInsertOverrides();
    observeEditorOverlay();
    installPublishSanitizer();
    updateToolbar();
  }

  function bootstrap() {
    init();
    // The editor overlay is sometimes inserted by the host after initial page load.
    if (!initObserver && document.body) {
      const hostSelectors =
        "#editorBody, #editor-overlay, .editor-toolbar, #imageStylePicker";
      const containsHostElement = (node) => {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        return (
          node.matches(hostSelectors) ||
          Boolean(node.querySelector(hostSelectors))
        );
      };
      initObserver = new MutationObserver((records) => {
        // Ignore normal editor edits and SVG stroke previews to avoid work on
        // every pointer movement. Re-initialize only if host UI is inserted or removed.
        const hostChanged = records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            containsHostElement,
          ),
        );
        if (!hostChanged) return;
        injectToolbarButton();
        injectAnnotationToolbar();
        initEditorBinding();
        observeEditorOverlay();
        updateToolbar();
      });
      initObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
