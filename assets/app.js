/* =============================
   /assets/app.js (공통 스크립트)
   ============================= */
// 헤더/푸터 인클루드 + 현재 페이지 활성화 표시
async function inject(selector, url){
  const mount = document.querySelector(selector);
  if(!mount) return;
  const res = await fetch(url);
  mount.innerHTML = await res.text();
}

function setActiveNav(){
  const path = location.pathname.split('/').pop() || 'index.html';
  const link = document.querySelector(`a[data-href="${path}"]`);
  if(link){
    link.classList.add('active');
    const up = link.closest('.has-sub');
    if(up){
      const top = up.querySelector('.top-link');
      if(top) top.classList.add('active');
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await inject('#site-header','partials/header.html');
  await inject('#site-footer','partials/footer.html');
  setActiveNav();
});
