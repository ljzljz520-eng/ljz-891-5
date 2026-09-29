'use strict';
/* ============================================================
   管理后台 SPA（原生 JS，无框架）
   ============================================================ */

const STATUS = {
  unused:   { label: '未核验', cls: 'badge-unused', tagCls: 'tag' },
  verified: { label: '已核验', cls: 'badge-verified', tagCls: 'tag tag-ok' },
  disabled: { label: '已停用', cls: 'badge-disabled', tagCls: 'tag tag-fail' }
};
const REASON_TEXT = {
  ok: '核验通过', not_found: '码不存在', phone_mismatch: '手机号不匹配',
  bad_input: '格式错误', disabled: '票码已停用'
};

/* ---------------- 工具 ---------------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function maskPhone(p) {
  return p && p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : (p || '—');
}
function statusBadge(s) {
  const m = STATUS[s] || { label: s, cls: 'badge-unused' };
  return `<span class="badge ${m.cls}">${m.label}</span>`;
}

async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  let json = {};
  try { json = await res.json(); } catch { /* ignore */ }
  if (res.status === 401) {
    showLogin();
    throw new Error(json.message || '未登录');
  }
  return { status: res.status, json };
}

/* ---------------- Toast / Modal ---------------- */

function toast(message, type = 'info', ms = 2800) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="dot-i"></span><span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function openModal(title, bodyHTML, footerHTML) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-mask" id="modalMask">
      <div class="card card-glow modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${title}</h3>
          <button class="modal-close" onclick="closeModal()" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        ${footerHTML !== null ? `<div class="modal-foot">${footerHTML || ''}</div>` : ''}
      </div>
    </div>`;
  document.getElementById('modalMask').addEventListener('mousedown', e => {
    if (e.target.id === 'modalMask') closeModal();
  });
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------------- 分页组件 ---------------- */

function pagerHTML(result) {
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.total, result.page * result.pageSize);
  return `
    <div class="pager">
      <span>共 ${result.total} 条 · 显示 ${from}-${to}</span>
      <div class="pager-btns">
        <button class="btn btn-ghost btn-sm" ${result.page <= 1 ? 'disabled' : ''}
          onclick="goPage(${result.page - 1})">上一页</button>
        <span class="btn btn-ghost btn-sm" style="cursor:default;">${result.page} / ${totalPages}</span>
        <button class="btn btn-ghost btn-sm" ${result.page >= totalPages ? 'disabled' : ''}
          onclick="goPage(${result.page + 1})">下一页</button>
      </div>
    </div>`;
}

/* ============================================================
   登录 / 会话
   ============================================================ */

let ME = null;
let currentPage = 'dashboard';

async function bootstrap() {
  const { status, json } = await api('GET', '/api/admin/me');
  if (status === 200 && json.ok) {
    ME = json.data;
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  ME = null;
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('topbarUser').innerHTML = '';
  setTimeout(() => document.getElementById('loginUser').focus(), 50);
}

function showApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('topbarUser').innerHTML = `
    <span style="display:flex;align-items:center;gap:8px;">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);"></span>
      ${esc(ME.displayName || ME.username)}
      <span class="role-tag ${ME.role === 'super' ? 'role-super' : 'role-admin'}">
        ${ME.role === 'super' ? '超级管理员' : '管理员'}
      </span>
    </span>
    <button class="btn btn-ghost btn-sm" onclick="doLogout()">退出登录</button>`;
  document.getElementById('navAdmins').classList.toggle('hidden', ME.role !== 'super');
  document.getElementById('sysSection').style.display = ME.role === 'super' ? '' : 'none';
  navigate(currentPage);
}

async function doLogout() {
  await api('POST', '/api/admin/logout');
  toast('已退出登录', 'info');
  showLogin();
}

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const alertEl = document.getElementById('loginAlert');
  alertEl.innerHTML = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 登录中…';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('loginUser').value.trim(),
        password: document.getElementById('loginPass').value
      })
    });
    const json = await res.json();
    if (json.ok) {
      ME = json.data;
      toast(`欢迎回来，${ME.displayName || ME.username}`, 'success');
      showApp();
    } else {
      alertEl.innerHTML = `
        <div class="alert alert-error" style="margin:0 0 16px;">
          <svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg><span>${esc(json.message || '登录失败')}</span>
        </div>`;
    }
  } catch {
    alertEl.innerHTML = '<div class="alert alert-error" style="margin:0 0 16px;">网络异常，请稍后重试</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '登 录';
    document.getElementById('loginPass').value = '';
  }
});

/* ---------------- 导航 ---------------- */

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.page));
});

function navigate(page) {
  const allowed = ['dashboard', 'tickets', 'logs', 'admins'];
  if (!allowed.includes(page)) page = 'dashboard';
  if (page === 'admins' && ME.role !== 'super') page = 'dashboard';
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  ({
    dashboard: renderDashboard,
    tickets: renderTicketsPage,
    logs: renderLogsPage,
    admins: renderAdminsPage
  })[page]();
}

/* ============================================================
   数据概览
   ============================================================ */

async function renderDashboard() {
  const root = document.getElementById('pageRoot');
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>数据概览</h2>
        <p>展会票码与查询实时情况</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="renderDashboard()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          刷新
        </button>
        <button class="btn btn-primary btn-sm" style="width:auto;padding:10px 18px;" onclick="navigate('tickets');openTicketModal()">
          + 新增票码
        </button>
      </div>
    </div>
    <div class="text-center muted" style="padding:60px;"><span class="spinner light"></span></div>`;

  const { json } = await api('GET', '/api/admin/stats');
  const s = json.data;
  const verifiedRate = s.totalTickets ? Math.round(s.statusCount.verified / s.totalTickets * 100) : 0;
  const zonesRows = s.zones.length
    ? s.zones.map(z => `
        <tr>
          <td>${esc(z.zone)}</td>
          <td class="mono">${z.count}</td>
          <td style="width:55%;">
            <div style="background:rgba(4,10,26,.6);border-radius:6px;height:8px;overflow:hidden;">
              <div style="height:100%;width:${Math.max(2, z.count / s.totalTickets * 100)}%;
                background:linear-gradient(90deg,var(--cyan),var(--indigo));border-radius:6px;"></div>
            </div>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="muted" style="text-align:center;padding:30px;">暂无数据</td></tr>';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>数据概览</h2>
        <p>${fmtTime(new Date().toISOString()).slice(0, 16)} 实时数据</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="renderDashboard()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          刷新
        </button>
        <button class="btn btn-primary btn-sm" style="width:auto;padding:10px 18px;" onclick="navigate('tickets');setTimeout(openTicketModal,50)">
          + 新增票码
        </button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="card stat-card">
        <div class="k">票码总数</div>
        <div class="num">${s.totalTickets}<small>张</small></div>
      </div>
      <div class="card stat-card green">
        <div class="k">已核验 / 核验率</div>
        <div class="num" style="color:var(--green);">${s.statusCount.verified}<small>${verifiedRate}%</small></div>
      </div>
      <div class="card stat-card amber">
        <div class="k">待核验</div>
        <div class="num" style="color:var(--amber);">${s.statusCount.unused}<small>张</small></div>
      </div>
      <div class="card stat-card violet">
        <div class="k">今日查询 / 总查询</div>
        <div class="num" style="color:#a5b4fc;">${s.queriesToday}<small>/ ${s.totalQueries}</small></div>
      </div>
    </div>

    <div class="card table-card">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:600;font-size:14.5px;">
        各展区票码分布
      </div>
      <div class="table-scroll">
        <table class="data">
          <thead><tr><th>展区</th><th>票码数</th><th>占比</th></tr></thead>
          <tbody>${zonesRows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   票码管理
   ============================================================ */

const ticketState = { page: 1, pageSize: 20, q: '', status: '', zone: '', date: '' };
let zonesCache = [];

function goPage(p) {
  if (currentPage === 'tickets') { ticketState.page = p; loadTickets(); }
  if (currentPage === 'logs') { logState.page = p; loadLogs(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderTicketsPage() {
  const root = document.getElementById('pageRoot');
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>票码管理</h2>
        <p>新增、编辑、核验入场票码，支持 CSV 批量导入</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="downloadTemplate()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          下载模板
        </button>
        <button class="btn btn-ghost" onclick="exportTickets()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          导出 CSV
        </button>
        <button class="btn btn-ghost" onclick="openImportModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          批量导入
        </button>
        <button class="btn btn-primary btn-sm" style="width:auto;padding:10px 18px;" onclick="openTicketModal()">+ 新增票码</button>
      </div>
    </div>

    <div class="toolbar">
      <input class="grow" id="fQ" placeholder="搜索入场码 / 姓名 / 手机号" value="${esc(ticketState.q)}" />
      <select id="fStatus">
        <option value="">全部状态</option>
        <option value="unused" ${ticketState.status === 'unused' ? 'selected' : ''}>未核验</option>
        <option value="verified" ${ticketState.status === 'verified' ? 'selected' : ''}>已核验</option>
        <option value="disabled" ${ticketState.status === 'disabled' ? 'selected' : ''}>已停用</option>
      </select>
      <select id="fZone"><option value="">全部展区</option></select>
      <input type="date" id="fDate" value="${esc(ticketState.date)}" />
      <button class="btn btn-ghost" onclick="applyTicketFilter()">筛选</button>
      <button class="btn btn-ghost" onclick="resetTicketFilter()">重置</button>
    </div>

    <div class="card table-card">
      <div id="ticketTable"></div>
    </div>`;

  // 回车搜索
  document.getElementById('fQ').addEventListener('keydown', e => { if (e.key === 'Enter') applyTicketFilter(); });

  await loadZones();
  await loadTickets();
}

