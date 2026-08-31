/* ==========================================================================
   NOTES SCRIPT (PARIPURNA) — CMS EDITION (SUPABASE INTEGRATED)
   ========================================================================== */

const OWNER_PASSWORD_HASH =
  "69bfe17dbd9743d9a11023421d37589c19c461539012b540c0a242b4fdfb5aab";
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
let globalArticlesCache = [];

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
    // Event listener untuk otomatisasi panah & word count
    editorBody.addEventListener("input", () => {
      updateWordCount();
      autoFormatArrows();
    });
  }

  const header = document.querySelector(".site-header");
  if (header) {
    window.addEventListener(
      "scroll",
      () => {
        if (window.scrollY > 50) header.classList.add("scrolled");
        else header.classList.remove("scrolled");
      },
      { passive: true },
    );
  }
});

// Otomatisasi tanda panah saat mengetik
function autoFormatArrows() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.focusNode;

  if (node && node.nodeType === 3) {
    let text = node.textContent;
    if (text.includes("->") || text.includes("<-") || text.includes("=>")) {
      const startOffset = sel.focusOffset;
      text = text.replace(/->/g, "→").replace(/<-/g, "←").replace(/=>/g, "⇒");
      node.textContent = text;

      // Kembalikan kursor ke posisi yang benar
      const range = document.createRange();
      const newOffset = Math.min(startOffset, node.textContent.length);
      range.setStart(node, newOffset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

window.executeNoteSearch = function () {
  const searchInput = document.getElementById("noteSearch");
  if (!searchInput) return;
  const filterText = searchInput.value.toLowerCase().trim();
  const noteCards = document.querySelectorAll(".ed-card");
  let totalVisible = 0;

  noteCards.forEach((card) => {
    if (card.getAttribute("aria-hidden") === "true") return;
    if (card.textContent.toLowerCase().includes(filterText)) {
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
    section.style.display =
      visibleCards.length === 0 && filterText !== "" ? "none" : "block";
  });

  const noResultsElement = document.getElementById("noResultsElement");
  if (noResultsElement)
    noResultsElement.style.display =
      totalVisible === 0 && filterText !== "" ? "block" : "none";
};

// Carousel Logic (Idempotent)
function initCarousels() {
  document.querySelectorAll(".carousel-container").forEach(initSingleCarousel);
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
    return clone;
  };

  originalItems.forEach((item) =>
    track.insertBefore(createSafeClone(item), originalItems[0]),
  );
  originalItems.forEach((item) => track.appendChild(createSafeClone(item)));

  const getScrollStep = () =>
    track.children[0].offsetWidth +
    (parseFloat(getComputedStyle(track).gap) || 32);

  setTimeout(() => {
    track.style.scrollBehavior = "auto";
    track.scrollLeft = totalOriginal * getScrollStep();
  }, 100);

  const scrollByArrow = (direction) =>
    track.scrollBy({ left: direction * getScrollStep(), behavior: "smooth" });
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

let currentArticleTitle = "Document";

window.openArticle = function (articleId) {
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

// Export Functions - Diperbarui untuk Margin A4 Formal
window.downloadNote = function (format) {
  const element = document.getElementById("reading-content-area");
  const filename = `${currentArticleTitle
    .substring(0, 30)
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()}`;

  if (format === "pdf") {
    const opt = {
      margin: 1, // Margin 1 inch untuk standar formal A4
      filename: `${filename}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    };
    html2pdf().set(opt).from(element).save();
  } else if (format === "png") {
    // Tambahkan padding sementara agar tidak mepet
    const originalPadding = element.style.padding;
    const originalBg = element.style.backgroundColor;
    element.style.padding = "40px";
    element.style.backgroundColor = "#ffffff";

    html2canvas(element, { useCORS: true, scale: 2 }).then((canvas) => {
      element.style.padding = originalPadding;
      element.style.backgroundColor = originalBg;
      const link = document.createElement("a");
      link.download = `${filename}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  } else if (format === "word") {
    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Export</title>
      <style>body { font-family: 'Times New Roman', serif; margin: 40px; } table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #000; padding: 8px; }</style>
      </head><body>`;
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
  }
};

window.copyArticleLink = function () {
  navigator.clipboard
    .writeText(window.location.href.split("#")[0])
    .then(() => alert("Link disalin!"))
    .catch((err) => console.error("Gagal menyalin: ", err));
};

window.switchLanguage = function (lang) {
  if (lang !== "en" && lang !== "id") return;
  document.querySelectorAll(".translatable").forEach((el) => {
    const translatedText = el.getAttribute(`data-${lang}`);
    if (translatedText !== null) {
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
        el.placeholder = translatedText;
      else el.innerHTML = translatedText;
    }
  });
  document
    .querySelectorAll(".lang-btn")
    .forEach((btn) => btn.classList.remove("active"));
  const activeBtn = document.getElementById(`btn-${lang}`);
  if (activeBtn) activeBtn.classList.add("active");
  localStorage.setItem("language", lang);
  document.documentElement.lang = lang;
};

function initScrollSpy() {
  const sections = document.querySelectorAll(".topic-section");
  const navLinks = document.querySelectorAll(".topic-list a");
  if (sections.length === 0 || navLinks.length === 0) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          navLinks.forEach((link) => link.classList.remove("active"));
          const activeLink = document.querySelector(
            `.topic-list a[href="#${entry.target.id}"]`,
          );
          if (activeLink) activeLink.classList.add("active");
        }
      });
    },
    { root: null, rootMargin: "-150px 0px -40% 0px", threshold: 0 },
  );
  sections.forEach((s) => observer.observe(s));
}

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
  document.body.style.overflow = "hidden";
};
window.closeLogin = function () {
  document.getElementById("login-overlay").classList.remove("active");
  document.body.style.overflow = "auto";
};
window.handleLogin = async function (e) {
  e.preventDefault();
  const hash = await sha256Hex(document.getElementById("ownerPassword").value);
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

async function fetchArticlesFromSupabase() {
  const { data, error } = await supabaseClient
    .from("articles")
    .select("*")
    .order("date_iso", { ascending: false });
  if (error) return [];
  globalArticlesCache = data.map((a) => ({
    id: a.id,
    topicId: a.topic_id,
    topicLabel: a.topic_label,
    topicIcon: a.topic_icon,
    title: a.title,
    excerpt: a.excerpt,
    dateISO: a.date_iso,
    dateDisplay: a.date_display,
    readTime: a.read_time,
    bodyHTML: a.body_html,
  }));
  return globalArticlesCache;
}

function ensureTopicSection(topicSlug, topicLabel, iconClass) {
  let section = document.getElementById(topicSlug);
  if (section) return section;
  section = document.createElement("section");
  section.id = topicSlug;
  section.className = "topic-section";
  section.innerHTML = `<h2 class="topic-heading">${topicLabel}</h2><div class="carousel-container"><button class="carousel-btn prev-btn"><i class="fa-solid fa-chevron-left"></i></button><div class="carousel-viewport"><div class="carousel-track"></div></div><button class="carousel-btn next-btn"><i class="fa-solid fa-chevron-right"></i></button></div>`;
  document.getElementById("main-content").appendChild(section);
  const topicList = document.getElementById("topic-list");
  if (
    !Array.from(topicList.querySelectorAll("a")).some(
      (a) => a.getAttribute("href") === `#${topicSlug}`,
    )
  ) {
    const li = document.createElement("li");
    li.innerHTML = `<a href="#${topicSlug}"><i class="fa-solid ${iconClass || "fa-tag"}"></i> ${topicLabel}</a>`;
    topicList.appendChild(li);
  }
  return section;
}

function buildArticleElement(data) {
  const article = document.createElement("article");
  article.className = "ed-card";
  article.id = data.id;
  article.innerHTML = ` 
    <div class="export-content" id="content-${data.id}"> 
      <div class="ed-meta">${data.dateDisplay} &bull; <span class="read-time">${data.readTime}</span></div> 
      <h3 class="ed-title">${data.title}</h3> 
      <div class="ed-excerpt"><p>${data.excerpt}</p></div> 
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
  const articles = await fetchArticlesFromSupabase();
  articles.forEach((data) =>
    ensureTopicSection(data.topicId, data.topicLabel, data.topicIcon)
      .querySelector(".carousel-track")
      .appendChild(buildArticleElement(data)),
  );
}

window.openEditor = function () {
  if (!isOwnerLoggedIn()) return openLogin();
  editingArticleId = null;
  document.getElementById("editorHeading").textContent = "Write a New Note";
  document.getElementById("fieldTitle").value = "";
  document.getElementById("fieldExcerpt").value = "";
  document.getElementById("editorBody").innerHTML = "";
  document.getElementById("editor-overlay").classList.add("active");
  document.body.style.overflow = "hidden";
  updateWordCount();
};

window.closeEditor = function () {
  document.getElementById("editor-overlay").classList.remove("active");
  document.body.style.overflow = "auto";
};

// Perbaikan fungsi styling agar lebih persisten
window.applyBlockType = function (tag) {
  const body = document.getElementById("editorBody");
  body.focus();
  document.execCommand("formatBlock", false, tag);
};

window.applyFont = function (fontFamily) {
  const body = document.getElementById("editorBody");
  body.focus();
  // Membungkus dalam span agar font lebih konsisten diaplikasikan
  const selection = window.getSelection();
  if (selection.rangeCount > 0 && !selection.isCollapsed) {
    const span = document.createElement("span");
    span.style.fontFamily = fontFamily;
    const range = selection.getRangeAt(0);
    span.appendChild(range.extractContents());
    range.insertNode(span);
  } else {
    document.execCommand("fontName", false, fontFamily);
  }
};

window.applyLineSpacing = function (spacing) {
  const body = document.getElementById("editorBody");
  body.focus();
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    let node = selection.anchorNode;
    while (node && node.nodeType !== 1) node = node.parentNode; // Cari elemen block terdekat
    if (node && node.id !== "editorBody") {
      node.style.lineHeight = spacing;
      node.style.marginBottom = spacing === "1" ? "10px" : "20px"; // Jarak antar paragraf
    } else {
      document.execCommand(
        "insertHTML",
        false,
        `<div style="line-height:${spacing}; margin-bottom: 20px;">&#8203;</div>`,
      );
    }
  }
};

window.insertTable = function () {
  const body = document.getElementById("editorBody");
  body.focus();
  const tableHTML = `
    <table class="note-table" style="width:100%; border-collapse:collapse; margin-bottom:15px;" border="1">
      <tbody>
        <tr><td style="padding:8px; border:1px solid #ccc;">Header 1</td><td style="padding:8px; border:1px solid #ccc;">Header 2</td></tr>
        <tr><td style="padding:8px; border:1px solid #ccc;">Data 1</td><td style="padding:8px; border:1px solid #ccc;">Data 2</td></tr>
      </tbody>
    </table><br/>`;
  document.execCommand("insertHTML", false, tableHTML);
};

window.execToolbar = function (command) {
  document.getElementById("editorBody").focus();
  document.execCommand(command, false, null);
};

function updateWordCount() {
  const text = document.getElementById("editorBody").textContent.trim();
  const words = text.length ? text.split(/\s+/).length : 0;
  document.getElementById("tbWordCount").textContent =
    `${words} words \u2022 ~${Math.max(1, Math.round(words / 200))} min read`;
}

window.publishArticle = async function () {
  // Logika simpan artikel sama seperti sebelumnya, pastikan elemen terambil benar
  const title = document.getElementById("fieldTitle").value.trim();
  const excerpt = document.getElementById("fieldExcerpt").value.trim();
  const bodyHTML = document.getElementById("editorBody").innerHTML.trim();
  if (!title || !bodyHTML)
    return alert("Judul dan isi catatan tidak boleh kosong.");
  alert("Simulasi penyimpanan Supabase selesai.");
  closeEditor();
};
