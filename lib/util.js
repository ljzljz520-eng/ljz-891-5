'use strict';

const PHONE_RE = /^1[3-9]\d{9}$/;
const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normPhone(p) {
  return String(p || '').replace(/[\s-]/g, '');
}
function normCode(c) {
  return String(c || '').trim().toUpperCase();
}
function isValidPhone(p) { return PHONE_RE.test(p); }
function isValidCode(c) { return CODE_RE.test(c); }
function isValidDate(d) {
  if (!DATE_RE.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === d;
}

/** 内存限流：key 维度窗口计数 */
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function take(key) {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now - e.start >= windowMs) {
      e = { start: now, count: 0 };
      hits.set(key, e);
    }
    e.count++;
    // 周期性清理
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    }
    return { ok: e.count <= max, remain: Math.max(0, max - e.count), retryAfter: windowMs - (now - e.start) };
  };
}

/** 简单脱敏 */
function maskPhone(p) {
  return p && p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : p;
}

/** 注入安全的 JSON 响应 */
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

module.exports = {
  normPhone, normCode, isValidPhone, isValidCode, isValidDate,
  rateLimiter, maskPhone, sendJSON
};
