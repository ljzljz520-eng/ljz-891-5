const STATUS_MAP = {
  valid: { text: '未核验 · 有效', cls: 'valid' },
  used: { text: '已核验', cls: 'used' },
  revoked: { text: '已作废', cls: 'revoked' },
};

const form = document.getElementById('queryForm');
const btn = document.getElementById('queryBtn');
const errBox = document.getElementById('errorMsg');
const result = document.getElementById('result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = document.getElementById('phone').value.trim();
  const code = document.getElementById('code').value.trim();

  errBox.textContent = '';
  result.classList.remove('show');

  if (!/^1\d{10}$/.test(phone)) { errBox.textContent = '请输入正确的 11 位手机号'; return; }
  if (!code) { errBox.textContent = '请输入入场码'; return; }

  btn.disabled = true;
  btn.textContent = '查询中…';
  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    const data = await res.json();
    if (!res.ok) { errBox.textContent = data.error || '查询失败，请稍后重试'; return; }

    document.getElementById('rName').textContent = data.name;
    document.getElementById('rType').textContent = data.ticket_type;
    document.getElementById('rDate').textContent = data.entry_date;
    document.getElementById('rZone').textContent = data.zone;
    const st = STATUS_MAP[data.status] || { text: data.status, cls: 'valid' };
    const badge = document.getElementById('rStatus');
    badge.textContent = st.text;
    badge.className = 'badge ' + st.cls;
    result.classList.add('show');
  } catch (err) {
    errBox.textContent = '网络异常，请稍后重试';
  } finally {
    btn.disabled = false;
    btn.textContent = '立即查询';
  }
});
