/* ==========================================================================
   NOTES SCRIPT — CMS EDITION (SUPABASE INTEGRATED)
   + VIEW ALL FEATURE
   + ROBUST RICH TEXT HIGHLIGHT
   + CLEAN URL ROUTING
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
  culture: {
    label: "Culture & History",
    icon: "fa-masks-theater",
  },

  sustainability: {
    label: "Sustainability",
    icon: "fa-leaf",
  },

  environment: {
    label: "Environment",
    icon: "fa-seedling",
  },

  education: {
    label: "Education",
    icon: "fa-book-open",
  },
};

/* ==========================================================================
   GLOBAL STATE
========================================================================== */

let pendingImageDataUrl = null;

let editingArticleId = null;

let globalArticlesCache = [];

let scrollSpyObserver = null;

let savedSelectionRange = null;

let lastSelectionRange = null;

let savedImageSelectionRange = null;

let currentArticleTitle = "Document";

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
   ROUTING
========================================================================== */

/**
 * Normalize pathname.
 *
 * /note/
 * becomes
 * /note
 */
function normalizePathname(pathname) {
  if (!pathname) {
    return "/";
  }

  let path = pathname;

  if (path.length > 1) {
    path = path.replace(/\/+$/, "");
  }

  return path;
}

/**
 * Convert article title to a public URL slug.
 *
 * Example:
 *
 * "Less Is More"
 * =>
 * "less-is-more"
 */
function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Get public article URL.
 *
 * Example:
 *
 * /note/less-is-more
 */
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

/**
 * Decode route component safely.
 */
function decodeRouteValue(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    console.warn("Could not decode route value:", error);

    return value;
  }
}

/**
 * Find article ID from public URL.
 *
 * /note
 * =>
 * null
 *
 * /note/less-is-more
 * =>
 * article ID
 *
 * Legacy hash route is also supported:
 *
 * /note#article-custom-123
 */
function getArticleIdFromLocation() {
  const pathname = normalizePathname(window.location.pathname);

  const base = normalizePathname(NOTE_BASE_PATH);

  /* ==========================================================
     HOMEPAGE
  =========================================================== */

  if (pathname === base) {
    const hash = window.location.hash || "";

    if (hash.startsWith("#article-")) {
      return decodeRouteValue(hash.substring(1));
    }

    return null;
  }

  /* ==========================================================
     PUBLIC ARTICLE ROUTE
  =========================================================== */

  if (pathname.startsWith(`${base}/`)) {
    const encodedSlug = pathname.substring(`${base}/`.length);

    if (!encodedSlug) {
      return null;
    }

    const slug = decodeRouteValue(encodedSlug);

    /*
       First match by slugified title.
    */
    const article = globalArticlesCache.find(
      (item) => slugify(item.title) === slug,
    );

    if (article) {
      return article.id;
    }

    /*
       Fallback:
       allow old ID-based route.
    */
    const articleById = globalArticlesCache.find((item) => item.id === slug);

    return articleById ? articleById.id : null;
  }

  return null;
}

/**
 * Navigate to article route.
 */
function navigateToArticle(articleId, replace = false) {
  if (!articleId) {
    return;
  }

  const route = getArticleRoute(articleId);

  const state = {
    type: "article",
    articleId,
  };

  if (replace) {
    window.history.replaceState(state, "", route);
  } else {
    window.history.pushState(state, "", route);
  }
}

/**
 * Navigate to public Notes homepage.
 */
function navigateToNotes(replace = false) {
  const route = NOTE_BASE_PATH;

  const state = {
    type: "notes",
  };

  if (replace) {
    window.history.replaceState(state, "", route);
  } else {
    window.history.pushState(state, "", route);
  }
}

/**
 * Hide reading overlay.
 */
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

/**
 * Execute current browser route.
 *
 * IMPORTANT:
 * This runs only AFTER Supabase
 * articles have been loaded.
 */
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

/**
 * Legacy compatibility.
 */
function checkHashForArticle() {
  handleCurrentRoute();
}

/**
 * Browser Back / Forward.
 */
window.addEventListener("popstate", () => {
  handleCurrentRoute();
});

/**
 * Legacy hash route.
 */
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
       MUST load Supabase first.
       This makes direct article URLs work.
    */
  await loadSavedArticlesIntoDom();

  initCarousels();

  initScrollSpy();

  refreshAuthUI();

  /* ------------------------------------------------------------
       DATE DEFAULT
    ------------------------------------------------------------ */

  const dateField = document.getElementById("fieldDate");

  if (dateField) {
    dateField.value = new Date().toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------
       EDITOR BODY INPUT
    ------------------------------------------------------------ */

  const editorBody = document.getElementById("editorBody");

  if (editorBody) {
    editorBody.addEventListener("input", () => {
      const sel = window.getSelection();

      if (sel && sel.rangeCount > 0) {
        const node = sel.anchorNode;

        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue;

          let newText = text;

          if (text.includes("->")) {
            newText = newText.replace("->", "→");
          }

          if (text.includes("<-")) {
            newText = newText.replace("<-", "←");
          }

          if (text.includes("=>")) {
            newText = newText.replace("=>", "⇒");
          }

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
    });
  }

  /* ------------------------------------------------------------
       SELECTION CHANGE
    ------------------------------------------------------------ */

  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();

    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return;
    }

    const range = sel.getRangeAt(0);

    const editor = document.getElementById("editorBody");

    if (!editor) {
      return;
    }

    if (editor.contains(range.commonAncestorContainer)) {
      lastSelectionRange = range.cloneRange();
    }
  });

  /* ------------------------------------------------------------
       HEADER SCROLL
    ------------------------------------------------------------ */

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
      {
        passive: true,
      },
    );
  }

  /* ------------------------------------------------------------
       INTERNAL ARTICLE LINKS
    ------------------------------------------------------------ */

  document.addEventListener("click", (event) => {
    const routeLink = event.target.closest("[data-note-route]");

    if (!routeLink) {
      return;
    }

    /*
           Preserve:
           Ctrl + Click
           Cmd + Click
           Shift + Click
           Middle click
        */
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }

    const articleId = routeLink.getAttribute("data-article-id");

    if (!articleId) {
      return;
    }

    event.preventDefault();

    openArticle(articleId, true);
  });

  /* ------------------------------------------------------------
       INITIAL ROUTE
    ------------------------------------------------------------ */

  handleCurrentRoute();
});

/* ==========================================================================
   SEARCH
========================================================================== */

