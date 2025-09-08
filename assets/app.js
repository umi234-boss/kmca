/* =============================
   /assets/app.js (공통 스크립트)
   ============================= */

// HTML 파셜 주입 (no-store로 캐시 회피)
async function inject(selector, url) {
  const mount = document.querySelector(selector);
  if (!mount) return;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    mount.innerHTML = await res.text();
  } catch (e) {
    console.warn('[inject] failed:', url, e);
  }
}

// 현재 페이지 활성 링크 표시 (.is-active 부여)
function setActiveNav() {
  const cur = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.top-link[data-href]').forEach(a => {
    if (a.getAttribute('data-href') === cur) {
      a.classList.add('is-active');
      // 드롭다운 하위 항목이면 상위 탑링크도 활성
      const up = a.closest('.has-sub');
      if (up) {
        const top = up.querySelector('.top-link');
        if (top) top.classList.add('is-active');
      }
    }
  });
}

// 드롭다운 접근성/모바일 클릭 토글 보강
function enhanceDropdowns() {
  document.querySelectorAll('.kmca-nav .has-sub').forEach(li => {
    const trigger = li.querySelector('.top-link');
    const menu = li.querySelector('.submenu');
    if (!trigger || !menu) return;

    // ARIA
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');

    const open = () => {
      menu.style.display = 'block';
      trigger.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
      menu.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
    };

    // 마우스(hover는 CSS로도 처리되지만, 첫 표시를 보장)
    li.addEventListener('mouseenter', open);
    li.addEventListener('mouseleave', close);

    // 모바일/터치: 클릭 토글
    trigger.addEventListener('click', (e) => {
      // 상위 페이지로 바로 이동 막고 토글 (원하면 제거)
      e.preventDefault();
      const shown = menu.style.display === 'block';
      shown ? close() : open();
    });

    // 키보드 포커스/ESC
    li.addEventListener('focusin', open);
    li.addEventListener('focusout', (e) => {
      if (!li.contains(e.relatedTarget)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  await inject('#site-header', 'partials/header.html');
  await inject('#site-footer', 'partials/footer.html');
  setActiveNav();
  enhanceDropdowns();
});
