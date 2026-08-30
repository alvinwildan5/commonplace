/* ==========================================================================
   IVY JOURNAL / DIGITAL LIBRARY
   Main Script
   Features:
   1. Bilingual Language System
   2. Video Audio Control
   3. Hero Section Visibility
   4. Dynamic Header Animation
   5. Digital Library Search
   6. Reading Mode
   7. Share Article
   8. Scroll Reveal Animation
   9. Active Navigation Link
   10. Deep Linking
   11. Supabase Contact Form
   ========================================================================== */
/* ==========================================================================
   GLOBAL FUNCTIONS
   ========================================================================== */
/* --------------------------------------------------------------------------
   1. LANGUAGE SWITCHER
   -------------------------------------------------------------------------- */
function switchLanguage(lang) {
  // Hanya menerima bahasa yang tersedia
  if (lang !== "en" && lang !== "id") return;
  // Ganti semua elemen translatable
  document.querySelectorAll(".translatable").forEach((element) => {
    const translatedText = element.getAttribute(`data-${lang}`);
    if (translatedText !== null) {
      element.innerHTML = translatedText;
    }
  });
  // Update tombol bahasa aktif
  document.querySelectorAll(".lang-btn").forEach((button) => {
    button.classList.remove("active");
  });
  const activeButton = document.getElementById(`btn-${lang}`);
  if (activeButton) {
    activeButton.classList.add("active");
  }
  // Simpan pilihan bahasa
  localStorage.setItem("language", lang);
  // Update atribut bahasa HTML
  document.documentElement.lang = lang;
}
// Supaya bisa dipanggil dari HTML
window.switchLanguage = switchLanguage;
  /* ------------------------------------------------------------------------
     HEADER GLASSMORPHISM SCROLL EFFECT
     ------------------------------------------------------------------------ */
 document.addEventListener("DOMContentLoaded", () => {

  const header = document.querySelector(".site-header");

  if (!header) return;

  const handleScroll = () => {
    if (window.scrollY > window.innerHeight * 0.6) {
      header.classList.add("scrolled");
    } else {
      header.classList.remove("scrolled");
    }
  };

  window.addEventListener("scroll", handleScroll, {
    passive: true
  });

  // Cek kondisi awal
  handleScroll();

});
  /* ------------------------------------------------------------------------
     1. INDEX AFTERMOVIE CYCLICAL CAROUSEL (SMOOTH KIRI-KANAN) & ARROWS
     ------------------------------------------------------------------------ */
  const track = document.getElementById('am-carousel');
  const dotsContainer = document.getElementById('am-dots');
  const prevBtn = document.getElementById('am-prev');
  const nextBtn = document.getElementById('am-next');
  if (track && dotsContainer) {
    const originalItems = Array.from(track.querySelectorAll('.aftermovie-item'));
    const totalOriginal = originalItems.length;
    // 1. Generate Dots secara dinamis
    originalItems.forEach((_, index) => {
      const dot = document.createElement('div');
      dot.classList.add('carousel-dot');
      if (index === 0) dot.classList.add('active');
      dotsContainer.appendChild(dot);
    });
    const dots = Array.from(dotsContainer.querySelectorAll('.carousel-dot'));
    // 2. Clone elemen untuk ilusi Infinite KIRI dan KANAN
    // Clone untuk ditaruh di awal (supaya bisa scroll ke kiri)
    originalItems.forEach(item => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.insertBefore(clone, originalItems[0]);
    });
    // Clone untuk ditaruh di akhir (supaya bisa scroll ke kanan)
    originalItems.forEach(item => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
    // 3. Fungsi menghitung ukuran untuk scroll (Lebar Item + Jarak Gap)
    const getScrollStep = () => {
      const itemWidth = originalItems[0].offsetWidth;
      const gap = parseFloat(getComputedStyle(track).gap) || 24;
      return itemWidth + gap;
    };
    // 4. Set posisi awal ke kelompok video ASLI (di tengah-tengah)
    setTimeout(() => {
      const step = getScrollStep();
      // Scroll secara instan ke kelompok video original
      track.style.scrollBehavior = 'auto';
      track.scrollLeft = totalOriginal * step;
    }, 100);
    let scrollTimeout;
    // 5. Logic saat menggeser (Swipe)
    track.addEventListener('scroll', () => {
      const step = getScrollStep();
      if (!step) return;
      const scrollLeft = track.scrollLeft;
      
      // Menghitung indeks mutlak berdasarkan posisi scroll saat ini
      const absoluteIndex = Math.round(scrollLeft / step);
      
      // Konversi ke indeks titik (dot) yang sesuai (0 sampai totalOriginal - 1)
      let realIndex = (absoluteIndex - totalOriginal) % totalOriginal;
      if (realIndex < 0) realIndex += totalOriginal;
      // Update warna titik (dots) seketika saat scroll
      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === realIndex);
      });
      // MAGIC INFINITE: Loncatan diam-diam (Silent Jump) SETELAH scroll berhenti
      // Ini menyelesaikan masalah patah-patah saat sedang di-swipe
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        // Jika pengguna sudah men-scroll terlalu jauh ke kiri (masuk ke area clone kiri)
        if (scrollLeft <= (totalOriginal - 1) * step) {
          track.style.scrollSnapType = 'none'; // Matikan snap sejenak
          track.scrollLeft = scrollLeft + (totalOriginal * step); // Lempar ke posisi asli
          requestAnimationFrame(() => track.style.scrollSnapType = 'x mandatory');
        } 
        // Jika pengguna sudah men-scroll terlalu jauh ke kanan (masuk ke area clone kanan)
        else if (scrollLeft >= (totalOriginal * 2) * step) {
          track.style.scrollSnapType = 'none';
          track.scrollLeft = scrollLeft - (totalOriginal * step);
          requestAnimationFrame(() => track.style.scrollSnapType = 'x mandatory');
        }
      }, 150); // Loncatan dieksekusi 150ms setelah jari diangkat / scroll berhenti
    });
    // 6. Tombol Panah Klik
    const scrollByArrow = (direction) => {
      const step = getScrollStep();
      track.scrollBy({
        left: direction * step,
        behavior: 'smooth'
      });
    };
    if (prevBtn) prevBtn.addEventListener('click', () => scrollByArrow(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => scrollByArrow(1));
    // 7. Klik Dots
    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        const step = getScrollStep();
        track.scrollTo({
          // Selalu scroll ke set video original di tengah
          left: (totalOriginal + index) * step,
          behavior: 'smooth'
        });
      });
    });
  }
