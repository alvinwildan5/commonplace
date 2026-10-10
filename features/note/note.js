/* ==========================================================================
   NOTES SCRIPT — CMS EDITION (SUPABASE) — MERGED SINGLE FILE
   --------------------------------------------------------------------------
   Menggabungkan note.js + image-annotation add-on menjadi SATU file.
   (Hapus tag <script> add-on; cukup muat file ini.)

   Isi:
   - Routing bersih (/note, /note/slug), SEO, carousel, search, export
   - Editor CMS (Supabase), card background, Focus Mode, Full Screen
   - Anotasi gambar (pen/line/arrow/box/circle/eraser) — versi diperbaiki
   - Seleksi/caret selalu dipulihkan sebelum perintah toolbar (fix bullet)
   - Word count khusus teks yang diseleksi
   - Tabel: tambah/hapus baris-kolom, merge/unmerge, lebar kolom & tinggi
     baris (menu + drag border)
   - Bullet bertingkat (anak bullet) + besar menjorok + gaya bullet/angka
========================================================================== */

/* ==========================================================================
   AUTH / CONFIG
========================================================================== */

const OWNER_PASSWORD_HASH =
  "69bfe17dbd9743d9a11023421d37589c19c461539012b540c0a242b4fdfb5aab";

const AUTH_KEY = "aws_notes_auth";

/*
   PUBLIC NOTES ROUTE
   https://aws-commonplace.pages.dev/note
   https://aws-commonplace.pages.dev/note/less-is-more
*/
const NOTE_BASE_PATH = "/note";

const DEFAULT_PAGE_TITLE = "Notes & Thoughts | AWS Archive";

const DEFAULT_DESCRIPTION =
  "A collection of digital archives, notes, and thoughts by Alvin Wildan Sahli navigating intersections of climate, spatial ecology, and community resilience.";

const TOPIC_CONFIG = {
  culture: { label: "Culture & History", icon: "fa-masks-theater" },
  sustainability: { label: "Sustainability", icon: "fa-leaf" },
  environment: { label: "Environment", icon: "fa-seedling" },
  education: { label: "Education", icon: "fa-book-open" },
};

/* ==========================================================================
   GLOBAL STATE
========================================================================== */

let pendingImageDataUrl = null;

/* Card background */
let pendingCardBackgroundFile = null;
let currentCardBackgroundUrl = null;
let currentCardBackgroundPath = null;
let removeCardBackground = false;
const CARD_BG_BUCKET = "note-card-images";

let editingArticleId = null;
let globalArticlesCache = [];
let scrollSpyObserver = null;

let savedSelectionRange = null;
let lastSelectionRange = null;
let savedImageSelectionRange = null;

let currentArticleTitle = "Document";

/* Editor view state (Focus Mode: metadata hidden) */
let editorFocusMode = true;

/* Preferensi menjorok bullet terakhir yang dipilih (px) */
let preferredListIndentPx = null;

/* Penanda: word count sedang menampilkan hitungan seleksi */
let wordCountShowsSelection = false;

/* ==========================================================================
   SUPABASE
========================================================================== */

const SUPABASE_URL = "https://hieryuiikzcrvssuvsmn.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_O0XW4AxwOSNv1cvGkxx5Tg_8XTOnRzF";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);

/* ==========================================================================
   SMALL HELPERS
========================================================================== */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const formatNumber = (value) => Number(Number(value).toFixed(2));

function getEditor() {
  return document.getElementById("editorBody");
}

function countWords(text) {
  const clean = String(text || "").trim();
  return clean ? clean.split(/\s+/).length : 0;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function setEditorStatus(message) {
  const element = document.getElementById("editorStatus");
  if (element) {
    element.textContent = message;
  }
}

/* ==========================================================================
   ROUTING
========================================================================== */

function normalizePathname(pathname) {
  if (!pathname) return "/";
  let path = pathname;
  if (path.length > 1) {
    path = path.replace(/\/+$/, "");
  }
  return path;
}

function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getArticleRoute(articleId) {
  const article = globalArticlesCache.find((item) => item.id === articleId);

  if (!article) {
    return `${NOTE_BASE_PATH}/${encodeURIComponent(articleId)}`;
  }

  const slug = slugify(article.title);

  if (!slug) {
    return `${NOTE_BASE_PATH}/${encodeURIComponent(articleId)}`;
  }

  return `${NOTE_BASE_PATH}/${encodeURIComponent(slug)}`;
}

function decodeRouteValue(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    console.warn("Could not decode route value:", error);
    return value;
  }
}

function getArticleIdFromLocation() {
  const pathname = normalizePathname(window.location.pathname);
  const base = normalizePathname(NOTE_BASE_PATH);

  if (pathname === base) {
    const hash = window.location.hash || "";

    if (hash.startsWith("#article-")) {
      return decodeRouteValue(hash.substring(1));
    }

    return null;
  }

  if (pathname.startsWith(`${base}/`)) {
    const encodedSlug = pathname.substring(`${base}/`.length);

    if (!encodedSlug) return null;

    const slug = decodeRouteValue(encodedSlug);

    const article = globalArticlesCache.find(
      (item) => slugify(item.title) === slug,
    );

    if (article) return article.id;

    const articleById = globalArticlesCache.find((item) => item.id === slug);

    return articleById ? articleById.id : null;
  }

  return null;
}

function navigateToArticle(articleId, replace = false) {
  if (!articleId) return;

  const route = getArticleRoute(articleId);
  const state = { type: "article", articleId };

  if (replace) {
    window.history.replaceState(state, "", route);
  } else {
    window.history.pushState(state, "", route);
  }
}

function navigateToNotes(replace = false) {
  const route = NOTE_BASE_PATH;
  const state = { type: "notes" };

  if (replace) {
    window.history.replaceState(state, "", route);
  } else {
    window.history.pushState(state, "", route);
  }
}

function hideReadingOverlay() {
  const overlay = document.getElementById("reading-overlay");

  if (overlay) {
    overlay.classList.remove("active");
  }

  document.body.style.overflow = "auto";

  const dropdown = document.getElementById("exportDropdown");

  if (dropdown) {
    dropdown.classList.remove("show");
  }

  currentArticleTitle = "Document";

  restoreDefaultSeoMetaTags();
}

/* Runs only AFTER Supabase articles are loaded. */
function handleCurrentRoute() {
  const articleId = getArticleIdFromLocation();

  if (!articleId) {
    hideReadingOverlay();
    return;
  }

  const articleElement = document.getElementById(articleId);

  if (!articleElement) {
    console.warn("Article route not found:", articleId);
    navigateToNotes(true);
    hideReadingOverlay();
    return;
  }

  openArticle(articleId, false);
}

function checkHashForArticle() {
  handleCurrentRoute();
}

window.addEventListener("popstate", () => {
  handleCurrentRoute();
});

window.addEventListener("hashchange", () => {
  handleCurrentRoute();
});

/* ==========================================================================
   DOM READY
========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const savedLanguage = localStorage.getItem("language") || "en";

  switchLanguage(savedLanguage);

  /*
     Pasang semua tambahan editor (anotasi, list, tabel, style) LEBIH DULU,
     sebelum menunggu Supabase, supaya toolbar langsung siap.
  */
  initEditorEnhancements();

  /* MUST load Supabase first so direct article URLs work. */
  await loadSavedArticlesIntoDom();

  initCarousels();
  initScrollSpy();
  refreshAuthUI();

  const dateField = document.getElementById("fieldDate");

  if (dateField) {
    dateField.value = new Date().toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------
       EDITOR BODY INPUT
  ------------------------------------------------------------ */

  const editorBody = getEditor();

  if (editorBody) {
    editorBody.addEventListener("input", () => {
      const sel = window.getSelection();

      if (sel && sel.rangeCount > 0) {
        const node = sel.anchorNode;

        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue;
          let newText = text;

          if (text.includes("->")) newText = newText.replace("->", "→");
          if (text.includes("<-")) newText = newText.replace("<-", "←");
          if (text.includes("=>")) newText = newText.replace("=>", "⇒");

          if (newText !== text) {
            node.nodeValue = newText;

            try {
              sel.collapse(node, node.nodeValue.length);
            } catch (error) {
              console.warn("Could not restore cursor position:", error);
            }
          }
        }
      }

      updateWordCount();

      updateEditorFocusTitle(
        document.getElementById("fieldTitle")?.value?.trim() || "",
      );
    });
  }

  const editorTitleInput = document.getElementById("fieldTitle");

  if (editorTitleInput) {
    editorTitleInput.addEventListener("input", () => {
      updateEditorFocusTitle(editorTitleInput.value.trim());
    });
  }

  /* HEADER SCROLL */
  const header = document.querySelector(".site-header");

  if (header) {
    window.addEventListener(
      "scroll",
      () => {
        if (window.scrollY > 50) {
          header.classList.add("scrolled");
        } else {
          header.classList.remove("scrolled");
        }
      },
      { passive: true },
    );
  }

  /* INTERNAL ARTICLE LINKS */
  document.addEventListener("click", (event) => {
    const routeLink = event.target.closest("[data-note-route]");

    if (!routeLink) return;

    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }

    const articleId = routeLink.getAttribute("data-article-id");

    if (!articleId) return;

    event.preventDefault();

    openArticle(articleId, true);
  });

  /* INITIAL ROUTE */
  handleCurrentRoute();

  /* INITIAL EDITOR VIEW STATE */
  setEditorFocusMode(true);
  updateEditorFullscreenButton();
});

/* ==========================================================================
   SEARCH
========================================================================== */

window.executeNoteSearch = function () {
  const searchInput = document.getElementById("noteSearch");

  if (!searchInput) return;

  const filterText = searchInput.value.toLowerCase().trim();
  const noteCards = document.querySelectorAll(".ed-card");

  let totalVisible = 0;

  noteCards.forEach((card) => {
    if (card.getAttribute("aria-hidden") === "true") return;

    const cardContent = card.textContent.toLowerCase();

    if (cardContent.includes(filterText)) {
      card.style.display = "flex";
      totalVisible++;
    } else {
      card.style.display = "none";
    }
  });

  document.querySelectorAll(".topic-section").forEach((section) => {
    const visibleCards = Array.from(
      section.querySelectorAll(".ed-card:not([aria-hidden='true'])"),
    ).filter((card) => card.style.display !== "none");

    if (visibleCards.length === 0 && filterText !== "") {
      section.style.display = "none";
    } else {
      section.style.display = "block";
    }
  });

  const noResultsElement = document.getElementById("noResultsElement");

  if (noResultsElement) {
    noResultsElement.style.display =
      totalVisible === 0 && filterText !== "" ? "block" : "none";
  }
};

/* ==========================================================================
   CAROUSEL
========================================================================== */

function initCarousels() {
  document.querySelectorAll(".carousel-container").forEach((container) => {
    initSingleCarousel(container);
  });
}

function initSingleCarousel(container) {
  let track = container.querySelector(".carousel-track");

  if (!track) return;

  track.querySelectorAll('[aria-hidden="true"]').forEach((element) => {
    element.remove();
  });

  const freshTrack = track.cloneNode(true);

  track.replaceWith(freshTrack);

  track = freshTrack;

  const originalItems = Array.from(track.children);
  const totalOriginal = originalItems.length;

  if (totalOriginal === 0) return;

  const prevBtn = container.querySelector(".prev-btn");
  const nextBtn = container.querySelector(".next-btn");

  const createSafeClone = (item) => {
    const clone = item.cloneNode(true);

    clone.setAttribute("aria-hidden", "true");
    clone.removeAttribute("id");

    clone.querySelectorAll("[id]").forEach((element) => {
      element.removeAttribute("id");
    });

    return clone;
  };

  originalItems.forEach((item) => {
    track.insertBefore(createSafeClone(item), originalItems[0]);
  });

  originalItems.forEach((item) => {
    track.appendChild(createSafeClone(item));
  });

  const getScrollStep = () => {
    if (!originalItems[0]) return 0;

    const itemWidth = originalItems[0].offsetWidth;
    const gap = parseFloat(getComputedStyle(track).gap) || 32;

    return itemWidth + gap;
  };

  setTimeout(() => {
    const step = getScrollStep();

    if (!step) return;

    track.style.scrollBehavior = "auto";
    track.scrollLeft = totalOriginal * step;

    requestAnimationFrame(() => {
      track.style.scrollBehavior = "";
    });
  }, 100);

  let scrollTimeout = null;

  track.addEventListener("scroll", () => {
    const step = getScrollStep();

    if (!step) return;

    const scrollLeft = track.scrollLeft;

    clearTimeout(scrollTimeout);

    scrollTimeout = setTimeout(() => {
      if (scrollLeft <= (totalOriginal - 1) * step) {
        track.style.scrollSnapType = "none";
        track.scrollLeft = scrollLeft + totalOriginal * step;

        requestAnimationFrame(() => {
          track.style.scrollSnapType = "x mandatory";
        });
      } else if (scrollLeft >= totalOriginal * 2 * step) {
        track.style.scrollSnapType = "none";
        track.scrollLeft = scrollLeft - totalOriginal * step;

        requestAnimationFrame(() => {
          track.style.scrollSnapType = "x mandatory";
        });
      }
    }, 150);
  });

  const scrollByArrow = (direction) => {
    const step = getScrollStep();

    if (!step) return;

    track.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  if (prevBtn) {
    const newPrev = prevBtn.cloneNode(true);
    prevBtn.replaceWith(newPrev);
    newPrev.addEventListener("click", () => scrollByArrow(-1));
  }

  if (nextBtn) {
    const newNext = nextBtn.cloneNode(true);
    nextBtn.replaceWith(newNext);
    newNext.addEventListener("click", () => scrollByArrow(1));
  }
}

/* ==========================================================================
   ARTICLE READING
========================================================================== */

window.openArticle = function (articleId, updateRoute = true) {
  const article = document.getElementById(articleId);

  if (!article) {
    console.warn("Cannot open article:", articleId);
    return;
  }

  const parentSection = article.closest(".topic-section");

  if (parentSection) {
    const topicId = parentSection.getAttribute("id");

    document.querySelectorAll(".topic-list a").forEach((link) => {
      link.classList.remove("active");
    });

    const activeLink = document.querySelector(
      `.topic-list a[href="#${topicId}"]`,
    );

    if (activeLink) activeLink.classList.add("active");
  }

  const contentToExport = document.getElementById(`content-${articleId}`);
  const modalContent = document.getElementById("reading-content-area");

  if (!contentToExport || !modalContent) return;

  const clone = contentToExport.cloneNode(true);
  const excerptEl = clone.querySelector(".ed-excerpt");

  if (excerptEl) excerptEl.remove();

  modalContent.innerHTML = clone.innerHTML;

  /*
     FIX: coretan pada gambar harus tampil di mode baca tanpa bergantung
     pada CSS eksternal -> style dasar layer SVG ditanam inline.
  */
  hydrateAnnotationsForReading(modalContent);

  const titleEl = modalContent.querySelector(".ed-title");

  if (titleEl) {
    currentArticleTitle = titleEl.innerText.trim();
  }

  const excerptText = article.querySelector(".ed-excerpt p")?.textContent || "";

  const articleUrl = new URL(getArticleRoute(articleId), window.location.origin)
    .href;

  updateSeoMetaTags(currentArticleTitle, excerptText, articleUrl, articleId);

  const readingOverlay = document.getElementById("reading-overlay");

  if (readingOverlay) readingOverlay.classList.add("active");

  document.body.style.overflow = "hidden";

  const exportDropdown = document.getElementById("exportDropdown");

  if (exportDropdown) exportDropdown.classList.remove("show");

  window.scrollTo({ top: 0, behavior: "auto" });

  modalContent.scrollTop = 0;

  if (updateRoute) {
    navigateToArticle(articleId);
  }
};

/* ==========================================================================
   SEO META
========================================================================== */

function setElementProp(id, prop, value) {
  const element = document.getElementById(id);

  if (element) {
    element[prop] = value;
  }
}

function applySeo({ fullTitle, description, url, articleId, headline }) {
  setElementProp("page-title", "textContent", fullTitle);
  setElementProp("meta-title", "content", fullTitle);
  setElementProp("meta-description", "content", description);
  setElementProp("canonical-url", "href", url);
  setElementProp("og-type", "content", articleId ? "article" : "website");
  setElementProp("og-url", "content", url);
  setElementProp("og-title", "content", fullTitle);
  setElementProp("og-description", "content", description);
  setElementProp("twitter-url", "content", url);
  setElementProp("twitter-title", "content", fullTitle);
  setElementProp("twitter-description", "content", description);

  const author = { "@type": "Person", name: "Alvin Wildan Sahli" };

  const schema = articleId
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline,
        name: headline,
        description,
        url,
        identifier: articleId,
        author,
      }
    : {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: DEFAULT_PAGE_TITLE,
        url,
        description,
        author,
      };

  setElementProp("structured-data", "textContent", JSON.stringify(schema));
}

