/* ==========================================================================
   NOTES IMAGE ANNOTATION ADD-ON
   --------------------------------------------------------------------------
   Drop-in extension for the existing AWS Commonplace note editor.

   Features:
   - Freehand marker / pen
   - Straight line
   - Arrow
   - Rectangle
   - Ellipse / circle
   - Eraser
   - Undo / clear
   - Color + marker width
   - Automatic freehand shape recognition
   - Optional "Perfect it" action for detected line/circle/ellipse
   - Inline SVG annotations saved inside existing body_html

   No Supabase schema change is required.
========================================================================== */

(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const HISTORY_LIMIT = 40;

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
  };

  /* -----------------------------------------------------------------------
     SMALL HELPERS
  ----------------------------------------------------------------------- */

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const escapeHtml = (value) => {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  };

  const setStatus = (message) => {
    if (typeof window.setEditorStatus === "function") {
      window.setEditorStatus(message);
    }
  };

  const formatNumber = (value) => Number(value.toFixed(2));

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const pathLength = (points) => {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += distance(points[i - 1], points[i]);
    }
    return total;
  };

  const average = (values) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

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

  function getLayoutFromClass(className = "") {
    if (className.includes("float-left")) return "float-left";
    if (className.includes("float-right")) return "float-right";
    if (className.includes("center-small")) return "center-small";
    if (className.includes("full")) return "full";
    return "normal";
  }

  function setStrokeStyle(element) {
    element.setAttribute("fill", "none");
    element.setAttribute("stroke", state.color);
    element.setAttribute("stroke-width", getStrokeWidthInViewBoxUnits());
    element.setAttribute("stroke-linecap", "round");
    element.setAttribute("stroke-linejoin", "round");
    element.setAttribute("opacity", "0.92");
    element.setAttribute("vector-effect", "non-scaling-stroke");
  }

  function getStrokeWidthInViewBoxUnits() {
    const svg = state.svg;
    const rect = svg?.getBoundingClientRect?.();
    const minSize = Math.max(1, Math.min(rect?.width || 600, rect?.height || 400));
    return Math.max(0.25, (state.width / minSize) * 100);
  }

  function pointsToPath(points) {
    return points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${formatNumber(point.x)} ${formatNumber(point.y)}`,
      )
      .join(" ");
  }

  /* -----------------------------------------------------------------------
     Ramer–Douglas–Peucker simplification
     Prevents long pen strokes from producing unnecessarily huge body_html.
  ----------------------------------------------------------------------- */

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
          ((point.x - x) * dx + (point.y - y) * dy) /
          (dx * dx + dy * dy);

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
        const sqDistance = sqSegDist(points[i], points[startIndex], points[endIndex]);

        if (sqDistance > maxDistance) {
          maxDistance = sqDistance;
          maxIndex = i;
        }
      }

      if (maxDistance > sqTolerance) {
        markers[maxIndex] = 1;
        stack.push([startIndex, maxIndex]);
        stack.push([maxIndex, endIndex]);
      }
    }

    return points.filter((_, index) => markers[index]);
  }

  /* -----------------------------------------------------------------------
     IMAGE WRAPPER
  ----------------------------------------------------------------------- */

  function ensureAnnotationWrapper(image) {
    if (!image) return null;

    const existing = image.closest(".note-image-annotation");

    if (existing) {
      ensureAnnotationLayer(existing);
      return existing;
    }

    const parent = image.parentNode;
    if (!parent) return null;

    const wrapper = document.createElement("div");
    const inner = document.createElement("div");
    const svg = createSvgElement("svg", {
      class: "note-annotation-layer",
      viewBox: "0 0 100 100",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    });

    wrapper.className = "note-image-annotation";
    wrapper.setAttribute("data-annotation-image", "true");
    wrapper.setAttribute("data-layout", getLayoutFromClass(image.className || ""));
    wrapper.setAttribute("contenteditable", "false");

    inner.className = "note-image-annotation-inner";

    parent.insertBefore(wrapper, image);
    inner.appendChild(image);
    inner.appendChild(svg);
    wrapper.appendChild(inner);

    ensureAnnotationLayer(wrapper);
    return wrapper;
  }

  function ensureAnnotationLayer(wrapper) {
    if (!wrapper) return null;

    wrapper.setAttribute("contenteditable", "false");

    let inner = wrapper.querySelector(":scope > .note-image-annotation-inner");
    const image = wrapper.querySelector(":scope img.note-img") || wrapper.querySelector("img.note-img");
    let svg = wrapper.querySelector(":scope > .note-image-annotation-inner > .note-annotation-layer") || wrapper.querySelector(".note-annotation-layer");

    if (!inner) {
      inner = document.createElement("div");
      inner.className = "note-image-annotation-inner";

      while (wrapper.firstChild) {
        inner.appendChild(wrapper.firstChild);
      }

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
    }

    if (!wrapper.dataset.layout && image) {
      wrapper.dataset.layout = getLayoutFromClass(image.className || "");
    }

    bindSvg(svg);
    return svg;
  }

  function selectImageWrapper(wrapper) {
    if (!wrapper) return;

    ensureAnnotationLayer(wrapper);

    document
      .querySelectorAll(".note-image-annotation.is-selected")
      .forEach((item) => {
        if (item !== wrapper) item.classList.remove("is-selected");
      });

    wrapper.classList.add("is-selected");

    state.wrapper = wrapper;
    state.svg = wrapper.querySelector(".note-annotation-layer");
    state.history = [];
    state.suggestion = null;
    hideSuggestion();

    if (state.svg) bindSvg(state.svg);
    updateToolbar();
  }

  /* -----------------------------------------------------------------------
     SVG POINTER EVENTS
  ----------------------------------------------------------------------- */

  function pointFromEvent(event, svg) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };

    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  function bindSvg(svg) {
    if (!svg || svg.dataset.annotationBound === "true") return;

    svg.dataset.annotationBound = "true";
    svg.addEventListener("pointerdown", beginPointer);
    svg.addEventListener("pointermove", movePointer);
    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", cancelPointer);
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

    const group = buildShape(state.tool, points);
    if (!group) return;

    group.setAttribute("data-preview", "true");
    state.svg.appendChild(group);
    state.preview = group;
  }

  function beginPointer(event) {
    if (!state.drawing || !state.svg) return;

    event.preventDefault();
    state.pointerId = event.pointerId;
    state.points = [pointFromEvent(event, state.svg)];

    try {
      state.svg.setPointerCapture(event.pointerId);
    } catch (_) {
      /* Pointer capture is a convenience; continue without it. */
    }

    if (state.tool === "eraser") {
      eraseAtTarget(event.target);
      state.points = [];
      return;
    }

    setPreview(state.points);
  }

  function movePointer(event) {
    if (!state.drawing || state.pointerId !== event.pointerId || !state.svg) return;

    event.preventDefault();
    const point = pointFromEvent(event, state.svg);

    if (state.tool === "pen") {
      state.points.push(point);
    } else {
      state.points = [state.points[0], point];
    }

    setPreview(state.points);
  }

  function endPointer(event) {
    if (!state.drawing || state.pointerId !== event.pointerId || !state.svg) return;

    event.preventDefault();
    const finalPoint = pointFromEvent(event, state.svg);

    if (state.tool === "eraser") {
      state.pointerId = null;
      state.points = [];
      return;
    }

    if (state.tool === "pen") {
      state.points.push(finalPoint);
    } else {
      state.points = [state.points[0], finalPoint];
    }

    const points = state.points.slice();
    const tool = state.tool;

    clearPreview();

    if (points.length >= 2 && distance(points[0], points.at(-1)) > 0.25) {
      snapshot();

      const group = buildShape(tool, points);
      if (group) {
        state.svg.appendChild(group);

        if (tool === "pen") {
          suggestPerfectShape(group, points);
        }
      }
    }

    state.pointerId = null;
    state.points = [];
  }

  function cancelPointer() {
    clearPreview();
    state.pointerId = null;
    state.points = [];
  }

  function eraseAtTarget(target) {
    const group = target?.closest?.("[data-annotation-kind]");

    if (!group || group.getAttribute("data-preview") === "true" || !state.svg?.contains(group)) {
      return;
    }

    snapshot();
    group.remove();
  }

  /* -----------------------------------------------------------------------
     SHAPE BUILDERS
  ----------------------------------------------------------------------- */

  function createGroup(kind) {
    return createSvgElement("g", {
      class: "annotation-group",
      "data-annotation-kind": kind,
    });
  }

  function buildArrow(group, start, end) {
    const main = createSvgElement("line", {
      x1: formatNumber(start.x),
      y1: formatNumber(start.y),
      x2: formatNumber(end.x),
      y2: formatNumber(end.y),
    });

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const length = 3.8;
    const spread = Math.PI / 7;

    const left = {
      x: end.x - length * Math.cos(angle - spread),
      y: end.y - length * Math.sin(angle - spread),
    };

    const right = {
      x: end.x - length * Math.cos(angle + spread),
      y: end.y - length * Math.sin(angle + spread),
    };

    const headA = createSvgElement("line", {
      x1: formatNumber(end.x),
      y1: formatNumber(end.y),
      x2: formatNumber(left.x),
      y2: formatNumber(left.y),
    });

    const headB = createSvgElement("line", {
      x1: formatNumber(end.x),
      y1: formatNumber(end.y),
      x2: formatNumber(right.x),
      y2: formatNumber(right.y),
    });

    [main, headA, headB].forEach(setStrokeStyle);
    group.append(main, headA, headB);
  }

  function buildShape(tool, points) {
    if (!points?.length) return null;

    const simplified = simplifyPoints(points);
    const start = simplified[0];
    const end = simplified.at(-1) || start;
    const group = createGroup(tool);

    if (tool === "pen") {
      const path = createSvgElement("path", {
        d: pointsToPath(simplified),
      });

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

  /* -----------------------------------------------------------------------
     SHAPE RECOGNITION
  ----------------------------------------------------------------------- */

  function perpendicularDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;

    return (
      Math.abs(
        dy * point.x -
          dx * point.y +
          end.x * start.y -
          end.y * start.x,
      ) / length
    );
  }

  function classifyStroke(points) {
    if (points.length < 10 || !state.svg) return null;

    const rect = state.svg.getBoundingClientRect();
    const scaleX = (rect.width || 1) / 100;
    const scaleY = (rect.height || 1) / 100;

    /*
       Detection is done in screen-pixel space rather than the SVG's
       normalized 0–100 coordinates. This prevents a real circle from
       being misclassified as an ellipse on a wide/short image.
    */
    const pixelPoints = points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    }));

    const start = pixelPoints[0];
    const end = pixelPoints.at(-1);
    const totalLength = pathLength(pixelPoints);
    const endpointDistance = distance(start, end);

    /* -------------------- line -------------------- */
    if (totalLength > 16) {
      let maxDeviation = 0;

      pixelPoints.forEach((point) => {
        maxDeviation = Math.max(
          maxDeviation,
          perpendicularDistance(point, start, end),
        );
      });

      const straightness = endpointDistance / totalLength;
      const deviationLimit = Math.max(3.5, Math.min(rect.width, rect.height) * 0.012);

      if (straightness >= 0.94 && maxDeviation <= deviationLimit) {
        return {
          kind: "line",
          originalStart: points[0],
          originalEnd: points.at(-1),
        };
      }
    }

    /* -------------------- circle / ellipse -------------------- */
    if (endpointDistance > Math.min(rect.width, rect.height) * 0.18 || totalLength < 36) {
      return null;
    }

    const xs = pixelPoints.map((point) => point.x);
    const ys = pixelPoints.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const widthPx = maxX - minX;
    const heightPx = maxY - minY;

    if (widthPx < 20 || heightPx < 20) return null;

    const centerPx = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };

    const normalizedRadii = pixelPoints.map((point) => {
      const nx = (point.x - centerPx.x) / (widthPx / 2);
      const ny = (point.y - centerPx.y) / (heightPx / 2);
      return Math.hypot(nx, ny);
    });

    const meanRadius = average(normalizedRadii);
    const meanError = average(
      normalizedRadii.map((radius) => Math.abs(radius - meanRadius)),
    );

    if (meanRadius < 0.72 || meanRadius > 1.28 || meanError > 0.17) {
      return null;
    }

    const aspectRatio = widthPx / heightPx;

    return {
      kind: aspectRatio >= 0.78 && aspectRatio <= 1.28 ? "circle" : "ellipse",
      center: {
        x: (centerPx.x / (rect.width || 1)) * 100,
        y: (centerPx.y / (rect.height || 1)) * 100,
      },
      width: (widthPx / (rect.width || 1)) * 100,
      height: (heightPx / (rect.height || 1)) * 100,
      radiusPx: Math.min(widthPx, heightPx) / 2,
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

  function perfectShape(detected) {
    const group = createGroup(`${detected.kind}-perfect`);

    if (detected.kind === "line") {
      const line = createSvgElement("line", {
        x1: formatNumber(detected.originalStart.x),
        y1: formatNumber(detected.originalStart.y),
        x2: formatNumber(detected.originalEnd.x),
        y2: formatNumber(detected.originalEnd.y),
      });
      setStrokeStyle(line);
      group.appendChild(line);
      return group;
    }

    const rect = state.svg.getBoundingClientRect();
    const isCircle = detected.kind === "circle";
    const rx = isCircle
      ? (detected.radiusPx / Math.max(1, rect.width)) * 100
      : detected.width / 2;
    const ry = isCircle
      ? (detected.radiusPx / Math.max(1, rect.height)) * 100
      : detected.height / 2;

    const ellipse = createSvgElement("ellipse", {
      cx: formatNumber(detected.center.x),
      cy: formatNumber(detected.center.y),
      rx: formatNumber(rx),
      ry: formatNumber(ry),
    });

    setStrokeStyle(ellipse);
    group.appendChild(ellipse);
    return group;
  }

  window.acceptAnnotationSuggestion = () => {
    if (!state.suggestion || !state.svg) return;

    const { group, detected } = state.suggestion;
    const replacement = perfectShape(detected);

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

  /* -----------------------------------------------------------------------
     TOOLBAR / MODE
  ----------------------------------------------------------------------- */

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
    if (width && Number(width.value) !== state.width) width.value = String(state.width);
  }

  window.toggleAnnotationMode = () => {
    if (!state.wrapper) {
      const editor = getEditor();
      const firstImage = editor?.querySelector("img.note-img");

      if (!firstImage) {
        setStatus("Insert or select an image first, then click the marker tool.");
        return;
      }

      selectImageWrapper(ensureAnnotationWrapper(firstImage));
    }

    state.drawing = !state.drawing;
    state.wrapper?.classList.toggle("is-drawing", state.drawing);

    if (!state.drawing) {
      clearPreview();
      state.suggestion = null;
      hideSuggestion();
    }

    updateToolbar();
  };

  window.finishAnnotationMode = () => {
    state.drawing = false;
    clearPreview();
    state.wrapper?.classList.remove("is-drawing");
    state.suggestion = null;
    hideSuggestion();
    updateToolbar();
  };

  window.setAnnotationTool = (tool) => {
    if (!["pen", "line", "arrow", "rect", "ellipse", "eraser"].includes(tool)) {
      return;
    }

    state.tool = tool;
    state.drawing = true;
    state.wrapper?.classList.add("is-drawing");
    state.suggestion = null;
    hideSuggestion();
    updateToolbar();
  };

  window.setAnnotationColor = (value) => {
    if (value) state.color = value;
  };

  window.setAnnotationWidth = (value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      state.width = clamp(numeric, 1, 10);
    }
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

  /* -----------------------------------------------------------------------
     IMAGE INSERT OVERRIDES
     Keeps the current image-style picker, but inserts an annotation-ready
     wrapper instead of a plain <img>.
  ----------------------------------------------------------------------- */

  function installImageInsertOverrides() {
    const originalCancel = window.cancelPendingImage;

    window.triggerImageInsert = () => {
      const body = getEditor();
      if (!body) return;

      body.focus();
      const selection = window.getSelection();

      if (selection?.rangeCount) {
        state.savedImageSelection = selection.getRangeAt(0).cloneRange();
      } else {
        state.savedImageSelection = null;
      }

      document.getElementById("imageFileInput")?.click();
    };

    window.handleImageFileChosen = (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) return;

      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file.");
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        state.pendingImageDataUrl = loadEvent.target.result;
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
        originalCancel?.();
      } catch (_) {
        /* Original cleanup is optional. */
      }
    };

    window.insertPendingImage = (styleClass) => {
      if (!state.pendingImageDataUrl) return;

      const body = getEditor();
      if (!body) return;

      body.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();

      if (state.savedImageSelection) {
        try {
          selection.addRange(state.savedImageSelection.cloneRange());
        } catch (_) {
          /* Fall back to the current caret. */
        }
      }

      const id = `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const layout = getLayoutFromClass(styleClass);

      const imageHtml = `
        <div
          class="note-image-annotation"
          data-annotation-image="true"
          data-annotation-id="${id}"
          data-layout="${layout}"
          contenteditable="false"
        >
          <div class="note-image-annotation-inner">
            <img
              class="note-img ${escapeHtml(styleClass)}"
              src="${state.pendingImageDataUrl}"
              alt=""
              draggable="false"
            />
            <svg
              class="note-annotation-layer"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            ></svg>
          </div>
        </div>
        <p><br></p>
      `;

      document.execCommand("insertHTML", false, imageHtml);

      const wrapper = body.querySelector(
        `.note-image-annotation[data-annotation-id="${id}"]`,
      );

      if (wrapper) {
        wrapper.removeAttribute("data-annotation-id");
        ensureAnnotationLayer(wrapper);
        selectImageWrapper(wrapper);
      }

      window.cancelPendingImage();
    };
  }

  /* -----------------------------------------------------------------------
     UI INJECTION
     No need to manually rebuild the existing HTML toolbar.
  ----------------------------------------------------------------------- */

  function injectToolbarButton() {
    if (document.getElementById("annotationLaunchBtn")) return;

    const toolbar = document.querySelector(".editor-toolbar");
    const imageButton = toolbar?.querySelector('[onclick="triggerImageInsert()"]');

    if (!toolbar || !imageButton) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tb-btn annotation-launch-btn";
    button.id = "annotationLaunchBtn";
    button.title = "Draw / annotate selected image";
    button.setAttribute("aria-label", "Draw / annotate selected image");
    button.innerHTML = '<i class="fa-solid fa-marker"></i>';
    button.addEventListener("click", window.toggleAnnotationMode);

    imageButton.parentElement.insertBefore(button, imageButton.nextSibling);
  }

  function injectAnnotationToolbar() {
    if (document.getElementById("annotationToolbar")) return;

    const editorBody = document.getElementById("editorBody");
    if (!editorBody) return;

    const toolbar = document.createElement("div");
    toolbar.className = "annotation-toolbar";
    toolbar.id = "annotationToolbar";
    toolbar.style.display = "none";
    toolbar.innerHTML = `
      <div class="annotation-toolbar-main">
        <span class="annotation-tool-label">Draw on image</span>

        <div class="annotation-tool-group">
          <button type="button" class="annotation-tool-btn is-active" data-annotation-tool="pen" title="Freehand marker">
            <i class="fa-solid fa-pen"></i><span>Pen</span>
          </button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="line" title="Straight line">
            <i class="fa-solid fa-minus"></i><span>Line</span>
          </button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="arrow" title="Arrow">
            <i class="fa-solid fa-arrow-right"></i><span>Arrow</span>
          </button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="rect" title="Rectangle">
            <i class="fa-regular fa-square"></i><span>Box</span>
          </button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="ellipse" title="Ellipse / circle">
            <i class="fa-regular fa-circle"></i><span>Circle</span>
          </button>
          <button type="button" class="annotation-tool-btn" data-annotation-tool="eraser" title="Erase annotation">
            <i class="fa-solid fa-eraser"></i><span>Erase</span>
          </button>
        </div>

        <label class="annotation-control" title="Marker color">
          <span>Color</span>
          <input id="annotationColor" type="color" value="#b23a39" />
        </label>

        <label class="annotation-control annotation-width-control" title="Marker thickness">
          <span>Size</span>
          <input id="annotationWidth" type="range" min="1" max="10" step="0.5" value="4" />
        </label>

        <button type="button" class="annotation-action-btn" id="annotationUndoBtn" title="Undo last annotation">
          <i class="fa-solid fa-rotate-left"></i>
        </button>
        <button type="button" class="annotation-action-btn" id="annotationClearBtn" title="Clear annotations from this image">
          <i class="fa-solid fa-trash-can"></i>
        </button>
        <button type="button" class="annotation-done-btn" id="annotationDoneBtn" title="Finish drawing">
          <i class="fa-solid fa-check"></i><span>Done</span>
        </button>
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
    if (imagePicker) {
      imagePicker.insertAdjacentElement("afterend", toolbar);
    } else {
      editorBody.insertAdjacentElement("beforebegin", toolbar);
    }

    toolbar.querySelectorAll("[data-annotation-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        window.setAnnotationTool(button.getAttribute("data-annotation-tool"));
      });
    });

    document.getElementById("annotationColor")?.addEventListener("change", (event) => {
      window.setAnnotationColor(event.target.value);
    });

    document.getElementById("annotationWidth")?.addEventListener("input", (event) => {
      window.setAnnotationWidth(event.target.value);
    });

    document.getElementById("annotationUndoBtn")?.addEventListener("click", window.undoAnnotation);
    document.getElementById("annotationClearBtn")?.addEventListener("click", window.clearAnnotations);
    document.getElementById("annotationDoneBtn")?.addEventListener("click", window.finishAnnotationMode);
    document.getElementById("acceptAnnotationSuggestionBtn")?.addEventListener("click", window.acceptAnnotationSuggestion);
    document.getElementById("dismissAnnotationSuggestionBtn")?.addEventListener("click", window.dismissAnnotationSuggestion);
  }

  /* -----------------------------------------------------------------------
     EDITOR BINDING
  ----------------------------------------------------------------------- */

  function initEditorBinding() {
    const editor = getEditor();
    if (!editor || editor.dataset.annotationAddonBound === "true") return;

    editor.dataset.annotationAddonBound = "true";

    editor.addEventListener("click", (event) => {
      const image = event.target.closest?.("img.note-img");

      if (!image || !editor.contains(image)) return;

      const wrapper = ensureAnnotationWrapper(image);
      if (!wrapper) return;

      event.preventDefault();
      event.stopPropagation();
      selectImageWrapper(wrapper);
    });

    editor.addEventListener("mousedown", (event) => {
      if (state.drawing && event.target.closest?.(".note-image-annotation")) {
        event.preventDefault();
      }
    });
  }

  function observeEditorOverlay() {
    const overlay = document.getElementById("editor-overlay");
    if (!overlay) return;

    const observer = new MutationObserver(() => {
      const active = overlay.classList.contains("active");

      if (!active) {
        state.drawing = false;
        state.wrapper?.classList.remove("is-selected", "is-drawing");
        state.wrapper = null;
        state.svg = null;
        state.history = [];
        state.suggestion = null;
        hideSuggestion();
        updateToolbar();
        return;
      }

      initEditorBinding();
      updateToolbar();
    });

    observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    injectToolbarButton();
    injectAnnotationToolbar();
    initEditorBinding();
    installImageInsertOverrides();
    observeEditorOverlay();
    updateToolbar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
JS