async function loadZones() {
  const { json } = await api('GET', '/api/admin/zones');
  zonesCache = json.data || [];
  const sel = document.getElementById('fZone');
  if (!sel) return;
  sel.innerHTML = '<option value="">全部展区</option>' +
    zonesCache.map(z => `<option value="${esc(z)}" ${ticketState.zone === z ? 'selected' : ''}>${esc(z)}</option>`).join('');
}
async function loadZonesSafe() {
  try {
    const { json } = await api('GET', '/api/admin/zones');
    zonesCache = json.data || [];
  } catch { /* 忽略，datalist 允许为空 */ }
}

function applyTicketFilter() {
  ticketState.q = document.getElementById('fQ').value.trim();
  ticketState.status = document.getElementById('fStatus').value;
  ticketState.zone = document.getElementById('fZone').value;
  ticketState.date = document.getElementById('fDate').value;
  ticketState.page = 1;
  loadTickets();
}
function resetTicketFilter() {
  Object.assign(ticketState, { page: 1, q: '', status: '', zone: '', date: '' });
  renderTicketsPage();
}

async function loadTickets() {
  const box = document.getElementById('ticketTable');
  if (!box) return;
  box.innerHTML = '<div class="empty"><span class="spinner light"></span></div>';
  const qs = new URLSearchParams({
    page: ticketState.page, pageSize: ticketState.pageSize,
    q: ticketState.q, status: ticketState.status, zone: ticketState.zone, date: ticketState.date
  });
  const { json } = await api('GET', '/api/admin/tickets?' + qs);
  const r = json.data;
  window.__lastTickets = r.items;
  if (!r.items.length) {
    box.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/></svg>
        <div>暂无符合条件的票码</div>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr>
            <th>入场码</th><th>姓名</th><th>手机号</th><th>票种</th>
            <th>展区</th><th>入场日期</th><th>状态</th><th>核验时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${r.items.map(t => `
            <tr>
              <td class="mono">${esc(t.code)}</td>
              <td>${esc(t.name)}</td>
              <td class="mono muted">${esc(t.phone)}</td>
              <td>${esc(t.ticketType)}</td>
              <td>${esc(t.zone)}</td>
              <td class="mono">${esc(t.entryDate)}</td>
              <td>${statusBadge(t.status)}</td>
              <td class="muted" style="font-size:12px;">${t.verifiedAt ? fmtTime(t.verifiedAt) : '—'}</td>
              <td>
                <div class="row-actions">
                  ${t.status !== 'verified' && t.status !== 'disabled'
                    ? `<button class="btn-link" onclick="doVerify('${t.id}')">核验</button>` : ''}
                  <button class="btn-link" onclick="openTicketModal('${t.id}')">编辑</button>
                  <button class="btn-link danger" onclick="deleteTicket('${t.id}', '${esc(t.code)}')">删除</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pagerHTML(r)}`;
}

/* ---------- 新增 / 编辑票码 ---------- */

async function openTicketModal(id) {
  let t = null;
  if (id) {
    // 编辑数据取自最近加载的列表缓存；缓存失效时回退拉取
    if (!window.__lastTickets || !window.__lastTickets.some(x => x.id === id)) {
      const { json } = await api('GET', '/api/admin/tickets?page=1&pageSize=200');
      window.__lastTickets = json.data.items;
    }
    t = window.__lastTickets.find(x => x.id === id) || null;
  }
  if (id && !t) { toast('未找到该票码，请刷新列表重试', 'error'); return; }
  if (!zonesCache.length) await loadZonesSafe();

  const title = t ? '编辑票码' : '新增票码';
  openModal(title, `
    <div class="form-grid">
      <div class="full field">
        <label>入场码 ${t ? '<span class="muted">（创建后不可修改）</span>' : ''}</label>
        <input id="mCode" maxlength="32" placeholder="如 EXPO2026A0001"
          value="${t ? esc(t.code) : ''}" ${t ? 'disabled' : ''}
          style="${t ? 'opacity:.55;' : ''}" />
      </div>
      <div class="field">
        <label>姓名 *</label>
        <input id="mName" maxlength="50" value="${t ? esc(t.name) : ''}" placeholder="观众姓名" />
      </div>
      <div class="field">
        <label>手机号 *</label>
        <input id="mPhone" maxlength="11" inputmode="numeric" value="${t ? esc(t.phone) : ''}" placeholder="11 位手机号" />
      </div>
      <div class="field">
        <label>票种 *</label>
        <input id="mType" maxlength="30" value="${t ? esc(t.ticketType) : ''}" placeholder="如 VIP通票 / 专业观众票" />
      </div>
      <div class="field">
        <label>所属展区 *</label>
        <input id="mZone" maxlength="50" value="${t ? esc(t.zone) : ''}" placeholder="如 主展区A馆" list="zoneList" />
        <datalist id="zoneList">${zonesCache.map(z => `<option value="${esc(z)}">`).join('')}</datalist>
      </div>
      <div class="field">
        <label>入场日期 *</label>
        <input id="mDate" type="date" value="${t ? esc(t.entryDate) : ''}" />
      </div>
      <div class="field">
        <label>核验状态</label>
        <select id="mStatus">
          <option value="unused" ${t && t.status === 'unused' ? 'selected' : ''}>未核验</option>
          <option value="verified" ${t && t.status === 'verified' ? 'selected' : ''}>已核验</option>
          <option value="disabled" ${t && t.status === 'disabled' ? 'selected' : ''}>已停用</option>
        </select>
      </div>
      <div class="full field" style="margin-bottom:0;">
        <label>备注</label>
        <textarea id="mNote" rows="2" maxlength="200" placeholder="选填，最多 200 字">${t ? esc(t.note || '') : ''}</textarea>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" style="width:auto;padding:11px 22px;" onclick="saveTicket('${id || ''}')">保存</button>`);
}

// 缓存当前页票码供编辑使用（见 loadTickets 中的 window.__lastTickets）

async function saveTicket(id) {
  const payload = {
    code: (document.getElementById('mCode').value || '').trim().toUpperCase(),
    name: document.getElementById('mName').value.trim(),
    phone: document.getElementById('mPhone').value.replace(/\D/g, ''),
    ticketType: document.getElementById('mType').value.trim(),
    zone: document.getElementById('mZone').value.trim(),
    entryDate: document.getElementById('mDate').value,
    status: document.getElementById('mStatus').value,
    note: document.getElementById('mNote').value.trim()
  };
  if (!id && !/^[A-Za-z0-9_-]{4,32}$/.test(payload.code)) return toast('入场码需为 4-32 位字母、数字、下划线或连字符', 'error');
  if (!payload.name) return toast('请填写姓名', 'error');
  if (!/^1[3-9]\d{9}$/.test(payload.phone)) return toast('请填写正确的 11 位手机号', 'error');
  if (!payload.ticketType) return toast('请填写票种', 'error');
  if (!payload.zone) return toast('请填写所属展区', 'error');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.entryDate)) return toast('请选择入场日期', 'error');

  const { status, json } = id
    ? await api('PUT', `/api/admin/tickets/${id}`, payload)
    : await api('POST', '/api/admin/tickets', payload);
  if (json.ok) {
    toast(id ? '票码已更新' : '票码已新增', 'success');
    closeModal();
    await loadZones();
    await loadTickets();
    if (currentPage === 'dashboard') renderDashboard();
  } else {
    toast(json.message || '保存失败', 'error');
  }
}

async function doVerify(id) {
  const { json } = await api('POST', `/api/admin/tickets/${id}/verify`);
  if (json.ok) {
    toast(`已核验：${json.data.name}（${json.data.code}）`, 'success');
    loadTickets();
  } else {
    toast(json.message || '核验失败', 'error');
  }
}

function deleteTicket(id, code) {
  openModal('删除票码', `
    <p style="color:var(--text-2);font-size:14px;line-height:1.8;">
      确定删除票码 <strong class="mono" style="color:var(--red);">${esc(code)}</strong> 吗？<br/>
      删除后观众将无法再凭此码查询入场信息，此操作不可恢复。
    </p>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="confirmDelete('${id}')">确认删除</button>`);
}
async function confirmDelete(id) {
  const { json } = await api('DELETE', `/api/admin/tickets/${id}`);
  if (json.ok) {
    toast('票码已删除', 'success');
    closeModal();
    loadTickets();
  } else {
    toast(json.message || '删除失败', 'error');
  }
}

/* ---------- 批量导入 ---------- */

function openImportModal() {
  openModal('批量导入票码', `
    <p style="font-size:13.5px;color:var(--text-2);margin-bottom:14px;">
      支持 CSV 文件（UTF-8 编码）。必填列：<strong>入场码、姓名、手机号、票种、展区、入场日期</strong>，
      表头同时支持中英文（code/name/phone/type/zone/date）。
    </p>
    <div class="import-zone" id="dropZone">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p><strong>点击选择文件</strong> 或将 CSV 文件拖拽到此处</p>
      <p class="hint">单次最多约 5MB，重复入场码自动跳过</p>
      <input type="file" id="fileInput" accept=".csv,.txt,text/csv" style="display:none;" />
    </div>
    <div class="field mt-16" style="margin-bottom:0;">
      <label>或直接粘贴 CSV / 表格内容（含表头）</label>
      <textarea id="pasteText" rows="4" placeholder="入场码,姓名,手机号,票种,展区,入场日期&#10;EXPO2026A0001,张三,13800138000,VIP通票,主展区A馆,2026-10-15"></textarea>
    </div>
    <div id="importResult"></div>`,
    `<a class="btn btn-ghost" href="/api/admin/template.csv" target="_blank">下载模板</a>
     <button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" style="width:auto;padding:11px 22px;" id="importBtn" onclick="doImport()">开始导入</button>`);

  const zone = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  });
  input.addEventListener('change', () => { if (input.files[0]) readFile(input.files[0]); });
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('pasteText').value = String(reader.result || '');
    toast(`已载入文件：${file.name}`, 'info');
  };
  reader.readAsText(file, 'utf-8');
}

