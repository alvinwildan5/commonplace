/* ==========================================================================
   IVY JOURNAL / DIGITAL LIBRARY
   Main Script

   Features:
   1. Bilingual Language System
   2. Dynamic Hero Parallax Fade
   3. Header Scroll Effect
   4. Index Aftermovie Cyclical Carousel
   5. Digital Library Search
   6. Reading Mode & Share (from other sections)

   ----------------------------------------------------------------------
   CATATAN SEO (dibaca dulu sebelum menyunting ulang):
   File ini TIDAK diubah logikanya sama sekali dari versi asli. Setelah
   ditinjau baris demi baris, tidak ada perbaikan SEO yang relevan untuk
   ditempatkan di sini — semua perbaikan SEO (meta description, canonical,
   Open Graph, Twitter Card, JSON-LD, iframe title/lazy-load, perbaikan
   hierarki heading) sepenuhnya berada di index.html, karena SEO pada
   dasarnya soal apa yang dikirim di HTML (dan bisa dibaca crawler),
   bukan soal interaktivitas di JS.

   Satu hal DI LUAR cakupan SEO yang saya temukan saat meninjau (SENGAJA
   TIDAK diperbaiki di sini karena permintaannya adalah "jangan ubah
   apa pun kecuali SEO"): blok `document.addEventListener("DOMContentLoaded", ...)`
   untuk Interactive Dashboard (GEE) di bagian bawah file ini di-nest di
   DALAM listener DOMContentLoaded yang sudah berjalan. Karena event
   DOMContentLoaded cuma terjadi sekali, listener yang didaftarkan
   belakangan (saat event itu sudah lewat) tidak akan pernah terpanggil
   -- artinya seluruh blok inisialisasi GEE (observer, iframe load/error
   listener, resize handler) kemungkinan besar tidak pernah jalan.
   Ini murni bug fungsional, bukan isu SEO, jadi saya laporkan saja di
   sini tanpa menyentuhnya — beri tahu saya kalau mau sekalian dibetulkan.
   ---------------------------------------------------------------------- */

/* ==========================================================================
   GLOBAL FUNCTIONS
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. LANGUAGE SWITCHER
   -------------------------------------------------------------------------- */

function switchLanguage(lang) {
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

  if (activeButton) {
    activeButton.classList.add("active");
  }

  localStorage.setItem("language", lang);
  document.documentElement.lang = lang;
}

window.switchLanguage = switchLanguage;

