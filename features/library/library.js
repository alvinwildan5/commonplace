/**
 * LIBRARY PAGE LOGIC (library.js)
 */

document.addEventListener("DOMContentLoaded", () => {
  initHeaderScroll();
  initScrollReveal();
});

/* ==========================================================================
   1. LIVE SEARCH LOGIC
   ========================================================================== */
function executeLibrarySearch() {
  const input = document.getElementById("librarySearch").value.toLowerCase();
  const cards = document.querySelectorAll(".book-card");
  const noResultsMsg = document.getElementById("noResultsElement");

  let hasVisibleCards = false;

  cards.forEach((card) => {
    // Mengambil teks dari Judul, Penulis, dan Kategori di dalam card
    const title = card.querySelector("h3").innerText.toLowerCase();
    const author = card.querySelector("p").innerText.toLowerCase();
    const category = card
      .querySelector(".book-category")
      .innerText.toLowerCase();

    // Jika input cocok dengan salah satu dari ketiganya
    if (
      title.includes(input) ||
      author.includes(input) ||
      category.includes(input)
    ) {
      card.style.display = "flex"; // Tampilkan kartu
      hasVisibleCards = true;
    } else {
      card.style.display = "none"; // Sembunyikan kartu
    }
  });

  // Menampilkan pesan "No Results" jika tidak ada buku yang cocok
  if (!hasVisibleCards) {
    noResultsMsg.style.display = "block";
  } else {
    noResultsMsg.style.display = "none";
  }
}

/* ==========================================================================
   2. HEADER SCROLL LOGIC
   ========================================================================== */
function initHeaderScroll() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  window.addEventListener("scroll", () => {
    if (window.scrollY > 50) {
      header.classList.add("scrolled");
    } else {
      header.classList.remove("scrolled");
    }
  });
}

/* ==========================================================================
   3. SCROLL REVEAL ANIMATION (Efek Muncul Perlahan)
   ========================================================================== */
function initScrollReveal() {
  const revealElements = document.querySelectorAll(".reveal-item");

  const revealOptions = {
    threshold: 0.1, // Elemen akan muncul ketika 10% bagiannya terlihat di layar
    rootMargin: "0px 0px -50px 0px",
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        observer.unobserve(entry.target); // Hanya animasikan sekali
      }
    });
  }, revealOptions);

  revealElements.forEach((el) => {
    revealObserver.observe(el);
  });
}

/* ==========================================================================
   4. LANGUAGE SWITCHER LOGIC (Basic)
   ========================================================================== */
function switchLanguage(lang) {
  // Ubah status tombol aktif
  document
    .querySelectorAll(".lang-btn")
    .forEach((btn) => btn.classList.remove("active"));
  document.getElementById(`btn-${lang}`).classList.add("active");

  // Temukan semua elemen yang bisa diterjemahkan
  const elements = document.querySelectorAll(".translatable");

  elements.forEach((el) => {
    // Mengganti teks utama
    if (el.hasAttribute(`data-${lang}`)) {
      el.innerText = el.getAttribute(`data-${lang}`);
    }

    // Mengganti placeholder (khusus untuk input search)
    if (
      el.tagName.toLowerCase() === "input" &&
      el.hasAttribute(`data-${lang}`)
    ) {
      el.setAttribute("placeholder", el.getAttribute(`data-${lang}`));
    }
  });
}