window.executeNoteSearch = function () {
  const searchInput = document.getElementById("noteSearch");

  if (!searchInput) {
    return;
  }

  const filterText = searchInput.value.toLowerCase().trim();

  const noteCards = document.querySelectorAll(".ed-card");

  let totalVisible = 0;

  noteCards.forEach((card) => {
    if (card.getAttribute("aria-hidden") === "true") {
      return;
    }

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

  if (!track) {
    return;
  }

  /*
     Remove previous generated clones.
  */
  track.querySelectorAll('[aria-hidden="true"]').forEach((element) => {
    element.remove();
  });

  /*
     Clone track to remove stale events.
  */
  const freshTrack = track.cloneNode(true);

  track.replaceWith(freshTrack);

  track = freshTrack;

  const originalItems = Array.from(track.children);

  const totalOriginal = originalItems.length;

  if (totalOriginal === 0) {
    return;
  }

  const prevBtn = container.querySelector(".prev-btn");

  const nextBtn = container.querySelector(".next-btn");

  /* ------------------------------------------------------------
     SAFE CLONE
  ------------------------------------------------------------ */

  const createSafeClone = (item) => {
    const clone = item.cloneNode(true);

    clone.setAttribute("aria-hidden", "true");

    clone.removeAttribute("id");

    clone.querySelectorAll("[id]").forEach((element) => {
      element.removeAttribute("id");
    });

    return clone;
  };

  /* ------------------------------------------------------------
     PREPEND CLONES
  ------------------------------------------------------------ */

  originalItems.forEach((item) => {
    track.insertBefore(createSafeClone(item), originalItems[0]);
  });

  /* ------------------------------------------------------------
     APPEND CLONES
  ------------------------------------------------------------ */

  originalItems.forEach((item) => {
    track.appendChild(createSafeClone(item));
  });

  /* ------------------------------------------------------------
     SCROLL STEP
  ------------------------------------------------------------ */

  const getScrollStep = () => {
    if (!originalItems[0]) {
      return 0;
    }

    const itemWidth = originalItems[0].offsetWidth;

    const gap = parseFloat(getComputedStyle(track).gap) || 32;

    return itemWidth + gap;
  };

  /* ------------------------------------------------------------
     INITIAL POSITION
  ------------------------------------------------------------ */

  setTimeout(() => {
    const step = getScrollStep();

    if (!step) {
      return;
    }

    track.style.scrollBehavior = "auto";

    track.scrollLeft = totalOriginal * step;

    requestAnimationFrame(() => {
      track.style.scrollBehavior = "";
    });
  }, 100);

  /* ------------------------------------------------------------
     INFINITE LOOP
  ------------------------------------------------------------ */

  let scrollTimeout = null;

  track.addEventListener("scroll", () => {
    const step = getScrollStep();

    if (!step) {
      return;
    }

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

  /* ------------------------------------------------------------
     ARROW CONTROL
  ------------------------------------------------------------ */

  const scrollByArrow = (direction) => {
    const step = getScrollStep();

    if (!step) {
      return;
    }

    track.scrollBy({
      left: direction * step,
      behavior: "smooth",
    });
  };

  if (prevBtn) {
    const newPrev = prevBtn.cloneNode(true);

    prevBtn.replaceWith(newPrev);

    newPrev.addEventListener("click", () => {
      scrollByArrow(-1);
    });
  }

  if (nextBtn) {
    const newNext = nextBtn.cloneNode(true);

    nextBtn.replaceWith(newNext);

    newNext.addEventListener("click", () => {
      scrollByArrow(1);
    });
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

  /* ------------------------------------------------------------
       ACTIVE TOPIC
    ------------------------------------------------------------ */

  const parentSection = article.closest(".topic-section");

  if (parentSection) {
    const topicId = parentSection.getAttribute("id");

    document.querySelectorAll(".topic-list a").forEach((link) => {
      link.classList.remove("active");
    });

    const activeLink = document.querySelector(
      `.topic-list a[href="#${topicId}"]`,
    );

    if (activeLink) {
      activeLink.classList.add("active");
    }
  }

  /* ------------------------------------------------------------
       CONTENT CLONE
    ------------------------------------------------------------ */

  const contentToExport = document.getElementById(`content-${articleId}`);

  const modalContent = document.getElementById("reading-content-area");

  if (!contentToExport || !modalContent) {
    return;
  }

  const clone = contentToExport.cloneNode(true);

  const excerptEl = clone.querySelector(".ed-excerpt");

  if (excerptEl) {
    excerptEl.remove();
  }

  modalContent.innerHTML = clone.innerHTML;

  /* ------------------------------------------------------------
       CURRENT TITLE
    ------------------------------------------------------------ */

  const titleEl = modalContent.querySelector(".ed-title");

  if (titleEl) {
    currentArticleTitle = titleEl.innerText.trim();
  }

  /* ------------------------------------------------------------
       DESCRIPTION
    ------------------------------------------------------------ */

  const excerptText = article.querySelector(".ed-excerpt p")?.textContent || "";

  const articleUrl = new URL(getArticleRoute(articleId), window.location.origin)
    .href;

  updateSeoMetaTags(currentArticleTitle, excerptText, articleUrl, articleId);

  /* ------------------------------------------------------------
       OPEN MODAL
    ------------------------------------------------------------ */

  const readingOverlay = document.getElementById("reading-overlay");

  if (readingOverlay) {
    readingOverlay.classList.add("active");
  }

  document.body.style.overflow = "hidden";

  const exportDropdown = document.getElementById("exportDropdown");

  if (exportDropdown) {
    exportDropdown.classList.remove("show");
  }

  /* ------------------------------------------------------------
       RESET SCROLL
    ------------------------------------------------------------ */

  window.scrollTo({
    top: 0,
    behavior: "auto",
  });

  if (modalContent) {
    modalContent.scrollTop = 0;
  }

  /* ------------------------------------------------------------
       PUBLIC ROUTE
    ------------------------------------------------------------ */

  if (updateRoute) {
    navigateToArticle(articleId);
  }
};

/* ==========================================================================
   SEO META
========================================================================== */

function updateSeoMetaTags(title, description, articleUrl, articleId = null) {
  const cleanDescription = String(description || "")
    .replace(/\s+/g, " ")
    .trim();

  const fullTitle = `${title} | AWS Archive`;

  const url =
    articleUrl || new URL(NOTE_BASE_PATH, window.location.origin).href;

  const pageTitle = document.getElementById("page-title");

  const metaTitle = document.getElementById("meta-title");

  const metaDescription = document.getElementById("meta-description");

  const canonical = document.getElementById("canonical-url");

  const ogType = document.getElementById("og-type");

  const ogUrl = document.getElementById("og-url");

  const ogTitle = document.getElementById("og-title");

  const ogDescription = document.getElementById("og-description");

  const twitterUrl = document.getElementById("twitter-url");

  const twitterTitle = document.getElementById("twitter-title");

  const twitterDescription = document.getElementById("twitter-description");

  const structuredData = document.getElementById("structured-data");

  if (pageTitle) {
    pageTitle.textContent = fullTitle;
  }

  if (metaTitle) {
    metaTitle.content = fullTitle;
  }

  if (metaDescription) {
    metaDescription.content = cleanDescription || DEFAULT_DESCRIPTION;
  }

  if (canonical) {
    canonical.href = url;
  }

  if (ogType) {
    ogType.content = articleId ? "article" : "website";
  }

  if (ogUrl) {
    ogUrl.content = url;
  }

  if (ogTitle) {
    ogTitle.content = fullTitle;
  }

  if (ogDescription) {
    ogDescription.content = cleanDescription || DEFAULT_DESCRIPTION;
  }

  if (twitterUrl) {
    twitterUrl.content = url;
  }

  if (twitterTitle) {
    twitterTitle.content = fullTitle;
  }

  if (twitterDescription) {
    twitterDescription.content = cleanDescription || DEFAULT_DESCRIPTION;
  }

  if (structuredData) {
    const schema = articleId
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: title,
          name: title,
          description: cleanDescription || DEFAULT_DESCRIPTION,
          url,
          identifier: articleId,
          author: {
            "@type": "Person",
            name: "Alvin Wildan Sahli",
          },
        }
      : {
          "@context": "https://schema.org",
          "@type": "Blog",
          name: DEFAULT_PAGE_TITLE,
          url,
          description: DEFAULT_DESCRIPTION,
          author: {
            "@type": "Person",
            name: "Alvin Wildan Sahli",
          },
        };

    structuredData.textContent = JSON.stringify(schema);
  }
}

/* ==========================================================================
   RESTORE DEFAULT SEO
========================================================================== */

function restoreDefaultSeoMetaTags() {
  const baseUrl = new URL(NOTE_BASE_PATH, window.location.origin).href;

  const pageTitle = document.getElementById("page-title");

  const metaTitle = document.getElementById("meta-title");

  const metaDescription = document.getElementById("meta-description");

  const canonical = document.getElementById("canonical-url");

  const ogType = document.getElementById("og-type");

  const ogUrl = document.getElementById("og-url");

  const ogTitle = document.getElementById("og-title");

  const ogDescription = document.getElementById("og-description");

  const twitterUrl = document.getElementById("twitter-url");

  const twitterTitle = document.getElementById("twitter-title");

  const twitterDescription = document.getElementById("twitter-description");

  const structuredData = document.getElementById("structured-data");

  if (pageTitle) {
    pageTitle.textContent = DEFAULT_PAGE_TITLE;
  }

  if (metaTitle) {
    metaTitle.content = DEFAULT_PAGE_TITLE;
  }

  if (metaDescription) {
    metaDescription.content = DEFAULT_DESCRIPTION;
  }

  if (canonical) {
    canonical.href = baseUrl;
  }

  if (ogType) {
    ogType.content = "website";
  }

  if (ogUrl) {
    ogUrl.content = baseUrl;
  }

  if (ogTitle) {
    ogTitle.content = DEFAULT_PAGE_TITLE;
  }

  if (ogDescription) {
    ogDescription.content = DEFAULT_DESCRIPTION;
  }

  if (twitterUrl) {
    twitterUrl.content = baseUrl;
  }

  if (twitterTitle) {
    twitterTitle.content = DEFAULT_PAGE_TITLE;
  }

  if (twitterDescription) {
    twitterDescription.content = DEFAULT_DESCRIPTION;
  }

  if (structuredData) {
    structuredData.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Blog",
      name: DEFAULT_PAGE_TITLE,
      url: baseUrl,
      description: DEFAULT_DESCRIPTION,
      author: {
        "@type": "Person",
        name: "Alvin Wildan Sahli",
      },
    });
  }
}

/* ==========================================================================
   CLOSE ARTICLE
========================================================================== */

window.closeArticle = function () {
  /*
       Replace instead of push:
       prevents duplicate /note entries in history.
    */
  navigateToNotes(true);

  hideReadingOverlay();
};

/* ==========================================================================
   EXPORT MENU
========================================================================== */

window.toggleExportMenu = function () {
  const dropdown = document.getElementById("exportDropdown");

  if (!dropdown) {
    return;
  }

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
   SHARE
========================================================================== */

window.shareLink = function (platform) {
  const url = encodeURIComponent(window.location.href);

  const title = encodeURIComponent(currentArticleTitle);

  if (platform === "wa") {
    const whatsappUrl = `https://api.whatsapp.com/send?text=*${title}*%0A${url}`;

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  } else if (platform === "x") {
    const xUrl = `https://twitter.com/intent/tweet?text=${title}&url=${url}`;

    window.open(xUrl, "_blank", "noopener,noreferrer");
  }

  const dropdown = document.getElementById("exportDropdown");

  if (dropdown) {
    dropdown.classList.remove("show");
  }
};

/* ==========================================================================
   COPY LINK
========================================================================== */

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

  if (dropdown) {
    dropdown.classList.remove("show");
  }
};

/* ==========================================================================
   DOWNLOAD / EXPORT
========================================================================== */

window.downloadNote = function (format) {
  const dropdown = document.getElementById("exportDropdown");

  if (dropdown) {
    dropdown.classList.remove("show");
  }

  const originalElement = document.getElementById("reading-content-area");

  if (!originalElement) {
    return;
  }

  const filename = currentArticleTitle
    .substring(0, 30)
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();

  /* ==============================================================
       PDF / PNG
    ============================================================== */

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

    const exportClone = originalElement.cloneNode(true);

    hiddenContainer.appendChild(exportClone);

    document.body.appendChild(hiddenContainer);

    /* ----------------------------------------------------------
         PDF
      ---------------------------------------------------------- */

    if (format === "pdf") {
      const opt = {
        margin: 1,

        filename: `${filename}.pdf`,

        image: {
          type: "jpeg",
          quality: 0.98,
        },

        html2canvas: {
          scale: 2,
          useCORS: true,
          windowWidth: 800,
        },

        jsPDF: {
          unit: "in",
          format: "a4",
          orientation: "portrait",
        },

        pagebreak: {
          mode: ["avoid-all", "css", "legacy"],
        },
      };

      setTimeout(() => {
        if (typeof html2pdf !== "function") {
          console.error("html2pdf library is unavailable.");

          document.body.removeChild(hiddenContainer);

          return;
        }

        html2pdf()
          .set(opt)
          .from(hiddenContainer)
          .save()
          .then(() => {
            if (document.body.contains(hiddenContainer)) {
              document.body.removeChild(hiddenContainer);
            }
          })
          .catch((error) => {
            console.error("PDF export failed:", error);

            if (document.body.contains(hiddenContainer)) {
              document.body.removeChild(hiddenContainer);
            }
          });
      }, 300);

      return;
    }

    /* ----------------------------------------------------------
         PNG
      ---------------------------------------------------------- */

    hiddenContainer.style.padding = "40px";

    setTimeout(() => {
      if (typeof html2canvas !== "function") {
        console.error("html2canvas library is unavailable.");

        document.body.removeChild(hiddenContainer);

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

          if (document.body.contains(hiddenContainer)) {
            document.body.removeChild(hiddenContainer);
          }
        })
        .catch((error) => {
          console.error("PNG export failed:", error);

          if (document.body.contains(hiddenContainer)) {
            document.body.removeChild(hiddenContainer);
          }
        });
    }, 300);

    return;
  }

  /* ==============================================================
       WORD
    ============================================================== */

  if (format === "word") {
    const exportClone = originalElement.cloneNode(true);

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

              div.WordSection1 {
                page: WordSection1;
              }

              table {
                border-collapse: collapse;
                width: 100%;
                margin-bottom: 1rem;
              }

              table,
              th,
              td {
                border: 1px solid black;
                padding: 8px;
              }

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
};

/* ==========================================================================
   LANGUAGE
========================================================================== */

window.switchLanguage = function (lang) {
  if (lang !== "en" && lang !== "id") {
    return;
  }

  document.querySelectorAll(".translatable").forEach((element) => {
    const translatedText = element.getAttribute(`data-${lang}`);

    if (translatedText === null) {
      return;
    }

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

  if (activeButton) {
    activeButton.classList.add("active");
  }

  localStorage.setItem("language", lang);

  document.documentElement.lang = lang;
};

/* ==========================================================================
   VIEW ALL
========================================================================== */

window.toggleViewAll = function (topicSlug) {
  const section = document.getElementById(topicSlug);

  if (!section) {
    return;
  }

  const isViewAll = section.classList.toggle("view-all-mode");

  const btnText = section.querySelector(".btn-text");

  const btnIcon = section.querySelector(".see-all-btn i");

  if (isViewAll) {
    if (btnText) {
      btnText.setAttribute("data-en", "Collapse");

      btnText.setAttribute("data-id", "Tutup Layar");
    }

    if (btnIcon) {
      btnIcon.className = "fa-solid fa-compress";
    }
  } else {
    if (btnText) {
      btnText.setAttribute("data-en", "See All");

      btnText.setAttribute("data-id", "Lihat Semua");
    }

    if (btnIcon) {
      btnIcon.className = "fa-solid fa-expand";
    }
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
  if (scrollSpyObserver) {
    scrollSpyObserver.disconnect();
  }

  const sections = document.querySelectorAll(".topic-section");

  if (sections.length === 0) {
    return;
  }

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const currentId = entry.target.getAttribute("id");

        document.querySelectorAll(".topic-list a").forEach((link) => {
          link.classList.remove("active");
        });

        const activeLink = document.querySelector(
          `.topic-list a[href="#${currentId}"]`,
        );

        if (activeLink) {
          activeLink.classList.add("active");
        }
      });
    },
    {
      root: null,
      rootMargin: "-25% 0px -70% 0px",
      threshold: 0,
    },
  );

  sections.forEach((section) => {
    scrollSpyObserver.observe(section);
  });
}

