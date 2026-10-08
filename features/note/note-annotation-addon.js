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

   Position / save fixes:
   - Preserve the original image layout when wrapping it for annotation
   - Drawing overlay does not make the image jump / shift
   - "Done" closes the annotation toolbar completely
   - Selection / drawing indicator classes are editor-only
   - Editor-only annotation states are stripped before article save
   - Actual SVG annotations remain saved inside body_html

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

    /* ---------------------------------------------------------------
       Keeps track of editor-only selection state.
       These states are NEVER intended to be saved.
    --------------------------------------------------------------- */
    selectedWrapper: null,
  };

  let publishSanitizerInstalled = false;
  let originalPublishArticle = null;

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

  /* ==========================================================================
   IMAGE LAYOUT PRESERVATION — STABLE VERSION
   --------------------------------------------------------------------------
   Fix:
   - Image does NOT jump to the left when clicked.
   - Original displayed size is preserved.
   - Original float / center alignment is preserved.
   - Original margins are preserved.
   - Wrapper takes over the image's layout instead of changing it.
   - Inner image only becomes 100% wide when the wrapper intentionally
     controls its width.
   - Repeated clicks do not recalculate the image and cause resizing.
========================================================================== */

  /*
     Cache the original image layout in memory.

     Why:
     After an image is wrapped, its computed geometry can change.
     We therefore capture the layout BEFORE moving it whenever possible,
     then reuse that snapshot.
  */
  const annotationLayoutCache = new WeakMap();

  function getContainingContentWidth(parent) {
    if (!parent) return 1;

    const computed = window.getComputedStyle(parent);

    const paddingLeft = parseFloat(computed.paddingLeft) || 0;
    const paddingRight = parseFloat(computed.paddingRight) || 0;

    const clientWidth = parent.clientWidth || 1;

    return Math.max(1, clientWidth - paddingLeft - paddingRight);
  }

  function captureImageLayout(image, parent) {
    if (!image) return null;

    const computed = window.getComputedStyle(image);

    const rect = image.getBoundingClientRect();

    const parentContentWidth = getContainingContentWidth(parent);

    const layout = getLayoutFromClass(image.className || "");

    const widthRatio = clamp(rect.width / parentContentWidth, 0.01, 1);

    return {
      layout,

      widthPx: rect.width,

      heightPx: rect.height,

      widthRatio,

      computedWidth: computed.width,

      computedHeight: computed.height,

      display: computed.display,

      float: computed.float,

      clear: computed.clear,

      boxSizing: computed.boxSizing,

      marginTop: computed.marginTop,

      marginRight: computed.marginRight,

      marginBottom: computed.marginBottom,

      marginLeft: computed.marginLeft,

      verticalAlign: computed.verticalAlign,

      maxWidth: computed.maxWidth,

      minWidth: computed.minWidth,

      parentTextAlign: window.getComputedStyle(parent || document.body)
        .textAlign,

      parentContentWidth,
    };
  }

  function applyAnnotationLayout(
    wrapper,
    image,
    originalParent = null,
    providedSnapshot = null,
  ) {
    if (!wrapper || !image) return;

    /*
       Reuse cached geometry whenever possible.

       This prevents the second click, third click, etc. from measuring an
       already-resized image and progressively changing its size.
    */
    let snapshot = providedSnapshot || annotationLayoutCache.get(wrapper);

    if (!snapshot) {
      snapshot = captureImageLayout(image, originalParent);
    }

    if (!snapshot) return;

    annotationLayoutCache.set(wrapper, snapshot);

    const layout = snapshot.layout;

    wrapper.dataset.layout = layout;

    /*
       Preserve layout classes on the wrapper.

       This is useful if the existing website CSS styles these classes.
    */
    ["float-left", "float-right", "center-small", "full"].forEach(
      (className) => {
        wrapper.classList.toggle(className, layout === className);
      },
    );

    /*
       ---------------------------------------------------------------
       WRAPPER GEOMETRY
       ---------------------------------------------------------------
    */

    wrapper.style.boxSizing = "border-box";

    wrapper.style.position = "relative";

    wrapper.style.clear =
      snapshot.clear && snapshot.clear !== "none" ? snapshot.clear : "none";

    wrapper.style.verticalAlign = snapshot.verticalAlign || "top";

    /*
       Use the ORIGINAL percentage relationship between the image and
       its containing block.

       Example:
       Original image = 480px
       Content width = 960px
       => wrapper = 50%

       This preserves the visual proportion while remaining responsive.
    */
    const widthPercent = clamp(snapshot.widthRatio * 100, 1, 100);

    /* ---------------------------------------------------------------
       FLOAT LEFT
    --------------------------------------------------------------- */

    if (layout === "float-left") {
      wrapper.style.display = "block";

      wrapper.style.float = "left";

      wrapper.style.width = `${formatNumber(widthPercent)}%`;

      wrapper.style.maxWidth = "100%";
    } else if (layout === "float-right") {

    /* ---------------------------------------------------------------
       FLOAT RIGHT
    --------------------------------------------------------------- */
      wrapper.style.display = "block";

      wrapper.style.float = "right";

      wrapper.style.width = `${formatNumber(widthPercent)}%`;

      wrapper.style.maxWidth = "100%";
    } else if (layout === "center-small") {

    /* ---------------------------------------------------------------
       CENTER SMALL
    --------------------------------------------------------------- */
      /*
         A centered image must remain a block-level element so
         margin-left/right:auto continues to work.
      */
      wrapper.style.display = "block";

      wrapper.style.float = "none";

      wrapper.style.width = `${formatNumber(widthPercent)}%`;

      wrapper.style.maxWidth = "100%";

      wrapper.style.marginLeft = "auto";

      wrapper.style.marginRight = "auto";
    } else if (layout === "full") {

    /* ---------------------------------------------------------------
       FULL
    --------------------------------------------------------------- */
      wrapper.style.display = "block";

      wrapper.style.float = "none";

      wrapper.style.width = "100%";

      wrapper.style.maxWidth = "100%";

      wrapper.style.marginLeft = "0";

      wrapper.style.marginRight = "0";
    } else {

    /* ---------------------------------------------------------------
       NORMAL IMAGE
       --------------------------------------------------------------- */
      wrapper.style.float = "none";

      /*
         If the original image was inline / inline-block, keep the
         wrapper inline-block.

         This is important because changing it into a block was one
         of the main reasons a centered/inline image could jump left.
      */
      const originalWasInline =
        snapshot.display === "inline" ||
        snapshot.display === "inline-block" ||
        snapshot.display === "inline-flex";

      const hadAutoHorizontalMargin =
        snapshot.marginLeft === "auto" || snapshot.marginRight === "auto";

      if (hadAutoHorizontalMargin) {
        /*
           Auto horizontal margins require a block formatting context
           for reliable centering.
        */
        wrapper.style.display = "block";

        wrapper.style.width = `${formatNumber(widthPercent)}%`;

        wrapper.style.maxWidth = "100%";

        wrapper.style.marginLeft = "auto";

        wrapper.style.marginRight = "auto";
      } else if (originalWasInline) {
        wrapper.style.display = "inline-block";

        wrapper.style.width = `${formatNumber(widthPercent)}%`;

        wrapper.style.maxWidth = "100%";
      } else {
        /*
           Preserve the visual relationship of normal block images.
        */
        wrapper.style.display = "block";

        wrapper.style.width = `${formatNumber(widthPercent)}%`;

        wrapper.style.maxWidth = "100%";
      }
    }

    /*
       ---------------------------------------------------------------
       PRESERVE ORIGINAL VERTICAL MARGINS
       ---------------------------------------------------------------
    */

    wrapper.style.marginTop = snapshot.marginTop || "0";

    wrapper.style.marginBottom = snapshot.marginBottom || "0";

    /*
       Horizontal margins are handled specially above for centered
       layouts. For other layouts, preserve the original margins when
       they are actual values rather than "auto".
    */

    if (layout !== "center-small" && snapshot.marginLeft !== "auto") {
      wrapper.style.marginLeft = snapshot.marginLeft || "0";
    }

    if (layout !== "center-small" && snapshot.marginRight !== "auto") {
      wrapper.style.marginRight = snapshot.marginRight || "0";
    }

    /*
       ---------------------------------------------------------------
       INNER CONTAINER
       ---------------------------------------------------------------
    */

    const inner = wrapper.querySelector(
      ":scope > .note-image-annotation-inner",
    );

    if (inner) {
      inner.style.position = "relative";

      inner.style.width = "100%";

      inner.style.maxWidth = "100%";

      inner.style.margin = "0";

      inner.style.padding = "0";

      inner.style.boxSizing = "border-box";

      inner.style.lineHeight = "0";
    }

    /*
       ---------------------------------------------------------------
       IMAGE
       ---------------------------------------------------------------
    */

    image.classList.add("annotation-contained-image");

    image.style.clear = "none";

    image.style.float = "none";

    image.style.display = "block";

    image.style.margin = "0";

    image.style.boxSizing = snapshot.boxSizing || "border-box";

    /*
       Only force image width to 100% when the wrapper is explicitly
       controlling the layout width.

       For normal images, retaining the original image width prevents
       accidental shrinking.
    */
    if (
      layout === "float-left" ||
      layout === "float-right" ||
      layout === "center-small" ||
      layout === "full"
    ) {
      image.style.width = "100%";

      image.style.maxWidth = "100%";
    } else {
      /*
         Preserve normal-image sizing.

         We do NOT blindly set width:100% here.
         That was another source of unexpected image resizing.
      */
      if (image.style.width === "100%" && snapshot.display !== "block") {
        image.style.width = "";
      }

      image.style.maxWidth =
        snapshot.maxWidth && snapshot.maxWidth !== "none"
          ? snapshot.maxWidth
          : "100%";
    }

    /*
       ---------------------------------------------------------------
       SVG OVERLAY
       ---------------------------------------------------------------
       The SVG must occupy exactly the image box and must never
       participate in normal document flow.
    */
    const svg = wrapper.querySelector(":scope .note-annotation-layer");

    if (svg) {
      svg.style.position = "absolute";

      svg.style.inset = "0";

      svg.style.width = "100%";

      svg.style.height = "100%";

      svg.style.display = "block";

      svg.style.margin = "0";

      svg.style.padding = "0";

      svg.style.pointerEvents = state.drawing ? "auto" : "none";

      svg.style.boxSizing = "border-box";
    }
  }

  /* -----------------------------------------------------------------------
     IMAGE WRAPPER
  ----------------------------------------------------------------------- */

  function ensureAnnotationWrapper(image) {
    if (!image) return null;

    const existing = image.closest(".note-image-annotation");

    /*
       ---------------------------------------------------------------
       ALREADY WRAPPED
       ---------------------------------------------------------------
    */
    if (existing) {
      /*
         Do NOT recalculate from scratch on every click.

         The original geometry has already been cached.
      */
      ensureAnnotationLayer(existing);

      return existing;
    }

    const parent = image.parentNode;

    if (!parent) return null;

    /*
       ===============================================================
       CRITICAL FIX
       ===============================================================
       Capture the image geometry BEFORE moving it.

       Previously, the code moved the image into the wrapper first and
       only THEN called getComputedStyle()/getBoundingClientRect().
       At that point the browser had already changed the layout context.
    */
    const originalSnapshot = captureImageLayout(image, parent);

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

    wrapper.setAttribute("contenteditable", "false");

    inner.className = "note-image-annotation-inner";

    /*
       Cache BEFORE DOM movement.
    */
    annotationLayoutCache.set(wrapper, originalSnapshot);

    /*
       Insert wrapper at the exact original position.
    */
    parent.insertBefore(wrapper, image);

    /*
       Move image into wrapper.
    */
    inner.appendChild(image);

    /*
       SVG goes AFTER image so it can sit on top using absolute positioning.
    */
    inner.appendChild(svg);

    wrapper.appendChild(inner);

    /*
       Apply the PRE-WRAP geometry snapshot.
    */
    applyAnnotationLayout(wrapper, image, parent, originalSnapshot);

    bindSvg(svg);

    return wrapper;
  }

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

    /*
       For articles loaded from saved HTML, there is no JS cache yet.

       Capture their current layout ONCE before applying annotation
       wrapper styling.
    */
    if (image) {
      let snapshot = annotationLayoutCache.get(wrapper);

      if (!snapshot) {
        snapshot = captureImageLayout(image, wrapper.parentNode);

        annotationLayoutCache.set(wrapper, snapshot);
      }

      applyAnnotationLayout(wrapper, image, wrapper.parentNode, snapshot);
    }

    bindSvg(svg);

    return svg;
  }

  /* -----------------------------------------------------------------------
     OPTIONAL: MAKE SVG NON-INTERACTIVE UNTIL DRAWING MODE
  ----------------------------------------------------------------------- */

  function updateAnnotationPointerState() {
    document
      .querySelectorAll(".note-image-annotation .note-annotation-layer")
      .forEach((svg) => {
        svg.style.pointerEvents =
          state.drawing && state.svg === svg ? "auto" : "none";
      });
  }

  /*
     Patch existing updateToolbar so SVG interaction follows drawing state.
     Replace the original updateToolbar function with this version.
  */
  function updateToolbar() {
    const toolbar = document.getElementById("annotationToolbar");

    const launch = document.getElementById("annotationLaunchBtn");

    if (toolbar) {
      toolbar.style.display = state.wrapper ? "block" : "none";
    }

    if (launch) {
      launch.classList.toggle("is-active", state.drawing);
    }

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

    updateAnnotationPointerState();
  }

  /* -----------------------------------------------------------------------
     SVG POINTER EVENTS
  ----------------------------------------------------------------------- */

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
    if (!svg || svg.dataset.annotationBound === "true") {
      return;
    }

    svg.dataset.annotationBound = "true";

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

  /* -----------------------------------------------------------------------
     SHAPE RECOGNITION
  ----------------------------------------------------------------------- */

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

    /* -------------------- circle / ellipse -------------------- */

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

  /* -----------------------------------------------------------------------
     TOOLBAR / MODE
  ----------------------------------------------------------------------- */

  function updateToolbar() {
    const toolbar = document.getElementById("annotationToolbar");

    const launch = document.getElementById("annotationLaunchBtn");

    if (toolbar) {
      toolbar.style.display = state.wrapper ? "block" : "none";
    }

    if (launch) {
      launch.classList.toggle("is-active", state.drawing);
    }

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
  }

  window.toggleAnnotationMode = () => {
    if (!state.wrapper) {
      const editor = getEditor();

      const firstImage = editor?.querySelector("img.note-img");

      if (!firstImage) {
        setStatus(
          "Insert or select an image first, then click the marker tool.",
        );

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

  /*
     DONE:
     - Stops drawing
     - Removes temporary selection indicators
     - Closes annotation toolbar
     - Clears active wrapper state
     - Does NOT remove actual SVG annotations
  */
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
        /* Original cleanup is optional. */
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
          /* Fall back to the current caret. */
        }
      }

      const id = `annotation-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

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

        const insertedImage = wrapper.querySelector("img.note-img");

        if (insertedImage) {
          applyAnnotationLayout(wrapper, insertedImage, wrapper.parentNode);
        }

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

  /* -----------------------------------------------------------------------
     EDITOR BINDING
  ----------------------------------------------------------------------- */

  function initEditorBinding() {
    const editor = getEditor();

    if (!editor || editor.dataset.annotationAddonBound === "true") {
      return;
    }

    editor.dataset.annotationAddonBound = "true";

    editor.addEventListener("click", (event) => {
      const image = event.target.closest?.("img.note-img");

      if (!image || !editor.contains(image)) {
        return;
      }

      /*
           While actively drawing, the SVG handles the pointer interaction.
           We must not run image-selection logic again.
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

    editor.addEventListener("mousedown", (event) => {
      if (state.drawing && event.target.closest?.(".note-image-annotation")) {
        /*
             Prevent browser image dragging / contenteditable selection from
             competing with the SVG pointer-drawing system.
          */
        event.preventDefault();
      }
    });

    /*
       Explicitly disable native image dragging.
    */
    editor.addEventListener("dragstart", (event) => {
      if (event.target.closest?.("img.note-img")) {
        event.preventDefault();
      }
    });
  }

  /* -----------------------------------------------------------------------
     PUBLISH / SAVE SANITIZATION
  -----------------------------------------------------------------------
     Selection indicators such as `.is-selected` and `.is-drawing` are
     strictly editor UI state. They must never be persisted into body_html.

     We sanitize both:
     1. publish-button click capture
     2. window.publishArticle wrapper
  ----------------------------------------------------------------------- */

  function installPublishSanitizer() {
    if (publishSanitizerInstalled) {
      return;
    }

    publishSanitizerInstalled = true;

    /*
       Capture phase runs before inline onclick handlers such as:
       onclick="publishArticle()"

       Therefore the DOM is already clean when note.js reads editorBody.innerHTML.
    */
    document.addEventListener(
      "click",
      (event) => {
        const publishButton = event.target.closest?.("#publishBtn");

        if (!publishButton) {
          return;
        }

        cleanAnnotationEditorDom();
      },
      true,
    );

    /*
       Also expose a wrapper around the global publishArticle function.
       This covers programmatic calls as well as the normal button.
    */
    const installGlobalWrapper = () => {
      if (typeof window.publishArticle !== "function") {
        return false;
      }

      if (window.publishArticle.__annotationSanitized === "true") {
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
               Remove editor-only indicators BEFORE note.js serializes
               editorBody.innerHTML.
            */
        cleanAnnotationEditorDom();

        try {
          return await originalPublishArticle.apply(this, args);
        } finally {
          /*
                 If publishing failed and the editor is still open, restore
                 the visual state for the user.

                 Successful publishing normally closes the editor, so these
                 classes will not be restored into a saved article.
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
          }
        }
      };

      wrappedPublish.__annotationSanitized = "true";

      window.publishArticle = wrappedPublish;

      return true;
    };

    /*
       note.js is loaded before this add-on, but a microtask + timeout
       makes this resilient if another initializer assigns the function
       immediately after DOM construction.
    */
    installGlobalWrapper();

    Promise.resolve().then(() => {
      installGlobalWrapper();
    });

    setTimeout(() => {
      installGlobalWrapper();
    }, 0);
  }

  /* -----------------------------------------------------------------------
     EDITOR OVERLAY OBSERVER
  ----------------------------------------------------------------------- */

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
             Ensure all pre-existing images loaded from an article can be
             selected and converted to annotation-ready wrappers without
             losing their layout.
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

  /* -----------------------------------------------------------------------
     INIT
  ----------------------------------------------------------------------- */

  function init() {
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
};)();
