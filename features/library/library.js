/**
 * LIBRARY PAGE LOGIC (library.js)
 */

document.addEventListener("DOMContentLoaded", () => {
  initHeaderScroll();
  initScrollReveal();

  // 1. Panggil fungsi inisialisasi bahasa saat halaman dimuat
  initLanguage();
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
    const title = card.querySelector("h3").innerText.toLowerCase();
    const author = card.querySelector("p").innerText.toLowerCase();
    const category = card
      .querySelector(".book-category")
      .innerText.toLowerCase();

    if (
      title.includes(input) ||
      author.includes(input) ||
      category.includes(input)
    ) {
      card.style.display = "flex";
      hasVisibleCards = true;
    } else {
      card.style.display = "none";
    }
  });

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
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        observer.unobserve(entry.target);
      }
    });
  }, revealOptions);

  revealElements.forEach((el) => {
    revealObserver.observe(el);
  });
}

/* ==========================================================================
   4. LANGUAGE SWITCHER LOGIC (Dengan LocalStorage)
   ========================================================================== */

// Fungsi baru untuk mengecek bahasa yang tersimpan saat pertama load
function initLanguage() {
  // Ambil bahasa dari localStorage, jika tidak ada, gunakan 'en' sebagai default
  const savedLang = localStorage.getItem("selectedLanguage") || "en";
  switchLanguage(savedLang);
}

function switchLanguage(lang) {
  // 2. Simpan pilihan bahasa ke localStorage
  localStorage.setItem("selectedLanguage", lang);

  // Ubah status tombol aktif
  document
    .querySelectorAll(".lang-btn")
    .forEach((btn) => btn.classList.remove("active"));

  const activeButton = document.getElementById(`btn-${lang}`);
  if (activeButton) {
    activeButton.classList.add("active");
  }

  // Temukan semua elemen yang bisa diterjemahkan
  const elements = document.querySelectorAll(".translatable");

  elements.forEach((el) => {
    if (el.hasAttribute(`data-${lang}`)) {
      // Mengganti placeholder jika elemen adalah input
      if (el.tagName.toLowerCase() === "input") {
        el.setAttribute("placeholder", el.getAttribute(`data-${lang}`));
      } else {
        // Mengganti teks utama untuk elemen lain
        el.innerText = el.getAttribute(`data-${lang}`);
      }
    }
  });
}
