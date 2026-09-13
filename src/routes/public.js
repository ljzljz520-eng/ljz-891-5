const express = require('express');
const { get, run } = require('../db');

const router = express.Router();
const isPhone = (p) => /^1\d{10}$/.test(String(p || '').trim());

// 观众查询：手机号 + 入场码 -> 姓名/票种/入场日期/展区/核验状态
router.post('/query', (req, res) => {
  const phone = String((req.body && req.body.phone) || '').trim();
  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  const log = (success, message) =>
    run('INSERT INTO query_logs (phone, code, success, message, ip) VALUES (?,?,?,?,?)',
      [phone, code, success, message, String(ip)]);

  if (!isPhone(phone) || !code) {
    log(0, '输入格式不正确');
    return res.status(400).json({ error: '请输入正确的 11 位手机号和入场码' });
  }

  const t = get('SELECT * FROM tickets WHERE phone = ? AND code = ?', [phone, code]);
  if (!t) {
    log(0, '票码不存在或信息不匹配');
    return res.status(404).json({ error: '未查询到入场信息，请核对手机号与入场码后重试' });
  }

  log(1, '查询成功');
  res.json({
    name: t.name,
    ticket_type: t.ticket_type,
    entry_date: t.entry_date,
    zone: t.zone,
    status: t.status, // valid 未核验 / used 已核验 / revoked 已作废
  });
});

module.exports = router;
