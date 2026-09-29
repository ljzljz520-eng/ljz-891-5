'use strict';
const crypto = require('crypto');

/* ---------- 密码哈希（scrypt） ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const derived = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === derived.length &&
      crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

/* ---------- 签名 Cookie 会话令牌 ---------- */
function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${sig}`;
}
function verifyToken(token, secret) {
  if (!token || token.indexOf('.') === -1) return null;
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}
function randomCode(len = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/* ---------- HTTP 辅助 ---------- */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON 格式错误'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* ---------- 简单内存限流 ---------- */
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.reset > windowMs) hits.delete(k);
  }, windowMs).unref();
  return function check(key) {
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now - rec.reset > windowMs) {
      rec = { count: 0, reset: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;
    return { allowed: rec.count <= max, remaining: Math.max(0, max - rec.count), reset: rec.reset };
  };
}

/* ---------- 字段校验与格式化 ---------- */
function isMobile(v) {
  return /^1[3-9]\d{9}$/.test(String(v || '').trim());
}
function normalizeCode(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}
function isValidDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}
function pad(n) { return String(n).padStart(2, '0'); }
function nowText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function todayText() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function maskPhone(p) {
  const s = String(p || '');
  return s.length === 11 ? `${s.slice(0, 3)}****${s.slice(7)}` : s;
}
function maskName(name) {
  const s = String(name || '');
  if (s.length <= 1) return s ? s + '*' : '';
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = {
  hashPassword, verifyPassword,
  signToken, verifyToken,
  randomCode, newId,
  sendJson, readBody, rateLimiter,
  isMobile, normalizeCode, isValidDate,
  nowText, todayText, maskPhone, maskName, escapeHtml
};
