/* ==========================================================================
   NOTES SCRIPT (PARIPURNA) — CMS EDITION (SUPABASE INTEGRATED)
   Auth + Supabase Database + Rich Text Editor + Cyclical Carousel + Search 
   + Bilingual + ScrollSpy + Auto Sync + Advanced Export & Share (Fixed)
   ========================================================================== */

const OWNER_PASSWORD_HASH =
  "69bfe17dbd9743d9a11023421d37589c19c461539012b540c0a242b4fdfb5aab";
const AUTH_KEY = "aws_notes_auth";

// Konfigurasi topik statis beserta ikonnya
const TOPIC_CONFIG = {
  culture: { label: "Culture & History", icon: "fa-masks-theater" },
  sustainability: { label: "Sustainability", icon: "fa-leaf" },
  environment: { label: "Environment", icon: "fa-seedling" },
  education: { label: "Education", icon: "fa-book-open" },
};

let pendingImageDataUrl = null;
let editingArticleId = null;
let globalArticlesCache = [];
let scrollSpyObserver = null;

const SUPABASE_URL = "https://hieryuiikzcrvssuvsmn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_O0XW4AxwOSNv1cvGkxx5Tg_8XTOnRzF";
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);

document.addEventListener("DOMContentLoaded", async () => {
  const savedLanguage = localStorage.getItem("language") || "en";
  switchLanguage(savedLanguage);

  await loadSavedArticlesIntoDom();
  initCarousels();
  initScrollSpy();
  refreshAuthUI();

  const dateField = document.getElementById("fieldDate");
  if (dateField) dateField.value = new Date().toISOString().slice(0, 10);

  const editorBody = document.getElementById("editorBody");
  if (editorBody) {
    editorBody.addEventListener("input", function (e) {
      const sel = window.getSelection();
      if (sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node && node.nodeType === 3) {
          const text = node.nodeValue;
          let newText = text;
          if (text.includes("->")) newText = newText.replace("->", "→");
          if (text.includes("<-")) newText = newText.replace("<-", "←");
          if (text.includes("=>")) newText = newText.replace("=>", "⇒");

          if (newText !== text) {
            node.nodeValue = newText;
            sel.collapse(node, node.nodeValue.length);
          }
        }
      }
      updateWordCount();
    });
  }

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

  checkHashForArticle();
  window.addEventListener("hashchange", checkHashForArticle);
});

/* --------------------------------------------------------------------------
   SHAREABLE URL / DEEP LINKING CHECK
-------------------------------------------------------------------------- */
function checkHashForArticle() {
  if (window.location.hash) {
    const articleId = window.location.hash.substring(1);
    if (
      articleId.startsWith("article-") ||
      globalArticlesCache.some((a) => a.id === articleId)
    ) {
      setTimeout(() => {
        openArticle(articleId, false);
      }, 500);
    }
  }
}

