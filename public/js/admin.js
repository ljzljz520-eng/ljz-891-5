/* ---------- 工具 ---------- */
const $ = (id) => document.getElementById(id);
const STATUS_TEXT = { valid: '未核验', used: '已核验', revoked: '已作废' };
const STATUS_CLS = { valid: 'valid', used: 'used', revoked: 'revoked' };
let token = localStorage.getItem('expo_token') || '';
let adminName = localStorage.getItem('expo_admin') || '';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, options = {}) {
  const res = await fetch('/api/admin' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Token': token,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(false); throw new Error(data.error || '登录已过期'); }
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
}

/* ---------- 登录 / 登出 ---------- */
function enterAdmin() {
  $('loginView').classList.add('hidden');
  $('adminView').classList.remove('hidden');
  $('adminName').textContent = '👤 ' + adminName;
  loadStats(); loadTickets(); loadLogs(); loadAdmins();
}

function logout(callApi = true) {
  if (callApi && token) api('/logout', { method: 'POST' }).catch(() => {});
  token = ''; adminName = '';
  localStorage.removeItem('expo_token');
  localStorage.removeItem('expo_admin');
  $('adminView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('loginUser').value.trim(),
        password: $('loginPass').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) { showMsg($('loginMsg'), data.error || '登录失败'); return; }
    token = data.token; adminName = data.username;
    localStorage.setItem('expo_token', token);
    localStorage.setItem('expo_admin', adminName);
    enterAdmin();
  } catch (err) {
    showMsg($('loginMsg'), '网络异常，请稍后重试');
  } finally {
    btn.disabled = false; btn.textContent = '登 录';
  }
});

$('logoutBtn').addEventListener('click', () => logout(true));

/* ---------- 标签页 ---------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('pane-' + tab.dataset.pane).classList.add('active');
    if (tab.dataset.pane === 'logs') loadLogs();
    if (tab.dataset.pane === 'admins') loadAdmins();
  });
});

/* ---------- 数据概览 ---------- */
async function loadStats() {
  try {
    const s = await api('/stats');
    $('stTotal').textContent = s.total;
    $('stValid').textContent = s.valid;
    $('stUsed').textContent = s.used;
    $('stRevoked').textContent = s.revoked;
    $('stToday').textContent = s.today_queries + ' / ' + s.today_success;
  } catch (e) { /* 登录失效时已处理 */ }
}

/* ---------- 票码管理 ---------- */
let tPage = 1;
const T_SIZE = 10;

async function loadTickets(page = tPage) {
  const kw = $('searchKw').value.trim();
  const status = $('searchStatus').value;
  const params = new URLSearchParams({ page, size: T_SIZE });
  if (kw) params.set('keyword', kw);
  if (status) params.set('status', status);
  try {
    const data = await api('/tickets?' + params);
    tPage = data.page;
    const tb = $('ticketRows');
    if (!data.rows.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">暂无数据</td></tr>';
    } else {
      tb.innerHTML = data.rows.map((t) => `
        <tr>
          <td>${esc(t.name)}</td>
          <td class="mono">${esc(t.phone)}</td>
          <td class="mono">${esc(t.code)}</td>
          <td>${esc(t.ticket_type)}</td>
          <td>${esc(t.entry_date)}</td>
          <td>${esc(t.zone)}</td>
          <td><span class="badge ${STATUS_CLS[t.status]}">${STATUS_TEXT[t.status] || t.status}</span></td>
          <td><div class="row-actions">
            ${t.status !== 'used' ? `<button class="link-btn" onclick="setStatus(${t.id},'used')">核销</button>` : ''}
            ${t.status !== 'valid' ? `<button class="link-btn" onclick="setStatus(${t.id},'valid')">恢复</button>` : ''}
            ${t.status !== 'revoked' ? `<button class="link-btn" onclick="setStatus(${t.id},'revoked')">作废</button>` : ''}
            <button class="link-btn danger" onclick="delTicket(${t.id})">删除</button>
          </div></td>
        </tr>`).join('');
    }
    const pages = Math.max(1, Math.ceil(data.total / T_SIZE));
    $('ticketTotal').textContent = `共 ${data.total} 条`;
    $('ticketPage').textContent = `${tPage} / ${pages}`;
    $('ticketPrev').disabled = tPage <= 1;
    $('ticketNext').disabled = tPage >= pages;
  } catch (e) { /* handled */ }
}

window.setStatus = async (id, status) => {
  try {
    await api('/tickets/' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadTickets(); loadStats();
  } catch (e) { alert(e.message); }
};

window.delTicket = async (id) => {
  if (!confirm('确定删除该票码？删除后观众将无法查询到该记录。')) return;
  try {
    await api('/tickets/' + id, { method: 'DELETE' });
    loadTickets(); loadStats();
  } catch (e) { alert(e.message); }
};

$('searchBtn').addEventListener('click', () => loadTickets(1));
$('searchKw').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTickets(1); });
$('searchStatus').addEventListener('change', () => loadTickets(1));
$('ticketPrev').addEventListener('click', () => loadTickets(tPage - 1));
$('ticketNext').addEventListener('click', () => loadTickets(tPage + 1));

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.name.value.trim(), phone: f.phone.value.trim(), code: f.code.value.trim(),
    ticket_type: f.ticket_type.value.trim(), entry_date: f.entry_date.value, zone: f.zone.value.trim(),
  };
  const btn = $('addBtn'); btn.disabled = true;
  try {
    await api('/tickets', { method: 'POST', body: JSON.stringify(body) });
    showMsg($('addMsg'), '✓ 新增成功', true);
    f.reset();
    loadTickets(1); loadStats();
  } catch (err) {
    showMsg($('addMsg'), err.message, false);
  } finally { btn.disabled = false; }
});

