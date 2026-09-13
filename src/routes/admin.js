const express = require('express');
const { all, get, run } = require('../db');
const { verifyPassword, hashPassword, createSession, destroySession, requireAdmin } = require('../auth');

const router = express.Router();

const isPhone = (p) => /^1\d{10}$/.test(String(p || '').trim());
const isCode = (c) => /^[A-Za-z0-9-]{4,32}$/.test(String(c || '').trim());
const normCode = (c) => String(c || '').trim().toUpperCase();
const STATUSES = ['valid', 'used', 'revoked'];

function validateTicket(body) {
  const t = {
    name: String(body.name || '').trim(),
    phone: String(body.phone || '').trim(),
    code: normCode(body.code),
    ticket_type: String(body.ticket_type || '').trim(),
    entry_date: String(body.entry_date || '').trim(),
    zone: String(body.zone || '').trim(),
  };
  if (!t.name) return { error: '姓名不能为空' };
  if (!isPhone(t.phone)) return { error: '手机号格式不正确（需 11 位数字）' };
  if (!isCode(t.code)) return { error: '入场码需为 4-32 位字母/数字/短横线' };
  if (!t.ticket_type) return { error: '票种不能为空' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.entry_date)) return { error: '入场日期格式应为 YYYY-MM-DD' };
  if (!t.zone) return { error: '所属展区不能为空' };
  return { ticket: t };
}

/* ---------- 登录 / 登出 ---------- */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = get('SELECT * FROM admins WHERE username = ?', [String(username || '').trim()]);
  if (!admin || !verifyPassword(password, admin.salt, admin.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = createSession(admin.username);
  res.json({ token, username: admin.username });
});

router.post('/logout', requireAdmin, (req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
});

/* ---------- 数据概览 ---------- */
router.get('/stats', requireAdmin, (req, res) => {
  const t = get(`SELECT COUNT(*) total,
    SUM(CASE WHEN status='valid' THEN 1 ELSE 0 END) valid,
    SUM(CASE WHEN status='used' THEN 1 ELSE 0 END) used,
    SUM(CASE WHEN status='revoked' THEN 1 ELSE 0 END) revoked FROM tickets`);
  const q = get(`SELECT COUNT(*) today_queries,
    SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) today_success
    FROM query_logs WHERE date(created_at)=date('now','localtime')`);
  res.json({
    total: t.total || 0, valid: t.valid || 0, used: t.used || 0, revoked: t.revoked || 0,
    today_queries: q.today_queries || 0, today_success: q.today_success || 0,
  });
});

/* ---------- 票码管理 ---------- */
router.get('/tickets', requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 10));
  const kw = String(req.query.keyword || '').trim();
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';

  const conds = [], params = [];
  if (kw) {
    conds.push('(name LIKE ? OR phone LIKE ? OR code LIKE ?)');
    const like = `%${kw}%`;
    params.push(like, like, like);
  }
  if (status) { conds.push('status = ?'); params.push(status); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const total = get(`SELECT COUNT(*) c FROM tickets ${where}`, params).c;
  const rows = all(`SELECT * FROM tickets ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size]);
  res.json({ rows, total, page, size });
});

router.post('/tickets', requireAdmin, (req, res) => {
  const { ticket, error } = validateTicket(req.body || {});
  if (error) return res.status(400).json({ error });
  const dup = get('SELECT id FROM tickets WHERE code = ? AND phone = ?', [ticket.code, ticket.phone]);
  if (dup) return res.status(409).json({ error: `入场码 ${ticket.code} 与该手机号的组合已存在` });
  run(`INSERT INTO tickets (code, phone, name, ticket_type, entry_date, zone, created_by)
       VALUES (?,?,?,?,?,?,?)`,
    [ticket.code, ticket.phone, ticket.name, ticket.ticket_type, ticket.entry_date, ticket.zone, req.admin]);
  res.json({ ok: true });
});

// 批量导入：{ rows: [{name, phone, code, ticket_type, entry_date, zone}, ...] }
router.post('/tickets/batch', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: '没有可导入的数据' });
  if (rows.length > 2000) return res.status(400).json({ error: '单次最多导入 2000 条' });

  let inserted = 0;
  const failed = [];
  rows.forEach((row, i) => {
    const line = i + 1;
    const { ticket, error } = validateTicket(row || {});
    if (error) return failed.push({ line, reason: error });
    const dup = get('SELECT id FROM tickets WHERE code = ? AND phone = ?', [ticket.code, ticket.phone]);
    if (dup) return failed.push({ line, reason: `入场码 ${ticket.code} 已存在（重复）` });
    run(`INSERT INTO tickets (code, phone, name, ticket_type, entry_date, zone, created_by)
         VALUES (?,?,?,?,?,?,?)`,
      [ticket.code, ticket.phone, ticket.name, ticket.ticket_type, ticket.entry_date, ticket.zone, req.admin]);
    inserted++;
  });
  res.json({ inserted, failed });
});

router.patch('/tickets/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: '无效的核验状态' });
  const t = get('SELECT id FROM tickets WHERE id = ?', [id]);
  if (!t) return res.status(404).json({ error: '票码不存在' });
  run('UPDATE tickets SET status = ? WHERE id = ?', [status, id]);
  res.json({ ok: true });
});

router.delete('/tickets/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const t = get('SELECT id FROM tickets WHERE id = ?', [id]);
  if (!t) return res.status(404).json({ error: '票码不存在' });
  run('DELETE FROM tickets WHERE id = ?', [id]);
  res.json({ ok: true });
});

/* ---------- 查询记录 ---------- */
router.get('/logs', requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 15));
  const total = get('SELECT COUNT(*) c FROM query_logs').c;
  const rows = all('SELECT * FROM query_logs ORDER BY id DESC LIMIT ? OFFSET ?',
    [size, (page - 1) * size]);
  res.json({ rows, total, page, size });
});

/* ---------- 多管理员 ---------- */
router.get('/admins', requireAdmin, (req, res) => {
  res.json({ rows: all('SELECT id, username, created_at FROM admins ORDER BY id') });
});

router.post('/admins', requireAdmin, (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 3-20 位字母/数字/下划线' });
  }
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (get('SELECT id FROM admins WHERE username = ?', [username])) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const { salt, hash } = hashPassword(password);
  run('INSERT INTO admins (username, password_hash, salt) VALUES (?,?,?)', [username, hash, salt]);
  res.json({ ok: true });
});

router.delete('/admins/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const target = get('SELECT * FROM admins WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: '管理员不存在' });
  if (target.username === req.admin) return res.status(400).json({ error: '不能删除当前登录的账号' });
  if (get('SELECT COUNT(*) c FROM admins').c <= 1) return res.status(400).json({ error: '至少保留一个管理员' });
  run('DELETE FROM admins WHERE id = ?', [id]);
  res.json({ ok: true });
});

// 修改自己的密码
router.post('/password', requireAdmin, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const admin = get('SELECT * FROM admins WHERE username = ?', [req.admin]);
  if (!verifyPassword(old_password, admin.salt, admin.password_hash)) {
    return res.status(400).json({ error: '原密码错误' });
  }
  if (String(new_password || '').length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  const { salt, hash } = hashPassword(new_password);
  run('UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?', [hash, salt, admin.id]);
  res.json({ ok: true });
});

module.exports = router;
