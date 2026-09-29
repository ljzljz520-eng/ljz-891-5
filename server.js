'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { Store } = require('./lib/store');
const { parseTicketCsv, ticketsToCsv, TEMPLATE_CSV } = require('./lib/csv');
const {
  verifyPassword, signToken, verifyToken,
  sendJson, readBody, rateLimiter,
  isMobile, normalizeCode, nowText, maskPhone, maskName
} = require('./lib/util');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 小时
const SECRET = process.env.SESSION_SECRET || 'expo-entry-query-secret-2026';

const store = new Store(DATA_DIR);
store.load();

/* ---------- 限流 ---------- */
const queryLimit = rateLimiter({ windowMs: 60 * 1000, max: 30 });
const loginLimit = rateLimiter({ windowMs: 60 * 1000, max: 10 });

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------- 会话 ---------- */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentAdmin(req) {
  const token = parseCookies(req).sid;
  const payload = verifyToken(token, SECRET);
  if (!payload) return null;
  if (!payload.iat || Date.now() - payload.iat > SESSION_TTL) return null;
  return store.findAdminById(payload.sub) || null;
}
function setSessionCookie(res, admin) {
  const token = signToken({ sub: admin.id, iat: Date.now() }, SECRET);
  res.setHeader('Set-Cookie',
    `sid=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? String(xff).split(',')[0].trim() : '') ||
    req.socket.remoteAddress || 'unknown';
}

/* ---------- 请求处理 ---------- */
async function handleApi(req, res, url) {
  const route = url.pathname;
  const method = req.method;
  const ip = clientIp(req);

  /* ===== 观众查询 ===== */
  if (route === '/api/query' && method === 'POST') {
    const limit = queryLimit(ip);
    if (!limit.allowed) return sendJson(res, 429, { ok: false, message: '查询过于频繁，请稍后再试' });
    const body = await readBody(req, 64 * 1024);
    const phone = String(body.phone || '').trim();
    const code = normalizeCode(body.code);
    if (!isMobile(phone)) {
      store.addLog({ phone, code, ok: false, reason: '手机号格式不正确', ip, ua: req.headers['user-agent'] || '' });
      return sendJson(res, 400, { ok: false, message: '请输入正确的 11 位手机号' });
    }
    if (!code || code.length < 4) {
      store.addLog({ phone, code, ok: false, reason: '入场码格式不正确', ip, ua: req.headers['user-agent'] || '' });
      return sendJson(res, 400, { ok: false, message: '请输入有效的入场码' });
    }
    const ticket = store.findTicketByCode(code);
    if (!ticket || ticket.phone !== phone) {
      store.addLog({ phone, code, ok: false, reason: '未找到匹配记录（手机号与入场码不匹配）', ip, ua: req.headers['user-agent'] || '' });
      return sendJson(res, 404, { ok: false, message: '未查询到匹配的入场信息，请核对手机号与入场码' });
    }
    store.addLog({
      phone, code, ok: true, ticketId: ticket.id, name: ticket.name,
      ip, ua: req.headers['user-agent'] || ''
    });
    return sendJson(res, 200, {
      ok: true,
      data: {
        name: ticket.name,
        ticketType: ticket.ticketType,
        entryDate: ticket.entryDate,
        zone: ticket.zone,
        status: ticket.status,
        phone: maskPhone(ticket.phone)
      }
    });
  }

  /* ===== 登录 / 登出 / 当前用户 ===== */
  if (route === '/api/auth/login' && method === 'POST') {
    const limit = loginLimit(ip);
    if (!limit.allowed) return sendJson(res, 429, { ok: false, message: '登录尝试过于频繁，请稍后再试' });
    const body = await readBody(req, 64 * 1024);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const admin = store.findAdminByUsername(username);
    if (!admin || !verifyPassword(password, admin.password)) {
      return sendJson(res, 401, { ok: false, message: '账号或密码错误' });
    }
    setSessionCookie(res, admin);
    return sendJson(res, 200, { ok: true, data: { username: admin.username, displayName: admin.displayName, role: admin.role } });
  }
  if (route === '/api/auth/logout' && method === 'POST') {
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }
  if (route === '/api/auth/me' && method === 'GET') {
    const admin = currentAdmin(req);
    if (!admin) return sendJson(res, 401, { ok: false, message: '未登录' });
    return sendJson(res, 200, { ok: true, data: { username: admin.username, displayName: admin.displayName, role: admin.role } });
  }

  /* ===== 以下接口需要登录 ===== */
  const admin = currentAdmin(req);
  if (!admin) return sendJson(res, 401, { ok: false, message: '未登录或会话已过期' });
  const requireSuper = (r) => {
    if (admin.role !== 'super') {
      sendJson(r, 403, { ok: false, message: '仅超级管理员可执行此操作' });
      return false;
    }
    return true;
  };

  /* ----- 概览统计 ----- */
  if (route === '/api/stats' && method === 'GET') {
    return sendJson(res, 200, { ok: true, data: store.stats() });
  }

  /* ----- 票码：列表 / 新增 / 导入 / 模板 / 导出 ----- */
  if (route === '/api/tickets' && method === 'GET') {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
    return sendJson(res, 200, {
      ok: true,
      data: store.listTickets({
        keyword: url.searchParams.get('keyword') || '',
        status: url.searchParams.get('status') || '',
        page, pageSize
      })
    });
  }
  if (route === '/api/tickets' && method === 'POST') {
    const body = await readBody(req, 256 * 1024);
    const result = store.addTicket(body, admin.username);
    if (result.error) return sendJson(res, 400, { ok: false, message: result.error });
    return sendJson(res, 201, { ok: true, data: result.ticket });
  }
  if (route === '/api/tickets/import' && method === 'POST') {
    const body = await readBody(req, 8 * 1024 * 1024);
    let records = [];
    if (Array.isArray(body.records)) {
      records = body.records;
    } else if (typeof body.csv === 'string' && body.csv.trim()) {
      const parsed = parseTicketCsv(body.csv);
      if (parsed.error) return sendJson(res, 400, { ok: false, message: parsed.error });
      records = parsed.records;
    } else {
      return sendJson(res, 400, { ok: false, message: '缺少导入数据（csv 文本或 records 数组）' });
    }
    if (!records.length) return sendJson(res, 400, { ok: false, message: '没有可导入的数据行' });
    let success = 0;
    const failures = [];
    const seen = new Set();
    for (const rec of records) {
      const r = store.addTicket(rec, admin.username);
      const code = normalizeCode(rec.code);
      if (r.error) {
        failures.push({ line: rec._line || '-', code: code || '(空)', message: r.error });
      } else {
        success += 1;
        seen.add(code);
      }
    }
    return sendJson(res, 200, {
      ok: true,
      data: { total: records.length, success, skipped: failures.length, failures: failures.slice(0, 200) }
    });
  }
  if (route === '/api/tickets/template' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ticket-import-template.csv"'
    });
    return res.end(TEMPLATE_CSV);
  }
  if (route === '/api/tickets/export' && method === 'GET') {
    const { items } = store.listTickets({
      keyword: url.searchParams.get('keyword') || '',
      status: url.searchParams.get('status') || '',
      page: 1, pageSize: 100000
    });
    const csv = ticketsToCsv(items);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tickets-${nowText().replace(/[: ]/g, '-')}.csv"`
    });
    return res.end(csv);
  }

  /* ----- 单条票码：编辑 / 删除 ----- */
  const ticketMatch = route.match(/^\/api\/tickets\/([^/]+)$/);
  if (ticketMatch) {
    const id = ticketMatch[1];
    if (method === 'PUT') {
      const body = await readBody(req, 256 * 1024);
      const result = store.updateTicket(id, body);
      if (result.error) return sendJson(res, 400, { ok: false, message: result.error });
      return sendJson(res, 200, { ok: true, data: result.ticket });
    }
    if (method === 'DELETE') {
      if (!store.deleteTicket(id)) return sendJson(res, 404, { ok: false, message: '票码不存在' });
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ----- 查询记录 ----- */
  if (route === '/api/logs' && method === 'GET') {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
    return sendJson(res, 200, {
      ok: true,
      data: store.listLogs({
        keyword: url.searchParams.get('keyword') || '',
        result: url.searchParams.get('result') || '',
        page, pageSize
      })
    });
  }

  /* ----- 管理员管理（仅超管） ----- */
  if (route === '/api/admins' && method === 'GET') {
    if (!requireSuper(res)) return;
    return sendJson(res, 200, { ok: true, data: store.listAdmins() });
  }
  if (route === '/api/admins' && method === 'POST') {
    if (!requireSuper(res)) return;
    const body = await readBody(req, 64 * 1024);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return sendJson(res, 400, { ok: false, message: '账号需为 3-20 位小写字母、数字或下划线' });
    }
    if (password.length < 6 || password.length > 64) {
      return sendJson(res, 400, { ok: false, message: '密码长度需为 6-64 位' });
    }
    if (store.findAdminByUsername(username)) {
      return sendJson(res, 400, { ok: false, message: '账号已存在' });
    }
    const created = store.addAdmin({
      username, password,
      displayName: String(body.displayName || username).trim(),
      role: body.role === 'super' ? 'super' : 'admin'
    });
    return sendJson(res, 201, { ok: true, data: created });
  }
  const adminMatch = route.match(/^\/api\/admins\/([^/]+)$/);
  if (adminMatch) {
    if (!requireSuper(res)) return;
    const id = adminMatch[1];
    if (method === 'PUT') {
      const target = store.findAdminById(id);
      if (!target) return sendJson(res, 404, { ok: false, message: '管理员不存在' });
      const body = await readBody(req, 64 * 1024);
      const patch = {};
      if (body.password) {
        if (String(body.password).length < 6) {
          return sendJson(res, 400, { ok: false, message: '密码长度至少 6 位' });
        }
        patch.password = String(body.password);
      }
      if (body.displayName !== undefined) patch.displayName = String(body.displayName);
      if (body.role) {
        if (body.role !== 'super' && target.role === 'super' && store.superAdminCount() <= 1) {
          return sendJson(res, 400, { ok: false, message: '至少保留一个超级管理员' });
        }
        patch.role = body.role;
      }
      const updated = store.updateAdmin(id, patch);
      return sendJson(res, 200, { ok: true, data: updated });
    }
    if (method === 'DELETE') {
      const target = store.findAdminById(id);
      if (!target) return sendJson(res, 404, { ok: false, message: '管理员不存在' });
      if (target.id === admin.id) return sendJson(res, 400, { ok: false, message: '不能删除当前登录账号' });
      if (target.role === 'super' && store.superAdminCount() <= 1) {
        return sendJson(res, 400, { ok: false, message: '至少保留一个超级管理员' });
      }
      store.deleteAdmin(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { ok: false, message: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (e) {
      const status = e.statusCode || 500;
      if (status >= 500) console.error(`[${nowText()}]`, e);
      if (!res.headersSent) sendJson(res, status, { ok: false, message: e.message || '服务器错误' });
    }
    return;
  }
  // 页面路由别名
  if (url.pathname === '/admin') {
    req.url = '/admin.html';
    return serveStatic(req, res, '/admin.html');
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`\n  展会入场码查询系统已启动`);
  console.log(`  观众查询:  http://localhost:${PORT}/`);
  console.log(`  管理后台:  http://localhost:${PORT}/admin`);
  console.log(`  默认账号:  admin / admin123 （超级管理员）\n`);
});

module.exports = server;