/* ==========================================================================
   DOM READY INIT
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  /* ------------------------------------------------------------------------
     1. INITIAL LANGUAGE
     ------------------------------------------------------------------------ */

  const savedLanguage = localStorage.getItem("language") || "en";

  switchLanguage(savedLanguage);

  /* ------------------------------------------------------------------------
     2. HEADER SCROLL EFFECT
     ------------------------------------------------------------------------ */

  const header = document.querySelector(".site-header");

  if (header) {
    const handleScrollHeader = () => {
      if (window.scrollY > window.innerHeight * 0.4) {
        header.classList.add("scrolled");
      } else {
        header.classList.remove("scrolled");
      }
    };

    window.addEventListener("scroll", handleScrollHeader, { passive: true });

    handleScrollHeader();
  }

  /* ------------------------------------------------------------------------
     3. DYNAMIC HERO SCROLL
        Fade + Vertical Parallax

        Telah digabungkan menggunakan requestAnimationFrame
        agar lebih smooth.
     ------------------------------------------------------------------------ */

  const heroText = document.getElementById("heroText");
  const heroImage = document.querySelector(".hero-split-image img");

  if (heroText) {
    const FADE_DISTANCE = 380;
    const TEXT_PARALLAX = 0.45;
    const IMAGE_PARALLAX = 0.1;

    let ticking = false;

    const updateHero = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      const progress = Math.min(scrollY / FADE_DISTANCE, 1);

      /* Text Opacity & Translation */

      const opacity = 1 - progress;
      const translateY = -(scrollY * TEXT_PARALLAX);

      heroText.style.opacity = opacity;

      heroText.style.transform = `translate3d(0, ${translateY}px, 0)`;

      /* Image Parallax
         Slow cinematic zoom & pan */

      if (heroImage) {
        const imageTranslate = scrollY * IMAGE_PARALLAX;

        heroImage.style.transform = `scale(1.03) translate3d(0, ${imageTranslate}px, 0)`;
      }

      ticking = false;
    };

    const requestUpdate = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateHero);
        ticking = true;
      }
    };

    window.addEventListener("scroll", requestUpdate, { passive: true });

    window.addEventListener("resize", requestUpdate, { passive: true });

    /* Run on page load */

    updateHero();
  }

  /* ------------------------------------------------------------------------
     4. INDEX AFTERMOVIE CYCLICAL CAROUSEL
     ------------------------------------------------------------------------ */

  const track = document.getElementById("am-carousel");
  const dotsContainer = document.getElementById("am-dots");
  const prevBtn = document.getElementById("am-prev");
  const nextBtn = document.getElementById("am-next");

  if (track && dotsContainer) {
    const originalItems = Array.from(
      track.querySelectorAll(".aftermovie-item"),
    );

    const totalOriginal = originalItems.length;

    /* Generate Dots */

    originalItems.forEach((_, index) => {
      const dot = document.createElement("div");

      dot.classList.add("carousel-dot");

      if (index === 0) {
        dot.classList.add("active");
      }

      dotsContainer.appendChild(dot);
    });

    const dots = Array.from(dotsContainer.querySelectorAll(".carousel-dot"));

    /* Clone elemen untuk infinite loop */

    originalItems.forEach((item) => {
      const clone = item.cloneNode(true);

      clone.setAttribute("aria-hidden", "true");

      track.insertBefore(clone, originalItems[0]);
    });

    originalItems.forEach((item) => {
      const clone = item.cloneNode(true);

      clone.setAttribute("aria-hidden", "true");

      track.appendChild(clone);
    });

    /* Get Scroll Step */

    const getScrollStep = () => {
      const itemWidth = originalItems[0].offsetWidth;

      const gap = parseFloat(getComputedStyle(track).gap) || 32;

      return itemWidth + gap;
    };

    /* Posisi Awal */

    setTimeout(() => {
      const step = getScrollStep();

      track.style.scrollBehavior = "auto";

      track.scrollLeft = totalOriginal * step;
    }, 100);

    /* Scroll Handler */

    let scrollTimeout;

    track.addEventListener("scroll", () => {
      const step = getScrollStep();

      if (!step) return;

      const scrollLeft = track.scrollLeft;

      const absoluteIndex = Math.round(scrollLeft / step);

      let realIndex = (absoluteIndex - totalOriginal) % totalOriginal;

      if (realIndex < 0) {
        realIndex += totalOriginal;
      }

      /* Update Active Dot */

      dots.forEach((dot, index) => {
        dot.classList.toggle("active", index === realIndex);
      });

      /* Silent Jump Infinite */

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

    /* Arrow Navigation */

    const scrollByArrow = (direction) => {
      const step = getScrollStep();

      track.scrollBy({
        left: direction * step,
        behavior: "smooth",
      });
    };

    if (prevBtn) {
      prevBtn.addEventListener("click", () => scrollByArrow(-1));
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => scrollByArrow(1));
    }

    /* Dot Navigation */

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

  /* ------------------------------------------------------------------------
     5. ACTIVE NAVIGATION LINK
     ------------------------------------------------------------------------ */

  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll(".nav-links > li > a").forEach((link) => {
    const href = link.getAttribute("href");

    if (!href) return;

    const linkPage = href.split("/").pop().split("#")[0];

    if (linkPage === currentPage) {
      link.classList.add("active");
    }
  });

  /* ------------------------------------------------------------------------
     6. DYNAMIC HEADER PARALLAX
        For library/profile fallback if used
     ------------------------------------------------------------------------ */

  const dynamicHeader = document.getElementById("dynamic-header");

  if (dynamicHeader) {
    const container = dynamicHeader.querySelector(".ivy-container");

    /* Header Load Animation */

    setTimeout(() => {
      dynamicHeader.classList.add("is-loaded");
    }, 150);

    /* Header Parallax */

    if (container) {
      window.addEventListener(
        "scroll",
        () => {
          const scrollY = window.scrollY;

          if (scrollY > dynamicHeader.offsetHeight) {
            return;
          }

          const translateY = scrollY * 0.3;

          const opacity = 1 - scrollY / (dynamicHeader.offsetHeight * 0.8);

          container.style.transform = `translateY(${translateY}px)`;

          container.style.opacity = Math.max(0, opacity).toString();
        },
        { passive: true },
      );
    }
  }

  /* =========================================================
     INTERACTIVE DASHBOARD — GEE
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    const geeWrapper = document.getElementById("gee-reveal");

    const geeIframe = document.querySelector(".gee-frame-container iframe");

    /* -------------------------------------------------------
       SAFETY CHECK
       ------------------------------------------------------- */

    if (!geeWrapper) {
      console.warn("Interactive Dashboard: #gee-reveal tidak ditemukan.");

      return;
    }

    /* -------------------------------------------------------
       FORCE VISIBLE
       ------------------------------------------------------- */

    geeWrapper.classList.add("is-visible");

    /* -------------------------------------------------------
       GEE IFRAME LOAD MONITOR
       ------------------------------------------------------- */

    if (geeIframe) {
      geeIframe.addEventListener("load", () => {
        console.log("Lusi Mangrove Dashboard berhasil dimuat.");

        geeWrapper.classList.add("is-visible");
      });

      /* -----------------------------------------------------
         ERROR DETECTION
         ----------------------------------------------------- */

      geeIframe.addEventListener("error", () => {
        console.error("Gagal memuat Google Earth Engine Dashboard.");
      });
    }

    /* -------------------------------------------------------
       OPTIONAL SCROLL REVEAL

       Hanya digunakan untuk animasi.
       Dashboard TIDAK akan menghilang jika observer gagal.
       ------------------------------------------------------- */

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              geeWrapper.classList.add("is-visible");

              observer.unobserve(entry.target);
            }
          });
        },
        {
          threshold: 0.05,
          rootMargin: "0px 0px -50px 0px",
        },
      );

      observer.observe(geeWrapper);
    }

    /* -------------------------------------------------------
       RESIZE HANDLING
       ------------------------------------------------------- */

    const resizeGeeFrame = () => {
      if (!geeIframe) return;

      /*
         Jangan mengubah tinggi iframe secara agresif.
         CSS menangani responsive height.
      */

      geeIframe.style.width = "100%";

      geeIframe.style.display = "block";
    };

    resizeGeeFrame();

    window.addEventListener("resize", resizeGeeFrame, { passive: true });

    /* -------------------------------------------------------
       DEBUG INFORMATION
       ------------------------------------------------------- */

    console.log("Interactive Dashboard initialized.");
  });
});
