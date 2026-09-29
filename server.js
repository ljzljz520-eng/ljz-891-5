'use strict';
/**
 * 展会入场码查询系统 - HTTP 服务
 * 零第三方依赖：原生 http + JSON 文件存储
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./lib/store');
const { hashPassword, verifyPassword } = require('./lib/auth');
const { parseTickets, toCSV } = require('./lib/csv');
const {
  normPhone, normCode, isValidPhone, isValidCode, isValidDate,
  rateLimiter, sendJSON
} = require('./lib/util');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'sid';
const SESSION_TTL_SEC = 7 * 24 * 3600;

store.init();
seedIfEmpty();

/* ---------------- 限流 ---------------- */
const queryLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 15 });
const loginLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 8 });

/* ---------------- 工具 ---------------- */

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? String(xff).split(',')[0].trim() : '') ||
    req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getAuthedAdmin(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = store.getSession(token);
  if (!session) return null;
  const admin = store.getAdmin(session.adminId);
  if (!admin || !admin.active) return null;
  return admin;
}

function validateTicketFields(b) {
  const errors = [];
  const f = {
    code: normCode(b.code),
    name: String(b.name || '').trim(),
    phone: normPhone(b.phone),
    ticketType: String(b.ticketType || '').trim(),
    zone: String(b.zone || '').trim(),
    entryDate: String(b.entryDate || '').trim(),
    status: b.status || 'unused',
    note: String(b.note || '').trim()
  };
  if (!isValidCode(f.code)) errors.push('入场码需为 4-32 位字母、数字、下划线或连字符');
  if (!f.name) errors.push('姓名不能为空');
  if (f.name.length > 50) errors.push('姓名最长 50 字');
  if (!isValidPhone(f.phone)) errors.push('手机号格式不正确（需为 11 位大陆手机号）');
  if (!f.ticketType) errors.push('票种不能为空');
  if (f.ticketType.length > 30) errors.push('票种最长 30 字');
  if (!f.zone) errors.push('所属展区不能为空');
  if (f.zone.length > 50) errors.push('展区最长 50 字');
  if (!isValidDate(f.entryDate)) errors.push('入场日期格式应为 YYYY-MM-DD');
  if (!['unused', 'verified', 'disabled'].includes(f.status)) errors.push('核验状态不合法');
  if (f.note.length > 200) errors.push('备注最长 200 字');
  return { f, errors };
}

function ticketPublic(t) {
  return {
    id: t.id, code: t.code, name: t.name, phone: t.phone,
    ticketType: t.ticketType, zone: t.zone, entryDate: t.entryDate,
    status: t.status, note: t.note,
    verifiedAt: t.verifiedAt, verifiedBy: t.verifiedBy,
    createdBy: t.createdBy, batchId: t.batchId, createdAt: t.createdAt
  };
}

/* ---------------- 业务处理 ---------------- */