function updateSeoMetaTags(title, description, articleUrl, articleId = null) {
  const cleanDescription = String(description || "")
    .replace(/\s+/g, " ")
    .trim();

  applySeo({
    fullTitle: `${title} | AWS Archive`,
    description: cleanDescription || DEFAULT_DESCRIPTION,
    url: articleUrl || new URL(NOTE_BASE_PATH, window.location.origin).href,
    articleId,
    headline: title,
  });
}

function restoreDefaultSeoMetaTags() {
  applySeo({
    fullTitle: DEFAULT_PAGE_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: new URL(NOTE_BASE_PATH, window.location.origin).href,
    articleId: null,
    headline: DEFAULT_PAGE_TITLE,
  });
}

/* ==========================================================================
   CLOSE ARTICLE
========================================================================== */

window.closeArticle = function () {
  navigateToNotes(true);
  hideReadingOverlay();
};

/* ==========================================================================
   EXPORT MENU
========================================================================== */

window.toggleExportMenu = function () {
  const dropdown = document.getElementById("exportDropdown");

  if (!dropdown) return;

  dropdown.classList.toggle("show");
};

document.addEventListener("click", (event) => {
  const container = document.querySelector(".export-menu-container");
  const dropdown = document.getElementById("exportDropdown");

  if (container && !container.contains(event.target) && dropdown) {
    dropdown.classList.remove("show");
  }
});

/* ==========================================================================
   SHARE / COPY LINK
========================================================================== */

window.shareLink = function (platform) {
  const url = encodeURIComponent(window.location.href);
  const title = encodeURIComponent(currentArticleTitle);

  if (platform === "wa") {
    window.open(
      `https://api.whatsapp.com/send?text=*${title}*%0A${url}`,
      "_blank",
      "noopener,noreferrer",
    );
  } else if (platform === "x") {
    window.open(
      `https://twitter.com/intent/tweet?text=${title}&url=${url}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  const dropdown = document.getElementById("exportDropdown");

  if (dropdown) dropdown.classList.remove("show");
};

window.copyArticleLink = function () {
  const url = window.location.href;

  navigator.clipboard
    .writeText(url)
    .then(() => {
      alert("Link copied to clipboard!");
    })
    .catch((error) => {
      console.error("Failed to copy link:", error);
      alert("Unable to copy the link.");
    });

  const dropdown = document.getElementById("exportDropdown");

  if (dropdown) dropdown.classList.remove("show");
};

/* ==========================================================================
   DOWNLOAD / EXPORT
========================================================================== */

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/*
   Word tidak bisa menampilkan <svg>. Gambar beranotasi "diratakan" menjadi
   satu PNG (gambar + coretan) sebelum diekspor.
*/
async function flattenAnnotatedImagesForWord(root) {
  const wrappers = Array.from(root.querySelectorAll(".note-image-annotation"));

  for (const wrapper of wrappers) {
    const image = wrapper.querySelector("img");

    if (!image) {
      wrapper.remove();
      continue;
    }

    try {
      const svg = wrapper.querySelector(".note-annotation-layer");
      const hasShapes = svg && svg.querySelector("[data-annotation-kind]");

      if (!hasShapes) {
        wrapper.replaceWith(image);
        continue;
      }

      const base = await loadImageElement(image.src);
      const width = base.naturalWidth || 800;
      const height = base.naturalHeight || 600;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(base, 0, 0, width, height);

      const viewBox = (svg.getAttribute("viewBox") || "0 0 100 100").trim();
      const legacy = viewBox === "0 0 100 100";

      let inner = svg.innerHTML;

      if (legacy) {
        inner = inner
          .replace(/vector-effect="non-scaling-stroke"/g, "")
          .replace(/stroke-width="[^"]*"/g, 'stroke-width="0.6"');
      }

      const markup =
        `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" ` +
        `preserveAspectRatio="none" width="${width}" height="${height}">` +
        `${inner}</svg>`;

      const overlay = await loadImageElement(
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup),
      );

      ctx.drawImage(overlay, 0, 0, width, height);

      const flat = document.createElement("img");
      flat.src = canvas.toDataURL("image/png");

      wrapper.replaceWith(flat);
    } catch (error) {
      console.warn("Could not flatten annotated image:", error);
      wrapper.replaceWith(image);
    }
  }
}

