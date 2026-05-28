// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });
const money = (n) => fmt.format(n ?? 0);

async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  // Offline guard: writes need network; reads can fall back to the SW cache
  if (!navigator.onLine && method !== 'GET') {
    toast('当前离线，无法保存修改');
    throw new Error('offline');
  }
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  // Mark whether the SW served this from cache (set the badge state)
  if (r.headers.get('X-Mycal-From-Cache') === '1') {
    setOfflineStale(true);
  }
  return r.json();
}

// Online/offline indicator + cached-data flag
function setConnState(online) {
  const dot = $('#conn-dot');
  dot.classList.toggle('is-online', online);
  dot.classList.toggle('is-offline', !online);
  dot.title = online ? '在线' : '离线（显示缓存数据）';
}
function setOfflineStale(stale) {
  // Subtle indicator: turn dot orange even when navigator.onLine is true,
  // because the Mac backend is unreachable from this device.
  if (stale) setConnState(false);
}
window.addEventListener('online',  () => setConnState(true));
window.addEventListener('offline', () => setConnState(false));

// Register service worker once at load
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[sw] register failed:', err));
  });
}

function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), ms);
}

function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }
$$('.modal-close').forEach(b => b.onclick = (e) => e.target.closest('.modal').classList.add('hidden'));

// ---------- theme ----------
const themeListeners = [];
function isDark() { return document.documentElement.classList.contains('dark'); }
function applyTheme(dark, persist = true) {
  document.documentElement.classList.toggle('dark', dark);
  if (persist) localStorage.setItem('mycal-theme', dark ? 'dark' : 'light');
  themeListeners.forEach(fn => fn(dark));
}
$('#btn-theme').onclick = () => applyTheme(!isDark());
// Follow OS changes only when the user hasn't picked manually
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('mycal-theme')) applyTheme(e.matches, false);
});

// ECharts axis/tooltip palette per theme
function chartPalette() {
  return isDark()
    ? { fg: '#cbd5e1', muted: '#64748b', grid: 'rgba(148,163,184,.18)', tipBg: 'rgba(15,23,42,.92)', tipBorder: 'rgba(167,139,250,.3)' }
    : { fg: '#334155', muted: '#94a3b8', grid: 'rgba(148,163,184,.25)', tipBg: 'rgba(255,255,255,.95)', tipBorder: 'rgba(124,58,237,.2)' };
}
function axisStyle(p) {
  return {
    axisLine:  { lineStyle: { color: p.muted } },
    axisLabel: { color: p.fg, fontSize: 10 },
    splitLine: { lineStyle: { color: p.grid } },
  };
}

// ---------- state ----------
const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  view: 'overview',
  page: 1,
  pageSize: 50,
  meta: { categories: [], colors: {} },
  charts: {},
};

// ---------- view routing ----------
function showView(name) {
  state.view = name;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'overview') renderOverview();
  if (name === 'list') renderList();
  if (name === 'categories') renderCategories();
  if (name === 'budgets') renderBudgets();
  if (name === 'income') renderIncome();
  if (name === 'imports') renderImports();
}
$$('.nav-btn').forEach(b => b.onclick = () => showView(b.dataset.view));

// ---------- onboarding / empty-state coordination ----------
state.periods = [];     // list of "YYYY-MM" strings with data

async function refreshPeriods() {
  state.periods = await api('/api/summary/periods');
  return state.periods;
}

function hasAnyData() { return state.periods.length > 0; }

function showWelcome() {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-welcome').classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  $('#banner').classList.add('hidden');
  $('#btn-refresh').classList.add('pulse');
}
function hideWelcome() {
  $('#btn-refresh').classList.remove('pulse');
}

$('#btn-welcome-import').onclick = () => $('#btn-refresh').click();
$('#btn-welcome-manual').onclick = () => {
  // Open manual entry modal directly without leaving welcome
  if (typeof openEntryModal === 'function') openEntryModal(null);
};

// Pick the nearest available period to (year, month). Returns "YYYY-MM" or null.
function nearestPeriod(year, month) {
  if (!state.periods.length) return null;
  const target = `${year}-${String(month).padStart(2, '0')}`;
  // Sorted descending. Find first <= target, else first (most recent).
  return state.periods.find(p => p <= target) || state.periods[0];
}

// ---------- period selectors ----------
function fillYearMonth(yearSel, monthSel, defaultY, defaultM) {
  const now = new Date();
  yearSel.innerHTML = '';
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 6; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y + ' 年';
    if (y === defaultY) o.selected = true;
    yearSel.appendChild(o);
  }
  monthSel.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const o = document.createElement('option');
    o.value = m; o.textContent = m + ' 月';
    if (m === defaultM) o.selected = true;
    monthSel.appendChild(o);
  }
}

function fillCategorySelect(sel, includeAll) {
  sel.innerHTML = includeAll ? '<option value="">全部</option>' : '';
  state.meta.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

// Count-up animation for KPI numbers
function countUp(el, value, isMoney = true, dur = 700) {
  const start = performance.now();
  const from = el._cur ?? 0;
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = from + (value - from) * eased;
    el.textContent = isMoney ? money(v) : Math.round(v).toString();
    if (t < 1) requestAnimationFrame(tick);
    else el._cur = value;
  }
  requestAnimationFrame(tick);
}