/* ==========================================================================
   SHA-256
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

/* ==========================================================================
   AUTH
========================================================================== */

function isOwnerLoggedIn() {
  return localStorage.getItem(AUTH_KEY) === "true";
}

function refreshAuthUI() {
  const loggedIn = isOwnerLoggedIn();

  const loginBtn = document.getElementById("loginTriggerBtn");

  const writeBtn = document.getElementById("writeTriggerBtn");

  const logoutBtn = document.getElementById("logoutTriggerBtn");

  if (loginBtn) {
    loginBtn.style.display = loggedIn ? "none" : "inline-flex";
  }

  if (writeBtn) {
    writeBtn.style.display = loggedIn ? "inline-flex" : "none";
  }

  if (logoutBtn) {
    logoutBtn.style.display = loggedIn ? "inline-flex" : "none";
  }

  document.querySelectorAll(".ed-manage").forEach((element) => {
    element.style.display = loggedIn ? "flex" : "none";
  });
}

/* ==========================================================================
   LOGIN
========================================================================== */

window.openLogin = function () {
  const overlay = document.getElementById("login-overlay");

  const error = document.getElementById("loginError");

  const password = document.getElementById("ownerPassword");

  if (overlay) {
    overlay.classList.add("active");
  }

  if (error) {
    error.style.display = "none";
  }

  if (password) {
    password.value = "";
  }

  document.body.style.overflow = "hidden";
};

