/* ==========================================================================
   NOTES SCRIPT (PARIPURNA) — CMS EDITION (SUPABASE INTEGRATED)
   Auth (client-side gate) + Supabase Database + Rich Text Editor + 
   Cyclical Infinite Carousel (idempotent re-init) + Search + 
   Bilingual + ScrollSpy + Export
   ========================================================================== */

/* --------------------------------------------------------------------------
   0. CONFIG & STORAGE KEYS
-------------------------------------------------------------------------- */
const OWNER_PASSWORD_HASH =
  "69bfe17dbd9743d9a11023421d37589c19c461539012b540c0a242b4fdfb5aab"; // default password: "notes2026"
const AUTH_KEY = "aws_notes_auth";
const STATIC_TOPICS = ["culture", "sustainability", "environment", "education"];
const STATIC_TOPIC_LABELS = {
  culture: "Culture & History",
  sustainability: "Sustainability",
  environment: "Environment",
  education: "Education",
};

let pendingImageDataUrl = null;
let editingArticleId = null;
let globalArticlesCache = []; // Cache lokal untuk mempermudah edit secara sinkron tanpa fetch berulang

// ==========================================
// INISIALISASI SUPABASE
// ==========================================
const SUPABASE_URL = "https://hieryuiikzcrvssuvsmn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_O0XW4AxwOSNv1cvGkxx5Tg_8XTOnRzF";
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Set Language Init
  const savedLanguage = localStorage.getItem("language") || "en";
  switchLanguage(savedLanguage);

  // 2. Muat artikel dari SUPABASE SEBELUM carousel di-init
  await loadSavedArticlesIntoDom();

  // 3. Initialize all Carousels
  initCarousels();

  // 4. Initialize Sidebar ScrollSpy
  initScrollSpy();

  // 5. Auth UI state
  refreshAuthUI();

  // 6. Default tanggal di editor = hari ini
  const dateField = document.getElementById("fieldDate");
  if (dateField) dateField.value = new Date().toISOString().slice(0, 10);

  // 7. Word count & Auto-format live update
  const editorBody = document.getElementById("editorBody");
  if (editorBody) {
    editorBody.addEventListener("input", function (e) {
      // Auto-replace panah
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

    // Native Undo/Redo listener override just in case
    editorBody.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        // Biarkan browser handle native undo
      }
      if (
        (e.ctrlKey && e.key.toLowerCase() === "y") ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        // Biarkan browser handle native redo
      }
    });
  }

  // 8. Header Scroll Blur
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
});

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
   2. CYCLICAL INFINITE CAROUSEL CONTROLS (IDEMPOTENT)
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
  const dotsContainer = container.querySelector(".carousel-dots");
  let dots = [];

  if (dotsContainer) {
    dotsContainer.innerHTML = "";
    originalItems.forEach((_, index) => {
      const dot = document.createElement("div");
      dot.classList.add("carousel-dot");
      if (index === 0) dot.classList.add("active");
      dotsContainer.appendChild(dot);
    });
    dots = Array.from(dotsContainer.querySelectorAll(".carousel-dot"));
  }

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

    if (dotsContainer) {
      const absoluteIndex = Math.round(scrollLeft / step);
      let realIndex = (absoluteIndex - totalOriginal) % totalOriginal;
      if (realIndex < 0) realIndex += totalOriginal;

      dots.forEach((dot, index) => {
        dot.classList.toggle("active", index === realIndex);
      });
    }

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
  if (dotsContainer) {
    dots.forEach((dot, index) => {
      dot.addEventListener("click", () => {
        const step = getScrollStep();
        track.scrollTo({
          left: (totalOriginal + index) * step,
          behavior: "smooth",
        });
      });
    });
  }
}

/* --------------------------------------------------------------------------
   3. MODAL READING OVERLAY
-------------------------------------------------------------------------- */
let currentArticleTitle = "Document";

window.openArticle = function (articleId) {
  const article = document.getElementById(articleId);
  if (!article) return;

  const contentToExport = document.getElementById(`content-${articleId}`);
  const modalContent = document.getElementById("reading-content-area");
  modalContent.innerHTML = contentToExport.innerHTML;

  const titleEl = modalContent.querySelector(".ed-title");
  if (titleEl) currentArticleTitle = titleEl.innerText;

  document.getElementById("reading-overlay").classList.add("active");
  document.body.style.overflow = "hidden";
};

window.closeArticle = function () {
  document.getElementById("reading-overlay").classList.remove("active");
  document.body.style.overflow = "auto";
};