// ---------- overview ----------
async function renderOverview() {
  const { year, month } = state;
  const [sum, cats, daily, top] = await Promise.all([
    api(`/api/summary?year=${year}&month=${month}`),
    api(`/api/summary/categories?year=${year}&month=${month}`),
    api(`/api/summary/daily?year=${year}&month=${month}`),
    api(`/api/summary/top?year=${year}&month=${month}&limit=5`),
  ]);

  // Period-empty state: show the friendly empty card + shortcut chips
  if (sum.count === 0) {
    $('#overview-dashboard').classList.add('hidden');
    $('#overview-empty').classList.remove('hidden');
    const jumps = $('#overview-empty-jumps');
    jumps.innerHTML = '';
    state.periods.slice(0, 6).forEach(p => {
      const b = document.createElement('button');
      b.className = 'month-jump';
      b.textContent = p.replace('-', ' / ');
      b.onclick = () => {
        const [y, m] = p.split('-').map(Number);
        state.year = y; state.month = m;
        $('#period-year').value = y;
        $('#period-month').value = m;
        renderOverview();
      };
      jumps.appendChild(b);
    });
    return;
  }
  $('#overview-dashboard').classList.remove('hidden');
  $('#overview-empty').classList.add('hidden');

  countUp($('#kpi-expense'), sum.expense);
  countUp($('#kpi-income'), sum.income);
  countUp($('#kpi-net'), sum.net);
  $('#kpi-net').classList.toggle('text-rose-500', sum.net < 0);
  $('#kpi-net').classList.toggle('text-emerald-500', sum.net > 0);
  countUp($('#kpi-count'), sum.count, false);
  refreshKpiBudgetBadge();
  const ch = sum.expense_change;
  $('#kpi-change').innerHTML = (ch == null)
    ? '<span class="text-slate-400">无上月对比</span>'
    : `<span class="${ch >= 0 ? 'text-rose-600' : 'text-emerald-600'}">${ch >= 0 ? '↑' : '↓'} ${(Math.abs(ch) * 100).toFixed(1)}% vs 上月</span>`;
  $('#period-hint').textContent = sum.count === 0 ? '该月暂无数据' : '';

  const p = chartPalette();
  const tipBox = {
    backgroundColor: p.tipBg, borderColor: p.tipBorder, borderWidth: 1,
    textStyle: { color: p.fg, fontSize: 12 }, extraCssText: 'backdrop-filter: blur(10px); border-radius: 10px;',
  };

  // category pie
  const pie = state.charts.pie || (state.charts.pie = echarts.init($('#chart-category')));
  pie.setOption({
    tooltip: { trigger: 'item', formatter: (q) => `${q.name}<br>${money(q.value)} (${q.percent}%)`, ...tipBox },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11, color: p.fg } },
    series: [{
      type: 'pie',
      radius: ['42%', '70%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: isDark() ? '#0b1024' : '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{d}%', color: p.fg },
      data: cats.map(c => ({ name: c.category, value: c.amount, itemStyle: { color: c.color } })),
    }],
  }, true);
  pie.off('click');
  pie.on('click', (p) => {
    showView('list');
    setTimeout(() => {
      $('#f-category').value = p.name;
      $('#f-year').value = state.year;
      $('#f-month').value = state.month;
      renderList();
    }, 50);
  });

  // daily bars
  const bar = state.charts.daily || (state.charts.daily = echarts.init($('#chart-daily')));
  const days = daily.map(d => d.date.slice(8));
  bar.setOption({
    tooltip: { trigger: 'axis', ...tipBox, formatter: (ps) => {
      const d = daily[ps[0].dataIndex];
      return `${d.date}<br>支出 ${money(d.expense)}<br>收入 ${money(d.income)}`;
    }},
    grid: { left: 50, right: 16, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: days, ...axisStyle(p) },
    yAxis: { type: 'value', ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, formatter: (v) => '¥' + v } },
    series: [{
      type: 'bar', data: daily.map(d => d.expense),
      itemStyle: {
        borderRadius: [6, 6, 0, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#c4b5fd' }, { offset: 1, color: '#7c3aed' }]),
      },
      emphasis: { itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: '#f0abfc' }, { offset: 1, color: '#a21caf' }]) } },
      barMaxWidth: 22, name: '支出',
    }],
  }, true);

  // top counterparties
  const topChart = state.charts.top || (state.charts.top = echarts.init($('#chart-top')));
  topChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...tipBox,
               formatter: (ps) => `${ps[0].name}<br>${money(ps[0].value)}` },
    grid: { left: 110, right: 60, top: 10, bottom: 20 },
    xAxis: { type: 'value', ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, formatter: (v) => '¥' + v } },
    yAxis: { type: 'category', data: top.map(t => t.name).reverse(), ...axisStyle(p),
             axisLabel: { ...axisStyle(p).axisLabel, fontSize: 11 } },
    series: [{
      type: 'bar', data: top.map(t => t.amount).reverse(),
      itemStyle: {
        borderRadius: [0, 8, 8, 0],
        color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
          { offset: 0, color: '#f43f5e' }, { offset: 1, color: '#fb7185' }]),
      },
      label: { show: true, position: 'right', formatter: (q) => money(q.value), color: p.fg },
    }],
  }, true);
}

// ---------- list ----------
async function renderList() {
  const params = new URLSearchParams({
    year: $('#f-year').value,
    month: $('#f-month').value,
    page: state.page,
    page_size: state.pageSize,
  });
  const day = $('#f-day').value; if (day) params.set('day', day);
  const cat = $('#f-category').value; if (cat) params.set('category', cat);
  const dir = $('#f-direction').value; if (dir) params.set('direction', dir);
  const q = $('#f-q').value.trim(); if (q) params.set('q', q);

  const res = await api(`/api/transactions?${params}`);
  const tbody = $('#tbody');
  tbody.innerHTML = '';
  if (res.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-slate-400 p-6">无数据</td></tr>`;
  }
  for (const t of res.items) {
    const tr = document.createElement('tr');
    const color = state.meta.colors[t.category] || '#999';
    const dir = t.direction === 'expense' ? '<span class="text-rose-600">支出</span>'
              : t.direction === 'income'  ? '<span class="text-emerald-600">收入</span>'
              : '<span class="text-slate-500">中性</span>';
    tr.innerHTML = `
      <td class="p-2 whitespace-nowrap">${t.tx_time}</td>
      <td class="p-2">${escapeHtml(t.counterparty || '')}</td>
      <td class="p-2 max-w-xs truncate" title="${escapeHtml(t.product || '')}">${escapeHtml(t.product || '')}</td>
      <td class="p-2 text-right font-medium">${money(t.amount)}</td>
      <td class="p-2">${dir}</td>
      <td class="p-2"><span class="cat-pill" style="background:${color}">${t.category}</span></td>
      <td class="p-2 text-xs text-slate-500">${t.source === 'manual' ? '手动' : '微信'}</td>
      <td class="p-2 text-xs text-slate-500">${escapeHtml(t.notes || '')}</td>
      <td class="p-2 text-right whitespace-nowrap">
        <button data-act="edit" data-id="${t.id}" class="text-violet-600 text-xs">编辑</button>
        <button data-act="del"  data-id="${t.id}" class="text-rose-600 text-xs ml-2">删除</button>
      </td>`;
    tbody.appendChild(tr);
  }
  $('#list-total').textContent = `共 ${res.total} 条`;
  const totalPages = Math.max(1, Math.ceil(res.total / state.pageSize));
  $('#page-info').textContent = `${state.page} / ${totalPages}`;

  tbody.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = () => {
      const id = +b.dataset.id;
      if (b.dataset.act === 'del') {
        if (!confirm('确定删除？')) return;
        api(`/api/transactions/${id}`, { method: 'DELETE' }).then(() => { toast('已删除'); renderList(); });
      } else {
        const tx = res.items.find(x => x.id === id);
        openEntryModal(tx);
      }
    };
  });
}