async function handlePublicQuery(req, res) {
  const ip = clientIp(req);
  const limit = queryLimiter(ip);
  if (!limit.ok) {
    return sendJSON(res, 429, { ok: false, message: '查询过于频繁，请稍后再试' });
  }
  const body = await readBody(req);
  const phone = normPhone(body.phone);
  const code = normCode(body.code);
  if (!isValidPhone(phone) || !isValidCode(code)) {
    store.addLog({ ip, phone, code, success: false, reason: 'bad_input' });
    return sendJSON(res, 400, { ok: false, message: '请输入正确的手机号和入场码' });
  }
  const t = store.getTicketByCode(code);
  // 无论“码不存在”还是“手机号不匹配”，对外统一提示，避免枚举
  if (!t || t.phone !== phone) {
    store.addLog({
      ip, phone, code, success: false,
      reason: !t ? 'not_found' : 'phone_mismatch'
    });
    return sendJSON(res, 404, { ok: false, message: '未查询到入场信息，请核对手机号与入场码' });
  }
  store.addLog({
    ip, phone, code, success: t.status !== 'disabled',
    reason: t.status === 'disabled' ? 'disabled' : 'ok',
    ticketId: t.id,
    snapshot: {
      name: t.name, ticketType: t.ticketType, entryDate: t.entryDate,
      zone: t.zone, status: t.status
    }
  });
  return sendJSON(res, 200, {
    ok: true,
    disabled: t.status === 'disabled',
    data: {
      name: t.name,
      ticketType: t.ticketType,
      entryDate: t.entryDate,
      zone: t.zone,
      status: t.status
    }
  });
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  const limit = loginLimiter(ip);
  if (!limit.ok) {
    return sendJSON(res, 429, { ok: false, message: '登录尝试过于频繁，请 5 分钟后再试' });
  }
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) {
    return sendJSON(res, 400, { ok: false, message: '请输入账号和密码' });
  }
  const admin = store.findAdminByUsername(username);
  // 统一错误文案，防止账号枚举
  if (!admin || !admin.active || !verifyPassword(password, admin.passwordHash)) {
    return sendJSON(res, 401, { ok: false, message: '账号或密码错误，或账号已被停用' });
  }
  const session = store.createSession(admin.id);
  store.touchAdminLogin(admin.id);
  setSessionCookie(res, session.token);
  return sendJSON(res, 200, { ok: true, data: store.publicAdmin(admin) });
}

async function handleTicketCreate(req, res, admin) {
  const body = await readBody(req);
  const { f, errors } = validateTicketFields(body);
  if (errors.length) return sendJSON(res, 400, { ok: false, message: errors[0], errors });
  if (store.getTicketByCode(f.code)) {
    return sendJSON(res, 409, { ok: false, message: '入场码已存在，请勿重复添加' });
  }
  const t = store.addTicket(f, admin.username);
  store.save();
  return sendJSON(res, 201, { ok: true, data: ticketPublic(t) });
}

async function handleTicketUpdate(req, res, id) {
  const body = await readBody(req);
  const t = store.getTicket(id);
  if (!t) return sendJSON(res, 404, { ok: false, message: '票码不存在' });
  const { f, errors } = validateTicketFields({ ...body, code: t.code });
  if (errors.length) return sendJSON(res, 400, { ok: false, message: errors[0], errors });
  const updated = store.updateTicket(id, {
    name: f.name, phone: f.phone, ticketType: f.ticketType,
    zone: f.zone, entryDate: f.entryDate, status: f.status, note: f.note
  });
  // 手动设置状态时维护核验痕迹
  if (updated.status === 'verified' && !updated.verifiedAt) {
    updated.verifiedAt = new Date().toISOString();
    updated.verifiedBy = '手动设置';
  } else if (updated.status !== 'verified') {
    updated.verifiedAt = null;
    updated.verifiedBy = null;
  }
  return sendJSON(res, 200, { ok: true, data: ticketPublic(updated) });
}

async function handleImport(req, res, admin) {
  const body = await readBody(req, 5 * 1024 * 1024);
  const text = String(body.text || '');
  if (!text.trim()) return sendJSON(res, 400, { ok: false, message: '导入内容为空' });
  const { records, errors: parseErrors } = parseTickets(text);
  if (parseErrors.length) return sendJSON(res, 400, { ok: false, message: parseErrors[0] });

  const valid = [];
  const invalid = [];
  for (const rec of records) {
    const { f, errors } = validateTicketFields(rec);
    if (errors.length) {
      if (invalid.length < 100) invalid.push({ row: rec.__row, code: rec.code || '', reason: errors[0] });
    } else {
      f.__row = rec.__row;
      valid.push(f);
    }
  }
  const result = store.bulkAddTickets(valid, admin.username);
  // 合并字段校验失败与重复跳过
  const skipped = [
    ...invalid.map(x => ({ row: x.row, code: x.code, reason: x.reason })),
    ...result.skipped.map(x => ({ row: x.row, code: x.code, reason: x.reason }))
  ];
  return sendJSON(res, 200, {
    ok: true,
    data: {
      total: records.length,
      imported: result.createdCount,
      failed: records.length - result.createdCount,
      skipped: skipped.slice(0, 100)
    }
  });
}