window.closeLogin = function () {
  const overlay = document.getElementById("login-overlay");

  if (overlay) {
    overlay.classList.remove("active");
  }

  document.body.style.overflow = "auto";
};

window.handleLogin = async function (event) {
  event.preventDefault();

  const password = document.getElementById("ownerPassword");

  if (!password) {
    return false;
  }

  const pw = password.value;

  const hash = await sha256Hex(pw);

  if (hash === OWNER_PASSWORD_HASH) {
    localStorage.setItem(AUTH_KEY, "true");

    closeLogin();

    refreshAuthUI();
  } else {
    const error = document.getElementById("loginError");

    if (error) {
      error.style.display = "block";
    }
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
    .order("date_iso", {
      ascending: false,
    });

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
  }));

  return globalArticlesCache;
}

/* ==========================================================================
   ESCAPE HTML
========================================================================== */

function escapeHtml(str) {
  const div = document.createElement("div");

  div.textContent = str ?? "";

  return div.innerHTML;
}

/* ==========================================================================
   ENSURE TOPIC SECTION
========================================================================== */

function ensureTopicSection(topicSlug, topicLabel, iconClass) {
  let section = document.getElementById(topicSlug);

  if (section) {
    return section;
  }

  section = document.createElement("section");

  section.id = topicSlug;

  section.className = "topic-section";

  const currentLang = document.documentElement.lang || "en";

  const btnText = currentLang === "id" ? "Lihat Semua" : "See All";

  section.innerHTML = `
    <div class="topic-header-wrapper">

      <h2 class="topic-heading">
        ${escapeHtml(topicLabel)}
      </h2>

      <button
        class="see-all-btn"
        onclick="toggleViewAll('${escapeHtml(topicSlug)}')"
        type="button"
      >

        <i class="fa-solid fa-expand"></i>

        <span
          class="btn-text translatable"
          data-en="See All"
          data-id="Lihat Semua"
        >
          ${btnText}
        </span>

      </button>

    </div>

    <div class="carousel-container">

      <button
        class="carousel-btn prev-btn"
        type="button"
        aria-label="Previous"
      >
        <i class="fa-solid fa-chevron-left"></i>
      </button>

      <div class="carousel-viewport">

        <div class="carousel-track"></div>

      </div>

      <button
        class="carousel-btn next-btn"
        type="button"
        aria-label="Next"
      >
        <i class="fa-solid fa-chevron-right"></i>
      </button>

    </div>
  `;

  const mainContent = document.getElementById("main-content");

  if (mainContent) {
    mainContent.appendChild(section);
  }

  /* ------------------------------------------------------------
     TOPIC LIST
  ------------------------------------------------------------ */

  const topicList = document.getElementById("topic-list");

  if (topicList) {
    const li = document.createElement("li");

    li.innerHTML = `
      <a href="#${escapeHtml(topicSlug)}">

        <i
          class="fa-solid ${iconClass || "fa-tag"}"
        ></i>

        ${escapeHtml(topicLabel)}

      </a>
    `;

    topicList.appendChild(li);
  }

  return section;
}

/* ==========================================================================
   BUILD ARTICLE
========================================================================== */

function buildArticleElement(data) {
  const article = document.createElement("article");

  article.className = "ed-card";

  article.id = data.id;

  const articleRoute = getArticleRoute(data.id);

  article.innerHTML = `

    <div
      class="export-content"
      id="content-${escapeHtml(data.id)}"
    >

      <div class="ed-meta">

        ${escapeHtml(data.dateDisplay || "")}

        •

        <span class="read-time">
          ${escapeHtml(data.readTime || "")}
        </span>

      </div>

      <h3 class="ed-title">
        ${escapeHtml(data.title || "")}
      </h3>

      <div class="ed-excerpt">

        <p>
          ${escapeHtml(data.excerpt || "")}
        </p>

      </div>

      <div class="ed-full-text">
        ${data.bodyHTML || ""}
      </div>

    </div>

    <div class="ed-actions">

      <a
        class="ed-btn"
        href="${articleRoute}"
        data-note-route="true"
        data-article-id="${escapeHtml(data.id)}"
      >
        Open Note
      </a>

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
        >

          <i
            class="fa-solid fa-pen"
          ></i>

        </button>

        <button
          class="ed-manage-btn"
          type="button"
          onclick="deleteArticle('${escapeHtml(data.id)}')"
          title="Delete"
          aria-label="Delete"
        >

          <i
            class="fa-solid fa-trash"
          ></i>

        </button>

      </div>

    </div>
  `;

  return article;
}