$('#btn-search').onclick = () => { state.page = 1; renderList(); };
$('#page-prev').onclick = () => { if (state.page > 1) { state.page--; renderList(); } };
$('#page-next').onclick = () => { state.page++; renderList(); };
['f-year', 'f-month', 'f-day', 'f-category', 'f-direction'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => { state.page = 1; renderList(); });
});
$('#f-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.page = 1; renderList(); } });

// ---------- categories view ----------
async function renderCategories() {
  const y = $('#cat-year').value, m = $('#cat-month').value;
  const cats = await api(`/api/summary/categories?year=${y}&month=${m}`);
  const tb = $('#cat-table tbody');
  tb.innerHTML = '';
  cats.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2"><span class="cat-pill" style="background:${c.color}">${c.category}</span></td>
      <td class="p-2 text-right font-medium">${money(c.amount)}</td>
      <td class="p-2 text-right">${c.percent}%</td>
      <td class="p-2 text-right">${c.count}</td>`;
    tb.appendChild(tr);
  });
  const p = chartPalette();
  const rose = state.charts.rose || (state.charts.rose = echarts.init($('#chart-rose')));
  rose.setOption({
    tooltip: { trigger: 'item', backgroundColor: p.tipBg, borderColor: p.tipBorder, textStyle: { color: p.fg },
               formatter: (q) => `${q.name}<br>${money(q.value)} (${q.percent}%)` },
    series: [{
      type: 'pie', radius: [30, 130], roseType: 'area',
      itemStyle: { borderRadius: 6, borderColor: isDark() ? '#0b1024' : '#fff', borderWidth: 2 },
      label: { formatter: '{b} {d}%', color: p.fg },
      data: cats.map(c => ({ name: c.category, value: c.amount, itemStyle: { color: c.color } })),
    }],
  }, true);
}
['cat-year', 'cat-month'].forEach(id => document.getElementById(id).addEventListener('change', renderCategories));

// ---------- imports view ----------
async function renderImports() {
  const logs = await api('/api/imports/logs');
  const tb = $('#imports-body');
  tb.innerHTML = '';
  if (logs.length === 0) {
    tb.innerHTML = `<tr><td colspan="6" class="text-center text-slate-400 p-6">尚无导入记录</td></tr>`;
    return;
  }
  logs.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">${escapeHtml(l.file_name || '')}</td>
      <td class="p-2 text-xs">${l.period_start || ''} ~ ${l.period_end || ''}</td>
      <td class="p-2 text-right text-emerald-600">${l.inserted}</td>
      <td class="p-2 text-right text-slate-500">${l.skipped}</td>
      <td class="p-2 text-right text-rose-500">${l.failed}</td>
      <td class="p-2 text-xs">${l.imported_at}</td>`;
    tb.appendChild(tr);
  });
}

// ---------- import wizard ----------
const SOURCE_GUIDE = {
  wechat: {
    name: '微信',
    color: 'linear-gradient(135deg,#22c55e,#16a34a)',
    steps: [
      '打开微信 → 我 → 服务 → 钱包 → 账单',
      '右上角「常见问题」→「下载账单」',
      '选「用于个人对账」，按月申请',
      '邮箱收到压缩包，解压得到 <code>.csv</code> 文件',
    ],
    tip: '微信账单密码就是你申请时设置的解压密码；解压后再上传。',
  },
  alipay: {
    name: '支付宝',
    color: 'linear-gradient(135deg,#3b82f6,#2563eb)',
    steps: [
      '打开支付宝 → 我 → 账单',
      '右上角 ⚙️ →「开具交易流水证明」',
      '选「用于个人对账」，选好月份申请',
      '邮箱收到压缩包，解压得到 <code>.csv</code> 文件',
    ],
    tip: '「不计收支」（如余额宝转入）和未完成交易会被自动跳过。',
  },
};

const wiz = { step: 1, source: null, preview: null, file: null };

function resetWizard() {
  wiz.step = 1; wiz.source = null; wiz.preview = null; wiz.file = null;
  $('#csv-file').value = '';
  $('#wiz-guide').classList.add('hidden');
  $('#wiz-parse').className = 'wiz-parse hidden';
  $('#wiz-preview').innerHTML = '';
  $('#upload-progress').classList.add('hidden');
  $('#upload-result').textContent = '';
  $$('.wiz-source').forEach(b => b.classList.remove('is-selected'));
  renderWizardStep();
}

function renderWizardStep() {
  // panes
  $$('.wiz-pane').forEach(p => p.classList.toggle('hidden', +p.dataset.pane !== wiz.step));
  // step indicators
  $$('.wiz-step').forEach(s => {
    const n = +s.dataset.step;
    s.classList.toggle('is-active', n === wiz.step);
    s.classList.toggle('is-done', n < wiz.step);
  });
  // nav buttons
  $('#wiz-back').style.visibility = wiz.step === 1 ? 'hidden' : 'visible';
  const next = $('#wiz-next');
  if (wiz.step === 1) { next.textContent = '下一步'; next.disabled = !wiz.source; }
  else if (wiz.step === 2) { next.textContent = '下一步'; next.disabled = !wiz.preview; }
  else { next.textContent = `确认导入 ${wiz.preview ? wiz.preview.will_insert : ''} 条`; next.disabled = !wiz.preview; }
}

$('#btn-refresh').onclick = () => { resetWizard(); openModal('modal-upload'); };

// Step 1: pick source
$$('.wiz-source').forEach(btn => {
  btn.onclick = () => {
    wiz.source = btn.dataset.source;
    $$('.wiz-source').forEach(b => b.classList.toggle('is-selected', b === btn));
    const g = SOURCE_GUIDE[wiz.source];
    $('#wiz-guide').innerHTML =
      `<b>${g.name}账单获取步骤：</b><ol>${g.steps.map(s => `<li>${s}</li>`).join('')}</ol>`
      + `<div class="wiz-tip">💡 ${g.tip}</div>`;
    $('#wiz-guide').classList.remove('hidden');
    $('#wiz-src-name').textContent = g.name;
    renderWizardStep();
  };
});

// Step 2: file → preview (parse, no write)
$('#csv-file').addEventListener('change', async () => {
  const f = $('#csv-file').files[0];
  wiz.preview = null; wiz.file = f;
  if (!f) { $('#wiz-parse').className = 'wiz-parse hidden'; renderWizardStep(); return; }
  const p = $('#wiz-parse');
  p.className = 'wiz-parse is-busy'; p.textContent = '正在解析…';
  try {
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/imports/preview', { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || '解析失败');
    const data = await r.json();
    wiz.preview = data;
    const srcName = { wechat: '微信', alipay: '支付宝' }[data.source] || '未知';
    if (wiz.source && wiz.source !== data.source) {
      p.className = 'wiz-parse is-err';
      p.innerHTML = `⚠️ 你选了「${SOURCE_GUIDE[wiz.source].name}」但文件看起来是「${srcName}」账单。可继续，但请确认。`;
    } else {
      p.className = 'wiz-parse is-ok';
      p.innerHTML = `✓ 识别为<b>${srcName}账单</b>，共解析 ${data.total} 条记录`;
    }
    renderWizardStep();
  } catch (e) {
    p.className = 'wiz-parse is-err';
    p.textContent = '✗ ' + e.message;
    wiz.preview = null;
    renderWizardStep();
  }
});