function handleExport(req, res) {
  const url = new URL(req.url, 'http://x');
  const result = store.queryTickets({
    q: url.searchParams.get('q') || '',
    status: url.searchParams.get('status') || '',
    zone: url.searchParams.get('zone') || '',
    date: url.searchParams.get('date') || '',
    page: 1, pageSize: 100000
  });
  const csv = toCSV([
    { key: 'code', label: '入场码' },
    { key: 'name', label: '姓名' },
    { key: 'phone', label: '手机号' },
    { key: 'ticketType', label: '票种' },
    { key: 'zone', label: '所属展区' },
    { key: 'entryDate', label: '入场日期' },
    { key: 'statusLabel', label: '核验状态' },
    { key: 'note', label: '备注' }
  ], result.items.map(t => ({
    ...t,
    statusLabel: { unused: '未核验', verified: '已核验', disabled: '已停用' }[t.status] || t.status
  })));
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="tickets_${new Date().toISOString().slice(0, 10)}.csv"`
  });
  res.end(csv);
}

function handleTemplate(res) {
  const csv = toCSV(
    [
      { key: 'code', label: '入场码' }, { key: 'name', label: '姓名' },
      { key: 'phone', label: '手机号' }, { key: 'ticketType', label: '票种' },
      { key: 'zone', label: '所属展区' }, { key: 'entryDate', label: '入场日期' }
    ],
    [
      { code: 'EXPO2026A0001', name: '张三', phone: '13800138000', ticketType: '专业观众票', zone: '主展区A馆', entryDate: '2026-10-15' },
      { code: 'EXPO2026B0002', name: '李四', phone: '13900139000', ticketType: 'VIP通票', zone: '展区B馆', entryDate: '2026-10-15' }
    ]
  );
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
  res.end(csv);
}

/* ---------------- 管理员管理（仅超管） ---------------- */

async function handleAdminCreate(req, res) {
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const displayName = String(body.displayName || '').trim();
  const role = body.role === 'super' ? 'super' : 'admin';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return sendJSON(res, 400, { ok: false, message: '账号需为 3-20 位字母、数字或下划线' });
  }
  if (password.length < 6 || password.length > 64) {
    return sendJSON(res, 400, { ok: false, message: '密码长度需为 6-64 位' });
  }
  if (store.findAdminByUsername(username)) {
    return sendJSON(res, 409, { ok: false, message: '账号已存在' });
  }
  const { salt, passwordHash } = hashPassword(password);
  const a = store.addAdmin({ username, passwordHash, salt, role, displayName });
  return sendJSON(res, 201, { ok: true, data: store.publicAdmin(a) });
}

async function handleAdminUpdate(req, res, id, actor) {
  const body = await readBody(req);
  const target = store.getAdmin(id);
  if (!target) return sendJSON(res, 404, { ok: false, message: '管理员不存在' });
  const patch = {};
  if (body.displayName !== undefined) {
    patch.displayName = String(body.displayName).trim() || target.username;
  }
  if (body.active !== undefined) patch.active = !!body.active;
  if (body.role !== undefined) patch.role = body.role === 'super' ? 'super' : 'admin';
  if (body.password) {
    if (String(body.password).length < 6) {
      return sendJSON(res, 400, { ok: false, message: '密码长度至少 6 位' });
    }
    const { salt, passwordHash } = hashPassword(String(body.password));
    patch.salt = salt; patch.passwordHash = passwordHash;
  }
  // 防止超管停用/降级自己导致锁死
  if (target.id === actor.id) {
    if ('active' in patch && !patch.active) {
      return sendJSON(res, 400, { ok: false, message: '不能停用当前登录的自己' });
    }
    if ('role' in patch && patch.role !== 'super') {
      return sendJSON(res, 400, { ok: false, message: '不能降低当前登录账号的角色' });
    }
  }
  const updated = store.updateAdmin(id, patch);
  return sendJSON(res, 200, { ok: true, data: store.publicAdmin(updated) });
}

function handleAdminDelete(res, id, actor) {
  if (id === actor.id) {
    return sendJSON(res, 400, { ok: false, message: '不能删除当前登录的自己' });
  }
  const target = store.getAdmin(id);
  if (!target) return sendJSON(res, 404, { ok: false, message: '管理员不存在' });
  store.deleteAdmin(id);
  return sendJSON(res, 200, { ok: true });
}

/* ---------------- 路由 ---------------- */

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
  let rel = urlPath;
  if (urlPath === '/') rel = '/index.html';
  if (urlPath === '/admin' || urlPath === '/admin/') rel = '/admin.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    /* ---- 访客公开接口 ---- */
    if (p === '/api/query' && req.method === 'POST') return await handlePublicQuery(req, res);

    /* ---- 登录/登出 ---- */
    if (p === '/api/admin/login' && req.method === 'POST') return await handleLogin(req, res);

    if (p === '/api/admin/template.csv' && req.method === 'GET') return handleTemplate(res);

    /* ---- 以下全部需要登录 ---- */
    const admin = getAuthedAdmin(req);
    if (p.startsWith('/api/admin')) {
      if (!admin) return sendJSON(res, 401, { ok: false, message: '未登录或会话已过期' });
    }

    if (p === '/api/admin/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) store.deleteSession(token);
      clearSessionCookie(res);
      return sendJSON(res, 200, { ok: true });
    }

    if (p === '/api/admin/me' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, data: store.publicAdmin(admin) });
    }

    if (p === '/api/admin/stats' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, data: store.stats() });
    }

    if (p === '/api/admin/zones' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, data: store.listZones() });
    }

    /* ---- 票码 ---- */
    if (p === '/api/admin/tickets' && req.method === 'GET') {
      const page = Math.min(500, Math.max(1, parseInt(url.searchParams.get('page') || '1', 10)));
      const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10)));
      const result = store.queryTickets({
        q: url.searchParams.get('q') || '',
        status: url.searchParams.get('status') || '',
        zone: url.searchParams.get('zone') || '',
        date: url.searchParams.get('date') || '',
        page, pageSize
      });
      return sendJSON(res, 200, { ok: true, data: { ...result, items: result.items.map(ticketPublic) } });
    }
    if (p === '/api/admin/tickets' && req.method === 'POST') {
      return await handleTicketCreate(req, res, admin);
    }
    if (p === '/api/admin/import' && req.method === 'POST') {
      return await handleImport(req, res, admin);
    }
    if (p === '/api/admin/export' && req.method === 'GET') {
      return handleExport(req, res);
    }

    const ticketMatch = p.match(/^\/api\/admin\/tickets\/([A-Za-z0-9]+)$/);
    if (ticketMatch) {
      if (req.method === 'PUT') return await handleTicketUpdate(req, res, ticketMatch[1]);
      if (req.method === 'DELETE') {
        const t = store.getTicket(ticketMatch[1]);
        if (!t) return sendJSON(res, 404, { ok: false, message: '票码不存在' });
        store.deleteTicket(ticketMatch[1]);
        return sendJSON(res, 200, { ok: true });
      }
    }
    const verifyMatch = p.match(/^\/api\/admin\/tickets\/([A-Za-z0-9]+)\/verify$/);
    if (verifyMatch && req.method === 'POST') {
      const result = store.verifyTicket(verifyMatch[1], admin.username);
      if (!result) return sendJSON(res, 404, { ok: false, message: '票码不存在' });
      if (!result.ok) return sendJSON(res, 400, { ok: false, message: result.reason });
      return sendJSON(res, 200, { ok: true, data: ticketPublic(result.ticket) });
    }

    /* ---- 查询记录 ---- */
    if (p === '/api/admin/logs' && req.method === 'GET') {
      const page = Math.min(500, Math.max(1, parseInt(url.searchParams.get('page') || '1', 10)));
      const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10)));
      const result = store.queryLogs({
        success: url.searchParams.get('success') || '', page, pageSize
      });
      return sendJSON(res, 200, { ok: true, data: result });
    }

    /* ---- 管理员管理（仅超管） ---- */
    if (p === '/api/admin/admins' && req.method === 'GET') {
      if (admin.role !== 'super') return sendJSON(res, 403, { ok: false, message: '需要超级管理员权限' });
      return sendJSON(res, 200, { ok: true, data: store.listAdmins() });
    }
    if (p === '/api/admin/admins' && req.method === 'POST') {
      if (admin.role !== 'super') return sendJSON(res, 403, { ok: false, message: '需要超级管理员权限' });
      return await handleAdminCreate(req, res);
    }
    const adminMatch = p.match(/^\/api\/admin\/admins\/([A-Za-z0-9]+)$/);
    if (adminMatch) {
      if (admin.role !== 'super') return sendJSON(res, 403, { ok: false, message: '需要超级管理员权限' });
      if (req.method === 'PUT') return await handleAdminUpdate(req, res, adminMatch[1], admin);
      if (req.method === 'DELETE') return handleAdminDelete(res, adminMatch[1], admin);
    }

    if (p.startsWith('/api/')) {
      return sendJSON(res, 404, { ok: false, message: '接口不存在' });
    }

    /* ---- 静态页面 ---- */
    return serveStatic(req, res, p);
  } catch (e) {
    if (e.message === 'BODY_TOO_LARGE') return sendJSON(res, 413, { ok: false, message: '提交内容过大' });
    if (e.message === 'BAD_JSON') return sendJSON(res, 400, { ok: false, message: '请求格式错误' });
    console.error('[server]', e);
    if (!res.headersSent) sendJSON(res, 500, { ok: false, message: '服务器内部错误' });
  }
});

/* ---------------- 首次启动种子数据 ---------------- */

function seedIfEmpty() {
  if (store.listAdmins().length === 0) {
    const { salt, passwordHash } = hashPassword('admin123');
    store.addAdmin({
      username: 'admin', passwordHash, salt, role: 'super',
      displayName: '超级管理员'
    });
    const s2 = hashPassword('staff1234');
    store.addAdmin({
      username: 'staff01', passwordHash: s2.passwordHash, salt: s2.salt,
      role: 'admin', displayName: '现场工作人员'
    });
    const samples = [
      { code: 'EXPO2026A0001', name: '张伟', phone: '13800138000', ticketType: 'VIP通票', zone: '主展区A馆', entryDate: '2026-10-15', status: 'unused' },
      { code: 'EXPO2026B0002', name: '李娜', phone: '13900139000', ticketType: '专业观众票', zone: '展区B馆', entryDate: '2026-10-15', status: 'unused' },
      { code: 'EXPO2026C0003', name: '王芳', phone: '13700137000', ticketType: '普通观众票', zone: '展区C馆', entryDate: '2026-10-16', status: 'unused' }
    ];
    samples.forEach(t => store.addTicket(t, 'admin'));
    store.save();
    console.log('──────────────────────────────────────────────');
    console.log('  首次启动已初始化：');
    console.log('  超级管理员  admin / admin123');
    console.log('  普通管理员  staff01 / staff1234');
    console.log('  示例票码 3 张（手机号 13800138000 等，见 data/db.json）');
    console.log('  请尽快登录后台修改默认密码！');
    console.log('──────────────────────────────────────────────');
  }
}

server.listen(PORT, () => {
  console.log(`展会入场码查询系统已启动: http://localhost:${PORT}`);
  console.log(`访客查询: http://localhost:${PORT}/  ｜  管理后台: http://localhost:${PORT}/admin`);
});
