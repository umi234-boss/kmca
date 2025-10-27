/* =============================
   /assets/app.js (공통 스크립트) - 개선판
   ============================= */

// 현재 스크립트/바디에서 base 경로 읽기 (예: "/" 또는 "/kmca/")
function getBasePath() {
  const fromScript = document
    .querySelector('script[src*="assets/app.js"]')
    ?.getAttribute("data-base");
  const fromBody = document.body.getAttribute("data-base");
  return fromScript || fromBody || "";
}

// 네이버 애널리틱스 (WCS) 스크립트 로드
function initNaverAnalytics() {
  const SITE_KEY = "23ff2123920380";
  if (window.__kmcaNaverAnalyticsInitialized) return;
  const head = document.head;
  if (!head) return;

  window.__kmcaNaverAnalyticsInitialized = true;
  window.wcs_add = window.wcs_add || {};
  window.wcs_add.wa = SITE_KEY;

  const script = document.createElement("script");
  script.src = "https://wcs.pstatic.net/wcslog.js";
  script.async = true;
  script.onload = () => {
    if (typeof window.wcs !== "undefined" && typeof window.wcs_do === "function") {
      window.wcs_do();
    }
  };
  head.appendChild(script);
}

// 주어진 URL을 순차 시도하며 첫 성공을 반환
async function tryFetch(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.text();
      // 404 등 비정상은 다음 후보 시도
    } catch (_) {
      // 네트워크 오류 → 다음 후보 시도
    }
  }
  throw new Error(`[tryFetch] all failed: ${urls.join(" , ")}`);
}

// HTML 파셜 주입 (경로 복구 포함)
async function inject(selector, partialPath) {
  const mount = document.querySelector(selector);
  if (!mount) return null;

  const base = getBasePath(); // 예: "/" 또는 "/사이트루트/"
  const candidates = [
    partialPath, // "partials/header.html"
    "/" + partialPath.replace(/^\/+/, ""), // "/partials/header.html"
    (base + "/" + partialPath).replace(/\/{2,}/g, "/"), // "/사이트루트/partials/header.html"
  ];

  try {
    const html = await tryFetch(candidates);
    mount.innerHTML = html;
    return mount;
  } catch (e) {
    console.warn("[inject] failed:", selector, partialPath, e);
    return null;
  }
}

// 현재 페이지 활성 링크 표시 (.is-active)
function setActiveNav() {
  const cur = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".top-link[data-href]").forEach((a) => {
    if (a.getAttribute("data-href") === cur) {
      a.classList.add("is-active");
      const up = a.closest(".has-sub");
      if (up) up.querySelector(".top-link")?.classList.add("is-active");
    }
  });
}

// 드롭다운 접근성/모바일 클릭 토글
function enhanceDropdowns() {
  document.querySelectorAll(".kmca-nav .has-sub").forEach((li) => {
    const trigger = li.querySelector(".top-link");
    const menu = li.querySelector(".submenu");
    if (!trigger || !menu) return;

    // ARIA
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");

    let closeTimer = null;
    const setVisible = (shown) => {
      if (shown) {
        menu.style.display = "block";
        trigger.setAttribute("aria-expanded", "true");
        li.classList.add("is-open");
        return;
      }
      menu.style.display = "none";
      trigger.setAttribute("aria-expanded", "false");
      li.classList.remove("is-open");
    };
    const open = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      setVisible(true);
    };
    const close = (immediate = false) => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      if (immediate) {
        setVisible(false);
        return;
      }
      closeTimer = window.setTimeout(() => {
        setVisible(false);
        closeTimer = null;
      }, 140);
    };

    // 마우스/포커스/ESC
    li.addEventListener("mouseenter", open);
    li.addEventListener("mouseleave", () => close());
    menu.addEventListener("mouseenter", open);
    menu.addEventListener("mouseleave", () => close());
    li.addEventListener("focusin", open);
    li.addEventListener("focusout", (e) => {
      if (!li.contains(e.relatedTarget)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(true);
    });
    document.addEventListener("kmca:menu-close", () => close(true));

    // 터치/모바일: 클릭 토글
    trigger.addEventListener("click", (e) => {
      // 상위 페이지 이동 막고 토글 (원하면 제거)
      e.preventDefault();
      const shown = menu.style.display === "block";
      shown ? close(true) : open();
    });
  });
}

// 페이지별 헤더 모드 적용 (투명/흰배경)
function applyHeaderMode() {
  const mode =
    document.body.getAttribute("data-header-mode") ||
    (location.pathname.endsWith("index.html") || location.pathname === "/"
      ? "transparent"
      : "solid");

  const el = document.querySelector(".kmca-header");
  if (!el) return;

  el.classList.toggle("kmca-header--transparent", mode === "transparent");
  el.classList.toggle("kmca-header--solid", mode === "solid");
  // 안전한 기본 z-index/sticky
  el.style.position = el.style.position || "sticky";
  el.style.top = el.style.top || "0";
  el.style.zIndex = el.style.zIndex || "1000";
}