function renderPreviewPane() {
  const d = wiz.preview;
  if (!d) return;
  const srcName = { wechat: '微信', alipay: '支付宝' }[d.source] || '账单';
  const srcColor = d.source === 'alipay' ? '#2563eb' : '#16a34a';
  const cats = d.categories.slice(0, 4)
    .map(c => `${c.category} ${money(c.amount)}`).join(' · ') || '—';
  const sampleRows = d.samples.map(s => `
    <tr>
      <td>${s.tx_time.slice(5,16)}</td>
      <td>${escapeHtml((s.counterparty||'').slice(0,10))}</td>
      <td class="amt" style="color:${s.direction==='income'?'#10b981':'#f43f5e'}">
        ${s.direction==='income'?'+':'-'}${money(s.amount)}</td>
      <td>${s.category}</td>
    </tr>`).join('');
  $('#wiz-preview').innerHTML = `
    <div class="wiz-prev-head">
      <span class="wiz-src-badge" style="background:${srcColor}">${srcName}账单</span>
      <span class="text-sm text-[var(--muted)]">${d.period_start || ''} ~ ${d.period_end || ''}</span>
    </div>
    <div class="wiz-stats">
      <div class="wiz-stat"><div class="lbl">记录数</div><div class="val">${d.total}</div></div>
      <div class="wiz-stat"><div class="lbl">支出</div><div class="val text-rose-500">${money(d.expense_sum)}</div></div>
      <div class="wiz-stat"><div class="lbl">收入</div><div class="val text-emerald-500">${money(d.income_sum)}</div></div>
    </div>
    <div class="wiz-dedup">
      将新增 <b>${d.will_insert}</b> 条${d.duplicates ? `，跳过已存在 <b>${d.duplicates}</b> 条（按交易号去重）` : ''}。
      ${d.categories.length ? `<br>主要支出分类：${cats}` : ''}
    </div>
    <div class="wiz-sample"><table><tbody>${sampleRows}</tbody></table></div>`;
}

// Wizard nav
$('#wiz-back').onclick = () => { if (wiz.step > 1) { wiz.step--; renderWizardStep(); } };
$('#wiz-next').onclick = async () => {
  if (wiz.step === 1) { wiz.step = 2; renderWizardStep(); return; }
  if (wiz.step === 2) { wiz.step = 3; renderPreviewPane(); renderWizardStep(); return; }
  // step 3 → commit
  await commitImport();
};

async function commitImport() {
  const next = $('#wiz-next'); next.disabled = true;
  $('#wiz-back').disabled = true;
  $('#upload-progress').classList.remove('hidden');
  $('#upload-bar').classList.remove('indeterminate');
  $('#upload-bar').style.width = '0%';
  $('#upload-stage').textContent = '导入中…';
  try {
    const fd = new FormData(); fd.append('file', wiz.file);
    $('#upload-bar').classList.add('indeterminate');
    const r = await fetch('/api/imports/bill', { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || '导入失败');
    const res = await r.json();
    $('#upload-bar').classList.remove('indeterminate');
    $('#upload-bar').style.width = '100%';
    $('#upload-stage').textContent = '✓ 导入完成';
    const label = { wechat: '微信账单', alipay: '支付宝账单' }[res.source] || '账单';
    $('#upload-result').innerHTML =
      `<span class="text-emerald-700 font-medium">${label}导入完成</span>：新增 ${res.inserted} 条，跳过重复 ${res.skipped} 条`;
    toast(`${label}：+${res.inserted} 新增 / ${res.skipped} 重复`, 3500);

    await refreshPeriods();
    await refreshSyncStatus();
    if (!$('#view-welcome').classList.contains('hidden')) {
      hideWelcome();
      showView('overview');
      setTimeout(() => window.maybeAutoStartTour && window.maybeAutoStartTour(), 800);
    } else {
      if (state.view === 'overview') renderOverview();
      if (state.view === 'list') renderList();
      if (state.view === 'imports') renderImports();
      if (state.view === 'income') renderIncome();
    }
    setTimeout(() => { closeModal('modal-upload'); resetWizard(); $('#wiz-back').disabled = false; }, 1200);
  } catch (e) {
    $('#upload-bar').classList.remove('indeterminate');
    $('#upload-stage').textContent = '失败';
    $('#upload-result').innerHTML = `<span class="text-rose-600">失败：${escapeHtml(e.message)}</span>`;
    next.disabled = false; $('#wiz-back').disabled = false;
  }
}

// ---------- new / edit modal ----------
let editingId = null;
$('#btn-new').onclick = () => openEntryModal(null);
function openEntryModal(tx) {
  editingId = tx ? tx.id : null;
  $('#entry-title').textContent = tx ? '编辑' : '新增一条';
  fillCategorySelect($('#e-category'), false);
  const now = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const def = tx ? tx.tx_time.replace(' ', 'T').slice(0, 16)
                 : `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $('#e-time').value = def;
  $('#e-direction').value = tx?.direction ?? 'expense';
  $('#e-amount').value = tx?.amount ?? '';
  $('#e-counterparty').value = tx?.counterparty ?? '';
  $('#e-product').value = tx?.product ?? '';
  $('#e-category').value = tx?.category ?? '其他';
  $('#e-pay').value = tx?.pay_method ?? '';
  $('#e-notes').value = tx?.notes ?? '';
  openModal('modal-entry');
}
$('#btn-save-entry').onclick = async () => {
  const body = {
    tx_time: $('#e-time').value.replace('T', ' ') + ':00',
    direction: $('#e-direction').value,
    amount: parseFloat($('#e-amount').value || '0'),
    counterparty: $('#e-counterparty').value,
    product: $('#e-product').value,
    category: $('#e-category').value,
    pay_method: $('#e-pay').value,
    notes: $('#e-notes').value,
  };
  if (!body.amount || body.amount <= 0) { toast('请输入金额'); return; }
  try {
    if (editingId) {
      await api(`/api/transactions/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      toast('已更新');
    } else {
      await api('/api/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      toast('已新增');
    }
    closeModal('modal-entry');
    await refreshPeriods();
    // Manual add from welcome page jumps into the dashboard at that period
    if (!$('#view-welcome').classList.contains('hidden')) {
      hideWelcome();
      // Default to the period of the entry just added
      const [y, m] = body.tx_time.slice(0, 7).split('-').map(Number);
      state.year = y; state.month = m;
      $('#period-year').value = y;
      $('#period-month').value = m;
      showView('overview');
      setTimeout(() => window.maybeAutoStartTour && window.maybeAutoStartTour(), 800);
      return;
    }
    if (state.view === 'list') renderList();
    if (state.view === 'overview') renderOverview();
  } catch (e) { toast('保存失败：' + e.message); }
};