async function doImport() {
  const text = document.getElementById('pasteText').value;
  const btn = document.getElementById('importBtn');
  if (!text.trim()) return toast('请先选择文件或粘贴导入内容', 'error');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 导入中…';
  try {
    const { json } = await api('POST', '/api/admin/import', { text });
    const box = document.getElementById('importResult');
    if (json.ok) {
      const d = json.data;
      const cls = d.failed === 0 ? 'ok' : 'warn';
      box.innerHTML = `
        <div class="import-summary ${cls}">
          <strong>导入完成：</strong>共 ${d.total} 行，成功
          <strong style="color:var(--green);">${d.imported}</strong> 条，
          失败/跳过 <strong style="color:${d.failed ? 'var(--amber)' : 'inherit'};">${d.failed}</strong> 条
          ${d.skipped.length ? `<ul>${d.skipped.map(s =>
            `<li>第 ${s.row || '?'} 行 ${esc(s.code || '')}：${esc(s.reason)}</li>`).join('')}</ul>` : ''}
        </div>`;
      toast(`成功导入 ${d.imported} 条`, d.failed ? 'info' : 'success');
      await loadZones();
      loadTickets();
    } else {
      toast(json.message || '导入失败', 'error');
    }
  } catch {
    toast('网络异常，导入失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '开始导入';
  }
}

function downloadTemplate() {
  window.open('/api/admin/template.csv', '_blank');
}
function exportTickets() {
  const qs = new URLSearchParams({
    q: ticketState.q, status: ticketState.status,
    zone: ticketState.zone, date: ticketState.date
  });
  window.open('/api/admin/export?' + qs, '_blank');
}

/* ============================================================
   查询记录
   ============================================================ */

const logState = { page: 1, pageSize: 20, success: '' };

async function renderLogsPage() {
  const root = document.getElementById('pageRoot');
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>查询记录</h2>
        <p>所有访客查询行为均留痕，含成功与失败原因（最多保留 5 万条）</p>
      </div>
    </div>
    <div class="toolbar">
      <select id="logFilter" style="min-width:150px;">
        <option value="">全部结果</option>
        <option value="ok" ${logState.success === 'ok' ? 'selected' : ''}>仅成功</option>
        <option value="fail" ${logState.success === 'fail' ? 'selected' : ''}>仅失败</option>
      </select>
      <button class="btn btn-ghost" onclick="applyLogFilter()">筛选</button>
    </div>
    <div class="card table-card"><div id="logTable"></div></div>`;
  loadLogs();
}
function applyLogFilter() {
  logState.success = document.getElementById('logFilter').value;
  logState.page = 1;
  loadLogs();
}
async function loadLogs() {
  const box = document.getElementById('logTable');
  if (!box) return;
  box.innerHTML = '<div class="empty"><span class="spinner light"></span></div>';
  const qs = new URLSearchParams({
    page: logState.page, pageSize: logState.pageSize, success: logState.success
  });
  const { json } = await api('GET', '/api/admin/logs?' + qs);
  const r = json.data;
  if (!r.items.length) {
    box.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <div>暂无查询记录</div>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr><th>时间</th><th>结果</th><th>手机号</th><th>入场码</th><th>原因/说明</th><th>查询快照</th><th>IP</th></tr>
        </thead>
        <tbody>
          ${r.items.map(l => `
            <tr>
              <td class="mono" style="white-space:nowrap;">${fmtTime(l.timestamp)}</td>
              <td><span class="tag ${l.success ? 'tag-ok' : 'tag-fail'}">${l.success ? '成功' : '失败'}</span></td>
              <td class="mono muted">${esc(maskPhone(l.phone))}</td>
              <td class="mono">${esc(l.code)}</td>
              <td class="muted">${esc(REASON_TEXT[l.reason] || l.reason)}</td>
              <td class="muted" style="font-size:12px;">
                ${l.snapshot ? `${esc(l.snapshot.name)} · ${esc(l.snapshot.zone)} · ${esc(l.snapshot.entryDate)}` : '—'}
              </td>
              <td class="mono muted" style="font-size:12px;">${esc(l.ip)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pagerHTML(r)}`;
}

/* ============================================================
   管理员账号（超管）
   ============================================================ */

async function renderAdminsPage() {
  if (ME.role !== 'super') return navigate('dashboard');
  const root = document.getElementById('pageRoot');
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>管理员账号</h2>
        <p>新增后台管理员、重置密码、停用账号（普通管理员可登录后台管理票码）</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary btn-sm" style="width:auto;padding:10px 18px;" onclick="openAdminModal()">+ 新增管理员</button>
      </div>
    </div>
    <div class="card table-card"><div id="adminTable" class="text-center muted" style="padding:50px;">
      <span class="spinner light"></span>
    </div></div>`;
  loadAdmins();
}

async function loadAdmins() {
  const box = document.getElementById('adminTable');
  const { json } = await api('GET', '/api/admin/admins');
  if (!json.ok) { box.innerHTML = `<div class="empty">${esc(json.message)}</div>`; return; }
  const list = json.data;
  box.innerHTML = `
    <div class="table-scroll">
      <table class="data">
        <thead>
          <tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>最近登录</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${list.map(a => `
            <tr ${a.id === ME.id ? 'style="background:rgba(34,211,238,.05);"' : ''}>
              <td class="mono">${esc(a.username)} ${a.id === ME.id ? '<span class="muted" style="font-size:11px;">（当前账号）</span>' : ''}</td>
              <td>${esc(a.displayName)}</td>
              <td><span class="role-tag ${a.role === 'super' ? 'role-super' : 'role-admin'}">${a.role === 'super' ? '超级管理员' : '管理员'}</span></td>
              <td>${a.active
                ? '<span class="badge badge-verified">启用</span>'
                : '<span class="badge badge-disabled">停用</span>'}</td>
              <td class="muted" style="font-size:12px;">${fmtTime(a.lastLoginAt)}</td>
              <td class="muted" style="font-size:12px;">${fmtTime(a.createdAt)}</td>
              <td>
                <div class="row-actions">
                  <button class="btn-link" onclick="openAdminModal('${a.id}')">编辑/重置密码</button>
                  ${a.id !== ME.id ? `<button class="btn-link danger" onclick="deleteAdmin('${a.id}','${esc(a.username)}')">删除</button>` : ''}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function openAdminModal(id) {
  // 简单起见从表格已加载数据中取不到完整对象，使用接口列表缓存
  api('GET', '/api/admin/admins').then(({ json }) => {
    const a = id ? json.data.find(x => x.id === id) : null;
    const title = a ? '编辑管理员' : '新增管理员';
    openModal(title, `
      <div class="form-grid">
        <div class="field">
          <label>登录账号 ${a ? '' : '*'}</label>
          <input id="aUsername" maxlength="20" value="${a ? esc(a.username) : ''}"
            placeholder="3-20 位字母/数字/下划线" ${a ? 'disabled style="opacity:.55;"' : ''} />
        </div>
        <div class="field">
          <label>显示名称</label>
          <input id="aDisplayName" maxlength="30" value="${a ? esc(a.displayName) : ''}" placeholder="如 现场工作人员A" />
        </div>
        <div class="field">
          <label>角色</label>
          <select id="aRole" ${a && a.id === ME.id ? 'disabled' : ''}>
            <option value="admin" ${a && a.role === 'admin' ? 'selected' : ''}>管理员（票码与记录）</option>
            <option value="super" ${(!a || a.role === 'super') ? 'selected' : ''}>超级管理员（全部权限）</option>
          </select>
        </div>
        <div class="field">
          <label>状态</label>
          <select id="aActive" ${a && a.id === ME.id ? 'disabled' : ''}>
            <option value="1" ${!a || a.active ? 'selected' : ''}>启用</option>
            <option value="0" ${a && !a.active ? 'selected' : ''}>停用</option>
          </select>
        </div>
        <div class="full field" style="margin-bottom:0;">
          <label>${a ? '重置密码（留空则不修改）' : '初始密码 *'}</label>
          <input id="aPassword" type="password" minlength="6" autocomplete="new-password"
            placeholder="${a ? '留空保持原密码' : '至少 6 位'}" />
        </div>
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
       <button class="btn btn-primary" style="width:auto;padding:11px 22px;" onclick="saveAdmin('${id || ''}')">保存</button>`);
  });
}

async function saveAdmin(id) {
  const displayName = document.getElementById('aDisplayName').value.trim();
  const role = document.getElementById('aRole').value;
  const active = document.getElementById('aActive').value === '1';
  const password = document.getElementById('aPassword').value;
  let res;
  if (!id) {
    const username = document.getElementById('aUsername').value.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return toast('账号需为 3-20 位字母、数字或下划线', 'error');
    if (!password || password.length < 6) return toast('请设置至少 6 位初始密码', 'error');
    res = await api('POST', '/api/admin/admins', { username, password, displayName, role });
  } else {
    const payload = { displayName, role, active };
    if (password) payload.password = password;
    res = await api('PUT', `/api/admin/admins/${id}`, payload);
  }
  if (res.json.ok) {
    toast(id ? '管理员已更新' : '管理员已新增', 'success');
    closeModal();
    loadAdmins();
  } else {
    toast(res.json.message || '保存失败', 'error');
  }
}

function deleteAdmin(id, username) {
  openModal('删除管理员', `
    <p style="color:var(--text-2);font-size:14px;line-height:1.8;">
      确定删除管理员 <strong style="color:var(--red);">${esc(username)}</strong> 吗？<br/>
      该账号的登录会话将立即失效。
    </p>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" onclick="confirmDeleteAdmin('${id}')">确认删除</button>`);
}
async function confirmDeleteAdmin(id) {
  const { json } = await api('DELETE', `/api/admin/admins/${id}`);
  if (json.ok) {
    toast('管理员已删除', 'success');
    closeModal();
    loadAdmins();
  } else {
    toast(json.message || '删除失败', 'error');
  }
}

/* ---------------- 启动 ---------------- */
bootstrap();