/* --------------------------------------------------------------------------
   2. DIGITAL LIBRARY SEARCH
   -------------------------------------------------------------------------- */
window.executeLibrarySearch = function () {
  const input = document.getElementById("librarySearch");
  if (!input) return;
  const filter = input.value.toLowerCase().trim();
  const cards = document.querySelectorAll(".book-card");
  let visibleCount = 0;
  cards.forEach((card) => {
    const bookInfo = card.querySelector(".book-info");
    if (!bookInfo) return;
    const contentText =
      bookInfo.textContent.toLowerCase();
    if (contentText.includes(filter)) {
      card.style.display = "";
      visibleCount++;
    } else {
      card.style.display = "none";
    }
  });
  // Tampilkan pesan jika tidak ada hasil
  const fallback =
    document.getElementById("noResultsElement");
  if (fallback) {
    fallback.style.display =
      visibleCount === 0 ? "block" : "none";
  }
};
/* --------------------------------------------------------------------------
   3. OPEN ARTICLE
   -------------------------------------------------------------------------- */
window.openArticle = function (articleId) {
  const article =
    document.getElementById(articleId);
  if (!article) return;
  // Tutup artikel lain jika ada
  document
    .querySelectorAll(".is-reading")
    .forEach((item) => {
      item.classList.remove("is-reading");
    });
  // Aktifkan reading mode
  document.body.classList.add(
    "reading-mode-active",
  );
  // Aktifkan overlay
  document
    .getElementById("reading-overlay")
    ?.classList.add("active");
  // Aktifkan artikel
  article.classList.add("is-reading");
  // Update URL hash
  history.replaceState(
    null,
    "",
    `#${encodeURIComponent(articleId)}`,
  );
  // Scroll artikel ke atas
  article.scrollTo({
    top: 0,
    behavior: "smooth",
  });
};
/* --------------------------------------------------------------------------
   4. CLOSE ARTICLE
   -------------------------------------------------------------------------- */
window.closeArticle = function () {
  // Nonaktifkan reading mode
  document.body.classList.remove(
    "reading-mode-active",
  );
  // Hilangkan overlay
  document
    .getElementById("reading-overlay")
    ?.classList.remove("active");
  // Hapus status reading dari artikel
  document
    .querySelectorAll(".is-reading")
    .forEach((article) => {
      article.classList.remove("is-reading");
    });
  // Hapus hash dari URL
  history.replaceState(
    null,
    "",
    window.location.pathname +
      window.location.search,
  );
};
/* --------------------------------------------------------------------------
   5. SHARE ARTICLE
   -------------------------------------------------------------------------- */