// ---------- sync status banner ----------
async function refreshSyncStatus() {
  const s = await api('/api/imports/status');
  const last = s.last_import;
  $('#sync-status').textContent = last
    ? `上次同步：${last.imported_at}` : '尚未导入数据';
  const banner = $('#banner');
  // When the welcome hero is showing, it already commands attention.
  // Don't double up with a banner.
  const welcomeVisible = !$('#view-welcome').classList.contains('hidden');
  const isCurrentMonth = (state.year === new Date().getFullYear()) && (state.month === new Date().getMonth() + 1);
  const needWarn = isCurrentMonth && !welcomeVisible && hasAnyData() && (
    s.current_period_rows === 0 ||
    !last ||
    (new Date() - new Date(last.imported_at.replace(' ', 'T'))) > 24 * 3600 * 1000
  );
  if (needWarn) {
    banner.classList.remove('hidden');
    banner.textContent = `本月（${s.current_period}）数据可能未同步，点击右上角「刷新数据」导入最新账单。`;
  } else {
    banner.classList.add('hidden');
  }
}

// ---------- util ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

window.addEventListener('resize', () => Object.values(state.charts).forEach(c => c && c.resize()));

themeListeners.push(() => {
  if (state.view === 'overview') renderOverview();
  if (state.view === 'categories') renderCategories();
  if (state.view === 'income') renderIncome();
  if (state.view === 'budgets') renderBudgets();
});

// ---------- budgets view ----------
function _budgetLabel(cat) { return cat === '_total' ? '本月总预算' : cat; }
function _budgetColor(cat) {
  if (cat === '_total') return 'linear-gradient(135deg,#8b5cf6,#ec4899)';
  return state.meta.colors[cat] || '#94a3b8';
}

async function renderBudgets() {
  const y = +$('#bg-year').value;
  const m = +$('#bg-month').value;
  const res = await api(`/api/budgets/status?year=${y}&month=${m}`);

  // Summary line
  const overCount = res.items.filter(i => i.status === 'over').length;
  const warnCount = res.items.filter(i => i.status === 'warn').length;
  $('#bg-summary').textContent = res.items.length
    ? `${res.items.length} 项预算 · ${overCount} 超支 · ${warnCount} 接近上限`
    : '还没配置预算';

  // Cards
  const grid = $('#budgets-grid');
  grid.innerHTML = '';
  if (!res.items.length) {
    grid.innerHTML = `<div class="empty-state-card" style="grid-column:1/-1">
      <div class="empty-icon-large">🎯</div>
      <h3>还没有预算配置</h3>
      <p>下方添加你的第一条分类预算，超过 70% 系统会自动提醒。</p>
    </div>`;
  }
  for (const it of res.items) {
    const card = document.createElement('div');
    card.className = `budget-card is-${it.status}` + (it.category === '_total' ? ' is-total' : '');
    const widthPct = Math.min(it.percent, 100);
    const remaining = it.remaining >= 0
      ? `剩 ${money(it.remaining)}`
      : `<span style="color:#f43f5e">超支 ${money(Math.abs(it.remaining))}</span>`;
    const colorStyle = it.category === '_total'
      ? 'background: linear-gradient(135deg,#8b5cf6,#ec4899)'
      : `background: ${_budgetColor(it.category)}`;

    // Override badge inline with title; subtitle row with "默认 ¥X | 撤销"
    const overrideTag = it.is_override ? '<span class="bg-override-tag">本月覆盖</span>' : '';
    const subRow = (() => {
      if (it.is_override && it.default_amount != null) {
        return `<div class="bg-card-sub">默认 ${money(it.default_amount)}
                  <a data-act="revert" data-cat="${escapeHtml(it.category)}">撤销本月覆盖</a></div>`;
      }
      if (it.is_override && it.default_amount == null) {
        return `<div class="bg-card-sub">仅此月（无默认）
                  <a data-act="revert" data-cat="${escapeHtml(it.category)}">撤销本月</a></div>`;
      }
      return '';
    })();

    card.innerHTML = `
      <div class="budget-pct-pill">${it.percent}%</div>
      <div class="budget-head">
        <div class="budget-name"><span class="budget-dot" style="${colorStyle}"></span>${escapeHtml(_budgetLabel(it.category))}${overrideTag}</div>
      </div>
      <div class="budget-amounts">
        <span class="budget-spent">${money(it.spent)}</span>
        <span class="budget-of">/ ${money(it.budget)}</span>
      </div>
      <div class="budget-bar-track"><div class="budget-bar-fill" style="width:${widthPct}%"></div></div>
      ${subRow}
      <div class="budget-footer">
        <span>${remaining}</span>
        <div class="budget-actions">
          <button data-act="edit" data-cat="${escapeHtml(it.category)}"
                  data-amt="${it.budget}" data-is-override="${it.is_override}"
                  data-default="${it.default_amount ?? ''}">编辑</button>
          <button data-act="del" data-cat="${escapeHtml(it.category)}"
                  data-has-default="${it.default_amount != null}">删除</button>
        </div>
      </div>`;
    grid.appendChild(card);
  }

  // Hook actions
  grid.querySelectorAll('button[data-act], a[data-act]').forEach(b => {
    b.onclick = async () => {
      const cat = b.dataset.cat;
      const act = b.dataset.act;
      const period = `${$('#bg-year').value}-${String($('#bg-month').value).padStart(2,'0')}`;

      if (act === 'revert') {
        if (!confirm(`撤销「${_budgetLabel(cat)}」在 ${period} 的本月覆盖？\n该月将回到默认值（如无默认则不再有预算）。`)) return;
        await api(`/api/budgets/${encodeURIComponent(cat)}?period=${period}`, { method: 'DELETE' });
        toast('已撤销本月覆盖');
        renderBudgets(); refreshKpiBudgetBadge();
        return;
      }

      if (act === 'del') {
        const hasDefault = b.dataset.hasDefault === 'true';
        const msg = hasDefault
          ? `删除「${_budgetLabel(cat)}」的默认预算？\n（所有该分类的本月覆盖也会保留，但失去默认基线）`
          : `删除「${_budgetLabel(cat)}」？`;
        if (!confirm(msg)) return;
        try {
          await api(`/api/budgets/${encodeURIComponent(cat)}`, { method: 'DELETE' });
          toast('已删除');
        } catch (e) {
          // If only override exists (no default), DELETE without period 404s — fall back
          await api(`/api/budgets/${encodeURIComponent(cat)}?period=${period}`, { method: 'DELETE' });
          toast('已删除本月覆盖');
        }
        renderBudgets(); refreshKpiBudgetBadge();
        return;
      }

      if (act === 'edit') {
        openBudgetEditModal({
          category: cat,
          currentAmount: +b.dataset.amt,
          isOverride: b.dataset.isOverride === 'true',
          defaultAmount: b.dataset.default ? +b.dataset.default : null,
          period,
        });
      }
    };
  });

  // Populate "add" form with categories not yet configured
  const configured = new Set(res.items.map(i => i.category));
  const sel = $('#bg-new-cat');
  sel.innerHTML = '';
  const allOptions = ['_total', ...state.meta.categories.filter(c => c !== '收入')];
  for (const c of allOptions) {
    if (configured.has(c)) continue;
    const o = document.createElement('option');
    o.value = c; o.textContent = _budgetLabel(c);
    sel.appendChild(o);
  }
  $('#bg-add-btn').disabled = sel.options.length === 0;
}