async function exportWordDocument(originalElement, filename) {
  const exportClone = originalElement.cloneNode(true);

  await flattenAnnotatedImagesForWord(exportClone);

  exportClone.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("style");
    img.removeAttribute("class");
    img.setAttribute("width", "620");
  });

  exportClone.querySelectorAll("p, div, li, td, th").forEach((element) => {
    element.style.cssText = [
      "text-align:justify",
      "font-size:12pt",
      "font-family:'Times New Roman', serif",
      "line-height:1.5",
    ].join(";");
  });

  exportClone.querySelectorAll("h1, h2, h3, .ed-title").forEach((element) => {
    element.style.cssText = [
      "text-align:left",
      "font-size:16pt",
      "font-family:'Times New Roman', serif",
      "font-weight:bold",
    ].join(";");
  });

  const header = `
    <html
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40"
    >
      <head>
        <meta charset="utf-8">
        <title>Export</title>
        <style>
          @page WordSection1 {
            size: 8.5in 11.0in;
            margin: 1.0in 1.0in 1.0in 1.0in;
            mso-header-margin: 0.5in;
            mso-footer-margin: 0.5in;
            mso-paper-source: 0;
          }
          div.WordSection1 { page: WordSection1; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
          table, th, td { border: 1px solid black; padding: 8px; }
        </style>
      </head>
      <body>
        <div class="WordSection1">
  `;

  const footer = `
        </div>
      </body>
    </html>
  `;

  const sourceHTML = header + exportClone.innerHTML + footer;

  const blob = new Blob(["\ufeff", sourceHTML], {
    type: "application/msword",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${filename}.doc`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

window.downloadNote = function (format) {
  const dropdown = document.getElementById("exportDropdown");

  if (dropdown) dropdown.classList.remove("show");

  const originalElement = document.getElementById("reading-content-area");

  if (!originalElement) return;

  const filename = currentArticleTitle
    .substring(0, 30)
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();

  /* ---------------------------- PDF / PNG ---------------------------- */

  if (format === "pdf" || format === "png") {
    const hiddenContainer = document.createElement("div");

    hiddenContainer.className = "export-mode-active";

    hiddenContainer.style.cssText = [
      "position:fixed",
      "top:0",
      "left:-9999px",
      "width:800px",
      "background-color:#ffffff",
      "color:#000000",
    ].join(";");

    hiddenContainer.appendChild(originalElement.cloneNode(true));

    document.body.appendChild(hiddenContainer);

    const cleanup = () => {
      if (document.body.contains(hiddenContainer)) {
        document.body.removeChild(hiddenContainer);
      }
    };

    if (format === "pdf") {
      const opt = {
        margin: 1,
        filename: `${filename}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, windowWidth: 800 },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };

      setTimeout(() => {
        if (typeof html2pdf !== "function") {
          console.error("html2pdf library is unavailable.");
          cleanup();
          return;
        }

        html2pdf()
          .set(opt)
          .from(hiddenContainer)
          .save()
          .then(cleanup)
          .catch((error) => {
            console.error("PDF export failed:", error);
            cleanup();
          });
      }, 300);

      return;
    }

    hiddenContainer.style.padding = "40px";

    setTimeout(() => {
      if (typeof html2canvas !== "function") {
        console.error("html2canvas library is unavailable.");
        cleanup();
        return;
      }

      html2canvas(hiddenContainer, {
        useCORS: true,
        scale: 2,
        backgroundColor: "#ffffff",
      })
        .then((canvas) => {
          const link = document.createElement("a");

          link.download = `${filename}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();

          cleanup();
        })
        .catch((error) => {
          console.error("PNG export failed:", error);
          cleanup();
        });
    }, 300);

    return;
  }

  /* ------------------------------ WORD ------------------------------ */

  if (format === "word") {
    exportWordDocument(originalElement, filename).catch((error) => {
      console.error("Word export failed:", error);
    });
  }
};

/* ==========================================================================
   LANGUAGE
========================================================================== */

window.switchLanguage = function (lang) {
  if (lang !== "en" && lang !== "id") return;

  document.querySelectorAll(".translatable").forEach((element) => {
    const translatedText = element.getAttribute(`data-${lang}`);

    if (translatedText === null) return;

    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      element.placeholder = translatedText;
    } else {
      element.innerHTML = translatedText;
    }
  });

  document.querySelectorAll(".lang-btn").forEach((button) => {
    button.classList.remove("active");
  });

  const activeButton = document.getElementById(`btn-${lang}`);

  if (activeButton) activeButton.classList.add("active");

  localStorage.setItem("language", lang);

  document.documentElement.lang = lang;
};

/* ==========================================================================
   VIEW ALL
========================================================================== */

window.toggleViewAll = function (topicSlug) {
  const section = document.getElementById(topicSlug);

  if (!section) return;

  const isViewAll = section.classList.toggle("view-all-mode");

  const btnText = section.querySelector(".btn-text");
  const btnIcon = section.querySelector(".see-all-btn i");

  if (isViewAll) {
    if (btnText) {
      btnText.setAttribute("data-en", "Collapse");
      btnText.setAttribute("data-id", "Tutup Layar");
    }

    if (btnIcon) btnIcon.className = "fa-solid fa-compress";
  } else {
    if (btnText) {
      btnText.setAttribute("data-en", "See All");
      btnText.setAttribute("data-id", "Lihat Semua");
    }

    if (btnIcon) btnIcon.className = "fa-solid fa-expand";
  }

  const currentLang = document.documentElement.lang || "en";

  if (btnText) {
    btnText.textContent = btnText.getAttribute(`data-${currentLang}`);
  }
};

/* ==========================================================================
   SCROLL SPY
========================================================================== */

function initScrollSpy() {
  if (scrollSpyObserver) scrollSpyObserver.disconnect();

  const sections = document.querySelectorAll(".topic-section");

  if (sections.length === 0) return;

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const currentId = entry.target.getAttribute("id");

        document.querySelectorAll(".topic-list a").forEach((link) => {
          link.classList.remove("active");
        });

        const activeLink = document.querySelector(
          `.topic-list a[href="#${currentId}"]`,
        );

        if (activeLink) activeLink.classList.add("active");
      });
    },
    { root: null, rootMargin: "-25% 0px -70% 0px", threshold: 0 },
  );

  sections.forEach((section) => scrollSpyObserver.observe(section));
}

/* ==========================================================================
   SHA-256 / AUTH
========================================================================== */

async function sha256Hex(text) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );

  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isOwnerLoggedIn() {
  return localStorage.getItem(AUTH_KEY) === "true";
}

function refreshAuthUI() {
  const loggedIn = isOwnerLoggedIn();

  const loginBtn = document.getElementById("loginTriggerBtn");
  const writeBtn = document.getElementById("writeTriggerBtn");
  const logoutBtn = document.getElementById("logoutTriggerBtn");

  if (loginBtn) loginBtn.style.display = loggedIn ? "none" : "inline-flex";
  if (writeBtn) writeBtn.style.display = loggedIn ? "inline-flex" : "none";
  if (logoutBtn) logoutBtn.style.display = loggedIn ? "inline-flex" : "none";

  document.querySelectorAll(".ed-manage").forEach((element) => {
    element.style.display = loggedIn ? "flex" : "none";
  });
}

window.openLogin = function () {
  const overlay = document.getElementById("login-overlay");
  const error = document.getElementById("loginError");
  const password = document.getElementById("ownerPassword");

  if (overlay) overlay.classList.add("active");
  if (error) error.style.display = "none";
  if (password) password.value = "";

  document.body.style.overflow = "hidden";
};

window.closeLogin = function () {
  const overlay = document.getElementById("login-overlay");

  if (overlay) overlay.classList.remove("active");

  document.body.style.overflow = "auto";
};

window.handleLogin = async function (event) {
  event.preventDefault();

  const password = document.getElementById("ownerPassword");

  if (!password) return false;

  const hash = await sha256Hex(password.value);

  if (hash === OWNER_PASSWORD_HASH) {
    localStorage.setItem(AUTH_KEY, "true");
    closeLogin();
    refreshAuthUI();
  } else {
    const error = document.getElementById("loginError");

    if (error) error.style.display = "block";
  }

  return false;
};

window.logoutOwner = function () {
  localStorage.removeItem(AUTH_KEY);
  refreshAuthUI();
};

/* ==========================================================================
   SUPABASE FETCH
========================================================================== */

async function fetchArticlesFromSupabase() {
  const { data, error } = await supabaseClient
    .from("articles")
    .select("*")
    .order("date_iso", { ascending: false });

  if (error) {
    console.error("Failed to load articles:", error);
    return [];
  }

  globalArticlesCache = (data || []).map((article) => ({
    id: article.id,
    topicId: article.topic_id,
    topicLabel: article.topic_label,
    topicIcon: article.topic_icon,
    title: article.title,
    excerpt: article.excerpt,
    dateISO: article.date_iso,
    dateDisplay: article.date_display,
    readTime: article.read_time,
    bodyHTML: article.body_html,
    cardBgUrl: article.card_bg_url || null,
    cardBgPath: article.card_bg_path || null,
  }));

  return globalArticlesCache;
}

/* ==========================================================================
   TOPIC SECTION / ARTICLE CARD
========================================================================== */

function ensureTopicSection(topicSlug, topicLabel, iconClass) {
  let section = document.getElementById(topicSlug);

  if (section) return section;

  section = document.createElement("section");

  section.id = topicSlug;
  section.className = "topic-section";

  const currentLang = document.documentElement.lang || "en";
  const btnText = currentLang === "id" ? "Lihat Semua" : "See All";

  section.innerHTML = `
    <div class="topic-header-wrapper">
      <h2 class="topic-heading">${escapeHtml(topicLabel)}</h2>
      <button
        class="see-all-btn"
        onclick="toggleViewAll('${escapeHtml(topicSlug)}')"
        type="button"
      >
        <i class="fa-solid fa-expand"></i>
        <span class="btn-text translatable" data-en="See All" data-id="Lihat Semua">${btnText}</span>
      </button>
    </div>
    <div class="carousel-container">
      <button class="carousel-btn prev-btn" type="button" aria-label="Previous">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <div class="carousel-viewport">
        <div class="carousel-track"></div>
      </div>
      <button class="carousel-btn next-btn" type="button" aria-label="Next">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  `;

  const mainContent = document.getElementById("main-content");

  if (mainContent) mainContent.appendChild(section);

  const topicList = document.getElementById("topic-list");

  if (topicList) {
    const li = document.createElement("li");

    li.innerHTML = `
      <a href="#${escapeHtml(topicSlug)}">
        <i class="fa-solid ${iconClass || "fa-tag"}"></i>
        ${escapeHtml(topicLabel)}
      </a>
    `;

    topicList.appendChild(li);
  }

  return section;
}

function buildArticleElement(data) {
  const article = document.createElement("article");

  article.className = "ed-card";
  article.id = data.id;

  if (data.cardBgUrl) {
    article.classList.add("has-card-bg");

    article.style.setProperty(
      "--card-bg-image",
      `url(${JSON.stringify(data.cardBgUrl)})`,
    );
  }

  const articleRoute = getArticleRoute(data.id);

  article.innerHTML = `
    <div class="ed-card-image" aria-hidden="true"></div>

    <div class="export-content" id="content-${escapeHtml(data.id)}">
      <div class="ed-meta">
        ${escapeHtml(data.dateDisplay || "")}
        •
        <span class="read-time">${escapeHtml(data.readTime || "")}</span>
      </div>

      <h3 class="ed-title">${escapeHtml(data.title || "")}</h3>

      <div class="ed-excerpt">
        <p>${escapeHtml(data.excerpt || "")}</p>
      </div>

      <div class="ed-full-text">${data.bodyHTML || ""}</div>
    </div>

    <div class="ed-actions">
      <a
        class="ed-btn"
        href="${articleRoute}"
        data-note-route="true"
        data-article-id="${escapeHtml(data.id)}"
      >Open Note</a>

      <div
        class="ed-manage"
        style="display: ${isOwnerLoggedIn() ? "flex" : "none"}"
      >
        <button
          class="ed-manage-btn"
          type="button"
          onclick="editArticle('${escapeHtml(data.id)}')"
          title="Edit"
          aria-label="Edit"
        ><i class="fa-solid fa-pen"></i></button>

        <button
          class="ed-manage-btn"
          type="button"
          onclick="deleteArticle('${escapeHtml(data.id)}')"
          title="Delete"
          aria-label="Delete"
        ><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `;

  return article;
}

async function loadSavedArticlesIntoDom() {
  const topicList = document.getElementById("topic-list");

  if (topicList) topicList.innerHTML = "";

  document.querySelectorAll(".topic-section").forEach((section) => {
    section.remove();
  });

  const articles = await fetchArticlesFromSupabase();

  articles.forEach((data) => {
    let icon = data.topicIcon;

    if (TOPIC_CONFIG[data.topicId]) {
      icon = TOPIC_CONFIG[data.topicId].icon;
    }

    const section = ensureTopicSection(
      data.topicId,
      data.topicLabel,
      icon || "fa-tag",
    );

    const track = section.querySelector(".carousel-track");

    if (track) track.appendChild(buildArticleElement(data));
  });

  const firstLink = document.querySelector(".topic-list a");

  if (firstLink) firstLink.classList.add("active");
}

/* ==========================================================================
   CARD BACKGROUND IMAGE HELPERS
========================================================================== */

function setCardBackgroundPreview(url) {
  const preview = document.getElementById("cardBackgroundPreview");
  const removeButton = document.getElementById("cardBgRemoveBtn");

  if (!preview) return;

  if (!url) {
    preview.style.display = "none";
    preview.style.backgroundImage = "";

    if (removeButton) removeButton.style.display = "none";

    return;
  }

  preview.style.display = "block";
  preview.style.backgroundImage = `url(${JSON.stringify(url)})`;

  if (removeButton) removeButton.style.display = "inline-flex";
}

window.handleCardBackgroundChosen = function (event) {
  const file = event.target.files?.[0];

  if (!file) return;

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedTypes.includes(file.type)) {
    alert("Please use JPG, PNG, or WebP images only.");
    event.target.value = "";
    return;
  }

  const maxSize = 5 * 1024 * 1024;

  if (file.size > maxSize) {
    alert("The card background image must be smaller than 5 MB.");
    event.target.value = "";
    return;
  }

  pendingCardBackgroundFile = file;
  removeCardBackground = false;

  const reader = new FileReader();

  reader.onload = (loadEvent) => {
    setCardBackgroundPreview(loadEvent.target.result);
  };

  reader.onerror = () => {
    console.error("Failed to preview card background.");
    pendingCardBackgroundFile = null;
  };

  reader.readAsDataURL(file);
};

window.clearCardBackground = function () {
  pendingCardBackgroundFile = null;
  currentCardBackgroundUrl = null;
  currentCardBackgroundPath = null;
  removeCardBackground = true;

  const input = document.getElementById("fieldCardBackground");

  if (input) input.value = "";

  setCardBackgroundPreview(null);
};

function resetCardBackgroundState() {
  pendingCardBackgroundFile = null;
  currentCardBackgroundUrl = null;
  currentCardBackgroundPath = null;
  removeCardBackground = false;

  const input = document.getElementById("fieldCardBackground");

  if (input) input.value = "";

  setCardBackgroundPreview(null);
}

async function deleteCardBackground(path) {
  if (!path) return;

  const { error } = await supabaseClient.storage
    .from(CARD_BG_BUCKET)
    .remove([path]);

  if (error) {
    console.warn("Could not remove old card background:", error);
  }
}

async function uploadCardBackground(file, articleId, title) {
  if (!file) return null;

  const extension =
    file.name
      .split(".")
      .pop()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";

  const safeTitle = slugify(title) || "note";

  const safeArticleId = String(articleId || "article").replace(
    /[^a-zA-Z0-9_-]/g,
    "",
  );

  const filePath = `card-bg/${safeArticleId}-${safeTitle}-${Date.now()}.${extension}`;

  const { data, error } = await supabaseClient.storage
    .from(CARD_BG_BUCKET)
    .upload(filePath, file, {
      cacheControl: "31536000",
      upsert: false,
      contentType: file.type,
    });

  if (error) {
    console.error("Card background upload failed:", error);
    throw error;
  }

  const { data: publicData } = supabaseClient.storage
    .from(CARD_BG_BUCKET)
    .getPublicUrl(filePath);

  if (!publicData?.publicUrl) {
    try {
      await deleteCardBackground(data?.path || filePath);
    } catch (cleanupError) {
      console.warn("Could not clean up failed upload:", cleanupError);
    }

    throw new Error("Unable to generate card background URL.");
  }

  return { path: data?.path || filePath, publicUrl: publicData.publicUrl };
}

/* ==========================================================================
   EDITOR FOCUS MODE
========================================================================== */

function updateEditorFocusTitle(title) {
  const element = document.getElementById("editorFocusTitle");

  if (!element) return;

  element.textContent = String(title || "").trim() || "Untitled Note";
}

window.setEditorFocusMode = function (enabled = true) {
  const overlay = document.getElementById("editor-overlay");

  if (!overlay) return;

  editorFocusMode = Boolean(enabled);

  overlay.classList.toggle("focus-mode", editorFocusMode);

  const detailsBtn = document.getElementById("editorDetailsBtn");
  const detailsLabel = document.getElementById("editorDetailsLabel");
  const detailsIcon = detailsBtn?.querySelector("i");

  if (detailsBtn) {
    detailsBtn.setAttribute("aria-pressed", String(!editorFocusMode));

    detailsBtn.setAttribute(
      "title",
      editorFocusMode ? "Show note details" : "Hide note details",
    );

    detailsBtn.setAttribute(
      "aria-label",
      editorFocusMode ? "Show note details" : "Hide note details",
    );
  }

  if (detailsLabel) {
    detailsLabel.textContent = editorFocusMode ? "Details" : "Hide Details";
  }

  if (detailsIcon) {
    detailsIcon.className = editorFocusMode
      ? "fa-solid fa-sliders"
      : "fa-solid fa-xmark";
  }
};

window.toggleEditorMetadata = function () {
  const overlay = document.getElementById("editor-overlay");

  if (!overlay) return;

  const currentlyFocused = overlay.classList.contains("focus-mode");

  setEditorFocusMode(!currentlyFocused);

  requestAnimationFrame(() => {
    const body = getEditor();

    /* Metadata baru dibuka -> jangan curi fokus. */
    if (body && currentlyFocused === false) {
      restoreSelection() || body.focus();
    }
  });
};

function updateEditorFullscreenButton() {
  const overlay = document.getElementById("editor-overlay");
  const button = document.getElementById("editorFullscreenBtn");
  const label = document.getElementById("editorFullscreenLabel");
  const icon = document.getElementById("editorFullscreenIcon");

  if (!overlay || !button) return;

  const isNativeFullscreen = document.fullscreenElement === overlay;

  const isFallbackFullscreen = overlay.classList.contains(
    "editor-browser-fullscreen-fallback",
  );

  const fullscreen = isNativeFullscreen || isFallbackFullscreen;

  button.setAttribute("aria-pressed", String(fullscreen));
  button.setAttribute("title", fullscreen ? "Exit full screen" : "Full screen");

  button.setAttribute(
    "aria-label",
    fullscreen ? "Exit full screen" : "Full screen",
  );

  if (label) {
    label.textContent = fullscreen ? "Exit Full Screen" : "Full Screen";
  }

  if (icon) {
    icon.className = fullscreen ? "fa-solid fa-compress" : "fa-solid fa-expand";
  }
}

window.toggleEditorFullscreen = async function () {
  const overlay = document.getElementById("editor-overlay");

  if (!overlay) return;

  setEditorFocusMode(true);

  try {
    const isNativeFullscreen = document.fullscreenElement === overlay;

    if (!document.fullscreenElement && !isNativeFullscreen) {
      if (typeof overlay.requestFullscreen === "function") {
        await overlay.requestFullscreen();
      } else {
        overlay.classList.add("editor-browser-fullscreen-fallback");
      }
    } else {
      if (typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
      }

      overlay.classList.remove("editor-browser-fullscreen-fallback");
    }
  } catch (error) {
    console.warn("Could not toggle native fullscreen:", error);
    overlay.classList.toggle("editor-browser-fullscreen-fallback");
  }

  updateEditorFullscreenButton();

  /* Kembalikan fokus TANPA mereset posisi kursor ke awal. */
  requestAnimationFrame(() => {
    const body = getEditor();

    if (body) {
      restoreSelection() || body.focus();
    }
  });
};

document.addEventListener("fullscreenchange", () => {
  const overlay = document.getElementById("editor-overlay");

  if (!overlay) return;

  if (document.fullscreenElement !== overlay) {
    overlay.classList.remove("editor-browser-fullscreen-fallback");
  }

  updateEditorFullscreenButton();
});

/* ==========================================================================
   OPEN / CLOSE EDITOR
========================================================================== */

window.openEditor = function () {
  if (!isOwnerLoggedIn()) {
    openLogin();
    return;
  }

  editingArticleId = null;

  resetCardBackgroundState();
  resetAnnotationState();

  const heading = document.getElementById("editorHeading");
  if (heading) heading.textContent = "Write a New Note";

  const publishLabel = document.getElementById("publishBtnLabel");
  if (publishLabel) publishLabel.textContent = "Publish";

  const titleField = document.getElementById("fieldTitle");
  if (titleField) titleField.value = "";

  const excerptField = document.getElementById("fieldExcerpt");
  if (excerptField) excerptField.value = "";

  const topicSelect = document.getElementById("fieldTopicSelect");
  if (topicSelect) topicSelect.value = "sustainability";

  const newTopicGroup = document.getElementById("newTopicGroup");
  if (newTopicGroup) newTopicGroup.style.display = "none";

  const newTopicName = document.getElementById("fieldNewTopicName");
  if (newTopicName) newTopicName.value = "";

  const newTopicIcon = document.getElementById("fieldNewTopicIcon");
  if (newTopicIcon) newTopicIcon.value = "fa-lightbulb";

  const dateField = document.getElementById("fieldDate");
  if (dateField) dateField.value = new Date().toISOString().slice(0, 10);

  const body = getEditor();
  if (body) body.innerHTML = "";

  const status = document.getElementById("editorStatus");
  if (status) status.textContent = "";

  clearSavedSelection();
  updateWordCount();
  updateEditorFocusTitle("");

  setEditorFocusMode(true);
  updateEditorFullscreenButton();

  const overlay = document.getElementById("editor-overlay");
  if (overlay) overlay.classList.add("active");

  document.body.style.overflow = "hidden";

  requestAnimationFrame(() => {
    if (body) body.focus();
  });
};

window.closeEditor = async function () {
  const overlay = document.getElementById("editor-overlay");

  if (
    overlay &&
    document.fullscreenElement === overlay &&
    typeof document.exitFullscreen === "function"
  ) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn("Could not exit fullscreen:", error);
    }
  }

  if (overlay) {
    overlay.classList.remove(
      "active",
      "focus-mode",
      "editor-browser-fullscreen-fallback",
    );
  }

  document.body.style.overflow = "auto";

  cancelPendingImage();
  clearSavedSelection();
  resetAnnotationState();
  resetCardBackgroundState();

  editorFocusMode = true;

  updateEditorFocusTitle("");
  updateEditorFullscreenButton();
};

window.handleTopicSelectChange = function () {
  const select = document.getElementById("fieldTopicSelect");
  const group = document.getElementById("newTopicGroup");

  if (!select || !group) return;

  group.style.display = select.value === "__new__" ? "block" : "none";
};

/* ==========================================================================
   SELECTION MANAGEMENT
   --------------------------------------------------------------------------
   AKAR MASALAH "bullet selalu jatuh di baris pertama":
   execToolbar() memanggil editor.focus() tanpa memulihkan kursor; saat
   editor kehilangan fokus (klik toolbar / full screen), focus() menaruh
   kursor di awal teks. Sekarang posisi kursor (termasuk kursor kosong,
   bukan hanya seleksi) selalu dilacak dan dipulihkan sebelum perintah.
========================================================================== */

function getRangeElement(range) {
  const node = range.commonAncestorContainer;

  return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
}

document.addEventListener("selectionchange", () => {
  const editor = getEditor();

  if (!editor) return;

  const sel = window.getSelection();

  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) {
    if (wordCountShowsSelection) updateWordCount();
    return;
  }

  /* Abaikan kursor di dalam gambar beranotasi (contenteditable=false). */
  const element = getRangeElement(range);

  if (element?.closest?.(".note-image-annotation")) return;

  lastSelectionRange = range.cloneRange();
  savedSelectionRange = range.cloneRange();

  updateWordCount();
  syncListControls();
});

window.saveSelection = function () {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const editor = getEditor();

  if (!editor || !editor.contains(range.commonAncestorContainer)) return;

  lastSelectionRange = range.cloneRange();
  savedSelectionRange = range.cloneRange();
};

function restoreSelection() {
  const editor = getEditor();

  if (!editor) return false;

  const range = lastSelectionRange || savedSelectionRange;

  if (!range) return false;

  try {
    editor.focus();

    const selection = window.getSelection();

    selection.removeAllRanges();
    selection.addRange(range.cloneRange());

    return true;
  } catch (error) {
    console.warn("Could not restore selection:", error);
    return false;
  }
}

function clearSavedSelection() {
  savedSelectionRange = null;
  lastSelectionRange = null;
}

/*
   Klik tombol toolbar tidak boleh memindahkan fokus/kursor dari editor.
   <select>, <input>, <label> dikecualikan supaya tetap bisa dipakai;
   kursor mereka dipulihkan lewat restoreSelection().
*/
function initToolbarFocusGuard() {
  document.addEventListener("mousedown", (event) => {
    const target = event.target;

    if (!target || !target.closest) return;

    if (
      !target.closest(
        ".editor-toolbar, .annotation-toolbar, #imageStylePicker, .nx-list-tools",
      )
    ) {
      return;
    }

    if (target.closest("select, input, textarea, option, label")) return;

    event.preventDefault();
  });
}

/* ==========================================================================
   TOOLBAR BASIC COMMANDS
========================================================================== */

window.execToolbar = function (command) {
  const body = getEditor();

  if (!body) return;

  if (!restoreSelection()) {
    body.focus();
  }

  document.execCommand(command, false, null);

  updateWordCount();
};

window.triggerLinkInsert = function () {
  const url = prompt("Enter URL:", "https://");

  if (!url) return;

  const body = getEditor();

  if (!body) return;

  if (!restoreSelection()) {
    body.focus();
  }

  document.execCommand("createLink", false, url);

  updateWordCount();
};

/* ==========================================================================
   WORD COUNT (total + khusus teks yang diseleksi)
========================================================================== */

function getSelectedTextInEditor() {
  const editor = getEditor();
  const sel = window.getSelection();

  if (!editor || !sel || sel.rangeCount === 0 || sel.isCollapsed) return "";

  const range = sel.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) return "";

  return sel.toString();
}

function updateWordCount() {
  const element = document.getElementById("tbWordCount");

  if (!element) return;

  const body = getEditor();
  const total = countWords(body ? body.textContent : "");
  const minutes = Math.max(1, Math.round(total / 200));
  const selected = countWords(getSelectedTextInEditor());

  wordCountShowsSelection = selected > 0;

  element.textContent =
    selected > 0
      ? `${selected} of ${total} words selected • ~${minutes} min read`
      : `${total} words • ~${minutes} min read`;
}

/* ==========================================================================
   HIGHLIGHT
========================================================================== */

function getTextNodesInRange(range, root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;

      if (!parent) return NodeFilter.FILTER_REJECT;

      if (parent.closest("script, style, template")) {
        return NodeFilter.FILTER_REJECT;
      }

      try {
        if (range.intersectsNode(node)) return NodeFilter.FILTER_ACCEPT;
      } catch (error) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_REJECT;
    },
  });

  const nodes = [];
  let node;

  while ((node = walker.nextNode())) {
    nodes.push(node);
  }

  return nodes;
}

function getHighlightAncestor(node, editor) {
  let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

  while (current && current !== editor) {
    if (current.classList && current.classList.contains("journal-highlight")) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function getEntireHighlightForSelection(range, editor) {
  const startAncestor = getHighlightAncestor(range.startContainer, editor);
  const endAncestor = getHighlightAncestor(range.endContainer, editor);

  if (startAncestor && startAncestor === endAncestor) return startAncestor;

  const commonElement = getRangeElement(range);
  const closest = commonElement?.closest?.(".journal-highlight");

  if (closest && editor.contains(closest)) return closest;

  return null;
}

function unwrapHighlight(highlight) {
  if (!highlight) return;

  const parent = highlight.parentNode;

  if (!parent) return;

  while (highlight.firstChild) {
    parent.insertBefore(highlight.firstChild, highlight);
  }

  parent.removeChild(highlight);
  parent.normalize();
}

window.applyCustomHighlight = function () {
  const editor = getEditor();

  if (!editor) return;
  if (!restoreSelection()) return;

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) return;
  if (!range.toString().trim()) return;

  const existingHighlight = getEntireHighlightForSelection(range, editor);

  if (existingHighlight) {
    const newRange = document.createRange();

    newRange.selectNodeContents(existingHighlight);

    unwrapHighlight(existingHighlight);

    selection.removeAllRanges();
    selection.addRange(newRange);

    lastSelectionRange = newRange.cloneRange();
    savedSelectionRange = newRange.cloneRange();

    updateWordCount();

    return;
  }

  const textNodes = getTextNodesInRange(range, editor);

  if (textNodes.length === 0) return;

  const createdHighlights = [];

  for (let i = textNodes.length - 1; i >= 0; i--) {
    const textNode = textNodes[i];

    let startOffset = 0;
    let endOffset = textNode.nodeValue.length;

    if (textNode === range.startContainer) startOffset = range.startOffset;
    if (textNode === range.endContainer) endOffset = range.endOffset;

    if (endOffset <= startOffset) continue;

    const highlight = document.createElement("span");

    highlight.className = "journal-highlight";

    highlight.style.background =
      "linear-gradient(120deg, rgba(218, 223, 124, 0.28), rgba(187, 211, 49, 0.46))";
    highlight.style.color = "inherit";
    highlight.style.padding = "0.04em 0.14em";
    highlight.style.borderRadius = "2px";
    highlight.style.boxDecorationBreak = "clone";
    highlight.style.webkitBoxDecorationBreak = "clone";

    const nodeRange = document.createRange();

    nodeRange.setStart(textNode, startOffset);
    nodeRange.setEnd(textNode, endOffset);

    try {
      nodeRange.surroundContents(highlight);
      createdHighlights.push(highlight);
    } catch (error) {
      try {
        const fragment = nodeRange.extractContents();
        highlight.appendChild(fragment);
        nodeRange.insertNode(highlight);
        createdHighlights.push(highlight);
      } catch (fallbackError) {
        console.error("Highlight operation failed:", fallbackError);
      }
    }
  }

  if (createdHighlights.length === 0) return;

  const cursorRange = document.createRange();

  cursorRange.setStartAfter(createdHighlights[0]);
  cursorRange.collapse(true);

  selection.removeAllRanges();
  selection.addRange(cursorRange);

  lastSelectionRange = cursorRange.cloneRange();
  savedSelectionRange = cursorRange.cloneRange();

  updateWordCount();
};

/* ==========================================================================
   IMAGE INSERT
   (Gambar disisipkan polos; pembungkus anotasi dibuat saat gambar diklik /
   tombol spidol ditekan, sehingga layout asli selalu terekam dengan benar.)
========================================================================== */

window.triggerImageInsert = function () {
  const body = getEditor();

  if (!body) return;

  if (!restoreSelection()) {
    body.focus();
  }

  const selection = window.getSelection();

  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);

    savedImageSelectionRange = body.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null;
  } else {
    savedImageSelectionRange = null;
  }

  const input = document.getElementById("imageFileInput");

  if (input) input.click();
};

window.handleImageFileChosen = function (event) {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Please select a valid image file.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = (loadEvent) => {
    pendingImageDataUrl = loadEvent.target.result;

    const picker = document.getElementById("imageStylePicker");

    if (picker) picker.style.display = "flex";
  };

  reader.onerror = () => {
    console.error("Failed to read image file.");
    pendingImageDataUrl = null;
  };

  reader.readAsDataURL(file);

  event.target.value = "";
};

window.insertPendingImage = function (styleClass) {
  if (!pendingImageDataUrl) return;

  const body = getEditor();

  if (!body) return;

  body.focus();

  const selection = window.getSelection();

  let placed = false;

  if (savedImageSelectionRange) {
    try {
      selection.removeAllRanges();
      selection.addRange(savedImageSelectionRange.cloneRange());
      placed = true;
    } catch (error) {
      console.warn("Could not restore image insertion selection:", error);
    }
  }

  if (!placed && !restoreSelection()) {
    const endRange = document.createRange();

    endRange.selectNodeContents(body);
    endRange.collapse(false);

    selection.removeAllRanges();
    selection.addRange(endRange);
  }

  const imgHtml = `<img class="note-img ${escapeHtml(styleClass)}" src="${pendingImageDataUrl}" alt="" draggable="false" />`;

  document.execCommand("insertHTML", false, imgHtml);

  cancelPendingImage();
  updateWordCount();
};

window.cancelPendingImage = function () {
  pendingImageDataUrl = null;
  savedImageSelectionRange = null;

  const picker = document.getElementById("imageStylePicker");

  if (picker) picker.style.display = "none";
};

/* ==========================================================================
   IMAGE ANNOTATION (digabung dari add-on)
   --------------------------------------------------------------------------
   Perbaikan utama:
   1. Layer SVG kini mendapat pointer-events/touch-action INLINE saat mode
      menggambar (tidak lagi bergantung pada CSS luar) -> coretan jalan.
   2. Koordinat memakai viewBox proporsional terhadap gambar (mis. 1000 x H)
      dengan ketebalan garis dalam satuan viewBox; tidak lagi 1px tipis
      (bug lama: stroke-width dihitung % lalu dikali non-scaling-stroke).
      Coretan lama (viewBox 0 0 100 100) tetap didukung.
   3. Style dasar layer SVG ditanam inline & di-hydrate di mode baca ->
      coretan tampil saat membaca / ekspor.
   4. Toolbar anotasi melayang di dalam #editor-overlay (aman di Focus Mode
      & native Full Screen).
   5. Event pointer memakai delegation di #editorBody (tidak hilang saat
      isi editor dimuat ulang).
========================================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";
const ANN_HISTORY_LIMIT = 40;
const LAYOUT_CLASSES = ["float-left", "float-right", "center-small", "full"];

const ANN = {
  tool: "pen",
  color: "#b23a39",
  width: 4,
  drawing: false,
  pointerId: null,
  points: [],
  preview: null,
  wrapper: null,
  svg: null,
  history: [],
  suggestion: null,
  eraseSnapshotTaken: false,
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const average = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

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

/* ---------------------------- layout capture ---------------------------- */

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
    clear: computed.clear,
    marginTop: computed.marginTop,
    marginRight: computed.marginRight,
    marginBottom: computed.marginBottom,
    marginLeft: computed.marginLeft,
    parentTextAlign: parentComputed?.textAlign || "left",
  };
}

function applyAnnotationLayout(wrapper, image) {
  if (!wrapper || !image) return;

  let saved = null;

  if (wrapper.dataset.annotationLayout) {
    try {
      saved = JSON.parse(wrapper.dataset.annotationLayout);
    } catch (_) {
      saved = null;
    }
  }

  if (!saved) {
    saved = captureImageLayout(image);

    if (saved) {
      wrapper.dataset.annotationLayout = JSON.stringify(saved);
    }
  }

  if (!saved) return;

  const layout = saved.layout || "normal";
  const s = wrapper.style;

  wrapper.dataset.layout = layout;

  LAYOUT_CLASSES.forEach((name) => wrapper.classList.remove(name));

  if (LAYOUT_CLASSES.includes(layout)) wrapper.classList.add(layout);

  s.boxSizing = "border-box";
  s.clear = saved.clear || "none";
  s.maxWidth = "100%";
  s.marginTop = saved.marginTop || "0";
  s.marginBottom = saved.marginBottom || "0";

  const setFixedWidth = () => {
    if (saved.widthPx > 0) s.width = `${saved.widthPx}px`;
  };

  if (layout === "normal") {
    s.float = "none";
    setFixedWidth();

    if (saved.parentTextAlign === "center") {
      s.display = "block";
      s.marginLeft = "auto";
      s.marginRight = "auto";
    } else if (saved.parentTextAlign === "right") {
      s.display = "block";
      s.marginLeft = "auto";
      s.marginRight = "0";
    } else {
      s.display = "inline-block";
      s.marginLeft = saved.marginLeft || "0";
      s.marginRight = saved.marginRight || "0";
    }
  } else if (layout === "float-left" || layout === "float-right") {
    s.display = "block";
    s.float = layout === "float-left" ? "left" : "right";
    setFixedWidth();
    s.marginLeft = saved.marginLeft || "0";
    s.marginRight = saved.marginRight || "0";
  } else if (layout === "center-small") {
    s.display = "block";
    s.float = "none";
    setFixedWidth();
    s.marginLeft = "auto";
    s.marginRight = "auto";
  } else if (layout === "full") {
    s.display = "block";
    s.float = "none";
    s.width = "100%";
    s.marginLeft = saved.marginLeft || "0";
    s.marginRight = saved.marginRight || "0";
  }

  const inner = wrapper.querySelector(":scope > .note-image-annotation-inner");

  if (inner) {
    inner.style.position = "relative";
    inner.style.width = "100%";
    inner.style.maxWidth = "100%";
    inner.style.height = "auto";
    inner.style.display = "block";
    inner.style.boxSizing = "border-box";
    inner.style.lineHeight = "0";
  }

  image.classList.add("annotation-contained-image");

  const is = image.style;

  is.float = "none";
  is.clear = "none";
  is.marginTop = "0";
  is.marginRight = "0";
  is.marginBottom = "0";
  is.marginLeft = "0";
  is.display = "block";
  is.width = "100%";
  is.maxWidth = "100%";
  is.height = "auto";
  is.verticalAlign = "top";
}

/* ------------------------------ SVG layer ------------------------------ */

/* Style dasar layer — ditanam inline agar tidak bergantung pada CSS luar. */
function applySvgBaseStyles(svg) {
  if (!svg) return;

  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";
  svg.style.zIndex = "2";
  svg.style.pointerEvents = "none";
  svg.style.removeProperty("cursor");
  svg.style.removeProperty("touch-action");

  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");

  if (!svg.getAttribute("viewBox")) {
    svg.setAttribute("viewBox", "0 0 1000 1000");
  }
}

function ensureAnnotationLayer(wrapper) {
  if (!wrapper) return null;

  wrapper.setAttribute("contenteditable", "false");

  let inner = wrapper.querySelector(":scope > .note-image-annotation-inner");

  const image =
    wrapper.querySelector("img.note-img") || wrapper.querySelector("img");

  if (!inner) {
    inner = document.createElement("div");
    inner.className = "note-image-annotation-inner";

    while (wrapper.firstChild) {
      inner.appendChild(wrapper.firstChild);
    }

    wrapper.appendChild(inner);
  }

  let svg = wrapper.querySelector(".note-annotation-layer");

  if (!svg) {
    svg = createSvgElement("svg", {
      class: "note-annotation-layer",
      viewBox: "0 0 1000 1000",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    });

    inner.appendChild(svg);
  }

  if (image) applyAnnotationLayout(wrapper, image);

  applySvgBaseStyles(svg);

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

  /* CRITICAL: rekam layout SEBELUM gambar dibungkus. */
  const originalLayout = captureImageLayout(image);

  const wrapper = document.createElement("div");
  const inner = document.createElement("div");

  const svg = createSvgElement("svg", {
    class: "note-annotation-layer",
    viewBox: "0 0 1000 1000",
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

  if (originalLayout) {
    wrapper.dataset.annotationLayout = JSON.stringify(originalLayout);
  }

  inner.className = "note-image-annotation-inner";

  parent.insertBefore(wrapper, image);

  inner.appendChild(image);
  inner.appendChild(svg);
  wrapper.appendChild(inner);

  applyAnnotationLayout(wrapper, image);
  applySvgBaseStyles(svg);

  return wrapper;
}

/* Isi editor dimuat ulang (edit note) -> siapkan semua wrapper. */
function hydrateAnnotationsInEditor() {
  const editor = getEditor();

  if (!editor) return;

  editor.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
    ensureAnnotationLayer(wrapper);
  });
}

/* Mode baca / ekspor: pastikan layer SVG tampil tanpa CSS eksternal. */
function hydrateAnnotationsForReading(container) {
  if (!container) return;

  container.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
    wrapper.classList.remove("is-selected", "is-drawing");
    wrapper.removeAttribute("contenteditable");

    const inner = wrapper.querySelector(".note-image-annotation-inner");

    if (inner) {
      inner.style.position = "relative";
      inner.style.display = "block";
      inner.style.lineHeight = "0";
    }

    const svg = wrapper.querySelector(".note-annotation-layer");

    applySvgBaseStyles(svg);
  });
}

/* HTML bersih untuk disimpan (tanpa state editor). */
function getCleanEditorHtml() {
  const editor = getEditor();

  if (!editor) return "";

  const clone = editor.cloneNode(true);

  clone.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
    wrapper.classList.remove("is-selected", "is-drawing");
    wrapper.removeAttribute("data-selected");
    wrapper.removeAttribute("data-drawing");

    wrapper
      .querySelectorAll('[data-preview="true"]')
      .forEach((element) => element.remove());

    wrapper.querySelectorAll(".note-annotation-layer").forEach((svg) => {
      applySvgBaseStyles(svg);
    });
  });

  clone
    .querySelectorAll('[data-preview="true"]')
    .forEach((element) => element.remove());

  return clone.innerHTML;
}

window.getCleanAnnotationEditorHtml = getCleanEditorHtml;
window.prepareAnnotationHtmlForSave = getCleanEditorHtml;

/* ------------------------------ metrics ------------------------------ */

function getSvgMetrics(svg) {
  const rect = svg.getBoundingClientRect();

  const vb = (svg.getAttribute("viewBox") || "0 0 100 100")
    .trim()
    .split(/[\s,]+/)
    .map(Number);

  const vbW = vb[2] || 100;
  const vbH = vb[3] || 100;

  return {
    rect,
    vbW,
    vbH,
    /* viewBox lama dari add-on versi sebelumnya */
    legacy: vbW === 100 && vbH === 100,
    sx: vbW / (rect.width || 1),
    sy: vbH / (rect.height || 1),
  };
}

/* Layer kosong -> viewBox disesuaikan dengan rasio gambar saat ini. */
function prepareSvgForDrawing(svg) {
  if (!svg || svg.querySelector("[data-annotation-kind]")) return;

  const image = svg.parentElement?.querySelector("img");

  if (!image) return;

  const rect = image.getBoundingClientRect();

  if (rect.width > 0 && rect.height > 0) {
    svg.setAttribute(
      "viewBox",
      `0 0 1000 ${formatNumber((1000 * rect.height) / rect.width)}`,
    );
  }
}

function pxDistance(a, b, m) {
  return Math.hypot((a.x - b.x) / m.sx, (a.y - b.y) / m.sy);
}

function pxPathLength(points, m) {
  let total = 0;

  for (let i = 1; i < points.length; i += 1) {
    total += pxDistance(points[i - 1], points[i], m);
  }

  return total;
}

function pointFromEvent(event, svg) {
  const m = getSvgMetrics(svg);

  if (!m.rect.width || !m.rect.height) return { x: 0, y: 0 };

  return {
    x: clamp(((event.clientX - m.rect.left) / m.rect.width) * m.vbW, 0, m.vbW),
    y: clamp(((event.clientY - m.rect.top) / m.rect.height) * m.vbH, 0, m.vbH),
  };
}

function applyStroke(element, m) {
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", ANN.color);
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");

  if (m.legacy) {
    element.setAttribute("stroke-width", ANN.width);
    element.setAttribute("vector-effect", "non-scaling-stroke");
  } else {
    element.setAttribute("stroke-width", formatNumber(ANN.width * m.sx));
  }
}

function pointsToPath(points) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${formatNumber(point.x)} ${formatNumber(point.y)}`,
    )
    .join(" ");
}

/* Ramer–Douglas–Peucker */
function simplifyPoints(points, tolerance) {
  if (points.length <= 8) return points;

  const sqTolerance = tolerance * tolerance;

  const sqSegDist = (point, start, end) => {
    let x = start.x;
    let y = start.y;
    let dx = end.x - x;
    let dy = end.y - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);

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
      const d = sqSegDist(points[i], points[startIndex], points[endIndex]);

      if (d > maxDistance) {
        maxDistance = d;
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

/* ------------------------------ shapes ------------------------------ */

function createGroup(kind) {
  const group = createSvgElement("g", {
    class: "annotation-group",
    "data-annotation-kind": kind,
  });

  group.setAttribute("opacity", "0.92");

  return group;
}

function makeLine(a, b, m) {
  const line = createSvgElement("line", {
    x1: formatNumber(a.x),
    y1: formatNumber(a.y),
    x2: formatNumber(b.x),
    y2: formatNumber(b.y),
  });

  applyStroke(line, m);

  return line;
}

function buildArrow(group, start, end, m) {
  group.appendChild(makeLine(start, end, m));

  /* Kepala panah dihitung dalam piksel agar proporsional di gambar lebar. */
  const s = { x: start.x / m.sx, y: start.y / m.sy };
  const e = { x: end.x / m.sx, y: end.y / m.sy };

  const angle = Math.atan2(e.y - s.y, e.x - s.x);
  const length = Math.max(12, ANN.width * 3.2);
  const spread = Math.PI / 7;

  [angle - spread, angle + spread].forEach((theta) => {
    const tip = {
      x: (e.x - length * Math.cos(theta)) * m.sx,
      y: (e.y - length * Math.sin(theta)) * m.sy,
    };

    group.appendChild(makeLine(end, tip, m));
  });
}

function buildShape(tool, points, m) {
  if (!points?.length) return null;

  const simplified =
    tool === "pen" ? simplifyPoints(points, 1.2 * m.sx) : points;

  const start = simplified[0];
  const end = simplified[simplified.length - 1] || start;

  const group = createGroup(tool);

  if (tool === "pen") {
    const path = createSvgElement("path", { d: pointsToPath(simplified) });

    applyStroke(path, m);
    group.appendChild(path);

    return group;
  }

  if (tool === "line") {
    group.appendChild(makeLine(start, end, m));
    return group;
  }

  if (tool === "arrow") {
    buildArrow(group, start, end, m);
    return group;
  }

  if (tool === "rect") {
    const rect = createSvgElement("rect", {
      x: formatNumber(Math.min(start.x, end.x)),
      y: formatNumber(Math.min(start.y, end.y)),
      width: formatNumber(Math.abs(end.x - start.x)),
      height: formatNumber(Math.abs(end.y - start.y)),
    });

    applyStroke(rect, m);
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

    applyStroke(ellipse, m);
    group.appendChild(ellipse);

    return group;
  }

  return null;
}

/* ------------------------------ preview ------------------------------ */

function clearPreview() {
  if (ANN.preview?.parentNode) ANN.preview.remove();

  ANN.preview = null;
}

function setPreview(points) {
  clearPreview();

  if (!ANN.svg || points.length < 2) return;

  const group = buildShape(ANN.tool, points, getSvgMetrics(ANN.svg));

  if (!group) return;

  group.setAttribute("data-preview", "true");

  ANN.svg.appendChild(group);
  ANN.preview = group;
}

function snapshot() {
  if (!ANN.svg) return;

  ANN.history.push(ANN.svg.innerHTML);

  if (ANN.history.length > ANN_HISTORY_LIMIT) ANN.history.shift();
}

/* ------------------------------ eraser ------------------------------ */

function eraseAt(point) {
  const svg = ANN.svg;

  if (!svg) return;

  const m = getSvgMetrics(svg);
  const r = 7;

  const offsets = [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ];

  const groups = Array.from(svg.querySelectorAll("[data-annotation-kind]"))
    .filter((group) => group.getAttribute("data-preview") !== "true")
    .reverse();

  for (const group of groups) {
    const hit = Array.from(group.children).some((element) => {
      if (typeof element.isPointInStroke !== "function") return false;

      return offsets.some(([dx, dy]) => {
        try {
          return element.isPointInStroke(
            new DOMPoint(point.x + dx * m.sx, point.y + dy * m.sy),
          );
        } catch (_) {
          return false;
        }
      });
    });

    if (hit) {
      if (!ANN.eraseSnapshotTaken) {
        snapshot();
        ANN.eraseSnapshotTaken = true;
      }

      group.remove();

      ANN.suggestion = null;
      hideSuggestion();

      break;
    }
  }
}

/* ------------------------------ pointer handlers ------------------------------ */

function annPointerDown(event) {
  if (!ANN.drawing || !ANN.svg) return;

  const svg = event.target.closest?.(".note-annotation-layer");

  if (!svg || svg !== ANN.svg) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();

  prepareSvgForDrawing(svg);

  ANN.pointerId = event.pointerId;
  ANN.points = [pointFromEvent(event, svg)];

  try {
    svg.setPointerCapture(event.pointerId);
  } catch (_) {
    /* lanjut tanpa capture */
  }

  if (ANN.tool === "eraser") {
    ANN.eraseSnapshotTaken = false;
    eraseAt(ANN.points[0]);
    return;
  }

  setPreview(ANN.points);
}

function annPointerMove(event) {
  if (!ANN.drawing || ANN.pointerId !== event.pointerId || !ANN.svg) return;

  event.preventDefault();
  event.stopPropagation();

  const point = pointFromEvent(event, ANN.svg);

  if (ANN.tool === "eraser") {
    eraseAt(point);
    return;
  }

  if (ANN.tool === "pen") {
    ANN.points.push(point);
  } else {
    ANN.points = [ANN.points[0], point];
  }

  setPreview(ANN.points);
}

function annPointerUp(event) {
  if (!ANN.drawing || ANN.pointerId !== event.pointerId || !ANN.svg) return;

  event.preventDefault();
  event.stopPropagation();

  const svg = ANN.svg;

  if (ANN.tool === "eraser") {
    ANN.pointerId = null;
    ANN.points = [];
    return;
  }

  const finalPoint = pointFromEvent(event, svg);

  if (ANN.tool === "pen") {
    ANN.points.push(finalPoint);
  } else {
    ANN.points = [ANN.points[0], finalPoint];
  }

  const points = ANN.points.slice();
  const tool = ANN.tool;
  const m = getSvgMetrics(svg);

  clearPreview();

  /*
     FIX: validasi memakai panjang goresan (untuk pen) sehingga lingkaran
     tertutup tidak lagi dibuang karena titik awal ≈ titik akhir.
  */
  const valid =
    tool === "pen"
      ? pxPathLength(points, m) > 3
      : pxDistance(points[0], points[points.length - 1], m) > 4;

  if (valid) {
    snapshot();

    const group = buildShape(tool, points, m);

    if (group) {
      svg.appendChild(group);

      if (tool === "pen") suggestPerfectShape(group, points, m);
    }
  }

  ANN.pointerId = null;
  ANN.points = [];
}

function annPointerCancel() {
  clearPreview();

  ANN.pointerId = null;
  ANN.points = [];
}

/* ------------------------------ shape recognition ------------------------------ */

function perpendicularDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;

  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    length
  );
}

function classifyStroke(points, m) {
  if (points.length < 10) return null;

  const W = m.rect.width || 1;
  const H = m.rect.height || 1;

  const px = points.map((p) => ({ x: p.x / m.sx, y: p.y / m.sy }));

  const start = px[0];
  const end = px[px.length - 1];

  let totalLength = 0;

  for (let i = 1; i < px.length; i += 1) {
    totalLength += distance(px[i - 1], px[i]);
  }

  const endpointDistance = distance(start, end);

  /* LINE */
  if (totalLength > 16) {
    let maxDeviation = 0;

    px.forEach((point) => {
      maxDeviation = Math.max(
        maxDeviation,
        perpendicularDistance(point, start, end),
      );
    });

    const straightness = endpointDistance / totalLength;
    const deviationLimit = Math.max(3.5, Math.min(W, H) * 0.012);

    if (straightness >= 0.94 && maxDeviation <= deviationLimit) {
      return {
        kind: "line",
        originalStart: points[0],
        originalEnd: points[points.length - 1],
      };
    }
  }

  /* CIRCLE / ELLIPSE */
  if (endpointDistance > Math.min(W, H) * 0.18 || totalLength < 36) {
    return null;
  }

  const xs = px.map((p) => p.x);
  const ys = px.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const widthPx = maxX - minX;
  const heightPx = maxY - minY;

  if (widthPx < 20 || heightPx < 20) return null;

  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  const normalizedRadii = px.map((p) => {
    const nx = (p.x - center.x) / (widthPx / 2);
    const ny = (p.y - center.y) / (heightPx / 2);

    return Math.hypot(nx, ny);
  });

  const meanRadius = average(normalizedRadii);

  const meanError = average(
    normalizedRadii.map((radius) => Math.abs(radius - meanRadius)),
  );

  if (meanRadius < 0.72 || meanRadius > 1.28 || meanError > 0.17) return null;

  const aspectRatio = widthPx / heightPx;
  const isCircle = aspectRatio >= 0.78 && aspectRatio <= 1.28;

  return {
    kind: isCircle ? "circle" : "ellipse",
    center,
    rxPx: isCircle ? (widthPx + heightPx) / 4 : widthPx / 2,
    ryPx: isCircle ? (widthPx + heightPx) / 4 : heightPx / 2,
  };
}

function suggestPerfectShape(group, points, m) {
  const detected = classifyStroke(points, m);

  if (!detected || !group) {
    ANN.suggestion = null;
    hideSuggestion();
    return;
  }

  ANN.suggestion = { group, detected };

  const text = document.getElementById("annotationStatusText");
  const accept = document.getElementById("acceptAnnotationSuggestionBtn");
  const row = document.getElementById("annotationStatusRow");

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

  if (row) row.style.display = "flex";
}

function hideSuggestion() {
  const row = document.getElementById("annotationStatusRow");

  if (row) row.style.display = "none";
}

function perfectShape(detected, m) {
  const group = createGroup(`${detected.kind}-perfect`);

  if (detected.kind === "line") {
    group.appendChild(
      makeLine(detected.originalStart, detected.originalEnd, m),
    );
    return group;
  }

  const ellipse = createSvgElement("ellipse", {
    cx: formatNumber(detected.center.x * m.sx),
    cy: formatNumber(detected.center.y * m.sy),
    rx: formatNumber(detected.rxPx * m.sx),
    ry: formatNumber(detected.ryPx * m.sy),
  });

  applyStroke(ellipse, m);
  group.appendChild(ellipse);

  return group;
}

window.acceptAnnotationSuggestion = () => {
  if (!ANN.suggestion || !ANN.svg) return;

  const { group, detected } = ANN.suggestion;
  const replacement = perfectShape(detected, getSvgMetrics(ANN.svg));

  if (!replacement) return;

  snapshot();

  group.replaceWith(replacement);

  ANN.suggestion = null;
  hideSuggestion();
};

window.dismissAnnotationSuggestion = () => {
  ANN.suggestion = null;
  hideSuggestion();
};

/* ------------------------------ selection / toolbar ------------------------------ */

function updateAnnotationToolbar() {
  const toolbar = document.getElementById("annotationToolbar");
  const launch = document.getElementById("annotationLaunchBtn");

  if (toolbar) toolbar.style.display = ANN.wrapper ? "block" : "none";

  if (launch) launch.classList.toggle("is-active", ANN.drawing);

  /* Interaksi layer dikendalikan INLINE (bukan hanya lewat CSS luar). */
  document.querySelectorAll(".note-image-annotation").forEach((wrapper) => {
    const active = Boolean(ANN.drawing && ANN.wrapper === wrapper);

    wrapper.classList.toggle("is-drawing", active);

    const svg = wrapper.querySelector(".note-annotation-layer");

    if (!svg) return;

    svg.style.pointerEvents = active ? "auto" : "none";
    svg.style.zIndex = "2";

    if (active) {
      svg.style.touchAction = "none";
      svg.style.cursor = "crosshair";
    } else {
      svg.style.removeProperty("touch-action");
      svg.style.removeProperty("cursor");
    }
  });

  document.querySelectorAll("[data-annotation-tool]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.getAttribute("data-annotation-tool") === ANN.tool,
    );
  });

  const color = document.getElementById("annotationColor");
  const width = document.getElementById("annotationWidth");

  if (color && color.value !== ANN.color) color.value = ANN.color;
  if (width && Number(width.value) !== ANN.width)
    width.value = String(ANN.width);
}

