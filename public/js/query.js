(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('queryForm');
  const phoneEl = $('phone');
  const codeEl = $('code');
  const alertBox = $('alertBox');
  const submitBtn = $('submitBtn');
  const btnText = $('btnText');
  const resultPanel = $('resultPanel');

  const STATUS_UI = {
    '未核验': { badge: 'badge-blue', tip: '请于入场日期当天持本凭证前往核验通道。' },
    '已核验': { badge: 'badge-amber', tip: '您的票码已核验，请按指引前往对应展区入场。' },
    '已入场': { badge: 'badge-green', tip: '欢迎入场！请妥善保管观展凭证。' },
    '已作废': { badge: 'badge-red', tip: '该入场码已作废，如有疑问请联系服务台 400-800-2026。' }
  };

  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  const WARN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';

  function showError(msg) {
    alertBox.textContent = msg;
    alertBox.className = 'alert alert-error';
  }
  function clearError() {
    alertBox.className = 'alert alert-error hidden';
  }

  phoneEl.addEventListener('input', () => {
    phoneEl.value = phoneEl.value.replace(/\D/g, '').slice(0, 11);
  });
  codeEl.addEventListener('input', () => {
    codeEl.value = codeEl.value.toUpperCase();
  });

  $('demoBtn').addEventListener('click', () => {
    phoneEl.value = '13800138000';
    codeEl.value = 'EXPO2026-A8K3M9';
    clearError();
    resultPanel.classList.add('hidden');
  });

  $('againBtn').addEventListener('click', () => {
    resultPanel.classList.add('hidden');
    codeEl.value = '';
    codeEl.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    resultPanel.classList.add('hidden');

    const phone = phoneEl.value.trim();
    const code = codeEl.value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return showError('请输入正确的 11 位手机号');
    if (code.length < 4) return showError('请输入有效的入场码');

    submitBtn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span> 核验中...';
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code })
      });
      const json = await res.json();
      if (!json.ok) {
        showError(json.message || '查询失败，请稍后再试');
        return;
      }
      renderResult(json.data);
    } catch (err) {
      showError('网络异常，请检查连接后重试');
    } finally {
      submitBtn.disabled = false;
      btnText.textContent = '立即查询';
    }
  });

  function renderResult(d) {
    const ui = STATUS_UI[d.status] || { badge: 'badge-gray', tip: '' };
    const invalid = d.status === '已作废';

    $('resultIcon').innerHTML = invalid ? WARN_SVG : CHECK_SVG;
    $('resultIcon').className = 'result-icon' + (invalid ? ' is-invalid' : '');
    $('resultTitle').textContent = invalid ? '凭证异常' : '查询成功';

    const badge = $('resultBadge');
    badge.className = 'badge ' + ui.badge;
    badge.textContent = d.status;

    $('rName').textContent = d.name;
    $('rPhone').textContent = d.phone;
    $('rType').textContent = d.ticketType;
    $('rDate').textContent = d.entryDate;
    $('rZone').textContent = d.zone;
    $('rStatus').innerHTML = '<span class="badge ' + ui.badge + '">' + d.status + '</span>';
    $('resultTip').textContent = ui.tip;

    resultPanel.classList.remove('hidden');
  }
})();