// "Add budget" submit
function _bindBudgetAdd() {
  $('#bg-add-btn').onclick = async () => {
    const cat = $('#bg-new-cat').value;
    const amt = parseFloat($('#bg-new-amount').value);
    if (!cat) { toast('请选择分类'); return; }
    if (!(amt >= 0)) { toast('请输入金额'); return; }
    await api(`/api/budgets/${encodeURIComponent(cat)}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ amount: amt }),
    });
    $('#bg-new-amount').value = '';
    toast('已添加');
    renderBudgets(); refreshKpiBudgetBadge();
  };
}

// ---------- Budget edit modal ----------
let _budgetEditCtx = null;

function openBudgetEditModal({ category, currentAmount, isOverride, defaultAmount, period }) {
  _budgetEditCtx = { category, period };
  $('#bg-edit-title').textContent = `编辑「${_budgetLabel(category)}」预算`;
  const subParts = [];
  subParts.push(`当前 ${money(currentAmount)}`);
  if (defaultAmount != null) subParts.push(`默认 ${money(defaultAmount)}`);
  if (isOverride) subParts.push(`本月覆盖中`);
  $('#bg-edit-sub').textContent = subParts.join(' · ');
  $('#bg-edit-amount').value = currentAmount;
  $('#bg-edit-error').classList.add('hidden');
  $('#bg-scope-period-label').textContent = `仅 ${period}`;

  // Pre-select scope based on current state
  const scope = isOverride ? 'override' : 'default';
  document.querySelectorAll('input[name="bg-scope"]').forEach(r => {
    r.checked = (r.value === scope);
  });

  openModal('modal-budget');
  setTimeout(() => $('#bg-edit-amount').focus(), 80);
}

$('#bg-edit-save').onclick = async () => {
  const ctx = _budgetEditCtx;
  if (!ctx) return;
  const amt = parseFloat($('#bg-edit-amount').value);
  if (!(amt >= 0)) {
    const e = $('#bg-edit-error'); e.textContent = '请输入有效金额'; e.classList.remove('hidden');
    return;
  }
  const scope = document.querySelector('input[name="bg-scope"]:checked').value;
  const url = scope === 'override'
    ? `/api/budgets/${encodeURIComponent(ctx.category)}?period=${ctx.period}`
    : `/api/budgets/${encodeURIComponent(ctx.category)}`;
  try {
    await api(url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt }),
    });
    toast(scope === 'override' ? `已设置 ${ctx.period} 本月覆盖` : '已更新默认值');
    closeModal('modal-budget');
    _budgetEditCtx = null;
    renderBudgets(); refreshKpiBudgetBadge();
  } catch (e) {
    const el = $('#bg-edit-error'); el.textContent = e.message; el.classList.remove('hidden');
  }
};

// ---------- KPI overview badge ----------
async function refreshKpiBudgetBadge() {
  try {
    const alerts = await api('/api/budgets/alerts');
    const badge = $('#kpi-budget-badge');
    if (!alerts.length) { badge.classList.add('hidden'); badge.textContent = ''; return; }
    // Pick the worst one
    const worst = alerts.reduce((a, b) => b.percent > a.percent ? b : a);
    const cls = worst.status === 'over' ? 'is-over' : 'is-warn';
    const sign = worst.status === 'over' ? '超支' : '接近上限';
    badge.className = `kpi-budget-badge ${cls}`;
    badge.classList.remove('hidden');
    badge.textContent = `${worst.status === 'over' ? '⚠️' : '🟡'} ${_budgetLabel(worst.category)} ${worst.percent}% (${sign})`;
    badge.style.cursor = 'pointer';
    badge.onclick = () => showView('budgets');
  } catch {}
}

// ---------- income view ----------
function fillYearOnly(sel, defaultY) {
  const now = new Date().getFullYear();
  sel.innerHTML = '';
  for (let y = now + 1; y >= now - 6; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y + ' 年';
    if (y === defaultY) o.selected = true;
    sel.appendChild(o);
  }
}

async function renderIncome() {
  const year = +$('#inc-year').value;
  const [cashflow, sources, txs] = await Promise.all([
    api(`/api/summary/cashflow?year=${year}`),
    api(`/api/summary/income/sources?year=${year}&limit=12`),
    api(`/api/transactions?year=${year}&direction=income&page_size=200`),
  ]);

  const totalIncome  = cashflow.reduce((s, r) => s + r.income, 0);
  const totalExpense = cashflow.reduce((s, r) => s + r.expense, 0);
  const incCount     = cashflow.reduce((s, r) => s + r.income_count, 0);
  const monthsWithData = cashflow.filter(r => r.income_count + r.expense_count > 0).length || 1;

  if (totalIncome + totalExpense === 0) {
    $('#income-dashboard').classList.add('hidden');
    $('#income-empty').classList.remove('hidden');
    return;
  }
  $('#income-dashboard').classList.remove('hidden');
  $('#income-empty').classList.add('hidden');

  countUp($('#inc-kpi-income'), totalIncome);
  countUp($('#inc-kpi-expense'), totalExpense);
  countUp($('#inc-kpi-net'), totalIncome - totalExpense);
  countUp($('#inc-kpi-count'), incCount, false);
  $('#inc-kpi-net').classList.toggle('text-rose-500', totalIncome - totalExpense < 0);
  $('#inc-kpi-net').classList.toggle('text-emerald-500', totalIncome - totalExpense > 0);

  $('#inc-kpi-avg').textContent = `月均 ${money(totalIncome / monthsWithData)}`;
  const saveRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100) : 0;
  $('#inc-kpi-rate').textContent = totalIncome > 0
    ? `储蓄率 ${saveRate.toFixed(1)}%`
    : '';
  $('#inc-hint').textContent = totalIncome + totalExpense === 0 ? `${year} 年暂无数据` : '';

  const p = chartPalette();
  const tipBox = {
    backgroundColor: p.tipBg, borderColor: p.tipBorder, borderWidth: 1,
    textStyle: { color: p.fg, fontSize: 12 }, extraCssText: 'backdrop-filter: blur(10px); border-radius: 10px;',
  };

  // Cashflow stacked area (income vs expense)
  const cashChart = state.charts.cashflow || (state.charts.cashflow = echarts.init($('#chart-cashflow')));
  cashChart.setOption({
    tooltip: {
      trigger: 'axis', ...tipBox,
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        const r = cashflow[i];
        const net = r.income - r.expense;
        const sign = net >= 0 ? '+' : '';
        return `${r.period}<br>` +
               `<span style="color:#10b981">●</span> 收入 ${money(r.income)}<br>` +
               `<span style="color:#f43f5e">●</span> 支出 ${money(r.expense)}<br>` +
               `净 ${sign}${money(net)}`;
      },
    },
    legend: { top: 0, textStyle: { color: p.fg, fontSize: 11 } },
    grid: { left: 55, right: 16, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: cashflow.map(r => r.month + ' 月'), ...axisStyle(p), boundaryGap: false },
    yAxis: { type: 'value', ...axisStyle(p),
             axisLabel: { ...axisStyle(p).axisLabel, formatter: (v) => '¥' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) } },
    series: [
      {
        name: '收入', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        itemStyle: { color: '#10b981' },
        lineStyle: { width: 2.5, color: '#10b981' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(16,185,129,0.45)' }, { offset: 1, color: 'rgba(16,185,129,0)' }]) },
        data: cashflow.map(r => r.income),
      },
      {
        name: '支出', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        itemStyle: { color: '#f43f5e' },
        lineStyle: { width: 2.5, color: '#f43f5e' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(244,63,94,0.45)' }, { offset: 1, color: 'rgba(244,63,94,0)' }]) },
        data: cashflow.map(r => r.expense),
      },
    ],
  }, true);

  // Income sources rose pie
  const srcChart = state.charts.incSources || (state.charts.incSources = echarts.init($('#chart-income-sources')));
  const palette = ['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#84cc16',
                   '#14b8a6', '#a855f7', '#f43f5e', '#22d3ee', '#fbbf24'];
  srcChart.setOption({
    tooltip: { trigger: 'item', ...tipBox,
               formatter: (q) => `${q.name}<br>${money(q.value)} (${q.percent}%)` },
    series: [{
      type: 'pie', radius: ['30%', '78%'], roseType: 'area',
      itemStyle: { borderRadius: 6, borderColor: isDark() ? '#0b1024' : '#fff', borderWidth: 2 },
      label: { color: p.fg, fontSize: 11, formatter: '{b}\n{d}%' },
      labelLine: { length: 6, length2: 6 },
      data: sources.map((s, i) => ({
        name: s.name.length > 8 ? s.name.slice(0, 8) + '…' : s.name,
        value: s.amount,
        itemStyle: { color: palette[i % palette.length] },
      })),
    }],
  }, true);

  // Income transactions list (recent first)
  const tb = $('#inc-tbody');
  tb.innerHTML = '';
  if (!txs.items.length) {
    tb.innerHTML = `<tr><td colspan="6" class="text-center text-[var(--muted)] p-6">该年无收入记录</td></tr>`;
  }
  for (const t of txs.items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2 whitespace-nowrap">${t.tx_time}</td>
      <td class="p-2">${escapeHtml(t.counterparty || '')}</td>
      <td class="p-2 max-w-xs truncate" title="${escapeHtml(t.product || '')}">${escapeHtml(t.product || '')}</td>
      <td class="p-2 text-right font-medium text-emerald-500">+${money(t.amount)}</td>
      <td class="p-2 text-xs text-[var(--muted)]">${escapeHtml(t.pay_method || '')}</td>
      <td class="p-2 text-xs text-[var(--muted)]">${escapeHtml(t.notes || '')}</td>`;
    tb.appendChild(tr);
  }
}

$('#inc-year').addEventListener?.('change', renderIncome);

// ---------- documents (multi-account) ----------
state.docs = { current_id: null, items: [] };

async function refreshDocs() {
  state.docs = await api('/api/documents');
  const cur = state.docs.items.find(d => d.id === state.docs.current_id);
  $('#doc-current-name').textContent = cur ? cur.name : '—';
  // Render dropdown list
  const ul = $('#doc-list');
  ul.innerHTML = '';
  for (const d of state.docs.items) {
    const li = document.createElement('li');
    if (d.id === state.docs.current_id) li.classList.add('is-current');
    li.textContent = d.name;
    li.onclick = async () => {
      if (d.id === state.docs.current_id) { closeDocMenu(); return; }
      await switchDoc(d.id);
    };
    ul.appendChild(li);
  }
}

async function switchDoc(doc_id) {
  closeDocMenu();
  toast('正在切换…');
  await api(`/api/documents/${doc_id}/open`, { method: 'POST' });
  // Drop all cached UI state and restart the bootstrap path
  await refreshDocs();
  // Reset client state related to dataset
  state.periods = [];
  state.charts = {};        // discard chart instances; new view will rebuild
  await refreshPeriods();
  await refreshSyncStatus();
  refreshKpiBudgetBadge();
  // Pick smart starting month
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth() + 1;
  if (hasAnyData()) {
    const target = `${state.year}-${String(state.month).padStart(2,'0')}`;
    if (!state.periods.includes(target)) {
      const n = nearestPeriod(state.year, state.month);
      if (n) { const [y,m] = n.split('-').map(Number); state.year=y; state.month=m; }
    }
    // sync selectors
    $('#period-year').value = state.year;
    $('#period-month').value = state.month;
    showView('overview');
    toast(`已切换到「${state.docs.items.find(d=>d.id===doc_id).name}」`);
  } else {
    showWelcome();
    toast(`已切换到「${state.docs.items.find(d=>d.id===doc_id).name}」(空文档)`);
  }
}

function openDocMenu()  { $('#doc-menu').classList.remove('hidden'); }
function closeDocMenu() { $('#doc-menu').classList.add('hidden'); }
$('#doc-switcher').onclick = (e) => {
  e.stopPropagation();
  $('#doc-menu').classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!$('#doc-menu').contains(e.target) && !$('#doc-switcher').contains(e.target)) {
    closeDocMenu();
  }
});

