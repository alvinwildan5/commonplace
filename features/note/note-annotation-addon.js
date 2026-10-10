/* ==========================================================================
   NOTES IMAGE ANNOTATION ADD-ON — FULL FIXED VERSION
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

   LAYOUT FIX:
   - Clicking an image does NOT move it to the left
   - Clicking an image does NOT unexpectedly shrink it
   - Original rendered width is captured BEFORE wrapping
   - Original float / alignment is preserved
   - Original margins are preserved
   - Normal / float-left / float-right / center-small / full layouts supported
   - SVG overlay exactly follows the image box
   - Existing annotated images keep their original layout
   - Editor-only states are stripped before save/publish

   No Supabase schema change required.
========================================================================== */

(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const HISTORY_LIMIT = 40;

  // Track SVG listeners in memory, not in serialized markup. Persisted DOM
  // must never carry a "bound" flag that prevents listeners on a later edit.
  const boundSvgs = new WeakSet();

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

  let publishSanitizerInstalled = false;
  let originalPublishArticle = null;

  /* ========================================================================
     BASIC HELPERS
  ======================================================================== */

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

  function injectAnnotationStyles() {
    if (document.getElementById("noteAnnotationStyles")) return;
    const style = document.createElement("style");
    style.id = "noteAnnotationStyles";
    style.textContent = `
      .note-image-annotation { position:relative; box-sizing:border-box; max-width:100%; }
      .note-image-annotation-inner { position:relative; display:block; width:100%; max-width:100%; box-sizing:border-box; line-height:0; }
      .note-image-annotation-inner > img.annotation-contained-image,
      .note-image-annotation-inner > img.note-img { display:block; width:100%; max-width:100%; height:auto; vertical-align:top; }
      .note-image-annotation .note-annotation-layer { position:absolute !important; inset:0; display:block; width:100% !important; height:100% !important; overflow:visible; pointer-events:none; z-index:2; }
      .note-image-annotation.is-drawing .note-annotation-layer { pointer-events:all !important; cursor:crosshair; touch-action:none; }
      .note-image-annotation .note-annotation-layer [data-annotation-kind] { pointer-events:visiblePainted; }
      .note-image-annotation.is-selected { outline:1px dashed rgba(180,154,98,.9); outline-offset:3px; }
      .annotation-toolbar { position:relative; z-index:30; display:none; flex-wrap:wrap; gap:8px; align-items:center; margin:8px 0 12px; padding:10px; border:1px solid #ddd5c6; border-radius:8px; background:#fbf8f0; color:#302e28; }
      .annotation-toolbar-main { display:flex; flex-wrap:wrap; align-items:center; gap:8px; width:100%; }
      .annotation-tool-group { display:flex; flex-wrap:wrap; gap:4px; }
      .annotation-tool-btn, .annotation-action-btn, .annotation-done-btn, .annotation-suggestion-btn { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-height:30px; padding:5px 8px; border:1px solid #d8d0c0; border-radius:5px; background:#fffdf8; color:#343128; cursor:pointer; font:inherit; font-size:12px; }
      .annotation-tool-btn.is-active, .annotation-suggestion-btn.is-primary { background:#e9dfc9; border-color:#b49a62; }
      .annotation-control { display:inline-flex; align-items:center; gap:6px; font-size:11px; }
      .annotation-control input[type=color] { width:28px; height:24px; padding:0; border:0; background:transparent; }
      .annotation-control input[type=range] { width:72px; accent-color:#b49a62; }
      .annotation-done-btn { background:#e9dfc9; }
      .annotation-status-row, .annotation-suggestion-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:12px; }
      @media (max-width:640px) { .annotation-tool-label { display:none; } .annotation-toolbar-main { align-items:flex-start; } }
    `;
    document.head.appendChild(style);
  }

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
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

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

  /* ========================================================================
     IMAGE LAYOUT CAPTURE
     ------------------------------------------------------------------------
     CRITICAL:
     Capture geometry BEFORE replacing the image's formatting context.
  ======================================================================== */

  function captureImageLayout(image) {
    if (!image) return null;

    const parent = image.parentElement;

    const computed = window.getComputedStyle(image);

    const parentComputed = parent ? window.getComputedStyle(parent) : null;

    const rect = image.getBoundingClientRect();

    let layout = getLayoutFromClass(image.className || "");

    /*
       Detect float from actual computed style if the class does not
       expose the layout.
    */
    if (layout === "normal") {
      if (computed.float === "left") {
        layout = "float-left";
      } else if (computed.float === "right") {
        layout = "float-right";
      }
    }

    return {
      layout,

      /* Original rendered geometry */
      widthPx: rect.width,
      heightPx: rect.height,

      /* Original computed dimensions */
      width: computed.width,
      maxWidth: computed.maxWidth,
      minWidth: computed.minWidth,

      height: computed.height,
      maxHeight: computed.maxHeight,
      minHeight: computed.minHeight,

      /* Original flow */
      display: computed.display,
      float: computed.float,
      clear: computed.clear,
      verticalAlign: computed.verticalAlign,

      /* Original margins */
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,

      /* Parent alignment context */
      parentTextAlign: parentComputed?.textAlign || "left",

      parentDisplay: parentComputed?.display || "block",

      /* Original inline styles */
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

  /* ========================================================================
     IMAGE LAYOUT APPLICATION
  ======================================================================== */

  function applyAnnotationLayout(wrapper, image, originalParent = null) {
    if (!wrapper || !image) return;

    let savedLayout = null;

    /*
       Use the ORIGINAL captured layout whenever possible.
    */
    if (wrapper.dataset.annotationLayout) {
      try {
        savedLayout = JSON.parse(wrapper.dataset.annotationLayout);
      } catch (_) {
        savedLayout = null;
      }
    }

    /*
       Fallback for old/pre-existing wrappers that do not yet have
       annotationLayout stored.
    */
    if (!savedLayout) {
      savedLayout = captureImageLayout(image);

      if (savedLayout) {
        wrapper.dataset.annotationLayout = JSON.stringify(savedLayout);
      }
    }

    if (!savedLayout) return;

    const layout = savedLayout.layout || "normal";

    wrapper.dataset.layout = layout;

    /* --------------------------------------------------------------
       Restore supported layout classes.
    -------------------------------------------------------------- */

    ["float-left", "float-right", "center-small", "full"].forEach(
      (className) => {
        wrapper.classList.remove(className);
      },
    );

    if (
      ["float-left", "float-right", "center-small", "full"].includes(layout)
    ) {
      wrapper.classList.add(layout);
    }

    /* --------------------------------------------------------------
       Wrapper base styles.
    -------------------------------------------------------------- */

    wrapper.style.boxSizing = "border-box";

    /* --------------------------------------------------------------
       NORMAL IMAGE
       -------------------------------------------------------------- */

    if (layout === "normal") {
      wrapper.style.float = "none";
      wrapper.style.clear = savedLayout.clear || "none";

      /*
         The exact original rendered width is retained.

         This is the most important fix for images that previously
         became smaller or jumped to the left.
      */
      if (savedLayout.widthPx > 0) {
        wrapper.style.width = `${savedLayout.widthPx}px`;
      }

      wrapper.style.maxWidth = "100%";

      /*
         Preserve original margins when they were actually used.
      */
      wrapper.style.marginTop = savedLayout.marginTop || "0";

      wrapper.style.marginBottom = savedLayout.marginBottom || "0";

      /*
         Preserve parent alignment.
      */
      if (savedLayout.parentTextAlign === "center") {
        wrapper.style.display = "block";
        wrapper.style.marginLeft = "auto";
        wrapper.style.marginRight = "auto";
      } else if (savedLayout.parentTextAlign === "right") {
        wrapper.style.display = "block";
        wrapper.style.marginLeft = "auto";
        wrapper.style.marginRight = "0";
      } else {
        wrapper.style.display = "inline-block";

        wrapper.style.marginLeft = savedLayout.marginLeft || "0";

        wrapper.style.marginRight = savedLayout.marginRight || "0";
      }
    } else if (layout === "float-left") {
      /* --------------------------------------------------------------
       FLOAT LEFT
       -------------------------------------------------------------- */
      wrapper.style.display = "block";
      wrapper.style.float = "left";
      wrapper.style.clear = savedLayout.clear || "none";

      if (savedLayout.widthPx > 0) {
        wrapper.style.width = `${savedLayout.widthPx}px`;
      }

      wrapper.style.maxWidth = "100%";

      wrapper.style.marginTop = savedLayout.marginTop || "0";

      wrapper.style.marginRight = savedLayout.marginRight || "0";

      wrapper.style.marginBottom = savedLayout.marginBottom || "0";

      wrapper.style.marginLeft = savedLayout.marginLeft || "0";
    } else if (layout === "float-right") {
      /* --------------------------------------------------------------
       FLOAT RIGHT
       -------------------------------------------------------------- */
      wrapper.style.display = "block";
      wrapper.style.float = "right";
      wrapper.style.clear = savedLayout.clear || "none";

      if (savedLayout.widthPx > 0) {
        wrapper.style.width = `${savedLayout.widthPx}px`;
      }

      wrapper.style.maxWidth = "100%";

      wrapper.style.marginTop = savedLayout.marginTop || "0";

      wrapper.style.marginRight = savedLayout.marginRight || "0";

      wrapper.style.marginBottom = savedLayout.marginBottom || "0";

      wrapper.style.marginLeft = savedLayout.marginLeft || "0";
    } else if (layout === "center-small") {
      /* --------------------------------------------------------------
       CENTER SMALL
       -------------------------------------------------------------- */
      wrapper.style.display = "block";
      wrapper.style.float = "none";
      wrapper.style.clear = savedLayout.clear || "none";

      if (savedLayout.widthPx > 0) {
        wrapper.style.width = `${savedLayout.widthPx}px`;
      }

      wrapper.style.maxWidth = "100%";

      wrapper.style.marginLeft = "auto";
      wrapper.style.marginRight = "auto";

      wrapper.style.marginTop = savedLayout.marginTop || "0";

      wrapper.style.marginBottom = savedLayout.marginBottom || "0";
    } else if (layout === "full") {
      /* --------------------------------------------------------------
       FULL WIDTH
       -------------------------------------------------------------- */
      wrapper.style.display = "block";
      wrapper.style.float = "none";
      wrapper.style.clear = savedLayout.clear || "none";

      wrapper.style.width = "100%";
      wrapper.style.maxWidth = "100%";

      wrapper.style.marginTop = savedLayout.marginTop || "0";

      wrapper.style.marginRight = savedLayout.marginRight || "0";

      wrapper.style.marginBottom = savedLayout.marginBottom || "0";

      wrapper.style.marginLeft = savedLayout.marginLeft || "0";
    }

    /* ==================================================================
       INNER CONTAINER
    ================================================================== */

    const inner = wrapper.querySelector(
      ":scope > .note-image-annotation-inner",
    );

    if (inner) {
      inner.style.position = "relative";
      inner.style.width = "100%";
      inner.style.maxWidth = "100%";
      inner.style.height = "auto";

      inner.style.display = "block";
      inner.style.boxSizing = "border-box";
      inner.style.lineHeight = "0";
    }

    /* ==================================================================
       IMAGE INSIDE WRAPPER
    ================================================================== */

    image.classList.add("annotation-contained-image");

    /*
       The wrapper now controls the image's original layout.
       Therefore the inner image can safely fill the wrapper.
    */
    image.style.float = "none";
    image.style.clear = "none";

    image.style.marginTop = "0";
    image.style.marginRight = "0";
    image.style.marginBottom = "0";
    image.style.marginLeft = "0";

    image.style.display = "block";

    image.style.width = "100%";
    image.style.maxWidth = "100%";

    image.style.height = "auto";

    image.style.verticalAlign = "top";

    /* ==================================================================
       SVG
    ================================================================== */

    const svg = wrapper.querySelector(".note-annotation-layer");

    if (svg) {
      svg.style.position = "absolute";
      svg.style.left = "0";
      svg.style.top = "0";

      svg.style.width = "100%";
      svg.style.height = "100%";

      svg.style.display = "block";

      /*
         CSS controls pointer interaction through the wrapper's
         .is-drawing class. Remove stale inline styles from older versions.
      */
      svg.style.removeProperty("pointer-events");
      svg.style.removeProperty("z-index");
      svg.style.removeProperty("touch-action");

      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");
    }
  }

  /* ========================================================================
     EDITOR-ONLY STATE CLEANUP
  ======================================================================== */

  function removeEditorOnlyState(wrapper) {
    if (!wrapper) return;

    wrapper.classList.remove("is-selected", "is-drawing");
    wrapper.removeAttribute("data-selected");
    wrapper.removeAttribute("data-drawing");

    /* Ensure editor interaction state is not persisted in body_html. */
    wrapper.querySelectorAll(".note-annotation-layer").forEach((svg) => {
      svg.style.removeProperty("pointer-events");
      svg.style.removeProperty("z-index");
      svg.style.removeProperty("touch-action");
      // This is runtime-only state; otherwise reopening a note can mistake
      // the persisted SVG for an already-bound one.
      svg.removeAttribute("data-annotation-bound");
    });

    wrapper
      .querySelectorAll('[data-preview="true"]')
      .forEach((element) => element.remove());
  }

  function cleanAnnotationEditorDom() {
    const editor = getEditor();

    if (!editor) return;

    editor.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
      removeEditorOnlyState(wrapper);
    });
  }

  function getCleanEditorHtml() {
    const editor = getEditor();

    if (!editor) return "";

    const clone = editor.cloneNode(true);

    clone.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
      removeEditorOnlyState(wrapper);
    });

    clone
      .querySelectorAll('[data-preview="true"]')
      .forEach((element) => element.remove());

    // Listener state is never serialized into saved HTML.
    clone.querySelectorAll(".note-annotation-layer").forEach((svg) => {
      svg.removeAttribute("data-annotation-bound");
    });

    return clone.innerHTML;
  }

  window.getCleanAnnotationEditorHtml = getCleanEditorHtml;

  window.prepareAnnotationHtmlForSave = () => {
    cleanAnnotationEditorDom();

    return getCleanEditorHtml();
  };

  /* ========================================================================
     STROKE STYLE
  ======================================================================== */

  function getStrokeWidthInViewBoxUnits() {
    const svg = state.svg;

    const rect = svg?.getBoundingClientRect?.();

    const minSize = Math.max(
      1,
      Math.min(rect?.width || 600, rect?.height || 400),
    );

    return Math.max(0.25, (state.width / minSize) * 100);
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

  function pointsToPath(points) {
    return points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${formatNumber(
            point.x,
          )} ${formatNumber(point.y)}`,
      )
      .join(" ");
  }

  /* ========================================================================
     RDP POINT SIMPLIFICATION
  ======================================================================== */

  function simplifyPoints(points, tolerance = 0.45) {
    if (points.length <= 8) {
      return points;
    }

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

        stack.push([startIndex, maxIndex]);

        stack.push([maxIndex, endIndex]);
      }
    }

    return points.filter((_, index) => markers[index]);
  }

  /* ========================================================================
     IMAGE WRAPPER
  ======================================================================== */

  function ensureAnnotationWrapper(image) {
    if (!image) return null;

    const existing = image.closest(".note-image-annotation");

    if (existing) {
      ensureAnnotationLayer(existing);

      applyAnnotationLayout(existing, image, existing.parentNode);

      return existing;
    }

    const parent = image.parentNode;

    if (!parent) return null;

    /*
       CRITICAL:
       Capture layout BEFORE inserting wrapper.
    */
    const originalLayout = captureImageLayout(image);

    const originalRect = image.getBoundingClientRect();

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

    wrapper.setAttribute(
      "data-layout",
      originalLayout?.layout || getLayoutFromClass(image.className || ""),
    );

    wrapper.setAttribute("contenteditable", "false");

    /*
       Save exact pre-wrap geometry.
    */
    if (originalLayout) {
      wrapper.dataset.annotationLayout = JSON.stringify(originalLayout);
    }

    inner.className = "note-image-annotation-inner";

    /*
       Insert wrapper at exact original
       DOM position.
    */
    parent.insertBefore(wrapper, image);

    inner.appendChild(image);
    inner.appendChild(svg);

    wrapper.appendChild(inner);

    /*
       Reapply the ORIGINAL geometry
       after wrapping.
    */
    applyAnnotationLayout(wrapper, image, parent);

    /*
       Final safety check for normal images.
    */
    if (originalRect.width > 0 && originalLayout?.layout === "normal") {
      const wrapperRect = wrapper.getBoundingClientRect();

      if (
        wrapperRect.width > 0 &&
        Math.abs(wrapperRect.width - originalRect.width) > 1
      ) {
        wrapper.style.width = `${originalRect.width}px`;
      }
    }

    ensureAnnotationLayer(wrapper);

    return wrapper;
  }

  /* ========================================================================
     ENSURE SVG LAYER
  ======================================================================== */

  function ensureAnnotationLayer(wrapper) {
    if (!wrapper) return null;

    wrapper.setAttribute("contenteditable", "false");

    let inner = wrapper.querySelector(":scope > .note-image-annotation-inner");

    const image =
      wrapper.querySelector(":scope img.note-img") ||
      wrapper.querySelector("img.note-img");

    let svg =
      wrapper.querySelector(
        ":scope > .note-image-annotation-inner > .note-annotation-layer",
      ) || wrapper.querySelector(".note-annotation-layer");

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

    if (image) {
      applyAnnotationLayout(wrapper, image, wrapper.parentNode);
    }

    bindSvg(svg);

    return svg;
  }

  /* ========================================================================
     IMAGE SELECTION
  ======================================================================== */

  function deselectImageWrapper(wrapper = state.wrapper) {
    if (!wrapper) return;

    wrapper.classList.remove("is-selected", "is-drawing");
  }

  function resetAnnotationSelection() {
    document
      .querySelectorAll(".note-image-annotation.is-selected")
      .forEach((item) => {
        item.classList.remove("is-selected", "is-drawing");
      });

    state.selectedWrapper = null;
    state.wrapper = null;
    state.svg = null;

    state.history = [];
    state.suggestion = null;

    clearPreview();
    hideSuggestion();
  }

  function selectImageWrapper(wrapper) {
    if (!wrapper) return;

    ensureAnnotationLayer(wrapper);

    document
      .querySelectorAll(".note-image-annotation.is-selected")
      .forEach((item) => {
        if (item !== wrapper) {
          item.classList.remove("is-selected", "is-drawing");
        }
      });

    wrapper.classList.add("is-selected");

    state.wrapper = wrapper;
    state.selectedWrapper = wrapper;
    state.svg = wrapper.querySelector(".note-annotation-layer");

    state.history = [];
    state.suggestion = null;
    hideSuggestion();

    if (state.svg) {
      bindSvg(state.svg);
      state.svg.style.removeProperty("pointer-events");
      state.svg.style.removeProperty("z-index");
      state.svg.style.removeProperty("touch-action");
    }

    updateToolbar();
  }

  /* ========================================================================
     POINTER / DRAWING
  ======================================================================== */

  function pointFromEvent(event, svg) {
    const rect = svg.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      return {
        x: 0,
        y: 0,
      };
    }

    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),

      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  function bindSvg(svg) {
    if (!svg || boundSvgs.has(svg)) {
      return;
    }

    boundSvgs.add(svg);

    svg.addEventListener("pointerdown", beginPointer);

    svg.addEventListener("pointermove", movePointer);

    svg.addEventListener("pointerup", endPointer);

    svg.addEventListener("pointercancel", cancelPointer);
  }

  function snapshot() {
    if (!state.svg) return;

    state.history.push(state.svg.innerHTML);

    if (state.history.length > HISTORY_LIMIT) {
      state.history.shift();
    }
  }

  function clearPreview() {
    if (state.preview?.parentNode) {
      state.preview.remove();
    }

    state.preview = null;
  }

  function setPreview(points) {
    clearPreview();

    if (!state.svg || points.length < 2) {
      return;
    }

    const group = buildShape(state.tool, points);

    if (!group) return;

    group.setAttribute("data-preview", "true");

    state.svg.appendChild(group);

    state.preview = group;
  }

  function beginPointer(event) {
    if (!state.drawing || !state.svg) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    state.pointerId = event.pointerId;

    state.points = [pointFromEvent(event, state.svg)];

    try {
      state.svg.setPointerCapture(event.pointerId);
    } catch (_) {
      /* Continue without capture. */
    }

    if (state.tool === "eraser") {
      eraseAtTarget(event.target);

      state.points = [];

      return;
    }

    setPreview(state.points);
  }

  function movePointer(event) {
    if (!state.drawing || state.pointerId !== event.pointerId || !state.svg) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const point = pointFromEvent(event, state.svg);

    if (state.tool === "pen") {
      state.points.push(point);
    } else {
      state.points = [state.points[0], point];
    }

    setPreview(state.points);
  }

  function endPointer(event) {
    if (!state.drawing || state.pointerId !== event.pointerId || !state.svg) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

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

    if (
      !group ||
      group.getAttribute("data-preview") === "true" ||
      !state.svg?.contains(group)
    ) {
      return;
    }

    snapshot();

    group.remove();
  }

  /* ========================================================================
     SHAPE BUILDERS
  ======================================================================== */

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
    if (!points?.length) {
      return null;
    }

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

  /* ========================================================================
     SHAPE RECOGNITION
  ======================================================================== */

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
    if (points.length < 10 || !state.svg) {
      return null;
    }

    const rect = state.svg.getBoundingClientRect();

    const scaleX = (rect.width || 1) / 100;

    const scaleY = (rect.height || 1) / 100;

    /*
       Work in pixel space so circles are not incorrectly classified
       as ellipses when the image itself is wide.
    */
    const pixelPoints = points.map((point) => ({
      x: point.x * scaleX,

      y: point.y * scaleY,
    }));

    const start = pixelPoints[0];

    const end = pixelPoints.at(-1);

    const totalLength = pathLength(pixelPoints);

    const endpointDistance = distance(start, end);

    /* --------------------------------------------------------------
       LINE
    -------------------------------------------------------------- */

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

          originalEnd: points.at(-1),
        };
      }
    }

    /* --------------------------------------------------------------
       CIRCLE / ELLIPSE
    -------------------------------------------------------------- */

    if (
      endpointDistance > Math.min(rect.width, rect.height) * 0.18 ||
      totalLength < 36
    ) {
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

    if (widthPx < 20 || heightPx < 20) {
      return null;
    }

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

    state.suggestion = {
      group,
      detected,
    };

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

    if (row) {
      row.style.display = "flex";
    }
  }

  function hideSuggestion() {
    const row = document.getElementById("annotationStatusRow");

    if (row) {
      row.style.display = "none";
    }
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
    if (!state.suggestion || !state.svg) {
      return;
    }

    const { group, detected } = state.suggestion;

    const replacement = perfectShape(detected);

    if (!replacement) {
      return;
    }

    snapshot();

    group.replaceWith(replacement);

    state.suggestion = null;

    hideSuggestion();
  };

  window.dismissAnnotationSuggestion = () => {
    state.suggestion = null;

    hideSuggestion();
  };

  /* ========================================================================
     TOOLBAR
  ======================================================================== */

  function updateToolbar() {
    const toolbar = document.getElementById("annotationToolbar");
    const launch = document.getElementById("annotationLaunchBtn");

    if (toolbar) {
      toolbar.style.display = state.wrapper ? "block" : "none";
    }

    if (launch) {
      launch.classList.toggle("is-active", state.drawing);
    }

    /* CSS class, not inline pointer-events, controls the drawing surface. */
    document.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
      wrapper.classList.toggle(
        "is-drawing",
        Boolean(state.drawing && state.wrapper === wrapper),
      );
    });

    document.querySelectorAll("[data-annotation-tool]").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.getAttribute("data-annotation-tool") === state.tool,
      );
    });

    const color = document.getElementById("annotationColor");
    const width = document.getElementById("annotationWidth");

    if (color && color.value !== state.color) {
      color.value = state.color;
    }

    if (width && Number(width.value) !== state.width) {
      width.value = String(state.width);
    }

    // Explicitly control hit-testing instead of relying on an external CSS file.
    // `pointer-events: all` makes the transparent SVG surface drawable, including
    // areas with no existing stroke, which is important in browser fullscreen.
    document
      .querySelectorAll(".note-image-annotation .note-annotation-layer")
      .forEach((svg) => {
        const wrapper = svg.closest(".note-image-annotation");
        const activeDrawingSurface = Boolean(
          state.drawing && state.wrapper === wrapper,
        );
        svg.style.position = "absolute";
        svg.style.left = "0";
        svg.style.top = "0";
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.style.zIndex = "2";
        svg.style.pointerEvents = activeDrawingSurface ? "all" : "none";
        svg.style.touchAction = activeDrawingSurface ? "none" : "";
      });
  }

  /* ========================================================================
     TOGGLE ANNOTATION MODE
  ======================================================================== */

  window.toggleAnnotationMode = () => {
    if (!state.wrapper) {
      const editor = getEditor();

      const selectedImage = editor?.querySelector(
        ".note-image-annotation.is-selected img.note-img",
      );

      const firstImage = selectedImage || editor?.querySelector("img.note-img");

      if (!firstImage) {
        setStatus(
          "Insert or select an image first, then click the marker tool.",
        );

        return;
      }

      const wrapper = ensureAnnotationWrapper(firstImage);

      if (wrapper) {
        selectImageWrapper(wrapper);
      }
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

  /* ========================================================================
     DONE
  ======================================================================== */

  window.finishAnnotationMode = () => {
    clearPreview();

    state.drawing = false;

    if (state.wrapper) {
      state.wrapper.classList.remove("is-drawing", "is-selected");
    }

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

  /* ========================================================================
     TOOL SELECTION
  ======================================================================== */

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
    if (value) {
      state.color = value;
    }
  };

  window.setAnnotationWidth = (value) => {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      state.width = clamp(numeric, 1, 10);
    }
  };

  /* ========================================================================
     UNDO / CLEAR
  ======================================================================== */

  window.undoAnnotation = () => {
    if (!state.svg || !state.history.length) {
      return;
    }

    state.svg.innerHTML = state.history.pop();

    state.suggestion = null;

    hideSuggestion();
  };

  window.clearAnnotations = () => {
    if (!state.svg || !state.svg.children.length) {
      return;
    }

    snapshot();

    state.svg.innerHTML = "";

    state.suggestion = null;

    hideSuggestion();
  };

  /* ========================================================================
     IMAGE INSERT OVERRIDES
  ======================================================================== */

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

      if (!file) {
        return;
      }

      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file.");

        return;
      }

      const reader = new FileReader();

      reader.onload = (loadEvent) => {
        state.pendingImageDataUrl = loadEvent.target.result;

        const picker = document.getElementById("imageStylePicker");

        if (picker) {
          picker.style.display = "flex";
        }
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

      if (picker) {
        picker.style.display = "none";
      }

      try {
        originalCancel?.();
      } catch (_) {
        /* Optional cleanup. */
      }
    };

    window.insertPendingImage = (styleClass) => {
      if (!state.pendingImageDataUrl) {
        return;
      }

      const body = getEditor();

      if (!body) {
        return;
      }

      body.focus();

      const selection = window.getSelection();

      selection?.removeAllRanges();

      if (state.savedImageSelection) {
        try {
          selection.addRange(state.savedImageSelection.cloneRange());
        } catch (_) {
          /* Keep current caret. */
        }
      }

      const id = `annotation-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      const layout = getLayoutFromClass(styleClass);

      const safeStyle = escapeHtml(styleClass);

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
                class="note-img ${safeStyle}"
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

        const insertedImage = wrapper.querySelector("img.note-img");

        if (insertedImage) {
          /*
               New image has not necessarily completed loading yet.
               Apply layout once now and again after load so its natural
               dimensions are available.
            */
          applyAnnotationLayout(wrapper, insertedImage, wrapper.parentNode);

          if (!insertedImage.complete) {
            insertedImage.addEventListener(
              "load",
              () => {
                /*
                     New images should respond naturally to their
                     style class. Do not recapture as though they were
                     already wrapped.
                  */
                if (wrapper.isConnected) {
                  applyAnnotationLayout(
                    wrapper,
                    insertedImage,
                    wrapper.parentNode,
                  );
                }
              },
              {
                once: true,
              },
            );
          }
        }

        ensureAnnotationLayer(wrapper);

        selectImageWrapper(wrapper);
      }

      window.cancelPendingImage();
    };
  }

  /* ========================================================================
     TOOLBAR BUTTON
  ======================================================================== */

  function injectToolbarButton() {
    if (document.getElementById("annotationLaunchBtn")) {
      return;
    }

    const toolbar = document.querySelector(".editor-toolbar");

    const imageButton = toolbar?.querySelector(
      '[onclick="triggerImageInsert()"]',
    );

    if (!toolbar || !imageButton) {
      return;
    }

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

  /* ========================================================================
     ANNOTATION TOOLBAR
  ======================================================================== */

  function injectAnnotationToolbar() {
    if (document.getElementById("annotationToolbar")) {
      return;
    }

    const editorBody = document.getElementById("editorBody");

    if (!editorBody) {
      return;
    }

    const toolbar = document.createElement("div");

    toolbar.className = "annotation-toolbar";

    toolbar.id = "annotationToolbar";

    toolbar.style.display = "none";

    toolbar.innerHTML = `
      <div class="annotation-toolbar-main">

        <span class="annotation-tool-label">
          Draw on image
        </span>

        <div class="annotation-tool-group">

          <button
            type="button"
            class="annotation-tool-btn is-active"
            data-annotation-tool="pen"
            title="Freehand marker"
          >
            <i class="fa-solid fa-pen"></i>
            <span>Pen</span>
          </button>

          <button
            type="button"
            class="annotation-tool-btn"
            data-annotation-tool="line"
            title="Straight line"
          >
            <i class="fa-solid fa-minus"></i>
            <span>Line</span>
          </button>

          <button
            type="button"
            class="annotation-tool-btn"
            data-annotation-tool="arrow"
            title="Arrow"
          >
            <i class="fa-solid fa-arrow-right"></i>
            <span>Arrow</span>
          </button>

          <button
            type="button"
            class="annotation-tool-btn"
            data-annotation-tool="rect"
            title="Rectangle"
          >
            <i class="fa-regular fa-square"></i>
            <span>Box</span>
          </button>

          <button
            type="button"
            class="annotation-tool-btn"
            data-annotation-tool="ellipse"
            title="Ellipse / circle"
          >
            <i class="fa-regular fa-circle"></i>
            <span>Circle</span>
          </button>

          <button
            type="button"
            class="annotation-tool-btn"
            data-annotation-tool="eraser"
            title="Erase annotation"
          >
            <i class="fa-solid fa-eraser"></i>
            <span>Erase</span>
          </button>

        </div>

        <label
          class="annotation-control"
          title="Marker color"
        >
          <span>Color</span>

          <input
            id="annotationColor"
            type="color"
            value="#b23a39"
          />
        </label>

        <label
          class="annotation-control annotation-width-control"
          title="Marker thickness"
        >
          <span>Size</span>

          <input
            id="annotationWidth"
            type="range"
            min="1"
            max="10"
            step="0.5"
            value="4"
          />
        </label>

        <button
          type="button"
          class="annotation-action-btn"
          id="annotationUndoBtn"
          title="Undo last annotation"
        >
          <i class="fa-solid fa-rotate-left"></i>
        </button>

        <button
          type="button"
          class="annotation-action-btn"
          id="annotationClearBtn"
          title="Clear annotations from this image"
        >
          <i class="fa-solid fa-trash-can"></i>
        </button>

        <button
          type="button"
          class="annotation-done-btn"
          id="annotationDoneBtn"
          title="Finish drawing"
        >
          <i class="fa-solid fa-check"></i>
          <span>Done</span>
        </button>

      </div>

      <div
        class="annotation-status-row"
        id="annotationStatusRow"
        style="display:none"
      >

        <span id="annotationStatusText"></span>

        <div class="annotation-suggestion-actions">

          <button
            type="button"
            id="acceptAnnotationSuggestionBtn"
            class="annotation-suggestion-btn is-primary"
          >
            Perfect it
          </button>

          <button
            type="button"
            id="dismissAnnotationSuggestionBtn"
            class="annotation-suggestion-btn"
          >
            Keep freehand
          </button>

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

    document
      .getElementById("annotationColor")
      ?.addEventListener("change", (event) => {
        window.setAnnotationColor(event.target.value);
      });

    document
      .getElementById("annotationWidth")
      ?.addEventListener("input", (event) => {
        window.setAnnotationWidth(event.target.value);
      });

    document
      .getElementById("annotationUndoBtn")
      ?.addEventListener("click", window.undoAnnotation);

    document
      .getElementById("annotationClearBtn")
      ?.addEventListener("click", window.clearAnnotations);

    document
      .getElementById("annotationDoneBtn")
      ?.addEventListener("click", window.finishAnnotationMode);

    document
      .getElementById("acceptAnnotationSuggestionBtn")
      ?.addEventListener("click", window.acceptAnnotationSuggestion);

    document
      .getElementById("dismissAnnotationSuggestionBtn")
      ?.addEventListener("click", window.dismissAnnotationSuggestion);
  }

  /* ========================================================================
     EDITOR BINDING
  ======================================================================== */

  function initEditorBinding() {
    const editor = getEditor();

    if (!editor || editor.dataset.annotationAddonBound === "true") {
      return;
    }

    editor.dataset.annotationAddonBound = "true";

    /* --------------------------------------------------------------
       CLICK IMAGE
    -------------------------------------------------------------- */

    editor.addEventListener("click", (event) => {
      const image = event.target.closest?.("img.note-img");

      if (!image || !editor.contains(image)) {
        return;
      }

      /*
           During drawing, SVG owns interaction.
        */
      if (state.drawing) {
        return;
      }

      const wrapper = ensureAnnotationWrapper(image);

      if (!wrapper) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      selectImageWrapper(wrapper);
    });

    /* --------------------------------------------------------------
       MOUSE DOWN
    -------------------------------------------------------------- */

    editor.addEventListener("mousedown", (event) => {
      if (state.drawing && event.target.closest?.(".note-image-annotation")) {
        event.preventDefault();
      }
    });

    /* --------------------------------------------------------------
       DISABLE NATIVE IMAGE DRAGGING
    -------------------------------------------------------------- */

    editor.addEventListener("dragstart", (event) => {
      if (event.target.closest?.("img.note-img")) {
        event.preventDefault();
      }
    });
  }

  /* ========================================================================
     PUBLISH / SAVE SANITIZATION
  ======================================================================== */

  function installPublishSanitizer() {
    if (publishSanitizerInstalled) {
      return;
    }

    publishSanitizerInstalled = true;

    const installGlobalWrapper = () => {
      if (typeof window.publishArticle !== "function") {
        return false;
      }

      if (window.publishArticle?.__annotationSanitized === "true") {
        return true;
      }

      originalPublishArticle = window.publishArticle;

      const wrappedPublish = async function (...args) {
        const editor = getEditor();

        const selected =
          editor?.querySelectorAll?.(
            ".note-image-annotation.is-selected, .note-image-annotation.is-drawing",
          ) || [];

        const restoreState = Array.from(selected).map((wrapper) => ({
          wrapper,

          selected: wrapper.classList.contains("is-selected"),

          drawing: wrapper.classList.contains("is-drawing"),
        }));

        /*
               Clean editor-only state before note.js reads innerHTML.
            */
        cleanAnnotationEditorDom();

        try {
          return await originalPublishArticle.apply(this, args);
        } finally {
          /*
                 Restore editor visual state only if the editor
                 remains open.
              */
          const overlay = document.getElementById("editor-overlay");

          const editorStillOpen = overlay?.classList.contains("active");

          if (editorStillOpen) {
            restoreState.forEach(({ wrapper, selected, drawing }) => {
              if (!wrapper?.isConnected) {
                return;
              }

              wrapper.classList.toggle("is-selected", selected);

              wrapper.classList.toggle("is-drawing", drawing);
            });
            updateToolbar();
          }
        }
      };

      wrappedPublish.__annotationSanitized = "true";

      window.publishArticle = wrappedPublish;

      return true;
    };

    installGlobalWrapper();

    Promise.resolve().then(() => {
      installGlobalWrapper();
    });

    setTimeout(() => {
      installGlobalWrapper();
    }, 0);
  }

  /* ========================================================================
     EDITOR OVERLAY OBSERVER
  ======================================================================== */

  function observeEditorOverlay() {
    const overlay = document.getElementById("editor-overlay");

    if (!overlay) {
      return;
    }

    const observer = new MutationObserver(() => {
      const active = overlay.classList.contains("active");

      if (!active) {
        state.drawing = false;

        state.wrapper?.classList.remove("is-selected", "is-drawing");

        state.wrapper = null;

        state.selectedWrapper = null;

        state.svg = null;

        state.history = [];

        state.suggestion = null;

        state.pointerId = null;

        state.points = [];

        clearPreview();
        hideSuggestion();

        updateToolbar();

        return;
      }

      initEditorBinding();
      updateToolbar();

      /*
             Prepare existing images from article content.
          */
      const editor = getEditor();

      editor?.querySelectorAll?.("img.note-img")?.forEach((image) => {
        const wrapper = image.closest(".note-image-annotation");

        if (wrapper) {
          ensureAnnotationLayer(wrapper);
        }
      });
    });

    observer.observe(overlay, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  /* ========================================================================
     INITIALIZATION
  ======================================================================== */

  function init() {
    injectAnnotationStyles();
    injectToolbarButton();

    injectAnnotationToolbar();

    initEditorBinding();

    installImageInsertOverrides();

    observeEditorOverlay();

    installPublishSanitizer();

    updateToolbar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {
      once: true,
    });
  } else {
    init();
  }
})();