/* ==========================================================================
   LOAD ARTICLES
========================================================================== */

async function loadSavedArticlesIntoDom() {
  const topicList = document.getElementById("topic-list");

  if (topicList) {
    topicList.innerHTML = "";
  }

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

    if (track) {
      track.appendChild(buildArticleElement(data));
    }
  });

  const firstLink = document.querySelector(".topic-list a");

  if (firstLink) {
    firstLink.classList.add("active");
  }
}

/* ==========================================================================
   OPEN EDITOR
========================================================================== */

window.openEditor = function () {
  if (!isOwnerLoggedIn()) {
    openLogin();

    return;
  }

  editingArticleId = null;

  document.getElementById("editorHeading").textContent = "Write a New Note";

  document.getElementById("publishBtnLabel").textContent = "Publish";

  document.getElementById("fieldTitle").value = "";

  document.getElementById("fieldExcerpt").value = "";

  document.getElementById("fieldTopicSelect").value = "sustainability";

  document.getElementById("newTopicGroup").style.display = "none";

  document.getElementById("fieldNewTopicName").value = "";

  document.getElementById("fieldNewTopicIcon").value = "fa-lightbulb";

  document.getElementById("fieldDate").value = new Date()
    .toISOString()
    .slice(0, 10);

  document.getElementById("editorBody").innerHTML = "";

  document.getElementById("editorStatus").textContent = "";

  clearSavedSelection();

  updateWordCount();

  document.getElementById("editor-overlay").classList.add("active");

  document.body.style.overflow = "hidden";
};

/* ==========================================================================
   CLOSE EDITOR
========================================================================== */

window.closeEditor = function () {
  const overlay = document.getElementById("editor-overlay");

  if (overlay) {
    overlay.classList.remove("active");
  }

  document.body.style.overflow = "auto";

  cancelPendingImage();

  clearSavedSelection();
};

/* ==========================================================================
   TOPIC CHANGE
========================================================================== */

window.handleTopicSelectChange = function () {
  const select = document.getElementById("fieldTopicSelect");

  const group = document.getElementById("newTopicGroup");

  if (!select || !group) {
    return;
  }

  group.style.display = select.value === "__new__" ? "block" : "none";
};

/* ==========================================================================
   TOOLBAR BASIC COMMANDS
========================================================================== */

window.execToolbar = function (command) {
  const body = document.getElementById("editorBody");

  if (!body) {
    return;
  }

  body.focus();

  document.execCommand(command, false, null);

  updateWordCount();
};

/* ==========================================================================
   LINK
========================================================================== */

window.triggerLinkInsert = function () {
  const url = prompt("Enter URL:", "https://");

  if (!url) {
    return;
  }

  restoreSelection();

  const body = document.getElementById("editorBody");

  if (!body) {
    return;
  }

  body.focus();

  document.execCommand("createLink", false, url);

  updateWordCount();
};

/* ==========================================================================
   WORD COUNT
========================================================================== */

function updateWordCount() {
  const body = document.getElementById("editorBody");

  const text = body ? body.textContent.trim() : "";

  const words = text.length ? text.split(/\s+/).length : 0;

  const minutes = Math.max(1, Math.round(words / 200));

  const element = document.getElementById("tbWordCount");

  if (element) {
    element.textContent = `${words} words • ~${minutes} min read`;
  }
}

/* ==========================================================================
   SELECTION MANAGEMENT
========================================================================== */

window.saveSelection = function () {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);

  const editor = document.getElementById("editorBody");

  if (!editor) {
    return;
  }

  if (!editor.contains(range.commonAncestorContainer)) {
    return;
  }

  lastSelectionRange = range.cloneRange();

  savedSelectionRange = range.cloneRange();
};