$('#doc-new').onclick = () => { closeDocMenu(); openDocNewModal(); };
$('#doc-new-2')?.addEventListener('click', () => { closeModal('modal-docs'); openDocNewModal(); });
$('#doc-manage').onclick = () => { closeDocMenu(); openDocManageModal(); };

function openDocNewModal() {
  $('#doc-new-name').value = '';
  $('#doc-new-error').classList.add('hidden');
  openModal('modal-doc-new');
  setTimeout(() => $('#doc-new-name').focus(), 80);
}

$('#doc-new-create').onclick = async () => {
  const name = $('#doc-new-name').value.trim();
  if (!name) {
    const e = $('#doc-new-error'); e.textContent='请输入名称'; e.classList.remove('hidden'); return;
  }
  try {
    const d = await api('/api/documents', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name }),
    });
    closeModal('modal-doc-new');
    await switchDoc(d.id);
  } catch (e) {
    const el = $('#doc-new-error'); el.textContent = e.message; el.classList.remove('hidden');
  }
};

async function openDocManageModal() {
  await refreshDocs();
  const ul = $('#doc-manage-list');
  ul.innerHTML = '';
  for (const d of state.docs.items) {
    const li = document.createElement('li');
    if (d.id === state.docs.current_id) li.classList.add('is-current');
    const created = d.created_at ? d.created_at.slice(0, 10) : '';
    li.innerHTML = `
      <div class="doc-info">
        <b>${escapeHtml(d.name)}${d.id === state.docs.current_id ? ' · 当前' : ''}</b>
        <small>创建于 ${created}</small>
      </div>
      <div class="doc-mgmt-actions">
        <button data-act="open"   data-id="${d.id}">切换</button>
        <button data-act="rename" data-id="${d.id}" data-name="${escapeHtml(d.name)}">改名</button>
        <button data-act="del"    data-id="${d.id}" data-name="${escapeHtml(d.name)}">删除</button>
      </div>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id, act = b.dataset.act, name = b.dataset.name;
      if (act === 'open') {
        closeModal('modal-docs');
        await switchDoc(id);
      } else if (act === 'rename') {
        const v = prompt('新名称', name);
        if (!v || !v.trim() || v.trim() === name) return;
        try {
          await api(`/api/documents/${id}`, {
            method: 'PATCH', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ name: v.trim() }),
          });
          toast('已改名');
          openDocManageModal();
        } catch (e) { toast('改名失败：'+e.message); }
      } else if (act === 'del') {
        if (state.docs.items.length === 1) { toast('至少保留一个文档'); return; }
        if (!confirm(`确认删除「${name}」？\n该文档的全部账单与预算会永久消失，无法恢复。`)) return;
        const second = prompt(`再次确认：输入「${name}」以删除`, '');
        if (second !== name) { toast('未删除'); return; }
        try {
          await api(`/api/documents/${id}`, { method: 'DELETE' });
          toast('已删除');
          await refreshDocs();
          openDocManageModal();
          // If the deleted one was current, the server already promoted another
          if (id === state.docs.current_id) {
            // unlikely (current_id updates), but rerender just in case
          }
        } catch (e) { toast('删除失败：'+e.message); }
      }
    };
  });
  openModal('modal-docs');
}

// ---------- help menu + manual update check ----------
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// Help / about menu toggle
$('#btn-help').onclick = (e) => {
  e.stopPropagation();
  $('#help-menu').classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!$('#help-menu').contains(e.target) && !$('#btn-help').contains(e.target)) {
    $('#help-menu').classList.add('hidden');
  }
});
$('#help-tour').onclick = () => {
  $('#help-menu').classList.add('hidden');
  if (typeof window.startTour === 'function') window.startTour();
};
$('#help-update').onclick = () => {
  $('#help-menu').classList.add('hidden');
  manualCheckUpdate();
};

// Manual, on-demand update check — no auto-trigger, no throttle, no nagging.
let _checkingUpdate = false;
async function manualCheckUpdate() {
  if (_checkingUpdate) return;
  const current = state.meta.version;
  const repo = state.meta.repo;
  if (!current || !repo) { toast('无法获取版本信息'); return; }

  _checkingUpdate = true;
  toast('正在检查更新…', 1500);
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error('api');
    const data = await r.json();
    const latest = String(data.tag_name || '').replace(/^v/, '');
    if (!latest) throw new Error('no-tag');

    if (cmpVersion(latest, current) > 0) {
      // Newer available → show the gradient toast with a download link
      $('#ut-version').textContent = 'v' + latest;
      $('#ut-current').textContent = `(当前 v${current})`;
      $('#ut-link').href = data.html_url || `https://github.com/${repo}/releases/tag/v${latest}`;
      $('#update-toast').classList.remove('hidden');
      $('#ut-dismiss').onclick = () => $('#update-toast').classList.add('hidden');
    } else {
      toast(`已是最新版本 v${current}`, 3000);
    }
  } catch (e) {
    toast('检查更新失败，请稍后重试', 3000);
  } finally {
    _checkingUpdate = false;
  }
}

