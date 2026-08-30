/* ==========================================================================
   PROFILE PAGE SCRIPT
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
  if (activeButton) activeButton.classList.add("active");

  localStorage.setItem("language", lang);
  document.documentElement.lang = lang;
}
window.switchLanguage = switchLanguage;

/* --------------------------------------------------------------------------
   2. DOM READY & INITIALIZATIONS
   -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // Set Language
  const savedLanguage = localStorage.getItem("language") || "en";
  switchLanguage(savedLanguage);

  // Header Scroll Effect
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

  // Scroll Reveal Animations
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("active");
        }
      });
    },
    { threshold: 0.1 },
  );

  document.querySelectorAll(".reveal-item").forEach((item) => {
    observer.observe(item);
  });

  /* ----------------------------------------------------------------------
     3. SUPABASE CONTACT FORM
     ---------------------------------------------------------------------- */
  const SUPABASE_URL = "https://hieryuiikzcrvssuvsmn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_O0XW4AxwOSNv1cvGkxx5Tg_8XTOnRzF";

  let supabaseClient = null;
  if (typeof supabase !== "undefined") {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  const form = document.getElementById("contactForm");
  const submitBtn = document.getElementById("submitBtn");
  const statusMessage = document.getElementById("statusMessage");

  if (form && submitBtn && statusMessage && supabaseClient) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      // Loading State
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";
      statusMessage.style.display = "none";

      // Collect Data
      const firstName =
        document.getElementById("firstName")?.value.trim() || "";
      const lastName = document.getElementById("lastName")?.value.trim() || "";
      const email = document.getElementById("email")?.value.trim() || "";
      const ratingValue = document.getElementById("rating")?.value || "";
      const message = document.getElementById("message")?.value.trim() || "";
      const fullName =
        [firstName, lastName].filter(Boolean).join(" ") || "Anonymous";
      const parsedRating = ratingValue ? parseInt(ratingValue, 10) : null;

      try {
        const { error } = await supabaseClient.from("messages").insert([
          {
            name: fullName,
            email: email || null,
            rating: parsedRating,
            message: message,
          },
        ]);

        if (error) throw error;

        // Success
        statusMessage.textContent =
          "Thank you! Your message has been sent successfully.";
        statusMessage.className = "success";
        statusMessage.style.display = "block";
        form.reset();
      } catch (error) {
        console.error("Form Error:", error);
        statusMessage.textContent =
          "Oops! Something went wrong. Please try again.";
        statusMessage.className = "error";
        statusMessage.style.display = "block";
      } finally {
        // Reset Button
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Message";
      }
    });
  }
});