function selectImageWrapper(wrapper) {
  if (!wrapper) return;

  ensureAnnotationLayer(wrapper);

  document
    .querySelectorAll(".note-image-annotation.is-selected")
    .forEach((item) => {
      if (item !== wrapper) item.classList.remove("is-selected", "is-drawing");
    });

  wrapper.classList.add("is-selected");

  ANN.wrapper = wrapper;
  ANN.svg = wrapper.querySelector(".note-annotation-layer");
  ANN.history = [];
  ANN.suggestion = null;

  clearPreview();
  hideSuggestion();
  updateAnnotationToolbar();
}

function resetAnnotationState() {
  clearPreview();

  ANN.drawing = false;
  ANN.pointerId = null;
  ANN.points = [];
  ANN.history = [];
  ANN.suggestion = null;

  document
    .querySelectorAll(
      ".note-image-annotation.is-selected, .note-image-annotation.is-drawing",
    )
    .forEach((item) => item.classList.remove("is-selected", "is-drawing"));

  ANN.wrapper = null;
  ANN.svg = null;

  hideSuggestion();
  updateAnnotationToolbar();
}

window.toggleAnnotationMode = () => {
  const editor = getEditor();

  if (!ANN.wrapper) {
    const images = editor
      ? Array.from(editor.querySelectorAll("img.note-img"))
      : [];

    if (images.length === 0) {
      setEditorStatus("Insert an image first, then click the marker tool.");
      return;
    }

    if (images.length > 1) {
      setEditorStatus("Click the image you want to draw on first.");
      return;
    }

    const wrapper = ensureAnnotationWrapper(images[0]);

    if (wrapper) selectImageWrapper(wrapper);
  }

  ANN.drawing = !ANN.drawing;

  if (!ANN.drawing) {
    clearPreview();
    ANN.suggestion = null;
    hideSuggestion();
  }

  updateAnnotationToolbar();
};

