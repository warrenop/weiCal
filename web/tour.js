// tour.js — minimalist guided tour. No external deps.
//
// Each step targets a DOM element by selector. The spotlight sits on top of
// that element (transparent rect surrounded by darkened box-shadow), and a
// tooltip card explains it.
//
// Activation:
//   - On the very first time the user has data (post-import or post-manual),
//     localStorage flag drives auto-start.
//   - The help (?) button in the header re-runs the tour any time.

(function () {
  const SEEN_KEY = 'mycal-tour-seen-v1';

  const STEPS = [
    {
      sel: '.brand',
      title: '欢迎 👋',
      desc: '微记账本帮你把微信账单变成可视化报表。整个数据都在本地加密，不会上传任何服务器。',
      placement: 'bottom-start',
    },
    {
      sel: 'nav',
      title: '5 个视图',
      desc: '总览看月度全貌；明细查每一笔；分类看占比；收入单独分析；导入历史回顾每次同步。',
      placement: 'bottom',
    },
    {
      sel: '#period-year',
      title: '按年月日切换',
      desc: '总览/明细页随时切换月份，跳到历史数据看趋势。明细页还能再选「日」精细查询。',
      placement: 'bottom-start',
    },
    {
      sel: '#btn-refresh',
      title: '导入新账单',
      desc: '微信里申请月账单，邮件收到 .csv / .xlsx 就来这里上传。同一文件可以反复传，重复交易会自动去重。',
      placement: 'bottom-end',
    },
    {
      sel: '#btn-theme',
      title: '深浅 + 隐私',
      desc: '右上角可切换深浅模式。所有数据 AES-256 加密存在 ~/Library/Application Support，密钥放系统 Keychain。',
      placement: 'bottom-end',
    },
  ];

  const $ = (s) => document.querySelector(s);
  let idx = 0;
  let active = false;

  function ensureSeenFlag() { localStorage.setItem(SEEN_KEY, '1'); }

  function show() {
    const overlay = $('#tour');
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    active = true;
  }
  function hide() {
    const overlay = $('#tour');
    overlay.classList.add('hidden');
    overlay.classList.remove('active');
    active = false;
    ensureSeenFlag();
  }

  function place(step) {
    const target = document.querySelector(step.sel);
    const spot = $('#tour-spot');
    const tip  = $('#tour-tooltip');
    if (!target) { next(); return; }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.style.top    = (r.top    - pad) + 'px';
    spot.style.left   = (r.left   - pad) + 'px';
    spot.style.width  = (r.width  + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';

    // Position tooltip: under target by default, switch to above if it would
    // overflow the viewport bottom.
    const tipRect = tip.getBoundingClientRect();
    const gap = 14;
    let top = r.bottom + gap;
    if (top + tipRect.height > window.innerHeight - 10) {
      top = r.top - tipRect.height - gap;
    }
    let left;
    switch (step.placement) {
      case 'bottom-end':   left = r.right - tipRect.width; break;
      case 'bottom-start': left = r.left; break;
      case 'bottom':
      default:             left = r.left + r.width / 2 - tipRect.width / 2;
    }
    // Clamp to viewport
    left = Math.max(10, Math.min(left, window.innerWidth - tipRect.width - 10));
    top  = Math.max(10, top);
    tip.style.top  = top + 'px';
    tip.style.left = left + 'px';
  }

  function render() {
    const step = STEPS[idx];
    $('#tour-step').textContent = `${idx + 1} / ${STEPS.length}`;
    $('#tour-title').textContent = step.title;
    $('#tour-desc').textContent = step.desc;
    $('#tour-prev').style.visibility = idx === 0 ? 'hidden' : 'visible';
    $('#tour-next').textContent = idx === STEPS.length - 1 ? '完成' : '下一步';
    place(step);
  }

  function next() {
    if (idx >= STEPS.length - 1) { hide(); return; }
    idx++; render();
  }
  function prev() { if (idx > 0) { idx--; render(); } }

  function start() {
    idx = 0;
    show();
    // wait one frame for layout
    requestAnimationFrame(render);
  }

  // Public API
  window.startTour = start;
  window.maybeAutoStartTour = function () {
    if (!localStorage.getItem(SEEN_KEY)) start();
  };

  document.addEventListener('DOMContentLoaded', () => {
    $('#btn-tour').onclick = start;
    $('#tour-next').onclick = next;
    $('#tour-prev').onclick = prev;
    $('#tour-skip').onclick = hide;
    window.addEventListener('keydown', (e) => {
      if (!active) return;
      if (e.key === 'Escape') hide();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') prev();
    });
    window.addEventListener('resize', () => { if (active) render(); });
  });
})();
