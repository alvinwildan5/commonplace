/* ==========================================================================
   AWS COMMONPLACE — STICKY MARGIN NOTES (FOOTNOTES) ADD-ON
   --------------------------------------------------------------------------
   Pair with: notes-sticky-footnote.css
   Load AFTER notes-image-annotation.js (and note.js).

   - Select a word/sentence -> click the left/right note button.
   - A numbered <sup> is inserted right after the selection and a sticky
     note with the same number is created in the left/right margin.
   - The sticky note body is a real editable area: it uses the SAME editing
     pipeline (toolbar execCommand, paste, Enter, shortcuts) as the main text.
   - Numbers are renumbered automatically in document order.
   - Everything is stored inline in body_html (no schema change).
   - Editor-only state (contenteditable on note bodies, hover classes) is
     stripped before saving.
========================================================================== */

(() => {
  "use strict";

  if (window.__stickyFootnoteAddon) return;
  window.__stickyFootnoteAddon = true;

  const MIN_WIDTH = 120;
  const MAX_WIDTH = 230;
  const SAFE_MARGIN = 8;
  const CACHE_LIMIT = 200;
  const SYNC_DELAY = 250;

  const TOOLBAR_SELECTOR =
    ".editor-toolbar, .tb-btn, [class*='toolbar'], select, option";

  const state = {
    lastRange: null,
    cache: new Map(), // id -> { html, side } (session safety net)
    syncing: false,
    syncTimer: 0,
    layoutFrame: 0,
  };

  const boundEditors = new WeakSet();
  let resizeObserver = null;

  /* ========================================================================
     HELPERS
  ======================================================================== */

  const safe = (fn) =>
    function (...args) {
      try {
        return fn.apply(this, args);
      } catch (error) {
        console.warn("[sticky-footnote]", error);
        return undefined;
      }
    };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const getEditor = () => document.getElementById("editorBody");

  const setStatus = (message) => {
    if (typeof window.setEditorStatus === "function") {
      window.setEditorStatus(message);
    }
  };

  const uid = () =>
    `fn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const normSide = (value) => (value === "left" ? "left" : "right");

  const elementOf = (node) =>
    node ? (node.nodeType === 1 ? node : node.parentElement) : null;

  const closestEl = (node, selector) => {
    const el = elementOf(node);
    return el ? el.closest(selector) : null;
  };

  const setAttr = (el, key, value) => {
    if (el.getAttribute(key) !== value) el.setAttribute(key, value);
  };

  const isEditorOpen = () => {
    const overlay = document.getElementById("editor-overlay");
    return overlay
      ? overlay.classList.contains("active")
      : Boolean(getEditor());
  };

  function topBlock(editor, node) {
    let current = node;
    while (current && current.parentNode !== editor) {
      current = current.parentNode;
    }
    return current && current.parentNode === editor ? current : null;
  }

  function prevMeaningful(node) {
    let prev = node.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.textContent.trim()) {
      prev = prev.previousSibling;
    }
    return prev;
  }

  function placeCaretAtEnd(element) {
    const selection = window.getSelection();
    if (!selection) return;

    let node = element.lastChild;
    while (node && node.nodeType === 1 && node.lastChild) {
      node = node.lastChild;
    }

    const range = document.createRange();

    if (!node) {
      range.setStart(element, 0);
    } else if (node.nodeType === 3) {
      range.setStart(node, node.data.length);
    } else if (node.nodeName === "BR") {
      range.setStartBefore(node);
    } else {
      range.setStart(node, node.childNodes.length);
    }

    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const dispatchInput = () => {
    const editor = getEditor();
    if (editor) editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  /* ========================================================================
     MARKUP BUILDERS
  ======================================================================== */

  function buildRef(id, side) {
    const ref = document.createElement("sup");
    ref.className = "note-fn-ref";
    ref.setAttribute("data-fn", id);
    ref.setAttribute("data-fn-side", side);
    ref.setAttribute("contenteditable", "false");
    ref.setAttribute("role", "doc-noteref");
    ref.textContent = "1";
    return ref;
  }

  function buildSticky(id, side, html) {
    const el = document.createElement("div");
    el.className = "note-sticky";
    el.setAttribute("data-fn", id);
    el.setAttribute("data-side", side);
    el.setAttribute("role", "note");
    el.setAttribute("contenteditable", "false");
    el.innerHTML =
      '<div class="note-sticky-head" contenteditable="false">' +
      '<span class="note-sticky-num" title="Kembali ke teks">1</span>' +
      '<span class="note-sticky-tools" contenteditable="false">' +
      '<span class="note-sticky-tool" data-fn-action="flip" role="button" title="Pindahkan ke sisi lain">&#8644;</span>' +
      '<span class="note-sticky-tool" data-fn-action="delete" role="button" title="Hapus catatan">&times;</span>' +
      "</span></div>" +
      '<div class="note-sticky-body">' +
      (html && html.trim() ? html : "<p><br></p>") +
      "</div>";
    return el;
  }

  function ensureStickyStructure(sticky) {
    setAttr(sticky, "contenteditable", "false");

    if (!sticky.querySelector(":scope > .note-sticky-head")) {
      const temp = buildSticky("x", "right", "");
      sticky.insertBefore(
        temp.querySelector(".note-sticky-head"),
        sticky.firstChild,
      );
    }

    if (!sticky.querySelector(":scope > .note-sticky-body")) {
      const temp = buildSticky("x", "right", "");
      sticky.appendChild(temp.querySelector(".note-sticky-body"));
    }
  }

  function stickyBodyHtml(sticky) {
    const body = sticky.querySelector(":scope > .note-sticky-body");
    return body ? body.innerHTML : "";
  }

  function cacheSticky(sticky) {
    const id = sticky.getAttribute("data-fn");
    if (!id) return;

    state.cache.set(id, {
      html: stickyBodyHtml(sticky),
      side: normSide(sticky.getAttribute("data-side")),
    });

    if (state.cache.size > CACHE_LIMIT) {
      state.cache.delete(state.cache.keys().next().value);
    }
  }

  /* ========================================================================
     SYNC: numbering + ordering + orphan handling
  ======================================================================== */

  function syncFootnotes() {
    const editor = getEditor();
    if (!editor || state.syncing) return;

    state.syncing = true;

    try {
      // Notes/refs must never be nested inside notes.
      editor
        .querySelectorAll(".note-sticky .note-sticky")
        .forEach((node) => node.remove());
      editor
        .querySelectorAll(".note-sticky .note-fn-ref")
        .forEach((node) => node.remove());

      const refs = Array.from(editor.querySelectorAll(".note-fn-ref"));
      const byId = new Map();

      editor.querySelectorAll(".note-sticky").forEach((sticky) => {
        const id = sticky.getAttribute("data-fn");

        if (!id || byId.has(id)) {
          sticky.remove();
          return;
        }

        ensureStickyStructure(sticky);
        byId.set(id, sticky);
        cacheSticky(sticky);
      });

      const seen = new Set();
      const ordered = [];

      refs.forEach((ref) => {
        let id = ref.getAttribute("data-fn");
        const side = normSide(ref.getAttribute("data-fn-side"));
        let sticky = null;

        if (!id || seen.has(id)) {
          // Duplicated reference (copy/paste) -> new note cloned from source.
          const source = id ? byId.get(id) : null;
          const cached = id ? state.cache.get(id) : null;
          const html = source
            ? stickyBodyHtml(source)
            : cached
              ? cached.html
              : "";

          id = uid();
          ref.setAttribute("data-fn", id);
          sticky = buildSticky(id, side, html);
        } else {
          sticky = byId.get(id);

          if (!sticky) {
            // Reference exists but its note vanished -> restore from cache.
            const cached = state.cache.get(id);
            sticky = buildSticky(id, side, cached ? cached.html : "");
          }
        }

        byId.set(id, sticky);
        seen.add(id);
        ordered.push({ ref, sticky, side });
      });

      // Numbering and attributes.
      ordered.forEach(({ ref, sticky, side }, index) => {
        const number = String(index + 1);

        if (ref.textContent !== number) ref.textContent = number;
        setAttr(ref, "data-fn-num", number);
        setAttr(ref, "data-fn-side", side);
        setAttr(ref, "contenteditable", "false");
        setAttr(ref, "title", `Catatan ${number}`);

        setAttr(sticky, "data-side", side);
        setAttr(sticky, "data-fn-num", number);

        const numEl = sticky.querySelector(".note-sticky-num");
        if (numEl && numEl.textContent !== number) numEl.textContent = number;
      });

      // Group notes by the top-level block that holds their reference.
      const groups = new Map();

      ordered.forEach(({ ref, sticky }) => {
        const block = topBlock(editor, ref);
        if (!block) return;
        if (!groups.has(block)) groups.set(block, []);
        groups.get(block).push(sticky);
      });

      groups.forEach((list, block) => {
        let cursor = block;

        for (let i = list.length - 1; i >= 0; i -= 1) {
          const sticky = list[i];

          if (prevMeaningful(cursor) !== sticky) {
            editor.insertBefore(sticky, cursor);
          }

          cursor = sticky;
        }
      });

      // Notes without a reference are removed (kept in cache for restore).
      byId.forEach((sticky, id) => {
        if (!seen.has(id)) {
          cacheSticky(sticky);
          sticky.remove();
        }
      });

      ordered.forEach(({ sticky }) => cacheSticky(sticky));
    } finally {
      state.syncing = false;
    }

    scheduleLayout();
  }

  function scheduleSync() {
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(safe(syncFootnotes), SYNC_DELAY);
  }

  /* ========================================================================
     EDITING STATE (note bodies are editable only while being used)
  ======================================================================== */

  function clearTransient(root) {
    root.querySelectorAll(".is-linked, .is-flash").forEach((node) => {
      node.classList.remove("is-linked", "is-flash");
    });
  }

  function disableStickyEditing(except = null) {
    const editor = getEditor();
    if (!editor) return;

    editor
      .querySelectorAll(".note-sticky-body[contenteditable]")
      .forEach((body) => {
        if (body !== except) body.removeAttribute("contenteditable");
      });

    clearTransient(editor);
  }

  function prepareForSave() {
    disableStickyEditing();
    syncFootnotes();
  }

  window.prepareStickyFootnotesForSave = safe(prepareForSave);
  window.syncStickyFootnotes = safe(syncFootnotes);

  function getScrollArea(editor) {
    for (
      let el = editor;
      el && el !== document.body && el !== document.documentElement;
      el = el.parentElement
    ) {
      const overflowY = getComputedStyle(el).overflowY;
      if (
        overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay"
      ) {
        return el;
      }
    }
    return editor;
  }

  function isToolbarLike(target, editor) {
    if (target.closest(TOOLBAR_SELECTOR)) return true;

    const areaTop = getScrollArea(editor).getBoundingClientRect().top;
    return target.getBoundingClientRect().bottom <= areaTop + 4;
  }

  function onPointerDownCapture(event) {
    const editor = getEditor();
    if (!editor || !isEditorOpen()) return;

    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const body = target.closest(".note-sticky-body");

    if (body && editor.contains(body)) {
      disableStickyEditing(body);
      body.setAttribute("contenteditable", "true");
      return;
    }

    if (editor.contains(target) && target.closest(".note-sticky")) return;
    if (isToolbarLike(target, editor)) return;

    disableStickyEditing();
  }

  function onFocusInCapture(event) {
    const editor = getEditor();
    if (!editor || !isEditorOpen()) return;

    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    // Toolbar commands often call editorBody.focus(); keep the note editable.
    if (editor.contains(target)) return;
    if (isToolbarLike(target, editor)) return;

    disableStickyEditing();
  }

  function onKeyDownCapture(event) {
    if ((event.ctrlKey || event.metaKey) && /^s$/i.test(event.key || "")) {
      if (isEditorOpen()) prepareForSave();
    }
  }

  /* ========================================================================
     FOCUS / JUMP / FLASH
  ======================================================================== */

  function pairOf(id, scope) {
    return Array.from(
      scope.querySelectorAll(".note-fn-ref, .note-sticky"),
    ).filter((node) => node.getAttribute("data-fn") === id);
  }

  function scopeFor(node) {
    const editor = getEditor();
    return editor && editor.contains(node) ? editor : document;
  }

  function setLinked(node, on) {
    const id = node.getAttribute("data-fn");
    if (!id) return;
    pairOf(id, scopeFor(node)).forEach((item) => {
      item.classList.toggle("is-linked", on);
    });
  }

  function flash(nodes) {
    nodes.forEach((node) => {
      node.classList.remove("is-flash");
      void node.offsetWidth;
      node.classList.add("is-flash");
      setTimeout(() => node.classList.remove("is-flash"), 1300);
    });
  }

  function findIn(editor, selector, id) {
    return (
      Array.from(editor.querySelectorAll(selector)).find(
        (node) => node.getAttribute("data-fn") === id,
      ) || null
    );
  }

  function focusSticky(id) {
    const editor = getEditor();
    if (!editor) return;

    const sticky = findIn(editor, ".note-sticky", id);
    const body = sticky && sticky.querySelector(":scope > .note-sticky-body");
    if (!body) return;

    disableStickyEditing(body);
    body.setAttribute("contenteditable", "true");

    try {
      body.focus({ preventScroll: true });
    } catch (_) {
      body.focus();
    }

    placeCaretAtEnd(body);

    sticky.scrollIntoView({ block: "nearest", behavior: "smooth" });
    flash([sticky]);
  }

  function ensureCaretInBody(event, body) {
    const selection = window.getSelection();

    if (
      selection &&
      selection.rangeCount &&
      body.contains(selection.anchorNode)
    ) {
      return;
    }

    disableStickyEditing(body);
    body.setAttribute("contenteditable", "true");

    try {
      body.focus({ preventScroll: true });
    } catch (_) {
      body.focus();
    }

    let range = null;

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (pos && body.contains(pos.offsetNode)) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    } else if (document.caretRangeFromPoint) {
      const found = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (found && body.contains(found.startContainer)) range = found;
    }

    if (!range) {
      placeCaretAtEnd(body);
      return;
    }

    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /* ========================================================================
     ACTIONS: insert / flip / delete
  ======================================================================== */

  function rangeAllowed(range, editor) {
    const blocked =
      ".note-image-annotation, .note-fn-ref, .note-sticky, [contenteditable='false']";

    return [range.startContainer, range.endContainer].every((node) => {
      const el = elementOf(node);
      if (!el || !editor.contains(el)) return false;
      const bad = el.closest(blocked);
      return !(bad && editor.contains(bad));
    });
  }

  function resolveCaret(range) {
    if (range.collapsed) return range.cloneRange();

    const root = range.commonAncestorContainer;
    const texts = [];

    if (root.nodeType === 3) {
      texts.push(root);
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) texts.push(node);
    }

    let last = null;
    let lastEnd = 0;

    texts.forEach((text) => {
      if (!range.intersectsNode(text)) return;
      if (closestEl(text, ".note-fn-ref, .note-sticky, .note-image-annotation"))
        return;

      const start = text === range.startContainer ? range.startOffset : 0;
      let end =
        text === range.endContainer ? range.endOffset : text.data.length;

      while (end > start && /\s/.test(text.data[end - 1])) end -= 1;

      if (end > start) {
        last = text;
        lastEnd = end;
      }
    });

    const caret = document.createRange();

    if (last) {
      caret.setStart(last, lastEnd);
    } else {
      caret.setStart(range.endContainer, range.endOffset);
    }

    caret.collapse(true);
    return caret;
  }

  function insertFootnote(sideInput) {
    const editor = getEditor();
    if (!editor || !isEditorOpen()) return;

    const side = normSide(sideInput);
    const selection = window.getSelection();
    let range = null;

    if (selection && selection.rangeCount) {
      const current = selection.getRangeAt(0);
      if (editor.contains(current.commonAncestorContainer)) {
        range = current.cloneRange();
      }
    }

    if (
      range &&
      (closestEl(range.startContainer, ".note-sticky") ||
        closestEl(range.endContainer, ".note-sticky"))
    ) {
      setStatus("Catatan tempel tidak bisa disisipkan di dalam catatan lain.");
      return;
    }

    if (
      !range &&
      state.lastRange &&
      editor.contains(state.lastRange.commonAncestorContainer)
    ) {
      range = state.lastRange.cloneRange();
    }

    if (!range) {
      setStatus(
        "Letakkan kursor atau blok kata/kalimat di tulisan utama dulu.",
      );
      return;
    }

    if (!rangeAllowed(range, editor)) {
      setStatus("Posisi ini tidak bisa diberi catatan tempel.");
      return;
    }

    const caret = resolveCaret(range);
    const id = uid();
    const ref = buildRef(id, side);

    caret.insertNode(ref);

    const next = ref.nextSibling;
    if (!next || next.nodeType !== 3) {
      ref.after(document.createTextNode("\u200B"));
    }

    const sticky = buildSticky(id, side, "");
    const block = topBlock(editor, ref);

    if (block) {
      editor.insertBefore(sticky, block);
    } else {
      editor.appendChild(sticky);
    }

    syncFootnotes();
    dispatchInput();
    focusSticky(id);

    setStatus(
      side === "left"
        ? "Catatan ditambahkan di sisi kiri."
        : "Catatan ditambahkan di sisi kanan.",
    );
  }

  function flipSide(id) {
    const editor = getEditor();
    if (!editor) return;

    const ref = findIn(editor, ".note-fn-ref", id);
    const sticky = findIn(editor, ".note-sticky", id);
    const current = normSide(
      (ref && ref.getAttribute("data-fn-side")) ||
        (sticky && sticky.getAttribute("data-side")),
    );
    const next = current === "left" ? "right" : "left";

    if (ref) ref.setAttribute("data-fn-side", next);
    if (sticky) sticky.setAttribute("data-side", next);

    syncFootnotes();
    dispatchInput();
  }

  function deleteFootnote(id) {
    const editor = getEditor();
    if (!editor) return;

    const ref = findIn(editor, ".note-fn-ref", id);
    const sticky = findIn(editor, ".note-sticky", id);
    const body = sticky && sticky.querySelector(":scope > .note-sticky-body");
    const hasText = body && body.textContent.trim().length > 0;

    if (
      hasText &&
      !window.confirm("Hapus catatan tempel ini beserta isinya?")
    ) {
      return;
    }

    if (ref) ref.remove();
    if (sticky) sticky.remove();
    state.cache.delete(id);

    syncFootnotes();
    dispatchInput();
  }

  window.insertStickyFootnote = safe(insertFootnote);

  /* ========================================================================
     BACKSPACE / DELETE next to a note (prevents the browser deleting the
     non-editable note block when merging paragraphs)
  ======================================================================== */

  function isMergeableBlock(el) {
    return (
      /^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(el.tagName) &&
      !el.matches(
        ".note-image-annotation, .note-sticky, [contenteditable='false']",
      )
    );
  }

  function caretAtEdge(block, selection, edge) {
    const range = document.createRange();
    range.selectNodeContents(block);

    if (edge === "start") {
      range.setEnd(selection.anchorNode, selection.anchorOffset);
    } else {
      range.setStart(selection.anchorNode, selection.anchorOffset);
    }

    const fragment = range.cloneContents();
    const text = (fragment.textContent || "").replace(/[\u200B\uFEFF]/g, "");

    return (
      text.length === 0 && !fragment.querySelector("img, svg, .note-fn-ref")
    );
  }

  function handleMergeKeys(event) {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const editor = getEditor();
    const selection = window.getSelection();

    if (
      !editor ||
      !selection ||
      !selection.rangeCount ||
      !selection.isCollapsed
    ) {
      return;
    }

    if (closestEl(selection.anchorNode, ".note-sticky")) return;

    const block = topBlock(editor, selection.anchorNode);
    if (!block || block.nodeType !== 1) return;

    if (event.key === "Backspace") {
      if (!caretAtEdge(block, selection, "start")) return;

      const run = [];
      let prev = block.previousElementSibling;

      while (prev && prev.classList.contains("note-sticky")) {
        run.unshift(prev);
        prev = prev.previousElementSibling;
      }

      if (!run.length) return;

      if (prev && isMergeableBlock(prev)) {
        run.forEach((note) => editor.insertBefore(note, prev));
      } else {
        event.preventDefault();
      }

      return;
    }

    if (!caretAtEdge(block, selection, "end")) return;

    const run = [];
    let next = block.nextElementSibling;

    while (next && next.classList.contains("note-sticky")) {
      run.push(next);
      next = next.nextElementSibling;
    }

    if (!run.length) return;

    if (next && isMergeableBlock(next)) {
      run.forEach((note) => editor.insertBefore(note, block));
    } else {
      event.preventDefault();
    }
  }

  /* ========================================================================
     DOCUMENT-LEVEL CLICK (works in editor and, if loaded, reading page)
  ======================================================================== */

  function onDocumentClick(event) {
    const target = elementOf(event.target);
    if (!target) return;

    const editor = getEditor();
    const inEditor = Boolean(editor && editor.contains(target));

    const action = target.closest("[data-fn-action]");

    if (action && inEditor) {
      const sticky = action.closest(".note-sticky");
      if (!sticky) return;

      event.preventDefault();
      event.stopPropagation();

      const id = sticky.getAttribute("data-fn");

      if (action.getAttribute("data-fn-action") === "delete") {
        deleteFootnote(id);
      } else {
        flipSide(id);
      }

      return;
    }

    const ref = target.closest(".note-fn-ref");

    if (ref) {
      const id = ref.getAttribute("data-fn");

      if (inEditor) {
        event.preventDefault();
        focusSticky(id);
      } else {
        const pair = pairOf(id, document);
        const sticky = pair.find((node) =>
          node.classList.contains("note-sticky"),
        );

        if (sticky) {
          sticky.scrollIntoView({ block: "center", behavior: "smooth" });
          flash([sticky]);
        }
      }

      return;
    }

    const num = target.closest(".note-sticky-num");

    if (num) {
      const sticky = num.closest(".note-sticky");
      const id = sticky && sticky.getAttribute("data-fn");
      if (!id) return;

      const pair = pairOf(id, inEditor ? editor : document);
      const source = pair.find((node) =>
        node.classList.contains("note-fn-ref"),
      );

      if (source) {
        source.scrollIntoView({ block: "center", behavior: "smooth" });
        flash([source]);
      }

      return;
    }

    if (inEditor) {
      const body = target.closest(".note-sticky-body");
      if (body) ensureCaretInBody(event, body);
    }
  }

  /* ========================================================================
     LAYOUT: measure the free margin; float if it fits, otherwise compact
  ======================================================================== */

  function layoutContainer(container) {
    if (!container || !container.isConnected || !container.clientWidth) return;

    const style = getComputedStyle(container);
    const rect = container.getBoundingClientRect();
    const left = rect.left + container.clientLeft;

    const contentLeft = left + (parseFloat(style.paddingLeft) || 0);
    const contentRight =
      left + container.clientWidth - (parseFloat(style.paddingRight) || 0);

    let clipLeft = 0;
    let clipRight = document.documentElement.clientWidth;

    for (
      let el = container;
      el && el !== document.body && el !== document.documentElement;
      el = el.parentElement
    ) {
      if (getComputedStyle(el).overflowX === "visible") continue;

      const r = el.getBoundingClientRect();
      clipLeft = Math.max(clipLeft, r.left + el.clientLeft);
      clipRight = Math.min(clipRight, r.left + el.clientLeft + el.clientWidth);
    }

    const available = Math.min(
      contentLeft - clipLeft,
      clipRight - contentRight,
    );
    const gap = clamp(Math.round(available * 0.12), 14, 32);
    const width = Math.min(
      MAX_WIDTH,
      Math.floor(available - gap - SAFE_MARGIN),
    );
    const mode = width >= MIN_WIDTH ? "float" : "compact";

    if (mode === "float") {
      const widthValue = `${width}px`;
      const gapValue = `${gap}px`;

      if (container.style.getPropertyValue("--note-sticky-w") !== widthValue) {
        container.style.setProperty("--note-sticky-w", widthValue);
      }

      if (container.style.getPropertyValue("--note-sticky-gap") !== gapValue) {
        container.style.setProperty("--note-sticky-gap", gapValue);
      }
    }

    if (container.getAttribute("data-fn-layout") !== mode) {
      container.setAttribute("data-fn-layout", mode);
    }
  }

  function layoutAll() {
    const containers = new Set();

    document.querySelectorAll(".note-sticky").forEach((sticky) => {
      if (sticky.parentElement) containers.add(sticky.parentElement);
    });

    containers.forEach(safe(layoutContainer));
  }

  function scheduleLayout() {
    if (state.layoutFrame) return;

    state.layoutFrame = requestAnimationFrame(() => {
      state.layoutFrame = 0;
      safe(layoutAll)();
    });
  }

  function observeSizes() {
    if (!("ResizeObserver" in window)) return;

    const editor = getEditor();
    if (!editor) return;

    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => scheduleLayout());
    }

    let el = editor;
    let depth = 0;

    while (el && el !== document.body && depth < 8) {
      resizeObserver.observe(el);
      el = el.parentElement;
      depth += 1;
    }
  }

  /* ========================================================================
     TOOLBAR BUTTONS
  ======================================================================== */

  function makeToolbarButton(side) {
    const button = document.createElement("button");
    const isLeft = side === "left";

    button.type = "button";
    button.className = "tb-btn note-fn-launch-btn";
    button.id = isLeft ? "footnoteLeftBtn" : "footnoteRightBtn";
    button.setAttribute("data-fn-side", side);
    button.title = isLeft
      ? "Sisipkan catatan tempel di sisi kiri"
      : "Sisipkan catatan tempel di sisi kanan";
    button.setAttribute("aria-label", button.title);
    button.innerHTML =
      '<i class="fa-regular fa-note-sticky"></i>' +
      `<span class="note-fn-btn-dir">${isLeft ? "&lsaquo;" : "&rsaquo;"}</span>`;

    // Keep the text selection while clicking the button.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener(
      "click",
      safe(() => insertFootnote(side)),
    );

    return button;
  }

  function injectToolbarButtons() {
    if (document.getElementById("footnoteLeftBtn")) return true;

    const toolbar = document.querySelector(".editor-toolbar");
    if (!toolbar) return false;

    const anchor =
      document.getElementById("annotationLaunchBtn") ||
      toolbar.querySelector('[onclick="triggerImageInsert()"]');

    const parent = anchor ? anchor.parentElement : toolbar;
    const before = anchor ? anchor.nextSibling : null;

    parent.insertBefore(makeToolbarButton("left"), before);
    parent.insertBefore(makeToolbarButton("right"), before);

    return true;
  }

  /* ========================================================================
     SAVE GUARDS
  ======================================================================== */

  function installSaveGuards() {
    ["publishArticle", "saveArticle", "saveNote", "updateArticle"].forEach(
      (name) => {
        const original = window[name];

        if (typeof original !== "function" || original.__stickyFootnoteGuard) {
          return;
        }

        const wrapped = function (...args) {
          try {
            prepareForSave();
          } catch (error) {
            console.warn("[sticky-footnote]", error);
          }

          return original.apply(this, args);
        };

        try {
          Object.assign(wrapped, original);
          wrapped.__stickyFootnoteGuard = true;
          window[name] = wrapped;
        } catch (_) {
          /* Read-only global: pointer/focus guards still protect saving. */
        }
      },
    );
  }

  /* ========================================================================
     EDITOR BINDING + OVERLAY OBSERVER
  ======================================================================== */

  function bindEditor() {
    const editor = getEditor();
    if (!editor || boundEditors.has(editor)) return;

    boundEditors.add(editor);

    editor.addEventListener("input", safe(scheduleSync));
    editor.addEventListener("keydown", safe(handleMergeKeys), true);

    observeSizes();
  }

  function observeOverlay() {
    const overlay = document.getElementById("editor-overlay");
    if (!overlay || overlay.__stickyFootnoteObserved) return;

    overlay.__stickyFootnoteObserved = true;

    let wasActive = overlay.classList.contains("active");

    const observer = new MutationObserver(
      safe(() => {
        const active = overlay.classList.contains("active");

        if (active && !wasActive) {
          bindEditor();
          injectToolbarButtons();
          observeSizes();

          [0, 150, 450, 1000].forEach((ms, index) => {
            setTimeout(
              safe(() => {
                if (!isEditorOpen()) return;
                if (index === 0) disableStickyEditing();
                syncFootnotes();
                scheduleLayout();
              }),
              ms,
            );
          });
        } else if (!active && wasActive) {
          disableStickyEditing();
          state.cache.clear();
          state.lastRange = null;
        } else if (active) {
          scheduleLayout();
        }

        wasActive = active;
      }),
    );

    observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
  }

  /* ========================================================================
     INIT
  ======================================================================== */

  function healStaticPages() {
    const editor = getEditor();

    document
      .querySelectorAll(".note-sticky-body[contenteditable]")
      .forEach((body) => {
        if (!editor || !editor.contains(body)) {
          body.removeAttribute("contenteditable");
        }
      });
  }

  function init() {
    injectToolbarButtons();
    bindEditor();
    installSaveGuards();
    observeOverlay();
    healStaticPages();
    scheduleLayout();
  }

  // Document-level listeners (registered once).
  document.addEventListener("pointerdown", safe(onPointerDownCapture), true);
  document.addEventListener("focusin", safe(onFocusInCapture), true);
  document.addEventListener("keydown", safe(onKeyDownCapture), true);
  document.addEventListener("click", safe(onDocumentClick));

  document.addEventListener(
    "mouseover",
    safe((event) => {
      const node = closestEl(event.target, ".note-fn-ref, .note-sticky");
      if (node) setLinked(node, true);
    }),
  );

  document.addEventListener(
    "mouseout",
    safe((event) => {
      const node = closestEl(event.target, ".note-fn-ref, .note-sticky");

      if (
        node &&
        !(event.relatedTarget && node.contains(event.relatedTarget))
      ) {
        setLinked(node, false);
      }
    }),
  );

  document.addEventListener(
    "selectionchange",
    safe(() => {
      const editor = getEditor();
      const selection = window.getSelection();

      if (!editor || !selection || !selection.rangeCount) return;

      const range = selection.getRangeAt(0);

      if (!editor.contains(range.commonAncestorContainer)) return;
      if (closestEl(range.commonAncestorContainer, ".note-sticky")) return;

      state.lastRange = range.cloneRange();
    }),
  );

  window.addEventListener("resize", safe(scheduleLayout));
  document.addEventListener("fullscreenchange", safe(scheduleLayout));

  const start = safe(init);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  // note.js may define publishArticle / build the toolbar slightly later.
  window.addEventListener("load", start, { once: true });
  setTimeout(start, 0);
  setTimeout(start, 600);
  setTimeout(start, 1500);
})();