window.finishAnnotationMode = () => {
  clearPreview();

  ANN.drawing = false;

  if (ANN.wrapper) {
    ANN.wrapper.classList.remove("is-drawing", "is-selected");
  }

  ANN.wrapper = null;
  ANN.svg = null;
  ANN.history = [];
  ANN.suggestion = null;
  ANN.pointerId = null;
  ANN.points = [];

  hideSuggestion();
  updateAnnotationToolbar();
};

window.setAnnotationTool = (tool) => {
  if (!["pen", "line", "arrow", "rect", "ellipse", "eraser"].includes(tool)) {
    return;
  }

  ANN.tool = tool;
  ANN.drawing = true;
  ANN.suggestion = null;

  hideSuggestion();
  updateAnnotationToolbar();
};

window.setAnnotationColor = (value) => {
  if (value) ANN.color = value;
};

window.setAnnotationWidth = (value) => {
  const numeric = Number(value);

  if (Number.isFinite(numeric)) ANN.width = clamp(numeric, 1, 10);
};

window.undoAnnotation = () => {
  if (!ANN.svg || !ANN.history.length) return;

  ANN.svg.innerHTML = ANN.history.pop();
  ANN.suggestion = null;

  hideSuggestion();
};

window.clearAnnotations = () => {
  if (!ANN.svg || !ANN.svg.children.length) return;

  snapshot();

  ANN.svg.innerHTML = "";
  ANN.suggestion = null;

  hideSuggestion();
};