// ---------- bootstrap ----------
(async function init() {
  state.meta = await api('/api/meta');
  if (state.meta.version) $('#help-version-num').textContent = 'v' + state.meta.version;
  fillYearMonth($('#period-year'), $('#period-month'), state.year, state.month);
  fillYearMonth($('#f-year'), $('#f-month'), state.year, state.month);
  fillYearMonth($('#cat-year'), $('#cat-month'), state.year, state.month);
  fillYearMonth($('#bg-year'), $('#bg-month'), state.year, state.month);
  fillYearOnly($('#inc-year'), state.year);
  fillCategorySelect($('#f-category'), true);
  _bindBudgetAdd();
  $('#bg-year').addEventListener('change', renderBudgets);
  $('#bg-month').addEventListener('change', renderBudgets);
  $('#period-year').addEventListener('change', e => { state.year = +e.target.value; renderOverview(); });
  $('#period-month').addEventListener('change', e => { state.month = +e.target.value; renderOverview(); });

  await refreshDocs();
  await refreshPeriods();
  if (!hasAnyData()) {
    showWelcome();
    await refreshSyncStatus();   // keeps "尚未导入" label honest
    return;
  }
  // If the current month has no data, jump to the most recent month that does.
  const target = `${state.year}-${String(state.month).padStart(2, '0')}`;
  if (!state.periods.includes(target)) {
    const nearest = nearestPeriod(state.year, state.month);
    if (nearest) {
      const [y, m] = nearest.split('-').map(Number);
      state.year = y; state.month = m;
      $('#period-year').value = y;
      $('#period-month').value = m;
    }
  }
  showView('overview');
  await refreshSyncStatus();
  refreshKpiBudgetBadge();      // non-blocking
})();