/* --------------------------------------------------------------------------
   4. EXPORT & SHARE FUNCTIONS
-------------------------------------------------------------------------- */
window.downloadNote = function (format) {
  const element = document.getElementById("reading-content-area");

  // Simpan gaya asli dan berikan padding sementara agar tidak mepet
  const originalPadding = element.style.padding;
  const originalBg = element.style.backgroundColor;
  element.style.padding = "40px";
  element.style.backgroundColor = "#ffffff";

  const filename = `${currentArticleTitle
    .substring(0, 30)
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()}`;

  if (format === "pdf") {
    const opt = {
      margin: 1,
      filename: `${filename}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    };
    html2pdf()
      .set(opt)
      .from(element)
      .save()
      .then(() => {
        element.style.padding = originalPadding;
        element.style.backgroundColor = originalBg;
      });
  } else if (format === "png") {
    html2canvas(element, {
      useCORS: true,
      scale: 2,
      backgroundColor: "#ffffff",
    }).then((canvas) => {
      const link = document.createElement("a");
      link.download = `${filename}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      element.style.padding = originalPadding;
      element.style.backgroundColor = originalBg;
    });
  } else if (format === "word") {
    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Export</title>
      <style>
        body { font-family: 'Times New Roman', serif; margin: 1in; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
        table, th, td { border: 1px solid black; padding: 8px; }
      </style></head><body>`;
    const footer = "</body></html>";
    const sourceHTML = header + element.innerHTML + footer;
    const source =
      "data:application/vnd.ms-word;charset=utf-8," +
      encodeURIComponent(sourceHTML);

    const fileDownload = document.createElement("a");
    document.body.appendChild(fileDownload);
    fileDownload.href = source;
    fileDownload.download = `${filename}.doc`;
    fileDownload.click();
    document.body.removeChild(fileDownload);

    element.style.padding = originalPadding;
    element.style.backgroundColor = originalBg;
  }
};

window.copyArticleLink = function () {
  const url = window.location.href.split("#")[0];
  navigator.clipboard
    .writeText(url)
    .then(() => alert("Link copied to clipboard!"))
    .catch((err) => console.error("Failed to copy link: ", err));
};

/* --------------------------------------------------------------------------
   5. BILINGUAL SYSTEM
-------------------------------------------------------------------------- */
window.switchLanguage = function (lang) {
  if (lang !== "en" && lang !== "id") return;

  document.querySelectorAll(".translatable").forEach((element) => {
    const translatedText = element.getAttribute(`data-${lang}`);
    if (translatedText !== null) {
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        element.placeholder = translatedText;
      } else {
        element.innerHTML = translatedText;
      }
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

/* --------------------------------------------------------------------------
   6. SCROLL SPY SIDEBAR
-------------------------------------------------------------------------- */
function initScrollSpy() {
  const sections = document.querySelectorAll(".topic-section");
  const navLinks = document.querySelectorAll(".topic-list a");

  if (sections.length === 0 || navLinks.length === 0) return;

  const observerOptions = {
    root: null,
    rootMargin: "-150px 0px -40% 0px",
    threshold: 0,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const currentId = entry.target.getAttribute("id");
        navLinks.forEach((link) => link.classList.remove("active"));

        const activeLink = document.querySelector(
          `.topic-list a[href="#${currentId}"]`,
        );
        if (activeLink) activeLink.classList.add("active");
      }
    });
  }, observerOptions);

  sections.forEach((section) => observer.observe(section));
}

/* --------------------------------------------------------------------------
   7. AUTH (CLIENT-SIDE GATE)
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

  document.querySelectorAll(".ed-manage").forEach((el) => {
    el.style.display = loggedIn ? "flex" : "none";
  });
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
  } else {
    document.getElementById("loginError").style.display = "block";
  }
  return false;
};

window.logoutOwner = function () {
  localStorage.removeItem(AUTH_KEY);
  refreshAuthUI();
};

/* --------------------------------------------------------------------------
   8. ARTICLE SUPABASE FETCHING & DOM RENDERING
-------------------------------------------------------------------------- */
async function fetchArticlesFromSupabase() {
  const { data, error } = await supabaseClient
    .from("articles")
    .select("*")
    .order("date_iso", { ascending: false });

  if (error) {
    console.error("Failed to load articles from Supabase:", error);
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

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
      <div class="carousel-viewport">
        <div class="carousel-track"></div>
      </div>
      <button class="carousel-btn next-btn"><i class="fa-solid fa-chevron-right"></i></button>
    </div>
  `;
  document.getElementById("main-content").appendChild(section);

  const topicList = document.getElementById("topic-list");
  const alreadyInNav = Array.from(topicList.querySelectorAll("a")).some(
    (a) => a.getAttribute("href") === `#${topicSlug}`,
  );

  if (!alreadyInNav) {
    const li = document.createElement("li");
    li.innerHTML = `<a href="#${topicSlug}"><i class="fa-solid ${iconClass || "fa-tag"}"></i> ${escapeHtml(topicLabel)}</a>`;
    topicList.appendChild(li);
  }
  return section;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
    </div>
  `;
  return article;
}

async function loadSavedArticlesIntoDom() {
  const articles = await fetchArticlesFromSupabase();
  articles.forEach((data) => {
    const section = ensureTopicSection(
      data.topicId,
      data.topicLabel,
      data.topicIcon,
    );
    const track = section.querySelector(".carousel-track");
    track.appendChild(buildArticleElement(data));
  });
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
  if (sel && sel.rangeCount > 0) {
    savedSelectionRange = sel.getRangeAt(0);
  }
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

/* --------------------------------------------------------------------------
   11. PUBLISH / EDIT / DELETE ARTICLE (Supabase Integration)
-------------------------------------------------------------------------- */
window.editArticle = function (articleId) {
  if (!isOwnerLoggedIn()) {
    openLogin();
    return;
  }

  const data = globalArticlesCache.find((a) => a.id === articleId);
  if (!data) {
    alert(
      "This note isn't editable — it might be hardcoded into the HTML or not found in the database.",
    );
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
  const isStatic = STATIC_TOPICS.includes(data.topicId);

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
    alert("Failed to delete article: " + error.message);
    return;
  }

  globalArticlesCache = globalArticlesCache.filter((a) => a.id !== articleId);

  const el = document.getElementById(articleId);
  const container = el ? el.closest(".carousel-container") : null;
  if (el) el.remove();
  if (container) initSingleCarousel(container);
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
    topicLabel = STATIC_TOPIC_LABELS[topicSelectVal] || topicSelectVal;
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
  track.appendChild(buildArticleElement(dataApp));

  if (
    oldContainer &&
    oldContainer !== section.querySelector(".carousel-container")
  ) {
    initSingleCarousel(oldContainer);
  }

  initSingleCarousel(section.querySelector(".carousel-container"));
  editingArticleId = null;
  closeEditor();
};

function setEditorStatus(message) {
  const el = document.getElementById("editorStatus");
  if (el) el.textContent = message;
}

/* --------------------------------------------------------------------------
   12. BACKUP / MIGRATION & EDITOR TOOLS
-------------------------------------------------------------------------- */
window.exportArticlesJSON = function () {
  const data = JSON.stringify(globalArticlesCache, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "notes-backup.json";
  link.click();
};

window.importArticlesJSON = function (fileInputEvent) {
  const file = fileInputEvent.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error("Invalid format");

      const dbRows = imported.map((a) => ({
        id: a.id,
        topic_id: a.topicId,
        topic_label: a.topicLabel,
        topic_icon: a.topicIcon,
        title: a.title,
        excerpt: a.excerpt,
        date_iso: a.dateISO,
        date_display: a.dateDisplay,
        read_time: a.readTime,
        body_html: a.bodyHTML,
      }));

      const { error } = await supabaseClient.from("articles").insert(dbRows);
      if (error) throw new Error(error.message);

      alert("Import success!");
      location.reload();
    } catch (err) {
      alert("Could not import file: " + err.message);
    }
  };
  reader.readAsText(file);
};

// --- CUSTOM HIGHLIGHT WITH TOGGLE (Undo Support) ---
window.applyCustomHighlight = function () {
  const body = document.getElementById("editorBody");
  body.focus();
  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);
  let container = range.commonAncestorContainer;
  if (container.nodeType === 3) container = container.parentNode;

  // Cek apakah teks yang dipilih sudah di dalam span highlight
  const existingHighlight = container.closest(".journal-highlight");

  if (existingHighlight) {
    // 1. Matikan highlight (Unwrap the span to undo it naturally)
    const parent = existingHighlight.parentNode;
    while (existingHighlight.firstChild) {
      parent.insertBefore(existingHighlight.firstChild, existingHighlight);
    }
    parent.removeChild(existingHighlight);

    // Hapus seleksi kursor agar clean
    selection.removeAllRanges();
  } else {
    // 2. Nyalakan highlight (Bungkus dengan span)
    const span = document.createElement("span");
    span.className = "journal-highlight";

    const selectedText = range.extractContents();
    span.appendChild(selectedText);
    range.insertNode(span);

    // Pindahkan kursor ke akhir teks yang baru saja di-highlight
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(span);
    newRange.collapse(true);
    selection.addRange(newRange);
  }

  updateWordCount();
};

// --- SISTEM PENYIMPANAN SELECTION & AUTO-FORMAT ---
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

window.applyLineHeight = function (val) {
  restoreSelection();
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    let node = selection.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    node.style.lineHeight = val;
    node.style.marginBottom = val > 1.5 ? "1.5em" : "1em";
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
      '<table style="width:100%; border-collapse: collapse; border: 1px solid #ccc; margin-bottom: 1rem;"><tbody>';
    for (let i = 0; i < rows; i++) {
      tableHTML += "<tr>";
      for (let j = 0; j < cols; j++) {
        tableHTML +=
          '<td style="border: 1px solid #ccc; padding: 8px;">Sel</td>';
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
        } else {
          alert(
            "Gagal: Struktur baris bawah tidak sejajar karena modifikasi sebelumnya.",
          );
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