/* ------------------------------ editor events ------------------------------ */

function annEditorClick(event) {
  const editor = getEditor();

  if (!editor) return;

  const wrapperEl = event.target.closest?.(".note-image-annotation");

  if (ANN.drawing) {
    if (!wrapperEl) {
      window.finishAnnotationMode();
    } else if (wrapperEl !== ANN.wrapper) {
      selectImageWrapper(wrapperEl);
    }

    return;
  }

  const image = event.target.closest?.("img.note-img");

  if (image && editor.contains(image)) {
    const wrapper = ensureAnnotationWrapper(image);

    if (wrapper) {
      event.preventDefault();
      event.stopPropagation();
      selectImageWrapper(wrapper);
    }

    return;
  }

  /* Klik di luar gambar -> sembunyikan toolbar anotasi. */
  if (ANN.wrapper && !wrapperEl) {
    window.finishAnnotationMode();
  }
}

function initAnnotationEditorBinding() {
  const editor = getEditor();

  if (!editor || editor.dataset.annotationBound === "true") return;

  editor.dataset.annotationBound = "true";

  editor.addEventListener("pointerdown", annPointerDown);
  editor.addEventListener("pointermove", annPointerMove);
  editor.addEventListener("pointerup", annPointerUp);
  editor.addEventListener("pointercancel", annPointerCancel);
  editor.addEventListener("click", annEditorClick);

  editor.addEventListener("mousedown", (event) => {
    if (ANN.drawing && event.target.closest?.(".note-image-annotation")) {
      event.preventDefault();
    }
  });

  editor.addEventListener("dragstart", (event) => {
    if (event.target.closest?.("img.note-img")) event.preventDefault();
  });
}

/* ------------------------------ injected UI ------------------------------ */

function injectAnnotationLaunchButton() {
  if (document.getElementById("annotationLaunchBtn")) return;

  const toolbar = document.querySelector(".editor-toolbar");

  const imageButton = toolbar?.querySelector('[onclick*="triggerImageInsert"]');

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

  const overlay = document.getElementById("editor-overlay");

  if (!overlay) return;

  const toolbar = document.createElement("div");

  toolbar.className = "annotation-toolbar nx-floating";
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

  /* Di dalam overlay -> tetap terlihat di native Full Screen & Focus Mode. */
  overlay.appendChild(toolbar);

  toolbar.querySelectorAll("[data-annotation-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      window.setAnnotationTool(button.getAttribute("data-annotation-tool"));
    });
  });

  document
    .getElementById("annotationColor")
    ?.addEventListener("input", (event) => {
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

/* ==========================================================================
   LIST / BULLET (anak bullet, menjorok, gaya)
========================================================================== */

function getCaretElement() {
  const sel = window.getSelection();

  if (!sel || sel.rangeCount === 0) return null;

  const node = sel.getRangeAt(0).startContainer;

  return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
}

function getClosestList() {
  const editor = getEditor();
  const list = getCaretElement()?.closest?.("ul, ol");

  return list && editor && editor.contains(list) ? list : null;
}

function getRootList(list) {
  let root = list;

  while (root && root.parentElement?.closest?.("ul, ol")) {
    root = root.parentElement.closest("ul, ol");
  }

  return root;
}

/* Daftar anak yang baru dibuat mengikuti besar menjorok pilihan terakhir. */
function applyPreferredIndentToNewLists() {
  if (preferredListIndentPx == null) return;

  const list = getClosestList();

  if (!list) return;

  const root = getRootList(list);

  [root, ...root.querySelectorAll("ul, ol")].forEach((item) => {
    if (!item.style.paddingLeft) {
      item.style.paddingLeft = `${preferredListIndentPx}px`;
    }
  });
}

window.listIndent = function (fromKeyboard = false) {
  if (!fromKeyboard) restoreSelection();

  if (!getClosestList()) {
    setEditorStatus("Place the cursor inside a bullet list first.");
    return;
  }

  document.execCommand("indent", false, null);

  applyPreferredIndentToNewLists();
  syncListControls();
  updateWordCount();
};

window.listOutdent = function (fromKeyboard = false) {
  if (!fromKeyboard) restoreSelection();

  if (!getClosestList()) {
    setEditorStatus("Place the cursor inside a bullet list first.");
    return;
  }

  document.execCommand("outdent", false, null);

  syncListControls();
  updateWordCount();
};

/* Besar menjorok untuk list di kursor + semua anak di bawahnya. */
window.setListIndent = function (px) {
  const value = Number(px);

  if (!Number.isFinite(value)) return;

  restoreSelection();

  const list = getClosestList();

  if (!list) {
    setEditorStatus("Place the cursor inside a bullet list first.");
    return;
  }

  preferredListIndentPx = value;

  [list, ...list.querySelectorAll("ul, ol")].forEach((item) => {
    item.style.paddingLeft = `${value}px`;
  });

  updateWordCount();
};

window.setListStyle = function (type) {
  if (!type) return;

  restoreSelection();

  let list = getClosestList();

  if (!list) {
    setEditorStatus("Place the cursor inside a bullet list first.");
    return;
  }

  const wantOrdered = [
    "decimal",
    "lower-alpha",
    "upper-alpha",
    "lower-roman",
    "upper-roman",
  ].includes(type);

  if (wantOrdered && list.tagName === "UL") {
    document.execCommand("insertOrderedList", false, null);
    list = getClosestList() || list;
  } else if (!wantOrdered && list.tagName === "OL") {
    document.execCommand("insertUnorderedList", false, null);
    list = getClosestList() || list;
  }

  list.style.listStyleType = type;

  updateWordCount();
};

function syncListControls() {
  const sizeSelect = document.getElementById("nxListIndent");
  const styleSelect = document.getElementById("nxListStyle");

  if (!sizeSelect && !styleSelect) return;

  const list = getClosestList();

  if (!list) return;

  const computed = getComputedStyle(list);

  if (sizeSelect) {
    const px = parseFloat(computed.paddingLeft) || 0;

    let best = null;
    let bestDiff = Infinity;

    Array.from(sizeSelect.options).forEach((option) => {
      const diff = Math.abs(Number(option.value) - px);

      if (diff < bestDiff) {
        bestDiff = diff;
        best = option.value;
      }
    });

    if (best !== null) sizeSelect.value = best;
  }

  if (styleSelect) {
    const type = computed.listStyleType;

    const exists = Array.from(styleSelect.options).some(
      (option) => option.value === type,
    );

    styleSelect.value = exists ? type : "";
  }
}

function injectListControls() {
  if (document.getElementById("nxListTools")) return;

  const toolbar = document.querySelector(".editor-toolbar");

  if (!toolbar) return;

  const group = document.createElement("span");

  group.className = "nx-list-tools";
  group.id = "nxListTools";

  group.innerHTML = `
    <button type="button" class="tb-btn" id="nxListOutdentBtn"
      title="Kurangi tingkat bullet (Shift+Tab)" aria-label="Outdent list">
      <i class="fa-solid fa-outdent"></i>
    </button>
    <button type="button" class="tb-btn" id="nxListIndentBtn"
      title="Jadikan anak bullet (Tab)" aria-label="Indent list">
      <i class="fa-solid fa-indent"></i>
    </button>
    <select id="nxListIndent" title="Besar menjorok list ini &amp; anak-anaknya" aria-label="List indent size">
      <option value="16">Menjorok 16px</option>
      <option value="24" selected>Menjorok 24px</option>
      <option value="32">Menjorok 32px</option>
      <option value="40">Menjorok 40px</option>
      <option value="48">Menjorok 48px</option>
      <option value="64">Menjorok 64px</option>
      <option value="80">Menjorok 80px</option>
    </select>
    <select id="nxListStyle" title="Gaya bullet / penomoran" aria-label="List style">
      <option value="">Gaya…</option>
      <option value="disc">• Bulat</option>
      <option value="circle">◦ Lingkaran</option>
      <option value="square">▪ Kotak</option>
      <option value="decimal">1. Angka</option>
      <option value="lower-alpha">a. Huruf kecil</option>
      <option value="upper-alpha">A. Huruf besar</option>
      <option value="lower-roman">i. Romawi kecil</option>
      <option value="upper-roman">I. Romawi besar</option>
    </select>
  `;

  const anchors = toolbar.querySelectorAll(
    '[onclick*="insertUnorderedList"], [onclick*="insertOrderedList"]',
  );

  const lastAnchor = anchors.length ? anchors[anchors.length - 1] : null;

  if (lastAnchor && lastAnchor.parentElement) {
    lastAnchor.parentElement.insertBefore(group, lastAnchor.nextSibling);
  } else {
    toolbar.appendChild(group);
  }

  group
    .querySelector("#nxListOutdentBtn")
    .addEventListener("click", () => window.listOutdent());

  group
    .querySelector("#nxListIndentBtn")
    .addEventListener("click", () => window.listIndent());

  group.querySelector("#nxListIndent").addEventListener("change", (event) => {
    window.setListIndent(event.target.value);
  });

  group.querySelector("#nxListStyle").addEventListener("change", (event) => {
    window.setListStyle(event.target.value);
  });
}

/* Tab / Shift+Tab di dalam list = anak bullet; Esc = selesai menggambar. */
function initEditorKeyboard() {
  const editor = getEditor();

  if (!editor || editor.dataset.keyboardBound === "true") return;

  editor.dataset.keyboardBound = "true";

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ANN.drawing) {
      window.finishAnnotationMode();
      return;
    }

    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    if (!getClosestList()) return;

    event.preventDefault();

    if (event.shiftKey) {
      window.listOutdent(true);
    } else {
      window.listIndent(true);
    }
  });
}

/* ==========================================================================
   TABLE
   --------------------------------------------------------------------------
   Catatan: versi lama handleTableAction() memiliki fungsi bersarang di dalam
   blok switch sehingga aksi tambah/hapus baris-kolom tidak pernah berjalan.
   Di sini semuanya dirapikan menjadi satu implementasi berbasis "grid" yang
   aman terhadap colspan / rowspan.
========================================================================== */

function buildTableGrid(table) {
  const grid = [];
  const info = new Map();

  Array.from(table.rows).forEach((tr, r) => {
    grid[r] = grid[r] || [];

    let c = 0;

    Array.from(tr.cells).forEach((cell) => {
      while (grid[r][c]) c += 1;

      const rowSpan = cell.rowSpan || 1;
      const colSpan = cell.colSpan || 1;

      for (let i = 0; i < rowSpan; i += 1) {
        grid[r + i] = grid[r + i] || [];

        for (let j = 0; j < colSpan; j += 1) {
          grid[r + i][c + j] = cell;
        }
      }

      info.set(cell, { row: r, col: c, rowSpan, colSpan });

      c += colSpan;
    });
  });

  return { grid, info };
}

function getGridColumnCount(grid) {
  return grid.reduce((max, row) => Math.max(max, row ? row.length : 0), 0);
}

function getEditorCell() {
  const editor = getEditor();
  const sel = window.getSelection();

  if (!editor || !sel || sel.rangeCount === 0) return null;

  let node = sel.getRangeAt(0).startContainer;

  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

  const cell = node?.closest?.("td, th");

  return cell && editor.contains(cell) ? cell : null;
}

function makeTableCell(reference, forceTag) {
  const tag =
    forceTag || (reference && reference.tagName === "TH" ? "th" : "td");
  const cell = document.createElement(tag);

  if (reference) {
    cell.style.cssText = reference.style.cssText;
    cell.style.width = "";
    cell.style.height = "";
  } else {
    cell.style.border = "1px solid #ccc";
    cell.style.padding = "8px 12px";
  }

  cell.innerHTML = "<br>";

  return cell;
}

function focusTableCell(cell) {
  if (!cell) return;

  const range = document.createRange();

  range.selectNodeContents(cell);
  range.collapse(true);

  const selection = window.getSelection();

  selection.removeAllRanges();
  selection.addRange(range);

  lastSelectionRange = range.cloneRange();
  savedSelectionRange = range.cloneRange();
}

function insertEditorTable(rows, cols) {
  const rowCount = clamp(parseInt(rows, 10) || 3, 1, 30);
  const colCount = clamp(parseInt(cols, 10) || 3, 1, 15);

  let html =
    '<table style="width:100%;border-collapse:collapse;border:1px solid #ccc;margin-bottom:1.5rem;"><tbody>';

  for (let i = 0; i < rowCount; i += 1) {
    html += "<tr>";

    for (let j = 0; j < colCount; j += 1) {
      html += '<td style="border:1px solid #ccc;padding:8px 12px;"><br></td>';
    }

    html += "</tr>";
  }

  html += "</tbody></table><p><br></p>";

  document.execCommand("insertHTML", false, html);
}

function setTableBorders(table, mode) {
  const cells = table.querySelectorAll("th, td");
  const line = "1px solid #ccc";

  const apply = (target, sides) => {
    target.style.border = "none";

    sides.forEach((side) => {
      target.style[`border${side}`] = line;
    });
  };

  const sidesByMode = {
    "border-full": null,
    "border-horizontal": ["Top", "Bottom"],
    "border-vertical": ["Left", "Right"],
    "border-none": [],
  };

  const sides = sidesByMode[mode];

  if (sides === null) {
    table.style.border = line;
    cells.forEach((cell) => {
      cell.style.border = line;
    });
    return;
  }

  apply(table, sides);
  cells.forEach((cell) => apply(cell, sides));
}

function moveCellContent(from, to) {
  if (!from.textContent.trim()) return;

  if (to.textContent.trim()) {
    to.appendChild(document.createElement("br"));
  } else {
    to.innerHTML = "";
  }

  while (from.firstChild) to.appendChild(from.firstChild);
}

/* ----- structure ----- */

function addTableRow(table, boundary) {
  const { grid, info } = buildTableGrid(table);
  const cols = getGridColumnCount(grid);
  const newRow = document.createElement("tr");
  const handled = new Set();

  for (let c = 0; c < cols; c += 1) {
    const above =
      boundary > 0 && grid[boundary - 1] ? grid[boundary - 1][c] : null;

    if (above) {
      const i = info.get(above);

      if (i.row < boundary && i.row + i.rowSpan > boundary) {
        if (!handled.has(above)) {
          above.rowSpan = i.rowSpan + 1;
          handled.add(above);
        }

        continue;
      }
    }

    const refRow = grid[Math.min(boundary, grid.length - 1)] || [];

    newRow.appendChild(makeTableCell(refRow[c] || null, "td"));
  }

  if (boundary < table.rows.length) {
    table.rows[boundary].before(newRow);
  } else {
    table.rows[table.rows.length - 1].after(newRow);
  }

  focusTableCell(newRow.cells[0]);
}

function addTableColumn(table, boundary) {
  const { grid, info } = buildTableGrid(table);
  const handled = new Set();

  let firstNew = null;

  for (let r = 0; r < table.rows.length; r += 1) {
    const left = boundary > 0 && grid[r] ? grid[r][boundary - 1] : null;

    if (left) {
      const i = info.get(left);

      if (i.col < boundary && i.col + i.colSpan > boundary) {
        if (!handled.has(left)) {
          left.colSpan = i.colSpan + 1;
          handled.add(left);
        }

        continue;
      }
    }

    const tr = table.rows[r];
    const ref =
      (grid[r] && (grid[r][boundary - 1] || grid[r][boundary])) || tr.cells[0];
    const newCell = makeTableCell(ref);

    let before = null;

    for (const cell of tr.cells) {
      if (info.get(cell).col >= boundary) {
        before = cell;
        break;
      }
    }

    tr.insertBefore(newCell, before);

    if (!firstNew) firstNew = newCell;
  }

  syncColgroupAfterColumnAdd(table, boundary);

  focusTableCell(firstNew);
}

