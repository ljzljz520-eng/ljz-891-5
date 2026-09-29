(function () {
  'use strict';

  /* ================= 基础工具 ================= */
  const $ = (id) => document.getElementById(id);
  const STATUS_BADGE = {
    '未核验': 'badge-blue', '已核验': 'badge-amber',
    '已入场': 'badge-green', '已作废': 'badge-red'
  };

  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(url, opt);
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (res.status === 401) {
      showLogin();
      throw new Error('未登录或会话已过期');
    }
    if (!json) throw new Error('服务器响应异常');
    if (!json.ok) throw new Error(json.message || '请求失败');
    return json.data;
  }

  let appAlertTimer = null;
  function appAlert(message, type) {
    const el = $('appAlert');
    el.className = 'alert alert-' + (type || 'success');
    el.textContent = message;
    clearTimeout(appAlertTimer);
    if (type !== 'persist') appAlertTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function statusBadge(s) {
    return `<span class="badge ${STATUS_BADGE[s] || 'badge-gray'}">${esc(s)}</span>`;
  }

  /* ================= 弹窗 ================= */
  function openModal(id) { $(id).classList.add('show'); }
  function closeModal(id) { $(id).classList.remove('show'); }
  document.querySelectorAll('.modal-mask').forEach((mask) => {
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.classList.remove('show'); });
  });
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  function confirmDialog({ title, text, okText, onOk }) {
    $('confirmTitle').textContent = title || '确认操作';
    $('confirmText').innerHTML = text;
    $('confirmOkBtn').textContent = okText || '确认';
    openModal('confirmModal');
    const btn = $('confirmOkBtn');
    const handler = async () => {
      btn.disabled = true;
      try { await onOk(); closeModal('confirmModal'); }
      catch (e) { appAlert(e.message, 'error'); }
      finally { btn.disabled = false; btn.removeEventListener('click', handler); }
    };
    btn.addEventListener('click', handler);
  }

  /* ================= 登录 / 会话 ================= */
  let currentUser = null;

  function showLogin() {
    $('loginView').classList.remove('hidden');
    $('appView').classList.add('hidden');
  }
  function showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = $('loginAlert');
    alertEl.classList.add('hidden');
    const btn = $('loginBtn');
    btn.disabled = true;
    $('loginBtnText').innerHTML = '<span class="spinner"></span> 登录中';
    try {
      const data = await api('POST', '/api/auth/login', {
        username: $('loginUsername').value.trim(),
        password: $('loginPassword').value
      });
      await bootstrap(data);
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      $('loginBtnText').textContent = '登 录';
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
    currentUser = null;
    showLogin();
    $('loginPassword').value = '';
  });

  async function bootstrap(user) {
    currentUser = user;
    $('adminName').textContent = user.displayName || user.username;
    const roleEl = $('adminRole');
    if (user.role === 'super') {
      roleEl.className = 'badge badge-purple';
      roleEl.textContent = '超级管理员';
      $('tabAdmins').style.display = '';
    } else {
      roleEl.className = 'badge badge-blue';
      roleEl.textContent = '管理员';
      $('tabAdmins').style.display = 'none';
    }
    showApp();
    switchTab('dashboard');
    loadStats();
  }

  /* ================= Tab 切换 ================= */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    $('tab-' + name).classList.remove('hidden');
    if (name === 'tickets') loadTickets();
    if (name === 'logs') loadLogs();
    if (name === 'admins' && currentUser && currentUser.role === 'super') loadAdmins();
  }
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  /* ================= 数据概览 ================= */
  async function loadStats() {
    try {
      const s = await api('GET', '/api/stats');
      $('stTotalTickets').textContent = s.totalTickets;
      $('stTodayVerified').textContent = s.todayVerified;
      $('stTodayQueries').textContent = s.todayQueries;
      $('stTotalLogs').textContent = s.totalLogs;
      $('stAdminsLine').textContent = `管理员 ${s.totalAdmins} 人`;

      const defs = [
        ['未入场未核验', s.byStatus['未核验'] || 0, 'fill-blue'],
        ['已核验', s.byStatus['已核验'] || 0, 'fill-amber'],
        ['已入场', s.byStatus['已入场'] || 0, 'fill-green'],
        ['已作废', s.byStatus['已作废'] || 0, 'fill-red']
      ];
      const max = Math.max(1, ...defs.map((d) => d[1]));
      $('statusBars').innerHTML = defs.map(([label, n, cls]) => `
        <div class="status-bar-row">
          <div class="status-bar-label">${statusBadge(label === '未入场未核验' ? '未核验' : label)}</div>
          <div class="status-bar-track"><div class="status-bar-fill ${cls}" style="width:0" data-w="${Math.round(n / max * 100)}%"></div></div>
          <div class="status-bar-count">${n}</div>
        </div>`).join('');
      requestAnimationFrame(() => {
        document.querySelectorAll('.status-bar-fill').forEach((el) => { el.style.width = el.dataset.w; });
      });
    } catch (e) { /* 401 已处理 */ }
  }

  /* ================= 票码管理 ================= */
  const ticketState = { page: 1, pageSize: 15, keyword: '', status: '', total: 0 };

  async function loadTickets() {
    const tbody = $('ticketTbody');
    tbody.innerHTML = `<tr><td colspan="9" class="empty"><span class="spinner dark"></span> 加载中...</td></tr>`;
    try {
      const qs = new URLSearchParams({
        page: ticketState.page, pageSize: ticketState.pageSize,
        keyword: ticketState.keyword, status: ticketState.status
      });
      const data = await api('GET', '/api/tickets?' + qs.toString());
      ticketState.total = data.total;
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty">暂无票码数据，点击右上角「新增票码」或「批量导入」</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((t) => `
          <tr>
            <td class="code-cell">${esc(t.code)}</td>
            <td>${esc(t.name)}</td>
            <td class="mono dim">${esc(t.phone)}</td>
            <td>${esc(t.ticketType)}</td>
            <td>${esc(t.zone)}</td>
            <td class="dim">${esc(t.entryDate)}</td>
            <td>${statusBadge(t.status)}</td>
            <td class="dim">${esc(t.createdBy || '-')}</td>
            <td>
              <div class="row-actions">
                <button class="link-btn" data-edit="${t.id}">编辑</button>
                <button class="link-btn danger" data-del="${t.id}">删除</button>
              </div>
            </td>
          </tr>`).join('');
      }
      renderPager($('ticketPager'), ticketState, data.total, loadTickets);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">${esc(e.message)}</td></tr>`;
    }
  }

  $('ticketSearchBtn').addEventListener('click', () => {
    ticketState.keyword = $('ticketKeyword').value.trim();
    ticketState.status = $('ticketStatus').value;
    ticketState.page = 1;
    loadTickets();
  });
  $('ticketKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('ticketSearchBtn').click(); });

  $('exportBtn').addEventListener('click', () => {
    const qs = new URLSearchParams({ keyword: ticketState.keyword, status: ticketState.status });
    window.open('/api/tickets/export?' + qs.toString(), '_blank');
  });

  /* ----- 新增 / 编辑票码 ----- */
  let editingTicketId = null;
  function resetTicketForm() {
    ['fCode', 'fPhone', 'fName', 'fTicketType', 'fZone', 'fNote'].forEach((id) => $(id).value = '');
    $('fStatus').value = '未核验';
    $('fEntryDate').value = '';
    $('ticketFormAlert').classList.add('hidden');
  }
  $('addTicketBtn').addEventListener('click', () => {
    editingTicketId = null;
    $('ticketModalTitle').textContent = '新增票码';
    resetTicketForm();
    $('fCode').disabled = false;
    openModal('ticketModal');
    setTimeout(() => $('fCode').focus(), 50);
  });

  $('ticketTbody').addEventListener('click', async (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    if (editId) {
      try {
        const qs = new URLSearchParams({ keyword: '', page: 1, pageSize: 200 });
        const data = await api('GET', '/api/tickets?' + qs.toString());
        const t = data.items.find((x) => x.id === editId);
        if (!t) return;
        editingTicketId = t.id;
        $('ticketModalTitle').textContent = '编辑票码';
        $('fCode').value = t.code;
        $('fPhone').value = t.phone;
        $('fName').value = t.name;
        $('fTicketType').value = t.ticketType;
        $('fZone').value = t.zone;
        $('fEntryDate').value = t.entryDate;
        $('fStatus').value = t.status;
        $('fNote').value = t.note || '';
        $('ticketFormAlert').classList.add('hidden');
        $('fCode').disabled = false;
        openModal('ticketModal');
      } catch (err) { appAlert(err.message, 'error'); }
    }
    if (delId) {
      const row = ticketCache(delId);
      confirmDialog({
        title: '删除票码',
        text: `确定删除入场码 <strong class="mono">${esc(row ? row.code : delId)}</strong> 吗？<br>删除后观众将无法通过该码查询，此操作不可恢复。`,
        okText: '确认删除',
        onOk: async () => {
          await api('DELETE', '/api/tickets/' + delId);
          appAlert('票码已删除');
          loadTickets(); loadStats();
        }
      });
    }
  });

  /* 缓存当前页数据，删除确认时展示编码 */
  function ticketCache(id) {
    // 简单方式：从 DOM 取
    const btn = document.querySelector(`[data-del="${id}"]`);
    if (!btn) return null;
    const tr = btn.closest('tr');
    return { code: tr ? tr.children[0].textContent : '' };
  }

  $('saveTicketBtn').addEventListener('click', async () => {
    const payload = {
      code: $('fCode').value,
      phone: $('fPhone').value.trim(),
      name: $('fName').value.trim(),
      ticketType: $('fTicketType').value.trim(),
      zone: $('fZone').value.trim(),
      entryDate: $('fEntryDate').value,
      status: $('fStatus').value,
      note: $('fNote').value.trim()
    };
    const formAlert = $('ticketFormAlert');
    const btn = $('saveTicketBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      if (editingTicketId) {
        await api('PUT', '/api/tickets/' + editingTicketId, payload);
        appAlert('票码已更新');
      } else {
        await api('POST', '/api/tickets', payload);
        appAlert('票码新增成功');
      }
      closeModal('ticketModal');
      loadTickets(); loadStats();
    } catch (e) {
      formAlert.textContent = e.message;
      formAlert.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  });

  /* ----- 批量导入 ----- */
  $('importBtn').addEventListener('click', () => {
    $('importFile').value = '';
    $('importText').value = '';
    $('importResult').innerHTML = '';
    openModal('importModal');
  });
  $('importFile').addEventListener('change', () => {
    const file = $('importFile').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { $('importText').value = String(reader.result || ''); };
    reader.readAsText(file, 'utf-8');
  });
  $('doImportBtn').addEventListener('click', async () => {
    const csv = $('importText').value.trim();
    if (!csv) {
      $('importResult').innerHTML = '<div class="alert alert-error" style="margin:0">请选择文件或粘贴 CSV 内容</div>';
      return;
    }
    const btn = $('doImportBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 导入中';
    try {
      const r = await api('POST', '/api/tickets/import', { csv });
      const failHtml = r.failures.length
        ? `<ul class="import-failures">${r.failures.map((f) =>
            `<li>第 ${f.line} 行 · <span class="mono">${esc(f.code)}</span>：${esc(f.message)}</li>`).join('')}</ul>`
        : '<div style="color:var(--green);margin-top:8px">全部记录导入成功</div>';
      $('importResult').innerHTML = `
        <div class="import-summary">
          共解析 <span class="num">${r.total}</span> 条 ·
          成功 <span class="num" style="color:var(--green)">${r.success}</span> 条 ·
          跳过 <span class="num" style="color:${r.skipped ? 'var(--amber)' : 'inherit'}">${r.skipped}</span> 条
          ${failHtml}
        </div>`;
      loadTickets(); loadStats();
    } catch (e) {
      $('importResult').innerHTML = `<div class="alert alert-error" style="margin:0">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '开始导入';
    }
  });

  /* ================= 查询记录 ================= */
  const logState = { page: 1, pageSize: 15, keyword: '', result: '' };

  async function loadLogs() {
    const tbody = $('logTbody');
    tbody.innerHTML = `<tr><td colspan="6" class="empty"><span class="spinner dark"></span> 加载中...</td></tr>`;
    try {
      const qs = new URLSearchParams({
        page: logState.page, pageSize: logState.pageSize,
        keyword: logState.keyword, result: logState.result
      });
      const data = await api('GET', '/api/logs?' + qs.toString());
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty">暂无查询记录</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((l) => `
          <tr>
            <td class="dim mono" style="white-space:nowrap">${esc(l.time)}</td>
            <td class="mono dim">${esc(l.phone || '-')}</td>
            <td class="code-cell">${esc(l.code || '-')}</td>
            <td>${l.ok
                ? '<span class="badge badge-green">成功</span>'
                : '<span class="badge badge-red">失败</span>'}</td>
            <td class="dim">${l.ok ? esc(l.name || '匹配成功') : esc(l.reason || '-')}</td>
            <td class="dim mono">${esc(l.ip || '-')}</td>
          </tr>`).join('');
      }
      renderPager($('logPager'), logState, data.total, loadLogs);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`;
    }
  }
  $('logSearchBtn').addEventListener('click', () => {
    logState.keyword = $('logKeyword').value.trim();
    logState.result = $('logResult').value;
    logState.page = 1;
    loadLogs();
  });
  $('logKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('logSearchBtn').click(); });

  /* ================= 管理员管理 ================= */
  async function loadAdmins() {
    const tbody = $('adminTbody');
    try {
      const list = await api('GET', '/api/admins');
      tbody.innerHTML = list.map((a) => `
        <tr>
          <td class="mono">${esc(a.username)}</td>
          <td>${esc(a.displayName)}</td>
          <td>${a.role === 'super'
              ? '<span class="badge badge-purple">超级管理员</span>'
              : '<span class="badge badge-blue">管理员</span>'}</td>
          <td class="dim">${esc(a.createdAt)}</td>
          <td>
            <div class="row-actions">
              <button class="link-btn" data-admin-edit="${a.id}">编辑</button>
              <button class="link-btn" data-admin-pwd="${a.id}">重置密码</button>
              <button class="link-btn danger" data-admin-del="${a.id}">删除</button>
            </div>
          </td>
        </tr>`).join('');
    } catch (e) {
      appAlert(e.message, 'error');
    }
  }

  let editingAdminId = null;
  function openAdminModal(admin) {
    editingAdminId = admin ? admin.id : null;
    $('adminModalTitle').textContent = admin ? '编辑管理员' : '新增管理员';
    $('afUsername').value = admin ? admin.username : '';
    $('afUsername').disabled = !!admin;
    $('afDisplayName').value = admin ? admin.displayName : '';
    $('afRole').value = admin ? admin.role : 'admin';
    $('afPassword').value = '';
    $('afPasswordLabel').innerHTML = admin ? '设置新密码' : '初始密码<span class="req">*</span>';
    $('afPasswordHint').textContent = admin ? '留空则不修改密码' : '至少 6 位';
    $('adminFormAlert').classList.add('hidden');
    openModal('adminModal');
  }
  $('addAdminBtn').addEventListener('click', () => openAdminModal(null));

  $('adminTbody').addEventListener('click', async (e) => {
    const editId = e.target.dataset.adminEdit;
    const pwdId = e.target.dataset.adminPwd;
    const delId = e.target.dataset.adminDel;
    try {
      if (editId) {
        const list = await api('GET', '/api/admins');
        const a = list.find((x) => x.id === editId);
        if (a) openAdminModal(a);
      }
      if (pwdId) {
        const list = await api('GET', '/api/admins');
        const a = list.find((x) => x.id === pwdId);
        if (a) {
          openAdminModal(a);
          $('afPassword').focus();
        }
      }
      if (delId) {
        const list = await api('GET', '/api/admins');
        const a = list.find((x) => x.id === delId);
        confirmDialog({
          title: '删除管理员',
          text: `确定删除管理员 <strong>${esc(a ? a.username : delId)}</strong> 吗？该账号将立即无法登录。`,
          okText: '确认删除',
          onOk: async () => {
            await api('DELETE', '/api/admins/' + delId);
            appAlert('管理员已删除');
            loadAdmins(); loadStats();
          }
        });
      }
    } catch (err) { appAlert(err.message, 'error'); }
  });

  $('saveAdminBtn').addEventListener('click', async () => {
    const alertEl = $('adminFormAlert');
    const btn = $('saveAdminBtn');
    const username = $('afUsername').value.trim();
    const password = $('afPassword').value;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      if (editingAdminId) {
        const patch = {
          displayName: $('afDisplayName').value.trim(),
          role: $('afRole').value
        };
        if (password) patch.password = password;
        await api('PUT', '/api/admins/' + editingAdminId, patch);
        appAlert('管理员信息已更新');
      } else {
        if (!password) { alertEl.textContent = '请设置初始密码'; alertEl.classList.remove('hidden'); return; }
        await api('POST', '/api/admins', {
          username,
          password,
          displayName: $('afDisplayName').value.trim(),
          role: $('afRole').value
        });
        appAlert('管理员新增成功');
      }
      closeModal('adminModal');
      loadAdmins(); loadStats();
    } catch (e) {
      alertEl.textContent = e.message;
      alertEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  });

  /* ================= 分页渲染 ================= */
  function renderPager(el, state, total, reload) {
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    el.innerHTML = `
      <span>共 ${total} 条 · 第 ${state.page}/${pages} 页</span>
      <button class="btn btn-ghost btn-sm" data-p="prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
      <button class="btn btn-ghost btn-sm" data-p="next" ${state.page >= pages ? 'disabled' : ''}>下一页</button>`;
    el.querySelector('[data-p="prev"]').addEventListener('click', () => {
      if (state.page > 1) { state.page -= 1; reload(); }
    });
    el.querySelector('[data-p="next"]').addEventListener('click', () => {
      if (state.page < pages) { state.page += 1; reload(); }
    });
  }

  /* ================= 启动：检查已有会话 ================= */
  (async function init() {
    try {
      const me = await api('GET', '/api/auth/me');
      await bootstrap(me);
    } catch {
      showLogin();
    }
  })();
})();