function restoreSelection() {
  const editor = document.getElementById("editorBody");

  if (!editor) {
    return false;
  }

  const range = lastSelectionRange || savedSelectionRange;

  if (!range) {
    return false;
  }

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

      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      if (parent.closest("script, style, template")) {
        return NodeFilter.FILTER_REJECT;
      }

      try {
        if (range.intersectsNode(node)) {
          return NodeFilter.FILTER_ACCEPT;
        }
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

  if (startAncestor && startAncestor === endAncestor) {
    return startAncestor;
  }

  const commonAncestor = range.commonAncestorContainer;

  const commonElement =
    commonAncestor.nodeType === Node.TEXT_NODE
      ? commonAncestor.parentElement
      : commonAncestor;

  const closest = commonElement?.closest?.(".journal-highlight");

  if (closest && editor.contains(closest)) {
    return closest;
  }

  return null;
}

function unwrapHighlight(highlight) {
  if (!highlight) {
    return;
  }

  const parent = highlight.parentNode;

  if (!parent) {
    return;
  }

  while (highlight.firstChild) {
    parent.insertBefore(highlight.firstChild, highlight);
  }

  parent.removeChild(highlight);

  parent.normalize();
}

window.applyCustomHighlight = function () {
  const editor = document.getElementById("editorBody");

  if (!editor) {
    return;
  }

  if (!restoreSelection()) {
    return;
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) {
    return;
  }

  if (!range.toString().trim()) {
    return;
  }

  /* ----------------------------------------------------------
       TOGGLE OFF EXISTING HIGHLIGHT
    ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
       APPLY HIGHLIGHT
    ---------------------------------------------------------- */

  const textNodes = getTextNodesInRange(range, editor);

  if (textNodes.length === 0) {
    return;
  }

  const createdHighlights = [];

  for (let i = textNodes.length - 1; i >= 0; i--) {
    const textNode = textNodes[i];

    let startOffset = 0;

    let endOffset = textNode.nodeValue.length;

    if (textNode === range.startContainer) {
      startOffset = range.startOffset;
    }

    if (textNode === range.endContainer) {
      endOffset = range.endOffset;
    }

    if (endOffset <= startOffset) {
      continue;
    }

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

  if (createdHighlights.length === 0) {
    return;
  }

  const lastHighlight = createdHighlights[0];

  const cursorRange = document.createRange();

  cursorRange.setStartAfter(lastHighlight);

  cursorRange.collapse(true);

  selection.removeAllRanges();

  selection.addRange(cursorRange);

  lastSelectionRange = cursorRange.cloneRange();

  savedSelectionRange = cursorRange.cloneRange();

  updateWordCount();
};

/* ==========================================================================
   IMAGE INSERT
========================================================================== */

window.triggerImageInsert = function () {
  const body = document.getElementById("editorBody");

  if (!body) {
    return;
  }

  body.focus();

  const selection = window.getSelection();

  if (selection && selection.rangeCount > 0) {
    savedImageSelectionRange = selection.getRangeAt(0).cloneRange();
  }

  const input = document.getElementById("imageFileInput");

  if (input) {
    input.click();
  }
};

window.handleImageFileChosen = function (event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    alert("Please select a valid image file.");

    event.target.value = "";

    return;
  }

  const reader = new FileReader();

  reader.onload = (loadEvent) => {
    pendingImageDataUrl = loadEvent.target.result;

    const picker = document.getElementById("imageStylePicker");

    if (picker) {
      picker.style.display = "flex";
    }
  };

  reader.onerror = () => {
    console.error("Failed to read image file.");

    pendingImageDataUrl = null;
  };

  reader.readAsDataURL(file);

  event.target.value = "";
};

window.insertPendingImage = function (styleClass) {
  if (!pendingImageDataUrl) {
    return;
  }

  const body = document.getElementById("editorBody");

  if (!body) {
    return;
  }

  body.focus();

  const selection = window.getSelection();

  selection.removeAllRanges();

  if (savedImageSelectionRange) {
    try {
      selection.addRange(savedImageSelectionRange.cloneRange());
    } catch (error) {
      console.warn("Could not restore image insertion selection:", error);
    }
  }

  const imgHtml = `
      <img
        class="note-img ${escapeHtml(styleClass)}"
        src="${pendingImageDataUrl}"
        alt=""
      />
    `;

  document.execCommand("insertHTML", false, imgHtml);

  cancelPendingImage();

  updateWordCount();
};

window.cancelPendingImage = function () {
  pendingImageDataUrl = null;

  savedImageSelectionRange = null;

  const picker = document.getElementById("imageStylePicker");

  if (picker) {
    picker.style.display = "none";
  }
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

  document.getElementById("editorHeading").textContent = "Edit Note";

  document.getElementById("publishBtnLabel").textContent = "Save changes";

  document.getElementById("fieldTitle").value = data.title;

  document.getElementById("fieldExcerpt").value = data.excerpt;

  document.getElementById("fieldDate").value = data.dateISO;

  document.getElementById("editorBody").innerHTML = data.bodyHTML;

  const topicSelect = document.getElementById("fieldTopicSelect");

  const isStatic = !!TOPIC_CONFIG[data.topicId];

  if (isStatic) {
    topicSelect.value = data.topicId;

    document.getElementById("newTopicGroup").style.display = "none";
  } else {
    topicSelect.value = "__new__";

    document.getElementById("newTopicGroup").style.display = "block";

    document.getElementById("fieldNewTopicName").value = data.topicLabel;

    document.getElementById("fieldNewTopicIcon").value =
      data.topicIcon || "fa-lightbulb";
  }

  clearSavedSelection();

  updateWordCount();

  document.getElementById("editorStatus").textContent = "";

  document.getElementById("editor-overlay").classList.add("active");

  document.body.style.overflow = "hidden";
};

/* ==========================================================================
   DELETE ARTICLE
========================================================================== */

window.deleteArticle = async function (articleId) {
  if (!isOwnerLoggedIn()) {
    return;
  }

  if (!confirm("Delete this note? This cannot be undone.")) {
    return;
  }

  const { error } = await supabaseClient
    .from("articles")
    .delete()
    .eq("id", articleId);

  if (error) {
    alert("Failed to delete: " + error.message);

    return;
  }

  globalArticlesCache = globalArticlesCache.filter(
    (article) => article.id !== articleId,
  );

  const element = document.getElementById(articleId);

  const container = element ? element.closest(".carousel-container") : null;

  if (element) {
    element.remove();
  }

  if (container) {
    initSingleCarousel(container);
  }

  initScrollSpy();

  const currentRouteId = getArticleIdFromLocation();

  if (currentRouteId === articleId) {
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

  const body = document.getElementById("editorBody");

  const bodyHTML = body ? body.innerHTML.trim() : "";

  const topicSelectVal = document.getElementById("fieldTopicSelect").value;

  if (!title) {
    return setEditorStatus("Please add a title.");
  }

  if (!excerpt) {
    return setEditorStatus("Please add a short excerpt.");
  }

  if (!bodyHTML || bodyHTML === "<br>") {
    return setEditorStatus("Please write the note body.");
  }

  /* ------------------------------------------------------------
       TOPIC
    ------------------------------------------------------------ */

  let topicId;

  let topicLabel;

  let topicIcon;

  if (topicSelectVal === "__new__") {
    const newName = document.getElementById("fieldNewTopicName").value.trim();

    if (!newName) {
      return setEditorStatus("Please name the new topic.");
    }

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

  /* ------------------------------------------------------------
       DATE
    ------------------------------------------------------------ */

  const dateObj = dateISO ? new Date(dateISO + "T00:00:00") : new Date();

  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });

  /* ------------------------------------------------------------
       WORD COUNT
    ------------------------------------------------------------ */

  const text = body?.textContent?.trim() || "";

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const readTime = `${Math.max(1, Math.round(wordCount / 200))} min read`;

  /* ------------------------------------------------------------
       INTERNAL ID
    ------------------------------------------------------------ */

  const id = editingArticleId || `article-custom-${Date.now()}`;

  /* ------------------------------------------------------------
       APP DATA
    ------------------------------------------------------------ */

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
  };

  /* ------------------------------------------------------------
       DATABASE PAYLOAD
    ------------------------------------------------------------ */

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
  };

  setEditorStatus("Saving to database...");

  /* ==========================================================
       UPDATE
    =========================================================== */

  if (editingArticleId) {
    const { error } = await supabaseClient
      .from("articles")
      .update(dbPayload)
      .eq("id", editingArticleId);

    if (error) {
      return setEditorStatus("Error updating: " + error.message);
    }

    const idx = globalArticlesCache.findIndex(
      (article) => article.id === editingArticleId,
    );

    if (idx > -1) {
      globalArticlesCache.splice(idx, 1);
    }
  } else {
    const { error } = await supabaseClient.from("articles").insert([dbPayload]);

    if (error) {
      return setEditorStatus("Error inserting: " + error.message);
    }
  }

  /* ------------------------------------------------------------
       CACHE
    ------------------------------------------------------------ */

  globalArticlesCache.push(dataApp);

  /* ------------------------------------------------------------
       REMOVE OLD ARTICLE
    ------------------------------------------------------------ */

  let oldContainer = null;

  if (editingArticleId) {
    const oldElement = document.getElementById(editingArticleId);

    if (oldElement) {
      oldContainer = oldElement.closest(".carousel-container");

      oldElement.remove();
    }
  }

  /* ------------------------------------------------------------
       ENSURE TOPIC
    ------------------------------------------------------------ */

  const section = ensureTopicSection(topicId, topicLabel, topicIcon);

  const track = section.querySelector(".carousel-track");

  if (track) {
    track.prepend(buildArticleElement(dataApp));
  }

  /* ------------------------------------------------------------
       REORDER TOPIC SECTION
    ------------------------------------------------------------ */

  const mainContent = document.getElementById("main-content");

  const noResultsElement = document.getElementById("noResultsElement");

  if (mainContent && noResultsElement) {
    mainContent.insertBefore(section, noResultsElement.nextSibling);
  }

  /* ------------------------------------------------------------
       REORDER TOPIC LINK
    ------------------------------------------------------------ */

  const targetLink = document.querySelector(
    `.topic-list a[href="#${topicId}"]`,
  );

  if (targetLink) {
    const targetLi = targetLink.parentElement;

    const topicList = document.getElementById("topic-list");

    if (topicList && targetLi) {
      topicList.prepend(targetLi);
    }
  }

  /* ------------------------------------------------------------
       REINIT CAROUSEL
    ------------------------------------------------------------ */

  if (
    oldContainer &&
    oldContainer !== section.querySelector(".carousel-container")
  ) {
    initSingleCarousel(oldContainer);
  }

  const newContainer = section.querySelector(".carousel-container");

  if (newContainer) {
    initSingleCarousel(newContainer);
  }

  initScrollSpy();

  editingArticleId = null;

  closeEditor();

  /*
       New public URL is generated
       from article title.
    */
  navigateToArticle(dataApp.id);

  /*
       Open article after publish/update.
    */
  setTimeout(() => {
    openArticle(dataApp.id, false);
  }, 50);
};