function deleteTableRow(table, r) {
  const { grid, info } = buildTableGrid(table);
  const tr = table.rows[r];

  if (!tr) return;

  const seen = new Set();

  (grid[r] || []).forEach((cell) => {
    if (!cell || seen.has(cell)) return;

    seen.add(cell);

    const i = info.get(cell);

    if (i.row < r) {
      cell.rowSpan = i.rowSpan - 1;
    } else if (i.rowSpan > 1) {
      cell.rowSpan = i.rowSpan - 1;

      const next = table.rows[r + 1];

      if (next) {
        let before = null;

        for (const nextCell of next.cells) {
          if (info.get(nextCell).col > i.col) {
            before = nextCell;
            break;
          }
        }

        next.insertBefore(cell, before);
      }
    }
  });

  tr.remove();

  if (!table.rows.length) table.remove();
}

function deleteTableColumn(table, c) {
  const { grid, info } = buildTableGrid(table);
  const seen = new Set();

  grid.forEach((row) => {
    const cell = row ? row[c] : null;

    if (!cell || seen.has(cell)) return;

    seen.add(cell);

    const i = info.get(cell);

    if (i.colSpan > 1) {
      cell.colSpan = i.colSpan - 1;
    } else {
      cell.remove();
    }
  });

  syncColgroupAfterColumnDelete(table, c);

  if (!table.querySelector("td, th")) table.remove();
}

function mergeTableCellRight(table, cell) {
  const { grid, info } = buildTableGrid(table);
  const me = info.get(cell);
  const target = grid[me.row][me.col + me.colSpan];

  if (!target) {
    alert("Tidak ada sel di sebelah kanan.");
    return;
  }

  const t = info.get(target);

  if (t.row !== me.row || t.rowSpan !== me.rowSpan) {
    alert(
      "Sel di sebelah kanan memiliki tinggi berbeda dan tidak dapat digabung.",
    );
    return;
  }

  cell.colSpan = me.colSpan + t.colSpan;

  moveCellContent(target, cell);

  target.remove();

  focusTableCell(cell);
}

function mergeTableCellDown(table, cell) {
  const { grid, info } = buildTableGrid(table);
  const me = info.get(cell);
  const below = grid[me.row + me.rowSpan]
    ? grid[me.row + me.rowSpan][me.col]
    : null;

  if (!below) {
    alert("Tidak ada sel di bawah pada posisi yang sama.");
    return;
  }

  const b = info.get(below);

  if (b.col !== me.col || b.colSpan !== me.colSpan) {
    alert("Sel di bawah memiliki lebar berbeda dan tidak dapat digabung.");
    return;
  }

  cell.rowSpan = me.rowSpan + b.rowSpan;

  moveCellContent(below, cell);

  below.remove();

  focusTableCell(cell);
}

function unmergeTableCell(table, cell) {
  const { info } = buildTableGrid(table);
  const me = info.get(cell);

  if (me.rowSpan === 1 && me.colSpan === 1) {
    alert("Sel ini tidak sedang digabung.");
    return;
  }

  for (let r = me.row; r < me.row + me.rowSpan; r += 1) {
    const tr = table.rows[r];

    if (!tr) continue;

    for (let c = me.col; c < me.col + me.colSpan; c += 1) {
      if (r === me.row && c === me.col) continue;

      const newCell = makeTableCell(cell);

      /* Pasang sebelum sel pertama (yang sudah ada) dengan kolom > c. */
      let before = null;

      for (const existing of tr.cells) {
        const existingInfo = info.get(existing);

        if (existingInfo && existingInfo.col > c) {
          before = existing;
          break;
        }
      }

      tr.insertBefore(newCell, before);
    }
  }

  cell.rowSpan = 1;
  cell.colSpan = 1;

  focusTableCell(cell);
}

/* ----- sizing ----- */

function ensureColgroup(table) {
  const { grid, info } = buildTableGrid(table);
  const count = getGridColumnCount(grid);

  let colgroup = table.querySelector(":scope > colgroup");

  if (colgroup && colgroup.children.length === count) {
    table.style.tableLayout = "fixed";
    return colgroup;
  }

  const tableRect = table.getBoundingClientRect();
  const tableWidth = tableRect.width || 1;
  const widths = [];

  for (let c = 0; c < count; c += 1) {
    let measured = 0;

    for (let r = 0; r < grid.length; r += 1) {
      const cell = grid[r] ? grid[r][c] : null;

      if (cell && info.get(cell).colSpan === 1) {
        measured = cell.getBoundingClientRect().width;
        break;
      }
    }

    widths.push(measured || tableWidth / count);
  }

  const total = widths.reduce((sum, w) => sum + w, 0) || 1;

  if (colgroup) colgroup.remove();

  colgroup = document.createElement("colgroup");

  widths.forEach((w) => {
    const col = document.createElement("col");

    col.style.width = `${((w / total) * 100).toFixed(2)}%`;
    colgroup.appendChild(col);
  });

  table.insertBefore(colgroup, table.firstChild);

  if (!table.style.width || table.style.width === "auto") {
    table.style.width = `${Math.round(tableWidth)}px`;
    table.style.maxWidth = "100%";
  }

  table.style.tableLayout = "fixed";

  return colgroup;
}

function normalizeColgroup(colgroup) {
  const cols = Array.from(colgroup.children);
  const total =
    cols.reduce((sum, col) => sum + (parseFloat(col.style.width) || 0), 0) || 1;

  cols.forEach((col) => {
    col.style.width = `${(((parseFloat(col.style.width) || 0) / total) * 100).toFixed(2)}%`;
  });
}

function syncColgroupAfterColumnAdd(table, boundary) {
  const colgroup = table.querySelector(":scope > colgroup");

  if (!colgroup) return;

  const cols = Array.from(colgroup.children);
  const count = cols.length + 1;
  const newCol = document.createElement("col");

  newCol.style.width = `${(100 / count).toFixed(2)}%`;

  cols.forEach((col) => {
    col.style.width = `${(((parseFloat(col.style.width) || 0) * (count - 1)) / count).toFixed(2)}%`;
  });

  colgroup.insertBefore(newCol, cols[boundary] || null);

  normalizeColgroup(colgroup);
}

function syncColgroupAfterColumnDelete(table, index) {
  const colgroup = table.querySelector(":scope > colgroup");

  if (!colgroup) return;

  const col = colgroup.children[index];

  if (col) col.remove();

  if (colgroup.children.length) {
    normalizeColgroup(colgroup);
  } else {
    colgroup.remove();
  }
}

function setColumnWidth(table, colIndex, rawValue) {
  const value = String(rawValue || "")
    .trim()
    .toLowerCase();

  if (!value) return false;

  const colgroup = ensureColgroup(table);
  const cols = Array.from(colgroup.children);
  const tableWidth = table.getBoundingClientRect().width || 1;

  let pct;

  if (value.endsWith("%")) {
    pct = parseFloat(value);
  } else {
    pct = (parseFloat(value) / tableWidth) * 100;
  }

  if (!Number.isFinite(pct) || !cols[colIndex]) return false;

  if (cols.length === 1) {
    cols[0].style.width = "100%";
    return true;
  }

  const minPct = 3;

  pct = clamp(pct, minPct, 100 - minPct * (cols.length - 1));

  const others = cols.filter((_, i) => i !== colIndex);

  const sumOthers =
    others.reduce((sum, col) => sum + (parseFloat(col.style.width) || 0), 0) ||
    1;

  const scale = (100 - pct) / sumOthers;

  others.forEach((col) => {
    col.style.width = `${((parseFloat(col.style.width) || 0) * scale).toFixed(2)}%`;
  });

  cols[colIndex].style.width = `${pct.toFixed(2)}%`;

  return true;
}

function setRowHeight(tr, px) {
  const height = clamp(Number(px) || 0, 16, 1000);

  tr.style.height = `${height}px`;

  Array.from(tr.cells).forEach((cell) => {
    cell.style.height = `${height}px`;
  });
}

function resetTableSizes(table) {
  table.querySelector(":scope > colgroup")?.remove();

  table.style.tableLayout = "";

  table.querySelectorAll("tr").forEach((tr) => {
    tr.style.height = "";
  });

  table.querySelectorAll("th, td").forEach((cell) => {
    cell.style.width = "";
    cell.style.height = "";
  });
}

/* ----- main entry (dipanggil dari <select id="tbTableAction">) ----- */

window.handleTableAction = function (action) {
  const select = document.getElementById("tbTableAction");

  if (select) select.selectedIndex = 0;

  if (!action) return;

  restoreSelection();

  if (action === "insert") {
    const rows = prompt("Jumlah baris?", "3");

    if (rows === null) return;

    const cols = prompt("Jumlah kolom?", "3");

    if (cols === null) return;

    insertEditorTable(rows, cols);
    updateWordCount();

    return;
  }

  const cell = getEditorCell();

  if (!cell) {
    alert("Letakkan kursor di dalam tabel terlebih dahulu.");
    return;
  }

  const table = cell.closest("table");
  const { info } = buildTableGrid(table);
  const me = info.get(cell);
  const row = cell.parentElement;

  switch (action) {
    case "add-row-above":
      addTableRow(table, me.row);
      break;

    case "add-row-below":
      addTableRow(table, me.row + me.rowSpan);
      break;

    case "add-column-left":
      addTableColumn(table, me.col);
      break;

    case "add-column-right":
      addTableColumn(table, me.col + me.colSpan);
      break;

    case "delete-row":
      deleteTableRow(table, me.row);
      break;

    case "delete-column":
      deleteTableColumn(table, me.col);
      break;

    case "delete-table":
      table.remove();
      break;

    case "fit-window":
      table.style.width = "100%";
      table.style.tableLayout = table.querySelector(":scope > colgroup")
        ? "fixed"
        : "auto";
      break;

    case "fit-content":
      table.style.width = "auto";
      table.style.tableLayout = "auto";
      table.querySelector(":scope > colgroup")?.remove();
      break;

    case "border-full":
    case "border-horizontal":
    case "border-vertical":
    case "border-none":
      setTableBorders(table, action);
      break;

    case "merge-right":
      mergeTableCellRight(table, cell);
      break;

    case "merge-down":
      mergeTableCellDown(table, cell);
      break;

    case "unmerge":
      unmergeTableCell(table, cell);
      break;

    case "col-width": {
      const input = prompt("Lebar kolom ini (contoh: 30% atau 200px):", "25%");

      if (input === null) break;

      if (!setColumnWidth(table, me.col, input)) {
        alert("Nilai tidak valid. Gunakan format seperti 30% atau 200px.");
      }

      break;
    }

    case "equalize-cols": {
      const colgroup = ensureColgroup(table);
      const count = colgroup.children.length;

      Array.from(colgroup.children).forEach((col) => {
        col.style.width = `${(100 / count).toFixed(2)}%`;
      });

      break;
    }

    case "row-height": {
      const input = prompt(
        "Tinggi baris ini (px):",
        String(Math.round(row.getBoundingClientRect().height)),
      );

      if (input === null) break;

      if (!(Number(input) > 0)) {
        alert("Masukkan angka piksel yang valid.");
        break;
      }

      setRowHeight(row, input);

      break;
    }

    case "row-height-all": {
      const input = prompt("Tinggi SEMUA baris (px):", "40");

      if (input === null) break;

      if (!(Number(input) > 0)) {
        alert("Masukkan angka piksel yang valid.");
        break;
      }

      Array.from(table.rows).forEach((tr) => setRowHeight(tr, input));

      break;
    }

    case "reset-sizes":
      resetTableSizes(table);
      break;

    default:
      break;
  }

  updateWordCount();
};

/* Tambahkan opsi baru ke <select id="tbTableAction"> bila belum ada. */
function enhanceTableSelect() {
  const select = document.getElementById("tbTableAction");

  if (!select) return;

  const existing = new Set(Array.from(select.options).map((o) => o.value));

  const extras = [
    ["add-row-above", "Tambah baris di atas"],
    ["add-row-below", "Tambah baris di bawah"],
    ["add-column-left", "Tambah kolom di kiri"],
    ["add-column-right", "Tambah kolom di kanan"],
    ["delete-row", "Hapus baris"],
    ["delete-column", "Hapus kolom"],
    ["delete-table", "Hapus tabel"],
    ["col-width", "Atur lebar kolom…"],
    ["equalize-cols", "Samakan lebar semua kolom"],
    ["row-height", "Atur tinggi baris…"],
    ["row-height-all", "Atur tinggi semua baris…"],
    ["reset-sizes", "Reset ukuran kolom & baris"],
  ].filter(([value]) => !existing.has(value));

  if (!extras.length) return;

  const group = document.createElement("optgroup");

  group.label = "Struktur & ukuran";

  extras.forEach(([value, label]) => {
    const option = document.createElement("option");

    option.value = value;
    option.textContent = label;
    group.appendChild(option);
  });

  select.appendChild(group);
}

/* Drag border sel: kolom (kanan) dan baris (bawah). */
function initTableResize() {
  const editor = getEditor();

  if (!editor || editor.dataset.tableResizeBound === "true") return;

  editor.dataset.tableResizeBound = "true";

  const EDGE = 6;
  const MIN_COL_PX = 30;

  let drag = null;

  const hitTest = (event) => {
    const cell = event.target.closest?.("td, th");

    if (!cell || !editor.contains(cell)) return null;

    const rect = cell.getBoundingClientRect();
    const table = cell.closest("table");
    const { grid, info } = buildTableGrid(table);
    const me = info.get(cell);
    const lastCol = getGridColumnCount(grid) - 1;
    const endCol = me.col + me.colSpan - 1;

    if (rect.right - event.clientX <= EDGE && endCol < lastCol) {
      return { type: "col", table, index: endCol };
    }

    if (rect.bottom - event.clientY <= EDGE) {
      const tr = table.rows[me.row + me.rowSpan - 1];

      return tr ? { type: "row", table, tr } : null;
    }

    return null;
  };

  editor.addEventListener("mousemove", (event) => {
    if (drag) return;

    const hit = hitTest(event);

    editor.style.cursor = hit
      ? hit.type === "col"
        ? "col-resize"
        : "row-resize"
      : "";
  });

  editor.addEventListener("mouseleave", () => {
    if (!drag) editor.style.cursor = "";
  });

  editor.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || ANN.drawing) return;

    const hit = hitTest(event);

    if (!hit) return;

    event.preventDefault();

    if (hit.type === "col") {
      const colgroup = ensureColgroup(hit.table);
      const tableWidth = hit.table.getBoundingClientRect().width || 1;
      const cols = Array.from(colgroup.children);

      const w1 =
        ((parseFloat(cols[hit.index].style.width) || 0) / 100) * tableWidth;
      const w2 =
        ((parseFloat(cols[hit.index + 1].style.width) || 0) / 100) * tableWidth;

      drag = { ...hit, startX: event.clientX, w1, w2, tableWidth, cols };
    } else {
      drag = {
        ...hit,
        startY: event.clientY,
        height: hit.tr.getBoundingClientRect().height,
      };
    }
  });

  document.addEventListener("mousemove", (event) => {
    if (!drag) return;

    event.preventDefault();

    if (drag.type === "col") {
      const dx = event.clientX - drag.startX;
      const total = drag.w1 + drag.w2;
      const next1 = clamp(drag.w1 + dx, MIN_COL_PX, total - MIN_COL_PX);
      const next2 = total - next1;

      drag.cols[drag.index].style.width =
        `${((next1 / drag.tableWidth) * 100).toFixed(2)}%`;
      drag.cols[drag.index + 1].style.width =
        `${((next2 / drag.tableWidth) * 100).toFixed(2)}%`;
    } else {
      setRowHeight(drag.tr, drag.height + (event.clientY - drag.startY));
    }
  });

  document.addEventListener("mouseup", () => {
    if (!drag) return;

    drag = null;
    editor.style.cursor = "";
  });
}

/* ==========================================================================
   LINE HEIGHT / BLOCK TYPE / FONT
========================================================================== */

