'use strict';
/**
 * 轻量 JSON 文件存储层
 * - 全量读入内存，修改后原子写盘（tmp + rename）
 * - 数据量在万级以内时性能足够，无需外部数据库
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  meta: { version: 1 },
  admins: [],
  tickets: [],
  logs: [],
  sessions: []
};

let db = null;

function genId(len = 12) {
  return crypto.randomBytes(len).toString('hex').slice(0, len);
}

function load() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = { ...DEFAULT_DB, ...JSON.parse(raw) };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[store] 数据库读取失败，使用空库:', e.message);
    db = JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  for (const k of ['admins', 'tickets', 'logs', 'sessions']) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  return db;
}

let saveTimer = null;
function save() {
  // 合并短时间内的多次写入
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[store] 写盘失败:', e.message);
    }
  }, 30);
}

function saveSync() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------------- Admins ---------------- */

function findAdminByUsername(username) {
  return db.admins.find(a => a.username.toLowerCase() === String(username).toLowerCase()) || null;
}
function getAdmin(id) {
  return db.admins.find(a => a.id === id) || null;
}
function publicAdmin(a) {
  if (!a) return null;
  const { passwordHash, salt, ...rest } = a;
  return rest;
}
function listAdmins() {
  return db.admins.map(publicAdmin).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}
function addAdmin({ username, passwordHash, salt, role = 'admin', displayName = '' }) {
  const now = new Date().toISOString();
  const admin = {
    id: genId(8),
    username,
    passwordHash,
    salt,
    role,
    displayName: displayName || username,
    active: true,
    createdAt: now,
    lastLoginAt: null
  };
  db.admins.push(admin);
  save();
  return admin;
}
function updateAdmin(id, patch) {
  const a = getAdmin(id);
  if (!a) return null;
  const allowed = ['displayName', 'active', 'passwordHash', 'salt', 'role'];
  for (const k of allowed) if (k in patch) a[k] = patch[k];
  save();
  return a;
}
function touchAdminLogin(id) {
  const a = getAdmin(id);
  if (a) { a.lastLoginAt = new Date().toISOString(); save(); }
}
function deleteAdmin(id) {
  const i = db.admins.findIndex(a => a.id === id);
  if (i === -1) return false;
  db.admins.splice(i, 1);
  // 同时清理该管理员的会话
  db.sessions = db.sessions.filter(s => s.adminId !== id);
  save();
  return true;
}

/* ---------------- Sessions ---------------- */

function createSession(adminId, ttlMs = 7 * 24 * 3600 * 1000) {
  const now = Date.now();
  const session = {
    token: crypto.randomBytes(32).toString('hex'),
    adminId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString()
  };
  db.sessions.push(session);
  // 顺带清理过期会话
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt).getTime() > now);
  save();
  return session;
}
function getSession(token) {
  if (!token) return null;
  const s = db.sessions.find(x => x.token === token);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    db.sessions = db.sessions.filter(x => x.token !== token);
    save();
    return null;
  }
  return s;
}
function deleteSession(token) {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.token !== token);
  if (db.sessions.length !== before) save();
}

/* ---------------- Tickets ---------------- */

function getTicketByCode(code) {
  return db.tickets.find(t => t.code === code) || null;
}
function getTicket(id) {
  return db.tickets.find(t => t.id === id) || null;
}
function addTicket(fields, createdBy) {
  const now = new Date().toISOString();
  const t = {
    id: genId(10),
    code: fields.code,
    name: fields.name,
    phone: fields.phone,
    ticketType: fields.ticketType,
    zone: fields.zone,
    entryDate: fields.entryDate,
    status: fields.status || 'unused',
    note: fields.note || '',
    verifiedAt: null,
    verifiedBy: null,
    batchId: fields.batchId || null,
    createdBy: createdBy || null,
    createdAt: now
  };
  db.tickets.push(t);
  return t;
}

/**
 * 批量导入。rows 中 code 已规范化。
 * 返回 { created, skipped:[{code, reason}], batchId }
 */
function bulkAddTickets(rows, createdBy) {
  const batchId = genId(8);
  const existing = new Set(db.tickets.map(t => t.code));
  const seenInBatch = new Set();
  const created = [];
  const skipped = [];
  for (const r of rows) {
    if (existing.has(r.code) || seenInBatch.has(r.code)) {
      if (skipped.length < 100) skipped.push({ code: r.code, reason: '入场码已存在', row: r.__row });
      continue;
    }
    seenInBatch.add(r.code);
    const t = addTicket({ ...r, batchId }, createdBy);
    created.push(t);
  }
  if (created.length) save();
  return { createdCount: created.length, skippedCount: rows.length - created.length, skipped, batchId };
}