/* --------------------------------------------------------------------------
   1. DEEP SEARCH FILTER
-------------------------------------------------------------------------- */
window.executeNoteSearch = function () {
  const searchInput = document.getElementById("noteSearch");
  if (!searchInput) return;

  const filterText = searchInput.value.toLowerCase().trim();
  const noteCards = document.querySelectorAll(".ed-card");
  let totalVisible = 0;

  noteCards.forEach((card) => {
    const cardContent = card.textContent.toLowerCase();
    if (card.getAttribute("aria-hidden") === "true") return;

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

/* --------------------------------------------------------------------------
   2. CYCLICAL INFINITE CAROUSEL CONTROLS
-------------------------------------------------------------------------- */
function initCarousels() {
  document.querySelectorAll(".carousel-container").forEach((container) => {
    initSingleCarousel(container);
  });
}

function initSingleCarousel(container) {
  let track = container.querySelector(".carousel-track");
  if (!track) return;

  track.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
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
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    return clone;
  };

  originalItems.forEach((item) => {
    track.insertBefore(createSafeClone(item), originalItems[0]);
  });
  originalItems.forEach((item) => {
    track.appendChild(createSafeClone(item));
  });

  const getScrollStep = () => {
    const itemWidth = originalItems[0].offsetWidth;
    const gap = parseFloat(getComputedStyle(track).gap) || 32;
    return itemWidth + gap;
  };

  setTimeout(() => {
    const step = getScrollStep();
    track.style.scrollBehavior = "auto";
    track.scrollLeft = totalOriginal * step;
  }, 100);

  let scrollTimeout;
  track.addEventListener("scroll", () => {
    const step = getScrollStep();
    if (!step) return;
    const scrollLeft = track.scrollLeft;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      if (scrollLeft <= (totalOriginal - 1) * step) {
        track.style.scrollSnapType = "none";
        track.scrollLeft = scrollLeft + totalOriginal * step;
        requestAnimationFrame(
          () => (track.style.scrollSnapType = "x mandatory"),
        );
      } else if (scrollLeft >= totalOriginal * 2 * step) {
        track.style.scrollSnapType = "none";
        track.scrollLeft = scrollLeft - totalOriginal * step;
        requestAnimationFrame(
          () => (track.style.scrollSnapType = "x mandatory"),
        );
      }
    }, 150);
  });

  const scrollByArrow = (direction) => {
    const step = getScrollStep();
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

/* --------------------------------------------------------------------------
   3. MODAL READING OVERLAY
-------------------------------------------------------------------------- */
let currentArticleTitle = "Document";

window.openArticle = function (articleId, updateHash = true) {
  const article = document.getElementById(articleId);
  if (!article) return;

  const parentSection = article.closest(".topic-section");
  if (parentSection) {
    const topicId = parentSection.getAttribute("id");
    document
      .querySelectorAll(".topic-list a")
      .forEach((link) => link.classList.remove("active"));
    const activeLink = document.querySelector(
      `.topic-list a[href="#${topicId}"]`,
    );
    if (activeLink) activeLink.classList.add("active");
  }

  const contentToExport = document.getElementById(`content-${articleId}`);
  const modalContent = document.getElementById("reading-content-area");

  const clone = contentToExport.cloneNode(true);
  const excerptEl = clone.querySelector(".ed-excerpt");
  if (excerptEl) excerptEl.remove();

  modalContent.innerHTML = clone.innerHTML;

  const titleEl = modalContent.querySelector(".ed-title");
  if (titleEl) currentArticleTitle = titleEl.innerText;

  document.getElementById("reading-overlay").classList.add("active");
  document.body.style.overflow = "hidden";
  document.getElementById("exportDropdown").classList.remove("show");

  if (updateHash) window.history.pushState(null, null, `#${articleId}`);
};

window.closeArticle = function () {
  document.getElementById("reading-overlay").classList.remove("active");
  document.body.style.overflow = "auto";
  document.getElementById("exportDropdown").classList.remove("show");

  const currentPath = window.location.pathname + window.location.search;
  window.history.pushState(null, null, currentPath);
};

/* --------------------------------------------------------------------------
   4. EXPORT & SHARE FUNCTIONS
-------------------------------------------------------------------------- */
window.toggleExportMenu = function () {
  document.getElementById("exportDropdown").classList.toggle("show");
};

document.addEventListener("click", function (e) {
  const container = document.querySelector(".export-menu-container");
  const dropdown = document.getElementById("exportDropdown");
  if (container && !container.contains(e.target) && dropdown) {
    dropdown.classList.remove("show");
  }
});

window.shareLink = function (platform) {
  const url = encodeURIComponent(window.location.href);
  const title = encodeURIComponent(currentArticleTitle);
  if (platform === "wa") {
    window.open(
      `https://api.whatsapp.com/send?text=*${title}*%0A${url}`,
      "_blank",
    );
  } else if (platform === "x") {
    window.open(
      `https://twitter.com/intent/tweet?text=${title}&url=${url}`,
      "_blank",
    );
  }
  document.getElementById("exportDropdown").classList.remove("show");
};

window.copyArticleLink = function () {
  const url = window.location.href;
  navigator.clipboard
    .writeText(url)
    .then(() => alert("Link copied to clipboard!"))
    .catch((err) => console.error("Failed to copy link: ", err));
  document.getElementById("exportDropdown").classList.remove("show");
};

window.downloadNote = function (format) {
  document.getElementById("exportDropdown").classList.remove("show");

  const originalElement = document.getElementById("reading-content-area");
  const filename = `${currentArticleTitle
    .substring(0, 30)
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()}`;

  if (format === "pdf" || format === "png") {
    const hiddenContainer = document.createElement("div");
    hiddenContainer.className = "export-mode-active";
    hiddenContainer.style.position = "fixed";
    hiddenContainer.style.top = "0";
    hiddenContainer.style.left = "-9999px";
    hiddenContainer.style.width = "800px";
    hiddenContainer.style.backgroundColor = "#ffffff";
    hiddenContainer.style.color = "#000000";

    const exportClone = originalElement.cloneNode(true);
    hiddenContainer.appendChild(exportClone);
    document.body.appendChild(hiddenContainer);

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
        html2pdf()
          .set(opt)
          .from(hiddenContainer)
          .save()
          .then(() => document.body.removeChild(hiddenContainer));
      }, 300);
    } else {
      hiddenContainer.style.padding = "40px";
      setTimeout(() => {
        html2canvas(hiddenContainer, {
          useCORS: true,
          scale: 2,
          backgroundColor: "#ffffff",
        }).then((canvas) => {
          const link = document.createElement("a");
          link.download = `${filename}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          document.body.removeChild(hiddenContainer);
        });
      }, 300);
    }
  } else if (format === "word") {
    const exportClone = originalElement.cloneNode(true);
    exportClone.querySelectorAll("img").forEach((img) => {
      img.removeAttribute("style");
      img.removeAttribute("class");
      img.setAttribute("width", "620");
    });
    exportClone.querySelectorAll("p, div, li, td, th").forEach((el) => {
      el.style.textAlign = "justify";
      el.style.fontSize = "12pt";
      el.style.fontFamily = '"Times New Roman", serif';
      el.style.lineHeight = "1.5";
    });
    exportClone.querySelectorAll("h1, h2, h3, .ed-title").forEach((el) => {
      el.style.textAlign = "left";
      el.style.fontSize = "16pt";
      el.style.fontFamily = '"Times New Roman", serif';
      el.style.fontWeight = "bold";
    });

    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Export</title>
      <style> 
        @page WordSection1 { size: 8.5in 11.0in; margin: 1.0in 1.0in 1.0in 1.0in; mso-header-margin: 0.5in; mso-footer-margin: 0.5in; mso-paper-source: 0; }
        div.WordSection1 { page: WordSection1; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; } 
        table, th, td { border: 1px solid black; padding: 8px; } 
      </style></head><body><div class="WordSection1">`;
    const footer = "</div></body></html>";
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

/* --------------------------------------------------------------------------
   5. BILINGUAL SYSTEM
-------------------------------------------------------------------------- */
window.switchLanguage = function (lang) {
  if (lang !== "en" && lang !== "id") return;
  document.querySelectorAll(".translatable").forEach((element) => {
    const translatedText = element.getAttribute(`data-${lang}`);
    if (translatedText !== null) {
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA")
        element.placeholder = translatedText;
      else element.innerHTML = translatedText;
    }
  });
  document
    .querySelectorAll(".lang-btn")
    .forEach((button) => button.classList.remove("active"));
  const activeButton = document.getElementById(`btn-${lang}`);
  if (activeButton) activeButton.classList.add("active");
  localStorage.setItem("language", lang);
  document.documentElement.lang = lang;
};

/* --------------------------------------------------------------------------
   6. SCROLL SPY SIDEBAR 
-------------------------------------------------------------------------- */
function initScrollSpy() {
  if (scrollSpyObserver) scrollSpyObserver.disconnect();
  const sections = document.querySelectorAll(".topic-section");
  if (sections.length === 0) return;

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const currentId = entry.target.getAttribute("id");
          document
            .querySelectorAll(".topic-list a")
            .forEach((link) => link.classList.remove("active"));
          const activeLink = document.querySelector(
            `.topic-list a[href="#${currentId}"]`,
          );
          if (activeLink) activeLink.classList.add("active");
        }
      });
    },
    { root: null, rootMargin: "-25% 0px -70% 0px", threshold: 0 },
  );

  sections.forEach((section) => scrollSpyObserver.observe(section));
}

/* --------------------------------------------------------------------------
   7. AUTH
-------------------------------------------------------------------------- */
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isOwnerLoggedIn() {
  return localStorage.getItem(AUTH_KEY) === "true";
}

function refreshAuthUI() {
  const loggedIn = isOwnerLoggedIn();
  document.getElementById("loginTriggerBtn").style.display = loggedIn
    ? "none"
    : "inline-flex";
  document.getElementById("writeTriggerBtn").style.display = loggedIn
    ? "inline-flex"
    : "none";
  document.getElementById("logoutTriggerBtn").style.display = loggedIn
    ? "inline-flex"
    : "none";
  document
    .querySelectorAll(".ed-manage")
    .forEach((el) => (el.style.display = loggedIn ? "flex" : "none"));
}

window.openLogin = function () {
  document.getElementById("login-overlay").classList.add("active");
  document.getElementById("loginError").style.display = "none";
  document.getElementById("ownerPassword").value = "";
  document.body.style.overflow = "hidden";
};
window.closeLogin = function () {
  document.getElementById("login-overlay").classList.remove("active");
  document.body.style.overflow = "auto";
};
window.handleLogin = async function (event) {
  event.preventDefault();
  const pw = document.getElementById("ownerPassword").value;
  const hash = await sha256Hex(pw);
  if (hash === OWNER_PASSWORD_HASH) {
    localStorage.setItem(AUTH_KEY, "true");
    closeLogin();
    refreshAuthUI();
  } else document.getElementById("loginError").style.display = "block";
  return false;
};
window.logoutOwner = function () {
  localStorage.removeItem(AUTH_KEY);
  refreshAuthUI();
};

/* --------------------------------------------------------------------------
   8. ARTICLE FETCHING & DOM RENDERING
-------------------------------------------------------------------------- */
async function fetchArticlesFromSupabase() {
  const { data, error } = await supabaseClient
    .from("articles")
    .select("*")
    .order("date_iso", { ascending: false });
  if (error) {
    console.error("Failed to load articles:", error);
    return [];
  }

  globalArticlesCache = data.map((article) => ({
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function ensureTopicSection(topicSlug, topicLabel, iconClass) {
  let section = document.getElementById(topicSlug);
  if (section) return section;

  section = document.createElement("section");
  section.id = topicSlug;
  section.className = "topic-section";
  section.innerHTML = `
    <h2 class="topic-heading">${escapeHtml(topicLabel)}</h2>
    <div class="carousel-container">
      <button class="carousel-btn prev-btn"><i class="fa-solid fa-chevron-left"></i></button>
      <div class="carousel-viewport"><div class="carousel-track"></div></div>
      <button class="carousel-btn next-btn"><i class="fa-solid fa-chevron-right"></i></button>
    </div>`;
  document.getElementById("main-content").appendChild(section);

  const topicList = document.getElementById("topic-list");
  const li = document.createElement("li");
  li.innerHTML = `<a href="#${topicSlug}"><i class="fa-solid ${iconClass || "fa-tag"}"></i> ${escapeHtml(topicLabel)}</a>`;
  topicList.appendChild(li);

  return section;
}

function buildArticleElement(data) {
  const article = document.createElement("article");
  article.className = "ed-card";
  article.id = data.id;
  article.innerHTML = `
    <div class="export-content" id="content-${data.id}">
      <div class="ed-meta">${escapeHtml(data.dateDisplay)} • <span class="read-time">${escapeHtml(data.readTime)}</span></div>
      <h3 class="ed-title">${escapeHtml(data.title)}</h3>
      <div class="ed-excerpt"><p>${escapeHtml(data.excerpt)}</p></div>
      <div class="ed-full-text">${data.bodyHTML}</div>
    </div>
    <div class="ed-actions">
      <button class="ed-btn" onclick="openArticle('${data.id}')">Open Note</button>
      <div class="ed-manage" style="display: ${isOwnerLoggedIn() ? "flex" : "none"}">
        <button class="ed-manage-btn" onclick="editArticle('${data.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="ed-manage-btn" onclick="deleteArticle('${data.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  return article;
}

async function loadSavedArticlesIntoDom() {
  const topicList = document.getElementById("topic-list");
  if (topicList) topicList.innerHTML = "";
  document.querySelectorAll(".topic-section").forEach((sec) => sec.remove());

  const articles = await fetchArticlesFromSupabase();
  articles.forEach((data) => {
    let icon = data.topicIcon;
    if (TOPIC_CONFIG[data.topicId]) icon = TOPIC_CONFIG[data.topicId].icon;
    const section = ensureTopicSection(
      data.topicId,
      data.topicLabel,
      icon || "fa-tag",
    );
    section
      .querySelector(".carousel-track")
      .appendChild(buildArticleElement(data));
  });

  const firstLink = document.querySelector(".topic-list a");
  if (firstLink) firstLink.classList.add("active");
}

/* --------------------------------------------------------------------------
   9. EDITOR — OPEN / CLOSE / TOOLBAR
-------------------------------------------------------------------------- */
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
  document.getElementById("fieldDate").value = new Date()
    .toISOString()
    .slice(0, 10);
  document.getElementById("editorBody").innerHTML = "";
  document.getElementById("editorStatus").textContent = "";

  updateWordCount();
  document.getElementById("editor-overlay").classList.add("active");
  document.body.style.overflow = "hidden";
};
window.closeEditor = function () {
  document.getElementById("editor-overlay").classList.remove("active");
  document.body.style.overflow = "auto";
  cancelPendingImage();
};
window.handleTopicSelectChange = function () {
  const val = document.getElementById("fieldTopicSelect").value;
  document.getElementById("newTopicGroup").style.display =
    val === "__new__" ? "block" : "none";
};

// Toolbar Exec
window.execToolbar = function (command) {
  document.getElementById("editorBody").focus();
  document.execCommand(command, false, null);
};
window.triggerLinkInsert = function () {
  const url = prompt("Enter URL:", "https://");
  if (!url) return;
  document.getElementById("editorBody").focus();
  document.execCommand("createLink", false, url);
};

function updateWordCount() {
  const body = document.getElementById("editorBody");
  const text = body ? body.textContent.trim() : "";
  const words = text.length ? text.split(/\s+/).length : 0;
  const minutes = Math.max(1, Math.round(words / 200));
  const el = document.getElementById("tbWordCount");
  if (el) el.textContent = `${words} words \u2022 ~${minutes} min read`;
}

/* --------------------------------------------------------------------------
   10. IMAGE INSERTION
-------------------------------------------------------------------------- */
let savedSelectionRange = null;

window.triggerImageInsert = function () {
  const body = document.getElementById("editorBody");
  body.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) savedSelectionRange = sel.getRangeAt(0);
  document.getElementById("imageFileInput").click();
};

window.handleImageFileChosen = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    pendingImageDataUrl = e.target.result;
    document.getElementById("imageStylePicker").style.display = "flex";
  };
  reader.readAsDataURL(file);
  event.target.value = "";
};

window.insertPendingImage = function (styleClass) {
  if (!pendingImageDataUrl) return;
  const body = document.getElementById("editorBody");
  body.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  if (savedSelectionRange) sel.addRange(savedSelectionRange);

  const imgHtml = `<img class="note-img ${styleClass}" src="${pendingImageDataUrl}" alt="" />`;
  document.execCommand("insertHTML", false, imgHtml);

  cancelPendingImage();
  updateWordCount();
};

window.cancelPendingImage = function () {
  pendingImageDataUrl = null;
  savedSelectionRange = null;
  const picker = document.getElementById("imageStylePicker");
  if (picker) picker.style.display = "none";
};

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* --------------------------------------------------------------------------
   11. PUBLISH / EDIT / DELETE ARTICLE
-------------------------------------------------------------------------- */
window.editArticle = function (articleId) {
  if (!isOwnerLoggedIn()) {
    openLogin();
    return;
  }
  const data = globalArticlesCache.find((a) => a.id === articleId);
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
  updateWordCount();
  document.getElementById("editorStatus").textContent = "";
  document.getElementById("editor-overlay").classList.add("active");
  document.body.style.overflow = "hidden";
};

window.deleteArticle = async function (articleId) {
  if (!isOwnerLoggedIn()) return;
  if (!confirm("Delete this note? This cannot be undone.")) return;

  const { error } = await supabaseClient
    .from("articles")
    .delete()
    .eq("id", articleId);
  if (error) {
    alert("Failed to delete: " + error.message);
    return;
  }

  globalArticlesCache = globalArticlesCache.filter((a) => a.id !== articleId);
  const el = document.getElementById(articleId);
  const container = el ? el.closest(".carousel-container") : null;
  if (el) el.remove();
  if (container) initSingleCarousel(container);
  initScrollSpy();
};

window.publishArticle = async function () {
  const title = document.getElementById("fieldTitle").value.trim();
  const excerpt = document.getElementById("fieldExcerpt").value.trim();
  const dateISO = document.getElementById("fieldDate").value;
  const bodyHTML = document.getElementById("editorBody").innerHTML.trim();
  const topicSelectVal = document.getElementById("fieldTopicSelect").value;

  if (!title) return setEditorStatus("Please add a title.");
  if (!excerpt) return setEditorStatus("Please add a short excerpt.");
  if (!bodyHTML || bodyHTML === "<br>")
    return setEditorStatus("Please write the note body.");

  let topicId, topicLabel, topicIcon;
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

  const dateObj = dateISO ? new Date(dateISO + "T00:00:00") : new Date();
  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  const wordCount = document
    .getElementById("editorBody")
    .textContent.trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const readTime = `${Math.max(1, Math.round(wordCount / 200))} min read`;
  const id = editingArticleId || `article-custom-${Date.now()}`;

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

  if (editingArticleId) {
    const { error } = await supabaseClient
      .from("articles")
      .update(dbPayload)
      .eq("id", editingArticleId);
    if (error) return setEditorStatus("Error updating: " + error.message);
    const idx = globalArticlesCache.findIndex((a) => a.id === editingArticleId);
    if (idx > -1) globalArticlesCache.splice(idx, 1);
  } else {
    const { error } = await supabaseClient.from("articles").insert([dbPayload]);
    if (error) return setEditorStatus("Error inserting: " + error.message);
  }

  globalArticlesCache.push(dataApp);
  let oldContainer = null;
  if (editingArticleId) {
    const oldEl = document.getElementById(editingArticleId);
    if (oldEl) {
      oldContainer = oldEl.closest(".carousel-container");
      oldEl.remove();
    }
  }

  const section = ensureTopicSection(topicId, topicLabel, topicIcon);
  const track = section.querySelector(".carousel-track");
  track.prepend(buildArticleElement(dataApp));

  const mainContent = document.getElementById("main-content");
  mainContent.insertBefore(
    section,
    document.getElementById("noResultsElement").nextSibling,
  );

  const targetLi = document.querySelector(
    `.topic-list a[href="#${topicId}"]`,
  ).parentElement;
  document.getElementById("topic-list").prepend(targetLi);

  if (
    oldContainer &&
    oldContainer !== section.querySelector(".carousel-container")
  )
    initSingleCarousel(oldContainer);
  initSingleCarousel(section.querySelector(".carousel-container"));
  initScrollSpy();

  editingArticleId = null;
  closeEditor();
};

function setEditorStatus(message) {
  const el = document.getElementById("editorStatus");
  if (el) el.textContent = message;
}

/* --------------------------------------------------------------------------
   12. EDITOR TOOLS & AUTO-FORMATTING (FIXED)
-------------------------------------------------------------------------- */
window.applyCustomHighlight = function () {
  const body = document.getElementById("editorBody");
  body.focus();
  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);
  let container = range.commonAncestorContainer;
  if (container.nodeType === 3) container = container.parentNode;

  const existingHighlight = container.closest(".journal-highlight");

  if (existingHighlight) {
    const parent = existingHighlight.parentNode;
    while (existingHighlight.firstChild) {
      parent.insertBefore(existingHighlight.firstChild, existingHighlight);
    }
    parent.removeChild(existingHighlight);
    selection.removeAllRanges();
  } else {
    const span = document.createElement("span");
    span.className = "journal-highlight";
    const selectedText = range.extractContents();
    span.appendChild(selectedText);
    range.insertNode(span);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(span);
    newRange.collapse(true);
    selection.addRange(newRange);
  }
  updateWordCount();
};

let lastSelectionRange = null;
window.saveSelection = function () {
  const sel = window.getSelection();
  if (sel.rangeCount > 0) lastSelectionRange = sel.getRangeAt(0);
};

window.applyBlockType = function (tag) {
  restoreSelection();
  document.execCommand("formatBlock", false, tag);
};

window.applyFont = function (fontFamily) {
  restoreSelection();
  document.execCommand("fontName", false, fontFamily);
};

function restoreSelection() {
  const body = document.getElementById("editorBody");
  body.focus();
  if (lastSelectionRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(lastSelectionRange);
  }
}

// FIXED: Penargetan Line Height agar akurat untuk blok paragraf/heading
window.applyLineHeight = function (val) {
  restoreSelection();
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    let node = selection.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;

    // Cari parent element level blok
    const blockParent = node.closest(
      "p, h1, h2, h3, h4, h5, h6, blockquote, li, td, div",
    );
    if (blockParent && blockParent.id !== "editorBody") {
      blockParent.style.lineHeight = val;
      blockParent.style.marginBottom = val > 1.5 ? "1.5em" : "1em";
    } else {
      node.style.lineHeight = val;
    }
  }
};

window.handleTableAction = function (val) {
  if (!val) return;
  document.getElementById("tbTableAction").selectedIndex = 0;
  restoreSelection();

  if (val === "insert") {
    const rows = prompt("Jumlah baris?", "3");
    const cols = prompt("Jumlah kolom?", "3");
    if (!rows || !cols) return;

    let tableHTML =
      '<table style="width:100%; border-collapse: collapse; border: 1px solid #ccc; margin-bottom: 1.5rem;"><tbody>';
    for (let i = 0; i < rows; i++) {
      tableHTML += "<tr>";
      for (let j = 0; j < cols; j++) {
        tableHTML +=
          '<td style="border: 1px solid #ccc; padding: 8px 12px;">Sel</td>';
      }
      tableHTML += "</tr>";
    }
    tableHTML += "</tbody></table><p><br></p>";
    document.execCommand("insertHTML", false, tableHTML);
    return;
  }

  const selection = window.getSelection();
  if (selection.rangeCount === 0)
    return alert("Arahkan kursor ke dalam tabel terlebih dahulu.");

  let node = selection.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const table = node.closest("table");
  if (!table)
    return alert("Kursor Anda harus berada di dalam tabel untuk mengeditnya.");

  const cells = table.querySelectorAll("th, td");
  const cell = node.closest("th, td");

  switch (val) {
    case "border-full":
      table.style.border = "1px solid #ccc";
      cells.forEach((c) => (c.style.border = "1px solid #ccc"));
      break;
    case "border-horizontal":
      table.style.border = "none";
      table.style.borderTop = "1px solid #ccc";
      table.style.borderBottom = "1px solid #ccc";
      cells.forEach((c) => {
        c.style.border = "none";
        c.style.borderTop = "1px solid #ccc";
        c.style.borderBottom = "1px solid #ccc";
      });
      break;
    case "border-vertical":
      table.style.border = "none";
      table.style.borderLeft = "1px solid #ccc";
      table.style.borderRight = "1px solid #ccc";
      cells.forEach((c) => {
        c.style.border = "none";
        c.style.borderLeft = "1px solid #ccc";
        c.style.borderRight = "1px solid #ccc";
      });
      break;
    case "border-none":
      table.style.border = "none";
      cells.forEach((c) => (c.style.border = "none"));
      break;
    case "fit-window":
      table.style.width = "100%";
      table.style.tableLayout = "auto";
      break;
    case "fit-content":
      table.style.width = "auto";
      table.style.tableLayout = "auto";
      break;
    case "merge-right":
      if (!cell) return;
      const nextCell = cell.nextElementSibling;
      if (nextCell) {
        const currentColSpan = cell.getAttribute("colspan")
          ? parseInt(cell.getAttribute("colspan"))
          : 1;
        const nextColSpan = nextCell.getAttribute("colspan")
          ? parseInt(nextCell.getAttribute("colspan"))
          : 1;
        cell.setAttribute("colspan", currentColSpan + nextColSpan);
        cell.innerHTML += "<br>" + nextCell.innerHTML;
        nextCell.remove();
      }
      break;
    case "merge-down":
      if (!cell) return;
      const row = cell.closest("tr");
      const tbody = row.closest("tbody") || row.parentNode;
      const allRows = Array.from(tbody.querySelectorAll("tr"));
      const rowIndex = allRows.indexOf(row);
      const currentRowSpan = cell.getAttribute("rowspan")
        ? parseInt(cell.getAttribute("rowspan"))
        : 1;
      let colIndex = 0;
      for (let c of Array.from(row.children)) {
        if (c === cell) break;
        colIndex += c.getAttribute("colspan")
          ? parseInt(c.getAttribute("colspan"))
          : 1;
      }
      const nextRow = allRows[rowIndex + currentRowSpan];
      if (nextRow) {
        let targetCell = null;
        let currentCol = 0;
        for (let c of Array.from(nextRow.children)) {
          if (currentCol === colIndex) {
            targetCell = c;
            break;
          }
          currentCol += c.getAttribute("colspan")
            ? parseInt(c.getAttribute("colspan"))
            : 1;
        }
        if (targetCell) {
          const targetRowSpan = targetCell.getAttribute("rowspan")
            ? parseInt(targetCell.getAttribute("rowspan"))
            : 1;
          cell.setAttribute("rowspan", currentRowSpan + targetRowSpan);
          cell.innerHTML += "<br>" + targetCell.innerHTML;
          targetCell.remove();
        }
      }
      break;
    case "unmerge":
      if (!cell) return;
      const cSpan = cell.getAttribute("colspan")
        ? parseInt(cell.getAttribute("colspan"))
        : 1;
      const rSpan = cell.getAttribute("rowspan")
        ? parseInt(cell.getAttribute("rowspan"))
        : 1;
      const originalBorder = cell.style.border || "1px solid #ccc";

      if (cSpan > 1) {
        for (let i = 1; i < cSpan; i++) {
          const newCell = document.createElement(cell.tagName);
          newCell.style.cssText = `border: ${originalBorder}; padding: 8px;`;
          newCell.innerHTML = "Sel";
          cell.parentNode.insertBefore(newCell, cell.nextSibling);
        }
        cell.removeAttribute("colspan");
      }
      if (rSpan > 1) {
        const rRef = cell.closest("tr");
        const tBodyRef = rRef.closest("tbody") || rRef.parentNode;
        const rowsArr = Array.from(tBodyRef.querySelectorAll("tr"));
        const rIdx = rowsArr.indexOf(rRef);
        for (let i = 1; i < rSpan; i++) {
          const nRow = rowsArr[rIdx + i];
          if (nRow) {
            const newCell = document.createElement(cell.tagName);
            newCell.style.cssText = `border: ${originalBorder}; padding: 8px;`;
            newCell.innerHTML = "Sel";
            nRow.appendChild(newCell);
          }
        }
        cell.removeAttribute("rowspan");
      }
      break;
  }
};