window.applyLineHeight = function (value) {
  restoreSelection();

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return;

  let node = selection.getRangeAt(0).commonAncestorContainer;

  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

  const editor = getEditor();

  if (!editor) return;

  const blockParent = node?.closest?.(
    "p, h1, h2, h3, h4, h5, h6, blockquote, li, td, div",
  );

  if (blockParent && blockParent !== editor) {
    blockParent.style.lineHeight = value;
    blockParent.style.marginBottom = Number(value) > 1.5 ? "1.5em" : "1em";
  } else if (node && node.style) {
    node.style.lineHeight = value;
  }

  updateWordCount();
};

window.applyBlockType = function (tag) {
  if (!tag) return;

  restoreSelection();

  document.execCommand("formatBlock", false, tag);

  updateWordCount();
};

const FONT_FAMILY_MAP = {
  "'Playfair Display', 'Georgia', serif": "'Playfair Display', Georgia, serif",
  "Playfair Display": "'Playfair Display', Georgia, serif",

  "'Inter', -apple-system, sans-serif":
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  Inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",

  "'JetBrains Mono', monospace": "'JetBrains Mono', monospace",
  "JetBrains Mono": "'JetBrains Mono', monospace",

  "'Cedarville Cursive', cursive": "'Cedarville Cursive', cursive",
  "Cedarville Cursive": "'Cedarville Cursive', cursive",

  "'Dancing Script', cursive": "'Dancing Script', cursive",
  "Dancing Script": "'Dancing Script', cursive",

  "'Caveat', cursive": "'Caveat', cursive",
  Caveat: "'Caveat', cursive",
};

function normalizeFontFamily(value) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  return FONT_FAMILY_MAP[raw] || raw;
}

function getPrimaryFontName(fontStack) {
  const value = String(fontStack || "").trim();

  if (!value) return "";

  return value
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function normalizeLegacyFontTags(editor) {
  if (!editor) return;

  editor.querySelectorAll("font[face]").forEach((fontElement) => {
    const face = fontElement.getAttribute("face");

    if (!face) return;

    const span = document.createElement("span");

    span.style.fontFamily = normalizeFontFamily(face);

    while (fontElement.firstChild) {
      span.appendChild(fontElement.firstChild);
    }

    fontElement.replaceWith(span);
  });
}

window.applyFont = function (fontFamily) {
  const editor = getEditor();

  if (!editor) return;

  const normalizedStack = normalizeFontFamily(fontFamily);

  if (!normalizedStack) return;

  const primaryFont = getPrimaryFontName(normalizedStack);

  if (!primaryFont) return;
  if (!restoreSelection()) return;

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) return;
  if (!range.toString().trim()) return;

  try {
    document.execCommand("styleWithCSS", false, true);

    const commandSuccess = document.execCommand("fontName", false, primaryFont);

    document.execCommand("styleWithCSS", false, false);

    if (!commandSuccess) {
      console.warn("fontName command was not accepted:", primaryFont);
    }
  } catch (error) {
    console.error("Font application failed:", error);
    return;
  }

  normalizeLegacyFontTags(editor);

  const currentSelection = window.getSelection();

  if (currentSelection && currentSelection.rangeCount > 0) {
    const selectedRange = currentSelection.getRangeAt(0);

    getTextNodesInRange(selectedRange, editor).forEach((textNode) => {
      const parent = textNode.parentElement;

      if (!parent || parent === editor) return;

      if (
        parent.tagName === "SPAN" ||
        parent.tagName === "FONT" ||
        parent.tagName === "A"
      ) {
        parent.style.fontFamily = normalizedStack;
      }
    });

    lastSelectionRange = selectedRange.cloneRange();
    savedSelectionRange = selectedRange.cloneRange();
  }

  updateWordCount();
};

/* ==========================================================================
   EDIT ARTICLE
========================================================================== */

window.editArticle = function (articleId) {
  if (!isOwnerLoggedIn()) {
    openLogin();
    return;
  }

  const data = globalArticlesCache.find((article) => article.id === articleId);

  if (!data) {
    alert("This note isn't editable.");
    return;
  }

  editingArticleId = articleId;

  resetAnnotationState();

  const heading = document.getElementById("editorHeading");
  if (heading) heading.textContent = "Edit Note";

  const publishLabel = document.getElementById("publishBtnLabel");
  if (publishLabel) publishLabel.textContent = "Save changes";

  const titleField = document.getElementById("fieldTitle");
  if (titleField) titleField.value = data.title;

  const excerptField = document.getElementById("fieldExcerpt");
  if (excerptField) excerptField.value = data.excerpt;

  const dateField = document.getElementById("fieldDate");
  if (dateField) dateField.value = data.dateISO;

  const body = getEditor();

  if (body) {
    body.innerHTML = data.bodyHTML;
  }

  /* Siapkan ulang layer anotasi dari isi tersimpan. */
  hydrateAnnotationsInEditor();

  pendingCardBackgroundFile = null;
  currentCardBackgroundUrl = data.cardBgUrl || null;
  currentCardBackgroundPath = data.cardBgPath || null;
  removeCardBackground = false;

  const backgroundInput = document.getElementById("fieldCardBackground");
  if (backgroundInput) backgroundInput.value = "";

  setCardBackgroundPreview(currentCardBackgroundUrl);

  const topicSelect = document.getElementById("fieldTopicSelect");
  const isStatic = !!TOPIC_CONFIG[data.topicId];

  if (topicSelect) {
    const newTopicGroup = document.getElementById("newTopicGroup");

    if (isStatic) {
      topicSelect.value = data.topicId;

      if (newTopicGroup) newTopicGroup.style.display = "none";
    } else {
      topicSelect.value = "__new__";

      if (newTopicGroup) newTopicGroup.style.display = "block";

      const newTopicName = document.getElementById("fieldNewTopicName");
      if (newTopicName) newTopicName.value = data.topicLabel;

      const newTopicIcon = document.getElementById("fieldNewTopicIcon");
      if (newTopicIcon) newTopicIcon.value = data.topicIcon || "fa-lightbulb";
    }
  }

  clearSavedSelection();
  updateWordCount();

  const status = document.getElementById("editorStatus");
  if (status) status.textContent = "";

  updateEditorFocusTitle(data.title);

  setEditorFocusMode(true);
  updateEditorFullscreenButton();

  const overlay = document.getElementById("editor-overlay");
  if (overlay) overlay.classList.add("active");

  document.body.style.overflow = "hidden";

  requestAnimationFrame(() => {
    if (body) body.focus();
  });
};

/* ==========================================================================
   DELETE ARTICLE
========================================================================== */

window.deleteArticle = async function (articleId) {
  if (!isOwnerLoggedIn()) return;

  if (!confirm("Delete this note? This cannot be undone.")) return;

  const articleToDelete = globalArticlesCache.find(
    (article) => article.id === articleId,
  );

  const oldCardBgPath = articleToDelete?.cardBgPath || null;

  setEditorStatus("Deleting note...");

  const { error } = await supabaseClient
    .from("articles")
    .delete()
    .eq("id", articleId);

  if (error) {
    alert("Failed to delete: " + error.message);
    return;
  }

  if (oldCardBgPath) {
    await deleteCardBackground(oldCardBgPath);
  }

  globalArticlesCache = globalArticlesCache.filter(
    (article) => article.id !== articleId,
  );

  const element = document.getElementById(articleId);
  const container = element ? element.closest(".carousel-container") : null;

  if (element) element.remove();

  if (container) initSingleCarousel(container);

  initScrollSpy();

  if (getArticleIdFromLocation() === articleId) {
    navigateToNotes(true);
    hideReadingOverlay();
  }
};

/* ==========================================================================
   PUBLISH / UPDATE
========================================================================== */

window.publishArticle = async function () {
  const title = document.getElementById("fieldTitle").value.trim();
  const excerpt = document.getElementById("fieldExcerpt").value.trim();
  const dateISO = document.getElementById("fieldDate").value;

  const body = getEditor();

  /*
     HTML bersih (tanpa state seleksi/menggambar). Tidak lagi mengubah DOM
     editor secara langsung, jadi tidak ada wrapper add-on yang perlu di-patch.
  */
  const bodyHTML = getCleanEditorHtml().trim();

  const topicSelectVal = document.getElementById("fieldTopicSelect").value;

  if (!title) return setEditorStatus("Please add a title.");
  if (!excerpt) return setEditorStatus("Please add a short excerpt.");

  if (!bodyHTML || bodyHTML === "<br>") {
    return setEditorStatus("Please write the note body.");
  }

  /* TOPIC */
  let topicId;
  let topicLabel;
  let topicIcon;

  if (topicSelectVal === "__new__") {
    const newName = document.getElementById("fieldNewTopicName").value.trim();

    if (!newName) return setEditorStatus("Please name the new topic.");

    topicId = slugify(newName);
    topicLabel = newName;
    topicIcon = document.getElementById("fieldNewTopicIcon").value;
  } else {
    topicId = topicSelectVal;

    topicLabel = TOPIC_CONFIG[topicSelectVal]
      ? TOPIC_CONFIG[topicSelectVal].label
      : topicSelectVal;

    topicIcon = null;
  }

  /* DATE */
  const dateObj = dateISO ? new Date(dateISO + "T00:00:00") : new Date();

  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });

  /* WORD COUNT */
  const wordCount = countWords(body?.textContent || "");
  const readTime = `${Math.max(1, Math.round(wordCount / 200))} min read`;

  const id = editingArticleId || `article-custom-${Date.now()}`;

  /* CARD BACKGROUND */
  const previousCardBgPath = editingArticleId
    ? currentCardBackgroundPath
    : null;

  let cardBgUrl = currentCardBackgroundUrl || null;
  let cardBgPath = currentCardBackgroundPath || null;
  let newlyUploadedCardBgPath = null;

  if (removeCardBackground && !pendingCardBackgroundFile) {
    cardBgUrl = null;
    cardBgPath = null;
  }

  setEditorStatus("Preparing note...");

  if (pendingCardBackgroundFile) {
    setEditorStatus("Uploading card background...");

    try {
      const uploadedBackground = await uploadCardBackground(
        pendingCardBackgroundFile,
        id,
        title,
      );

      if (!uploadedBackground) {
        throw new Error("Card background upload returned no data.");
      }

      cardBgUrl = uploadedBackground.publicUrl;
      cardBgPath = uploadedBackground.path;
      newlyUploadedCardBgPath = uploadedBackground.path;
    } catch (error) {
      console.error("Card background upload error:", error);

      return setEditorStatus(
        "Error uploading card background: " +
          (error?.message || "Unknown error"),
      );
    }
  }

  const dataApp = {
    id,
    topicId,
    topicLabel,
    topicIcon,
    title,
    excerpt,
    dateISO,
    dateDisplay,
    readTime,
    bodyHTML,
    cardBgUrl,
    cardBgPath,
  };

  const dbPayload = {
    id: dataApp.id,
    topic_id: dataApp.topicId,
    topic_label: dataApp.topicLabel,
    topic_icon: dataApp.topicIcon,
    title: dataApp.title,
    excerpt: dataApp.excerpt,
    date_iso: dataApp.dateISO,
    date_display: dataApp.dateDisplay,
    read_time: dataApp.readTime,
    body_html: dataApp.bodyHTML,
    card_bg_url: dataApp.cardBgUrl,
    card_bg_path: dataApp.cardBgPath,
  };

  setEditorStatus("Saving to database...");

  if (editingArticleId) {
    const { error } = await supabaseClient
      .from("articles")
      .update(dbPayload)
      .eq("id", editingArticleId);

    if (error) {
      if (newlyUploadedCardBgPath) {
        await deleteCardBackground(newlyUploadedCardBgPath);
      }

      return setEditorStatus("Error updating: " + error.message);
    }

    if (previousCardBgPath && previousCardBgPath !== cardBgPath) {
      await deleteCardBackground(previousCardBgPath);
    }

    const idx = globalArticlesCache.findIndex(
      (article) => article.id === editingArticleId,
    );

    if (idx > -1) globalArticlesCache.splice(idx, 1);
  } else {
    const { error } = await supabaseClient.from("articles").insert([dbPayload]);

    if (error) {
      if (newlyUploadedCardBgPath) {
        await deleteCardBackground(newlyUploadedCardBgPath);
      }

      return setEditorStatus("Error inserting: " + error.message);
    }
  }

  globalArticlesCache.push(dataApp);

  /* REMOVE OLD ARTICLE ELEMENT */
  let oldContainer = null;

  if (editingArticleId) {
    const oldElement = document.getElementById(editingArticleId);

    if (oldElement) {
      oldContainer = oldElement.closest(".carousel-container");
      oldElement.remove();
    }
  }

  /* ENSURE TOPIC + ADD CARD */
  const section = ensureTopicSection(topicId, topicLabel, topicIcon);
  const track = section.querySelector(".carousel-track");

  if (track) track.prepend(buildArticleElement(dataApp));

  /* REORDER TOPIC SECTION */
  const mainContent = document.getElementById("main-content");
  const noResultsElement = document.getElementById("noResultsElement");

  if (mainContent && noResultsElement) {
    mainContent.insertBefore(section, noResultsElement.nextSibling);
  }

  /* REORDER TOPIC LINK */
  const targetLink = document.querySelector(
    `.topic-list a[href="#${topicId}"]`,
  );

  if (targetLink) {
    const targetLi = targetLink.parentElement;
    const topicList = document.getElementById("topic-list");

    if (topicList && targetLi) topicList.prepend(targetLi);
  }

  /* REINIT CAROUSEL */
  const newContainer = section.querySelector(".carousel-container");

  if (oldContainer && oldContainer !== newContainer) {
    initSingleCarousel(oldContainer);
  }

  if (newContainer) initSingleCarousel(newContainer);

  initScrollSpy();

  currentCardBackgroundUrl = dataApp.cardBgUrl;
  currentCardBackgroundPath = dataApp.cardBgPath;
  removeCardBackground = false;
  pendingCardBackgroundFile = null;
  editingArticleId = null;

  await closeEditor();

  navigateToArticle(dataApp.id);

  setTimeout(() => {
    openArticle(dataApp.id, false);
  }, 50);
};

/* ==========================================================================
   RUNTIME STYLES (hanya untuk elemen tambahan; tidak menimpa CSS situs)
========================================================================== */

function injectRuntimeStyles() {
  if (document.getElementById("notesRuntimeStyles")) return;

  const style = document.createElement("style");

  style.id = "notesRuntimeStyles";

  style.textContent = `
    .note-image-annotation-inner { position: relative; }

    .note-image-annotation .note-annotation-layer {
      position: absolute; left: 0; top: 0; width: 100%; height: 100%;
    }

    .note-image-annotation.is-selected {
      outline: 2px solid rgba(59, 130, 246, 0.65);
      outline-offset: 2px;
    }

    .annotation-toolbar.nx-floating {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      z-index: 2147483000;
      max-width: calc(100vw - 24px);
      overflow-x: auto;
      background: #ffffff;
      color: #222222;
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
      padding: 8px 10px;
    }

    .annotation-toolbar.nx-floating .annotation-toolbar-main {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
    }

    .annotation-toolbar.nx-floating .annotation-tool-group {
      display: inline-flex; gap: 4px;
    }

    .annotation-toolbar.nx-floating .annotation-status-row {
      align-items: center; justify-content: space-between;
      gap: 12px; margin-top: 8px; font-size: 0.85rem;
    }

    .nx-list-tools {
      display: inline-flex; align-items: center; gap: 4px; margin: 0 6px;
    }

    .nx-list-tools select {
      font: inherit; font-size: 0.8rem; padding: 3px 4px;
      max-width: 120px; border-radius: 6px;
    }

    #editorBody ul, #editorBody ol { margin-top: 0.4em; margin-bottom: 0.4em; }
    #editorBody table { max-width: 100%; }
  `;

  document.head.appendChild(style);
}

/* ==========================================================================
   INIT — semua tambahan editor
========================================================================== */

function initEditorEnhancements() {
  injectRuntimeStyles();

  initToolbarFocusGuard();

  injectAnnotationLaunchButton();
  injectAnnotationToolbar();
  injectListControls();
  enhanceTableSelect();

  initAnnotationEditorBinding();
  initEditorKeyboard();
  initTableResize();

  updateAnnotationToolbar();
  updateWordCount();
}