window.shareArticle = async function (articleId) {
  const url =
    window.location.href.split("#")[0] +
    "#" +
    articleId;
  // Jika browser mendukung Web Share API
  if (navigator.share) {
    try {
      await navigator.share({
        title: document.title,
        url: url,
      });
      return;
    } catch (error) {
      // Jika user membatalkan share, jangan tampilkan error
      if (error.name === "AbortError") return;
      console.error("Share failed:", error);
    }
  }
  // Fallback: copy link
  try {
    await navigator.clipboard.writeText(url);
    alert("Link copied to clipboard.");
  } catch (error) {
    console.error("Copy failed:", error);
    alert("Unable to copy the link.");
  }
};
/* ==========================================================================
   SUPABASE CONFIGURATION
   ========================================================================== */
// Pastikan library Supabase sudah dimuat di HTML
const SUPABASE_URL =
  "https://fnwbxizcfoltempaiwqj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZud2J4aXpjZm9sdGVtcGFpd3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MjUzMzEsImV4cCI6MjA5ODQwMTMzMX0.HHRuJ0h4a6ufoYM1SeHBqXlO1fJjfGOmv8gTEbMkZ2M";
let supabaseClient = null;
// Cek apakah Supabase tersedia
if (typeof supabase !== "undefined") {
  const { createClient } = supabase;
  supabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  );
} else {
  console.warn(
    "Supabase library is not loaded.",
  );
}
/* ==========================================================================
   DOM READY
   ========================================================================== */