function setupMobileNav() {
  const header = document.querySelector(".kmca-header");
  if (!header) return;

  const toggle = header.querySelector(".kmca-header__toggle");
  const nav = header.querySelector(".kmca-nav");
  if (!toggle || !nav) return;

  const mq = window.matchMedia("(max-width: 780px)");
  const navId = nav.getAttribute("id") || "kmcaPrimaryNav";
  nav.id = navId;

  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", navId);

  const closeSubmenus = () => {
    document.dispatchEvent(new CustomEvent("kmca:menu-close"));
  };

  const setOpen = (open) => {
    const currentlyOpen = header.getAttribute("data-menu-open") === "true";
    if (open === currentlyOpen) return;

    if (open) {
      header.setAttribute("data-menu-open", "true");
      toggle.setAttribute("aria-expanded", "true");
      document.body.setAttribute("data-nav-open", "true");
      return;
    }

    header.removeAttribute("data-menu-open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.removeAttribute("data-nav-open");
    closeSubmenus();
  };

  const handleToggle = (event) => {
    if (!mq.matches) return;
    event.preventDefault();
    const isOpen = header.getAttribute("data-menu-open") === "true";
    setOpen(!isOpen);
  };

  toggle.addEventListener("click", handleToggle);

  const handleOutsideClick = (event) => {
    if (!mq.matches) return;
    if (!header.contains(event.target)) {
      setOpen(false);
    }
  };
  document.addEventListener("click", handleOutsideClick);

  const handleNavClick = (event) => {
    const link = event.target.closest("a");
    if (!link) return;

    const isSubmenuLink = !!link.closest(".submenu");
    const parentHasSub = link.closest(".has-sub");
    const isTopLevelWithSubmenu =
      parentHasSub &&
      link.classList.contains("top-link") &&
      parentHasSub.querySelector(".submenu") &&
      !isSubmenuLink;

    if (isTopLevelWithSubmenu) return;

    window.setTimeout(() => {
      if (mq.matches) setOpen(false);
    }, 0);
  };
  nav.addEventListener("click", handleNavClick);

  const handleEscape = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  };
  document.addEventListener("keydown", handleEscape);

  const handleBreakpoint = () => {
    if (!mq.matches) {
      setOpen(false);
    }
  };

  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handleBreakpoint);
  } else {
    mq.addListener(handleBreakpoint);
  }
}

function setupPolicyModals(footerRoot) {
  if (!footerRoot) return;

  const triggers = footerRoot.querySelectorAll(".modal-trigger[data-modal]");
  const modals = footerRoot.querySelectorAll(".modal");
  if (!triggers.length || !modals.length) return;

  const focusableSelector =
    'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const getFocusableElements = (modal) =>
    Array.from(modal.querySelectorAll(focusableSelector)).filter((el) => {
      if (el.hasAttribute("disabled")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      return el.closest("[hidden]") === null;
    });

  let activeModal = null;
  let previousFocus = null;

  const closeModal = (modal) => {
    if (!modal || modal.hasAttribute("hidden")) return;

    modal.setAttribute("hidden", "");
    modal.classList.remove("modal--open");

    if (modal.__trapHandler) {
      modal.removeEventListener("keydown", modal.__trapHandler);
      modal.__trapHandler = null;
    }

    if (!footerRoot.querySelector(".modal.modal--open")) {
      document.body.removeAttribute("data-modal-open");
    }

    if (activeModal === modal) activeModal = null;

    const focusTarget = previousFocus;
    previousFocus = null;
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus({ preventScroll: true });
    }
  };

  const handleEscape = (event) => {
    if (event.key === "Escape" && activeModal) {
      event.preventDefault();
      closeModal(activeModal);
    }
  };
  document.addEventListener("keydown", handleEscape);

  const openModal = (modal) => {
    if (!modal || !modal.hasAttribute("hidden")) return;

    if (activeModal && activeModal !== modal) {
      closeModal(activeModal);
    }

    previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    modal.removeAttribute("hidden");
    modal.classList.add("modal--open");
    document.body.setAttribute("data-modal-open", "true");
    activeModal = modal;

    const focusables = getFocusableElements(modal);
    const first = focusables[0] || modal.querySelector(".modal__panel");
    if (first && typeof first.focus === "function") {
      first.focus({ preventScroll: true });
    }

    const trap = (event) => {
      if (event.key !== "Tab") return;

      const items = getFocusableElements(modal);
      if (!items.length) {
        event.preventDefault();
        return;
      }

      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const current = document.activeElement;

      if (event.shiftKey) {
        if (current === firstEl || !modal.contains(current)) {
          event.preventDefault();
          lastEl.focus({ preventScroll: true });
        }
        return;
      }

      if (current === lastEl) {
        event.preventDefault();
        firstEl.focus({ preventScroll: true });
      }
    };

    modal.__trapHandler = trap;
    modal.addEventListener("keydown", trap);
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      const modalId = trigger.getAttribute("data-modal");
      if (!modalId) return;
      const modal = document.getElementById(modalId);
      if (modal) {
        openModal(modal);
      }
    });
  });

  modals.forEach((modal) => {
    modal.querySelectorAll("[data-modal-close]").forEach((control) => {
      control.addEventListener("click", (event) => {
        event.preventDefault();
        closeModal(modal);
      });
    });
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  // 헤더/푸터 주입 (경로 자동 복구)
  const $header = await inject("#site-header", "partials/header.html");
  const $footer = await inject("#site-footer", "partials/footer.html");

  initNaverAnalytics();

  // 헤더가 주입된 뒤에만 실행되어야 하는 것들
  if ($header) {
    applyHeaderMode();
    setActiveNav();
    enhanceDropdowns();
    setupMobileNav();
  }

  setupPolicyModals($footer || document);
});
