'use strict';

const form = document.getElementById('queryForm');
const phoneEl = document.getElementById('phone');
const codeEl = document.getElementById('code');
const btn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const alertBox = document.getElementById('alertBox');
const resultBox = document.getElementById('resultBox');

const STATUS_META = {
  unused:   { label: '未核验', cls: 'badge-unused', hint: '请在入场当日前往对应展区闸机扫码核验' },
  verified: { label: '已核验', cls: 'badge-verified', hint: '该入场码已完成入场核验' },
  disabled: { label: '已停用', cls: 'badge-disabled', hint: '该入场码已被停用，如有疑问请联系现场工作人员' }
};

const REASON_TEXT = {
  not_found: '未找到匹配的入场信息，请确认入场码输入正确',
  phone_mismatch: '手机号与入场码不匹配，请核对后重试',
  disabled: '该入场码已被停用，如有疑问请联系现场工作人员',
  bad_input: '手机号或入场码格式有误，请检查后重试',
  ok: '查询成功'
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showAlert(type, message) {
  alertBox.innerHTML = `
    <div class="alert alert-${type}">
      <svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>${esc(message)}</span>
    </div>`;
}

function renderResult(data) {
  const meta = STATUS_META[data.status] || STATUS_META.unused;
  const initial = esc(data.name.charAt(0));
  resultBox.innerHTML = `
    <div class="result card card-glow">
      <div class="result-head">
        <div class="avatar">${initial}</div>
        <div style="flex:1;min-width:0;">
          <h3>${esc(data.name)}</h3>
          <div class="sub">${esc(data.ticketType)}</div>
        </div>
        <span class="badge ${meta.cls}">${meta.label}</span>
      </div>
      <div class="result-body">
        <div class="info-grid">
          <div class="info-item">
            <div class="k">入场日期</div>
            <div class="v">${esc(data.entryDate)}</div>
          </div>
          <div class="info-item">
            <div class="k">所属展区</div>
            <div class="v">${esc(data.zone)}</div>
          </div>
        </div>
        <div class="notice-bar" style="margin-top:16px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          ${esc(meta.hint)}
        </div>
      </div>
    </div>`;
}

function setLoading(loading) {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner"></span><span>查询中…</span>'
    : '<span id="btnText">立即查询</span>';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  resultBox.innerHTML = '';

  const phone = phoneEl.value.replace(/\D/g, '').slice(0, 11);
  const code = codeEl.value.trim().toUpperCase();
  phoneEl.value = phone;

  if (!/^1[3-9]\d{9}$/.test(phone)) {
    showAlert('error', '请输入正确的 11 位手机号');
    phoneEl.focus();
    return;
  }
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) {
    showAlert('error', '请输入正确的入场码（4-32 位字母或数字）');
    codeEl.focus();
    return;
  }

  setLoading(true);
  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    const json = await res.json();
    if (json.ok) {
      renderResult(json.data);
    } else {
      showAlert('error', json.message || '查询失败，请稍后重试');
    }
  } catch (err) {
    showAlert('error', '网络异常，请稍后重试');
  } finally {
    setLoading(false);
  }
});

// 入场码自动大写
codeEl.addEventListener('input', () => {
  codeEl.value = codeEl.value.toUpperCase();
});