/* ---------- 批量导入 ---------- */
$('importBtn').addEventListener('click', async () => {
  const text = $('importText').value;
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) { $('importResult').innerHTML = '<span class="msg err">请先粘贴要导入的数据</span>'; return; }

  const rows = lines.map((line) => {
    const c = line.split(/[,，]/).map((s) => s.trim());
    return { name: c[0], phone: c[1], code: c[2], ticket_type: c[3], entry_date: c[4], zone: c[5] };
  });

  const btn = $('importBtn'); btn.disabled = true; btn.textContent = '导入中…';
  try {
    const data = await api('/tickets/batch', { method: 'POST', body: JSON.stringify({ rows }) });
    let html = `<span class="msg ok">✓ 成功导入 ${data.inserted} 条</span>`;
    if (data.failed && data.failed.length) {
      html += `<span class="msg err" style="margin-left:10px">失败 ${data.failed.length} 条</span>
        <div class="fail-list">` +
        data.failed.map((f) => `第 ${f.line} 行：${esc(f.reason)}`).join('<br>') + '</div>';
    }
    $('importResult').innerHTML = html;
    loadTickets(1); loadStats();
  } catch (err) {
    $('importResult').innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
  } finally { btn.disabled = false; btn.textContent = '开始导入'; }
});

$('importClear').addEventListener('click', () => { $('importText').value = ''; $('importResult').innerHTML = ''; });

/* ---------- 查询记录 ---------- */
let lPage = 1;
const L_SIZE = 15;

async function loadLogs(page = lPage) {
  try {
    const data = await api('/logs?' + new URLSearchParams({ page, size: L_SIZE }));
    lPage = data.page;
    const tb = $('logRows');
    if (!data.rows.length) {
      tb.innerHTML = '<tr><td colspan="6" class="empty">暂无查询记录</td></tr>';
    } else {
      tb.innerHTML = data.rows.map((l) => `
        <tr>
          <td class="mono">${esc(l.created_at)}</td>
          <td class="mono">${esc(l.phone)}</td>
          <td class="mono">${esc(l.code)}</td>
          <td>${l.success
            ? '<span class="badge valid">成功</span>'
            : '<span class="badge revoked">失败</span>'}</td>
          <td>${esc(l.message)}</td>
          <td class="mono">${esc(l.ip)}</td>
        </tr>`).join('');
    }
    const pages = Math.max(1, Math.ceil(data.total / L_SIZE));
    $('logTotal').textContent = `共 ${data.total} 条`;
    $('logPage').textContent = `${lPage} / ${pages}`;
    $('logPrev').disabled = lPage <= 1;
    $('logNext').disabled = lPage >= pages;
  } catch (e) { /* handled */ }
}
$('logPrev').addEventListener('click', () => loadLogs(lPage - 1));
$('logNext').addEventListener('click', () => loadLogs(lPage + 1));

/* ---------- 管理员 ---------- */
async function loadAdmins() {
  try {
    const data = await api('/admins');
    $('adminRows').innerHTML = data.rows.map((a) => `
      <tr>
        <td>${a.id}</td>
        <td>${esc(a.username)}${a.username === adminName ? ' <span class="badge used">当前</span>' : ''}</td>
        <td class="mono">${esc(a.created_at)}</td>
        <td>${a.username === adminName ? '' :
          `<button class="link-btn danger" onclick="delAdmin(${a.id},'${esc(a.username)}')">删除</button>`}</td>
      </tr>`).join('');
  } catch (e) { /* handled */ }
}

window.delAdmin = async (id, name) => {
  if (!confirm(`确定删除管理员「${name}」？`)) return;
  try {
    await api('/admins/' + id, { method: 'DELETE' });
    loadAdmins();
  } catch (e) { alert(e.message); }
};

$('adminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admins', {
      method: 'POST',
      body: JSON.stringify({ username: $('newAdminUser').value.trim(), password: $('newAdminPass').value }),
    });
    showMsg($('adminMsg'), '✓ 新增成功', true);
    $('newAdminUser').value = ''; $('newAdminPass').value = '';
    loadAdmins();
  } catch (err) { showMsg($('adminMsg'), err.message, false); }
});

$('pwdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/password', {
      method: 'POST',
      body: JSON.stringify({ old_password: $('oldPwd').value, new_password: $('newPwd').value }),
    });
    showMsg($('pwdMsg'), '✓ 密码已修改', true);
    $('oldPwd').value = ''; $('newPwd').value = '';
  } catch (err) { showMsg($('pwdMsg'), err.message, false); }
});

/* ---------- 启动 ---------- */
if (token) enterAdmin();