document.addEventListener(
  "DOMContentLoaded",
  () => {
    /* ----------------------------------------------------------------------
       1. INITIAL LANGUAGE
       ---------------------------------------------------------------------- */
    const savedLanguage =
      localStorage.getItem("language") || "en";
    switchLanguage(savedLanguage);
    /* ----------------------------------------------------------------------
       2. VIDEO AUDIO CONTROL
       ---------------------------------------------------------------------- */
    const video =
      document.getElementById("cardVideo");
    const soundBtn =
      document.getElementById("soundToggleCard");
    const iconMuted =
      document.getElementById("icon-muted");
    const iconUnmuted =
      document.getElementById("icon-unmuted");
    if (video && soundBtn) {
      // Set icon awal
      if (iconMuted && iconUnmuted) {
        iconMuted.style.display =
          video.muted ? "block" : "none";
        iconUnmuted.style.display =
          video.muted ? "none" : "block";
      }
      soundBtn.addEventListener(
        "click",
        async () => {
          // Toggle mute
          video.muted = !video.muted;
          // Coba jalankan video
          try {
            await video.play();
          } catch (error) {
            console.error(
              "Video play error:",
              error,
            );
          }
          // Update icon
          if (iconMuted && iconUnmuted) {
            iconMuted.style.display =
              video.muted
                ? "block"
                : "none";
            iconUnmuted.style.display =
              video.muted
                ? "none"
                : "block";
          }
        },
      );
    }
    /* ----------------------------------------------------------------------
       3. HERO VISIBILITY
       ---------------------------------------------------------------------- */
    const hero =
      document.querySelector(".hero-section");
    if (hero) {
      const updateHero = () => {
        if (window.scrollY < 50) {
          hero.classList.add(
            "is-visible",
          );
        } else if (
          window.scrollY >
          window.innerHeight * 0.4
        ) {
          hero.classList.remove(
            "is-visible",
          );
        }
      };
      // Jalankan pertama kali
      updateHero();
      // Jalankan saat scroll
      window.addEventListener(
        "scroll",
        updateHero,
        {
          passive: true,
        },
      );
    }
    /* ----------------------------------------------------------------------
       4. DYNAMIC HEADER PARALLAX
       ---------------------------------------------------------------------- */
    const header =
      document.getElementById(
        "dynamic-header",
      );
    if (header) {
      const container =
        header.querySelector(
          ".ivy-container",
        );
      // Animasi awal
      setTimeout(() => {
        header.classList.add(
          "is-loaded",
        );
      }, 150);
      if (container) {
        window.addEventListener(
          "scroll",
          () => {
            const scrollY =
              window.scrollY;
            // Jika sudah melewati header
            if (
              scrollY >
              header.offsetHeight
            ) {
              return;
            }
            const translateY =
              scrollY * 0.3;
            const opacity =
              1 -
              scrollY /
                (
                  header.offsetHeight *
                  0.8
                );
            container.style.transform =
              `translateY(${translateY}px)`;
            container.style.opacity =
              Math.max(
                0,
                opacity,
              ).toString();
          },
          {
            passive: true,
          },
        );
      }
    }
    window.addEventListener("load", () => {
  const noteHeader = document.querySelector(".note-header");
  if (noteHeader) {
    noteHeader.classList.add("is-loaded");
  }
}); 
  document.addEventListener("DOMContentLoaded", function() {
    // Memberikan sedikit jeda agar transisinya terasa lebih natural
    setTimeout(() => {
      document.querySelector('.note-header').classList.add('is-loaded');
    }, 100);
  });
 
    /* ----------------------------------------------------------------------
       5. SHAPE MORPH ANIMATION
       ---------------------------------------------------------------------- */
    setTimeout(() => {
      document
        .querySelectorAll(
          ".shape-morph",
        )
        .forEach((element) => {
          element.classList.add(
            "morphed",
          );
        });
    }, 1500);
    /* ----------------------------------------------------------------------
       6. CURTAIN REVEAL ANIMATION
       ---------------------------------------------------------------------- */
    if (
      "IntersectionObserver" in window
    ) {
      const revealObserver =
        new IntersectionObserver(
          (
            entries,
            observer,
          ) => {
            entries.forEach(
              (entry) => {
                if (
                  entry.isIntersecting
                ) {
                  entry.target.classList.add(
                    "is-visible",
                  );
                  observer.unobserve(
                    entry.target,
                  );
                }
              },
            );
          },
          {
            threshold: 0.1,
            rootMargin:
              "0px 0px -50px 0px",
          },
        );
      document
        .querySelectorAll(
          ".curtain-reveal",
        )
        .forEach((element) => {
          revealObserver.observe(
            element,
          );
        });
    }
    /* ----------------------------------------------------------------------
       7. ACTIVE NAVIGATION LINK
       ---------------------------------------------------------------------- */
    const currentPage =
      window.location.pathname
        .split("/")
        .pop() || "index.html";
    document
      .querySelectorAll(
        ".nav-links > li > a",
      )
      .forEach((link) => {
        const href =
          link.getAttribute("href");
        if (!href) return;
        // Bersihkan path
        const linkPage =
          href
            .split("/")
            .pop()
            .split("#")[0];
        if (
          linkPage === currentPage
        ) {
          link.classList.add(
            "active",
          );
        }
      });
    /* ----------------------------------------------------------------------
       8. CLOSE READING MODE
       ---------------------------------------------------------------------- */
    document.addEventListener(
      "click",
      (event) => {
        const activeArticle =
          document.querySelector(
            ".is-reading",
          );
        if (!activeArticle) return;
        // Jangan tutup jika klik di dalam artikel
        if (
          activeArticle.contains(
            event.target,
          )
        ) {
          return;
        }
        // Jangan tutup jika klik tombol pembuka artikel
        if (
          event.target.closest(
            "[data-article-id]",
          )
        ) {
          return;
        }
        closeArticle();
      },
    );
    /* ----------------------------------------------------------------------
       9. CLOSE READING MODE WITH ESC
       ---------------------------------------------------------------------- */
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          document.body.classList.contains(
            "reading-mode-active",
          )
        ) {
          closeArticle();
        }
      },
    );
    /* ----------------------------------------------------------------------
       10. DEEP LINKING
       ---------------------------------------------------------------------- */
    if (window.location.hash) {
      const articleId =
        decodeURIComponent(
          window.location.hash.substring(
            1,
          ),
        );
      if (
        document.getElementById(
          articleId,
        )
      ) {
        requestAnimationFrame(
          () => {
            openArticle(
              articleId,
            );
          },
        );
      }
    }
    /* ----------------------------------------------------------------------
       11. SUPABASE CONTACT FORM
       ---------------------------------------------------------------------- */
    const form =
      document.getElementById(
        "contactForm",
      );
    const submitBtn =
      document.getElementById(
        "submitBtn",
      );
    const statusMessage =
      document.getElementById(
        "statusMessage",
      );
    // Hanya jalankan jika form ada
    if (
      form &&
      submitBtn &&
      statusMessage &&
      supabaseClient
    ) {
      form.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();
          /* --------------------------------------------------------------
             UPDATE BUTTON
             -------------------------------------------------------------- */
          submitBtn.disabled = true;
          submitBtn.textContent =
            "Sending...";
          statusMessage.style.display =
            "none";
          /* --------------------------------------------------------------
             GET FORM DATA
             -------------------------------------------------------------- */
          const firstName =
            document
              .getElementById(
                "firstName",
              )
              ?.value
              .trim() || "";
          const lastName =
            document
              .getElementById(
                "lastName",
              )
              ?.value
              .trim() || "";
          const email =
            document
              .getElementById(
                "email",
              )
              ?.value
              .trim() || "";
          const ratingValue =
            document
              .getElementById(
                "rating",
              )
              ?.value || "";
          const message =
            document
              .getElementById(
                "message",
              )
              ?.value
              .trim() || "";
          /* --------------------------------------------------------------
             FORMAT DATA
             -------------------------------------------------------------- */
          const fullName =
            [firstName, lastName]
              .filter(Boolean)
              .join(" ") ||
            "Anonymous";
          const parsedRating =
            ratingValue
              ? parseInt(
                  ratingValue,
                  10,
                )
              : null;
          /* --------------------------------------------------------------
             SEND TO SUPABASE
             -------------------------------------------------------------- */
          try {
            const {
              error,
            } =
              await supabaseClient
                .from(
                  "messages",
                )
                .insert([
                  {
                    name: fullName,
                    email:
                      email || null,
                    rating:
                      parsedRating,
                    message:
                      message,
                  },
                ]);
            if (error) {
              throw error;
            }
            /* ----------------------------------------------------------
               SUCCESS
               ---------------------------------------------------------- */
            statusMessage.textContent =
              "Thank you! Your message has been sent successfully.";
            statusMessage.className =
              "success";
            statusMessage.style.display =
              "block";
            // Reset form
            form.reset();
          } catch (error) {
            console.error(
              "Error submitting form:",
              error,
            );
            /* ----------------------------------------------------------
               ERROR
               ---------------------------------------------------------- */
            statusMessage.textContent =
              "Oops! Something went wrong. Please try again.";
            statusMessage.className =
              "error";
            statusMessage.style.display =
              "block";
          } finally {
            /* ----------------------------------------------------------
               RESET BUTTON
               ---------------------------------------------------------- */
            submitBtn.disabled =
              false;
            submitBtn.textContent =
              "Send Message";
          }
        },
      );
    }
    /* ----------------------------------------------------------------------
       12. LIBRARY SEARCH ON INPUT
       ---------------------------------------------------------------------- */
    const librarySearch =
      document.getElementById(
        "librarySearch",
      );
    if (librarySearch) {
      librarySearch.addEventListener(
        "input",
        () => {
          executeLibrarySearch();
        },
      );
    }
  },
);
let currentActiveArticleId = null;
let currentArticleTitle = "Note";
// Fungsi Buka Artikel
function openArticle(articleId) {
    const article = document.getElementById(articleId);
    const contentToExport = document.getElementById(`content-${articleId}`);
    const modalContent = document.getElementById('reading-content-area');
    
    // Kloning konten dari kartu ke dalam modal pembaca
    modalContent.innerHTML = contentToExport.innerHTML;
    
    // Ambil judul untuk keperluan nama file saat download
    const titleEl = modalContent.querySelector('.ed-title');
    if (titleEl) currentArticleTitle = titleEl.innerText;
    
    currentActiveArticleId = articleId;
    document.getElementById('reading-overlay').classList.add('active');
    document.body.style.overflow = 'hidden'; // Kunci scroll latar
}
// Fungsi Tutup Artikel
function closeArticle() {
    document.getElementById('reading-overlay').classList.remove('active');
    document.body.style.overflow = 'auto';
    currentActiveArticleId = null;
}
// ==========================================
// FUNGSI EXPORT (PDF, WORD, PNG)
// ==========================================
function downloadNote(format) {
    const element = document.getElementById('reading-content-area');
    const filename = `${currentArticleTitle.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
    if (format === 'pdf') {
        const opt = {
            margin:       0.5,
            filename:     `${filename}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(element).save();
    } 
    else if (format === 'png') {
        html2canvas(element, { useCORS: true, scale: 2 }).then(canvas => {
            const link = document.createElement('a');
            link.download = `${filename}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        });
    } 
    else if (format === 'word') {
        // Konversi sederhana HTML ke Word (.doc)
        const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export HTML to Word</title></head><body>";
        const footer = "</body></html>";
        const sourceHTML = header + element.innerHTML + footer;
        
        const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
        const fileDownload = document.createElement("a");
        document.body.appendChild(fileDownload);
        fileDownload.href = source;
        fileDownload.download = `${filename}.doc`;
        fileDownload.click();
        document.body.removeChild(fileDownload);
    }
}
// Bahasa Sederhana
function switchLanguage(lang) {
    document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${lang}`).classList.add('active');
    
    document.querySelectorAll('.translatable').forEach(el => {
        if(el.dataset[lang]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = el.dataset[lang];
            } else {
                el.innerText = el.dataset[lang];
            }
        }
    });
}