/* ==========================================================================
   EDITOR STATUS
========================================================================== */

function setEditorStatus(message) {
  const element = document.getElementById("editorStatus");

  if (element) {
    element.textContent = message;
  }
}

/* ==========================================================================
   BLOCK TYPE
========================================================================== */

window.applyBlockType = function (tag) {
  if (!tag) {
    return;
  }

  restoreSelection();

  document.execCommand("formatBlock", false, tag);

  updateWordCount();
};

/* ==========================================================================
   FONT
========================================================================== */

/* ==========================================================================
   FONT — ROBUST VERSION
   Supports:
   - Google Fonts
   - CSS font stacks
   - Existing <font face="">
   - Inline span styles
========================================================================== */

const FONT_FAMILY_MAP = {
  /* ------------------------------------------------------------
     CLASSIC
  ------------------------------------------------------------ */

  "'Playfair Display', 'Georgia', serif": "'Playfair Display', Georgia, serif",

  "Playfair Display": "'Playfair Display', Georgia, serif",

  /* ------------------------------------------------------------
     MODERN
  ------------------------------------------------------------ */

  "'Inter', -apple-system, sans-serif":
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",

  Inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",

  /* ------------------------------------------------------------
     MONOSPACE
  ------------------------------------------------------------ */

  "'JetBrains Mono', monospace": "'JetBrains Mono', monospace",

  "JetBrains Mono": "'JetBrains Mono', monospace",

  /* ------------------------------------------------------------
     HANDWRITING
  ------------------------------------------------------------ */

  "'Cedarville Cursive', cursive": "'Cedarville Cursive', cursive",

  "Cedarville Cursive": "'Cedarville Cursive', cursive",

  "'Dancing Script', cursive": "'Dancing Script', cursive",

  "Dancing Script": "'Dancing Script', cursive",

  "'Caveat', cursive": "'Caveat', cursive",

  Caveat: "'Caveat', cursive",
};

/* ==========================================================================
   NORMALIZE FONT VALUE
========================================================================== */

function normalizeFontFamily(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  return FONT_FAMILY_MAP[raw] || raw;
}

/* ==========================================================================
   EXTRACT PRIMARY FONT NAME
   document.execCommand("fontName") works more reliably with
   the actual font family name rather than a complete CSS stack.
========================================================================== */