function queryTickets({ q = '', status = '', zone = '', date = '', page = 1, pageSize = 20 }) {
  let list = db.tickets;
  if (q) {
    const kw = q.trim().toLowerCase();
    list = list.filter(t =>
      t.code.toLowerCase().includes(kw) ||
      t.name.toLowerCase().includes(kw) ||
      t.phone.includes(kw)
    );
  }
  if (status) list = list.filter(t => t.status === status);
  if (zone) list = list.filter(t => t.zone === zone);
  if (date) list = list.filter(t => t.entryDate === date);
  const total = list.length;
  list = list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = (page - 1) * pageSize;
  return { total, page, pageSize, items: list.slice(start, start + pageSize) };
}

function listZones() {
  return [...new Set(db.tickets.map(t => t.zone).filter(Boolean))].sort();
}

function updateTicket(id, patch) {
  const t = getTicket(id);
  if (!t) return null;
  // code 唯一性校验在调用处完成
  const allowed = ['name', 'phone', 'ticketType', 'zone', 'entryDate', 'status', 'note'];
  for (const k of allowed) if (k in patch) t[k] = patch[k];
  save();
  return t;
}
function deleteTicket(id) {
  const i = db.tickets.findIndex(t => t.id === id);
  if (i === -1) return false;
  db.tickets.splice(i, 1);
  save();
  return true;
}
function verifyTicket(id, adminName) {
  const t = getTicket(id);
  if (!t) return null;
  if (t.status === 'disabled') return { ok: false, reason: '该票码已停用，无法核验' };
  t.status = 'verified';
  t.verifiedAt = new Date().toISOString();
  t.verifiedBy = adminName;
  save();
  return { ok: true, ticket: t };
}

/* ---------------- Logs ---------------- */

function addLog(entry) {
  const log = {
    id: genId(10),
    timestamp: new Date().toISOString(),
    ip: entry.ip || '',
    phone: entry.phone || '',
    code: entry.code || '',
    success: !!entry.success,
    reason: entry.reason || (entry.success ? 'ok' : 'not_found'),
    ticketId: entry.ticketId || null,
    snapshot: entry.snapshot || null
  };
  db.logs.push(log);
  // 日志最多保留 5 万条，超出裁剪最旧的
  if (db.logs.length > 50000) db.logs = db.logs.slice(-50000);
  save();
  return log;
}
function queryLogs({ success = '', page = 1, pageSize = 20 }) {
  let list = db.logs;
  if (success === 'ok') list = list.filter(l => l.success);
  if (success === 'fail') list = list.filter(l => !l.success);
  const total = list.length;
  list = list.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const start = (page - 1) * pageSize;
  return { total, page, pageSize, items: list.slice(start, start + pageSize) };
}

/* ---------------- Stats ---------------- */

function stats() {
  const today = new Date().toISOString().slice(0, 10);
  const statusCount = { unused: 0, verified: 0, disabled: 0 };
  const zoneMap = {};
  for (const t of db.tickets) {
    statusCount[t.status] = (statusCount[t.status] || 0) + 1;
    zoneMap[t.zone] = (zoneMap[t.zone] || 0) + 1;
  }
  let queriesToday = 0, successToday = 0;
  for (const l of db.logs) {
    if (l.timestamp.slice(0, 10) === today) {
      queriesToday++;
      if (l.success) successToday++;
    }
  }
  return {
    totalTickets: db.tickets.length,
    statusCount,
    totalQueries: db.logs.length,
    queriesToday,
    successToday,
    zones: Object.entries(zoneMap).map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count)
  };
}

module.exports = {
  init: load,
  save: saveSync,
  genId,
  // admins
  findAdminByUsername, getAdmin, publicAdmin, listAdmins, addAdmin,
  updateAdmin, deleteAdmin, touchAdminLogin,
  // sessions
  createSession, getSession, deleteSession,
  // tickets
  addTicket, bulkAddTickets, queryTickets, getTicket, getTicketByCode,
  updateTicket, deleteTicket, verifyTicket, listZones,
  // logs
  addLog, queryLogs,
  stats
};