function getPrimaryFontName(fontStack) {
  const value = String(fontStack || "").trim();

  if (!value) {
    return "";
  }

  /*
     Extract first font family from:

     "'Cedarville Cursive', cursive"
     =>
     Cedarville Cursive
  */

  const firstPart = value.split(",")[0].trim();

  return firstPart.replace(/^["']|["']$/g, "").trim();
}

/* ==========================================================================
   CONVERT LEGACY <FONT FACE=""> TO INLINE STYLE
========================================================================== */

function normalizeLegacyFontTags(editor) {
  if (!editor) {
    return;
  }

  editor.querySelectorAll("font[face]").forEach((fontElement) => {
    const face = fontElement.getAttribute("face");

    if (!face) {
      return;
    }

    const normalized = normalizeFontFamily(face);

    fontElement.style.fontFamily = normalized;

    /*
       Preserve the text/content but remove old
       presentational <font> dependency.
    */

    const span = document.createElement("span");

    span.style.fontFamily = normalized;

    while (fontElement.firstChild) {
      span.appendChild(fontElement.firstChild);
    }

    fontElement.replaceWith(span);
  });
}

/* ==========================================================================
   APPLY FONT
========================================================================== */

window.applyFont = function (fontFamily) {
  const editor = document.getElementById("editorBody");

  if (!editor) {
    return;
  }

  /* ------------------------------------------------------------
     NORMALIZE FONT
  ------------------------------------------------------------ */

  const normalizedStack = normalizeFontFamily(fontFamily);

  if (!normalizedStack) {
    return;
  }

  const primaryFont = getPrimaryFontName(normalizedStack);

  if (!primaryFont) {
    return;
  }

  /* ------------------------------------------------------------
     RESTORE USER SELECTION
  ------------------------------------------------------------ */

  if (!restoreSelection()) {
    return;
  }

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) {
    return;
  }

  if (!range.toString().trim()) {
    return;
  }

  /* ------------------------------------------------------------
     APPLY FONT USING BROWSER COMMAND
  ------------------------------------------------------------ */

  try {
    /*
       Force browser to use CSS styling instead of relying
       exclusively on deprecated <font face=""> markup.
    */

    document.execCommand("styleWithCSS", false, true);

    const commandSuccess = document.execCommand("fontName", false, primaryFont);

    /*
       Disable styleWithCSS again so the rest of the editor
       does not inherit unexpected behavior.
    */

    document.execCommand("styleWithCSS", false, false);

    if (!commandSuccess) {
      console.warn("fontName command was not accepted:", primaryFont);
    }
  } catch (error) {
    console.error("Font application failed:", error);

    return;
  }

  /* ------------------------------------------------------------
     NORMALIZE RESULT
  ------------------------------------------------------------ */

  normalizeLegacyFontTags(editor);

  /* ------------------------------------------------------------
     FORCE INLINE FONT FAMILY
     This catches browsers that produce <span style="">
     inconsistently.
  ------------------------------------------------------------ */

  const currentSelection = window.getSelection();

  if (currentSelection && currentSelection.rangeCount > 0) {
    const selectedRange = currentSelection.getRangeAt(0);

    const affectedNodes = getTextNodesInRange(selectedRange, editor);

    affectedNodes.forEach((textNode) => {
      let parent = textNode.parentElement;

      if (!parent || parent === editor) {
        return;
      }

      /*
         Do not overwrite heading/list/table structure.
         Only add font to inline wrappers.
      */

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

  /* ------------------------------------------------------------
     WORD COUNT
  ------------------------------------------------------------ */

  updateWordCount();
};

/* ==========================================================================
   LINE HEIGHT
========================================================================== */

window.applyLineHeight = function (value) {
  restoreSelection();

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return;
  }

  let node = selection.getRangeAt(0).commonAncestorContainer;

  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  const editor = document.getElementById("editorBody");

  if (!editor) {
    return;
  }

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

/* ==========================================================================
   TABLE ACTIONS
========================================================================== */

window.handleTableAction = function (value) {
  if (!value) {
    return;
  }

  const select = document.getElementById("tbTableAction");

  if (select) {
    select.selectedIndex = 0;
  }

  restoreSelection();

  /* ------------------------------------------------------------
       INSERT TABLE
    ------------------------------------------------------------ */

  if (value === "insert") {
    const rows = prompt("Jumlah baris?", "3");

    const cols = prompt("Jumlah kolom?", "3");

    if (!rows || !cols) {
      return;
    }

    const rowCount = Math.max(1, parseInt(rows, 10));

    const colCount = Math.max(1, parseInt(cols, 10));

    let tableHTML = `
        <table
          style="
            width:100%;
            border-collapse:collapse;
            border:1px solid #ccc;
            margin-bottom:1.5rem;
          "
        >
          <tbody>
      `;

    for (let i = 0; i < rowCount; i++) {
      tableHTML += "<tr>";

      for (let j = 0; j < colCount; j++) {
        tableHTML += `
            <td
              style="
                border:1px solid #ccc;
                padding:8px 12px;
              "
            >
              Sel
            </td>
          `;
      }

      tableHTML += "</tr>";
    }

    tableHTML += `
          </tbody>
        </table>

        <p><br></p>
      `;

    document.execCommand("insertHTML", false, tableHTML);

    updateWordCount();

    return;
  }

  /* ------------------------------------------------------------
       TABLE EXISTENCE
    ------------------------------------------------------------ */

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    alert("Arahkan kursor ke dalam tabel terlebih dahulu.");

    return;
  }

  let node = selection.getRangeAt(0).commonAncestorContainer;

  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  const table = node?.closest?.("table");

  if (!table) {
    alert("Kursor Anda harus berada di dalam tabel untuk mengeditnya.");

    return;
  }

  const cells = table.querySelectorAll("th, td");

  const cell = node.closest?.("th, td");

  /* ------------------------------------------------------------
       TABLE ACTION SWITCH
    ------------------------------------------------------------ */

  switch (value) {
    /* ==========================================================
         BORDER FULL
      =========================================================== */

    case "border-full":
      table.style.border = "1px solid #ccc";

      cells.forEach((currentCell) => {
        currentCell.style.border = "1px solid #ccc";
      });

      break;

    /* ==========================================================
         HORIZONTAL
      =========================================================== */

    case "border-horizontal":
      table.style.border = "none";

      table.style.borderTop = "1px solid #ccc";

      table.style.borderBottom = "1px solid #ccc";

      cells.forEach((currentCell) => {
        currentCell.style.border = "none";

        currentCell.style.borderTop = "1px solid #ccc";

        currentCell.style.borderBottom = "1px solid #ccc";
      });

      break;

    /* ==========================================================
         VERTICAL
      =========================================================== */

    case "border-vertical":
      table.style.border = "none";

      table.style.borderLeft = "1px solid #ccc";

      table.style.borderRight = "1px solid #ccc";

      cells.forEach((currentCell) => {
        currentCell.style.border = "none";

        currentCell.style.borderLeft = "1px solid #ccc";

        currentCell.style.borderRight = "1px solid #ccc";
      });

      break;

    /* ==========================================================
         NONE
      =========================================================== */

    case "border-none":
      table.style.border = "none";

      cells.forEach((currentCell) => {
        currentCell.style.border = "none";
      });

      break;

    /* ==========================================================
         FIT WINDOW
      =========================================================== */

    case "fit-window":
      table.style.width = "100%";

      table.style.tableLayout = "auto";

      break;

    /* ==========================================================
         FIT CONTENT
      =========================================================== */

    case "fit-content":
      table.style.width = "auto";

      table.style.tableLayout = "auto";

      break;

    /* ==========================================================
         MERGE RIGHT
      =========================================================== */

    case "merge-right":
      if (!cell) {
        return;
      }

      const nextCell = cell.nextElementSibling;

      if (nextCell) {
        const currentColSpan = cell.hasAttribute("colspan")
          ? parseInt(cell.getAttribute("colspan"), 10)
          : 1;

        const nextColSpan = nextCell.hasAttribute("colspan")
          ? parseInt(nextCell.getAttribute("colspan"), 10)
          : 1;

        cell.setAttribute("colspan", currentColSpan + nextColSpan);

        cell.innerHTML += "<br>" + nextCell.innerHTML;

        nextCell.remove();
      }

      break;

    /* ==========================================================
         MERGE DOWN
      =========================================================== */

    case "merge-down":
      if (!cell) {
        return;
      }

      const row = cell.closest("tr");

      if (!row) {
        return;
      }

      const tbody = row.closest("tbody") || row.parentNode;

      const allRows = Array.from(tbody.querySelectorAll("tr"));

      const rowIndex = allRows.indexOf(row);

      const currentRowSpan = cell.hasAttribute("rowspan")
        ? parseInt(cell.getAttribute("rowspan"), 10)
        : 1;

      let colIndex = 0;

      for (const currentCell of Array.from(row.children)) {
        if (currentCell === cell) {
          break;
        }

        colIndex += currentCell.hasAttribute("colspan")
          ? parseInt(currentCell.getAttribute("colspan"), 10)
          : 1;
      }

      const nextRow = allRows[rowIndex + currentRowSpan];

      if (!nextRow) {
        break;
      }

      let targetCell = null;

      let currentCol = 0;

      for (const currentCell of Array.from(nextRow.children)) {
        if (currentCol === colIndex) {
          targetCell = currentCell;

          break;
        }

        currentCol += currentCell.hasAttribute("colspan")
          ? parseInt(currentCell.getAttribute("colspan"), 10)
          : 1;
      }

      if (targetCell) {
        const targetRowSpan = targetCell.hasAttribute("rowspan")
          ? parseInt(targetCell.getAttribute("rowspan"), 10)
          : 1;

        cell.setAttribute("rowspan", currentRowSpan + targetRowSpan);

        cell.innerHTML += "<br>" + targetCell.innerHTML;

        targetCell.remove();
      }

      break;

    /* ==========================================================
         UNMERGE
      =========================================================== */

    case "unmerge":
      if (!cell) {
        return;
      }

      const cSpan = cell.hasAttribute("colspan")
        ? parseInt(cell.getAttribute("colspan"), 10)
        : 1;

      const rSpan = cell.hasAttribute("rowspan")
        ? parseInt(cell.getAttribute("rowspan"), 10)
        : 1;

      const originalBorder = cell.style.border || "1px solid #ccc";

      /* --------------------------------------------------------
           COLUMNS
        -------------------------------------------------------- */

      if (cSpan > 1) {
        for (let i = 1; i < cSpan; i++) {
          const newCell = document.createElement(cell.tagName);

          newCell.style.cssText = [
            `border:${originalBorder}`,
            "padding:8px",
          ].join(";");

          newCell.innerHTML = "Sel";

          cell.parentNode.insertBefore(newCell, cell.nextSibling);
        }

        cell.removeAttribute("colspan");
      }

      /* --------------------------------------------------------
           ROWS
        -------------------------------------------------------- */

      if (rSpan > 1) {
        const referenceRow = cell.closest("tr");

        const referenceBody =
          referenceRow.closest("tbody") || referenceRow.parentNode;

        const rowsArray = Array.from(referenceBody.querySelectorAll("tr"));

        const referenceIndex = rowsArray.indexOf(referenceRow);

        for (let i = 1; i < rSpan; i++) {
          const nextRow = rowsArray[referenceIndex + i];

          if (!nextRow) {
            continue;
          }

          const newCell = document.createElement(cell.tagName);

          newCell.style.cssText = [
            `border:${originalBorder}`,
            "padding:8px",
          ].join(";");

          newCell.innerHTML = "Sel";

          nextRow.appendChild(newCell);
        }

        cell.removeAttribute("rowspan");
      }

      break;
  }

  updateWordCount();
};
