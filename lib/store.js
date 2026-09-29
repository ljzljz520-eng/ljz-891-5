'use strict';
const fs = require('fs');
const path = require('path');
const {
  hashPassword, newId, isMobile, normalizeCode, isValidDate, nowText
} = require('./util');

/* 状态白名单 */
const STATUSES = ['未核验', '已核验', '已入场', '已作废'];
function normalizeStatus(v) {
  const s = String(v || '').trim();
  const alias = {
    '': '未核验', '有效': '未核验', '待核验': '未核验',
    '核验通过': '已核验', '通过': '已核验',
    '已检票': '已入场', '入场': '已入场', '已核销': '已入场',
    '作废': '已作废', '无效': '已作废', '已取消': '已作废'
  };
  if (STATUSES.includes(s)) return s;
  return alias[s] || '未核验';
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.data = null;
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (e) {
        throw new Error(`数据文件解析失败: ${this.file} (${e.message})`);
      }
    } else {
      this.data = this._seed();
      this.save();
    }
    this.data.admins ||= [];
    this.data.tickets ||= [];
    this.data.logs ||= [];
    this.data.counters ||= {};
    return this.data;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  _seed() {
    const now = nowText();
    return {
      version: 1,
      createdAt: now,
      counters: {},
      admins: [
        {
          id: newId('adm'), username: 'admin', password: hashPassword('admin123'),
          role: 'super', displayName: '超级管理员', createdAt: now
        },
        {
          id: newId('adm'), username: 'manager', password: hashPassword('manager123'),
          role: 'admin', displayName: '运营管理员', createdAt: now
        }
      ],
      tickets: [
        { id: newId('tkt'), code: 'EXPO2026-A8K3M9', phone: '13800138000', name: '张伟', ticketType: 'VIP专业观众票', zone: 'A馆 · 智能制造展区', entryDate: '2026-10-15', status: '已入场', note: '开幕论坛嘉宾', createdBy: 'admin', createdAt: now, updatedAt: now },
        { id: newId('tkt'), code: 'EXPO2026-B2Q7X1', phone: '13912345678', name: '李娜', ticketType: '普通观众票', zone: 'B馆 · 消费电子展区', entryDate: '2026-10-16', status: '已核验', note: '', createdBy: 'admin', createdAt: now, updatedAt: now },
        { id: newId('tkt'), code: 'EXPO2026-C5R9T4', phone: '13766668888', name: '王晓明', ticketType: '专业观众票', zone: 'C馆 · 新能源与储能展区', entryDate: '2026-10-17', status: '未核验', note: '团体报名', createdBy: 'manager', createdAt: now, updatedAt: now },
        { id: newId('tkt'), code: 'EXPO2026-D6W2Y8', phone: '13555556666', name: '陈静怡', ticketType: '媒体证', zone: '新闻中心 · 全展区通行', entryDate: '2026-10-15', status: '已作废', note: '证件遗失补办', createdBy: 'admin', createdAt: now, updatedAt: now }
      ],
      logs: []
    };
  }

  /* ---------- 管理员 ---------- */
  findAdminByUsername(username) {
    return this.data.admins.find((a) => a.username === String(username).trim().toLowerCase());
  }
  findAdminById(id) {
    return this.data.admins.find((a) => a.id === id);
  }
  addAdmin({ username, password, displayName, role }) {
    const now = nowText();
    const admin = {
      id: newId('adm'),
      username: username.trim().toLowerCase(),
      password: hashPassword(password),
      displayName: (displayName || username).trim(),
      role: role === 'super' ? 'super' : 'admin',
      createdAt: now
    };
    this.data.admins.push(admin);
    this.save();
    return this._publicAdmin(admin);
  }
  listAdmins() {
    return this.data.admins.map((a) => this._publicAdmin(a));
  }
  updateAdmin(id, { password, displayName, role }) {
    const a = this.findAdminById(id);
    if (!a) return null;
    if (password) a.password = hashPassword(password);
    if (displayName !== undefined) a.displayName = displayName.trim();
    if (role) a.role = role === 'super' ? 'super' : 'admin';
    this.save();
    return this._publicAdmin(a);
  }
  deleteAdmin(id) {
    const i = this.data.admins.findIndex((a) => a.id === id);
    if (i === -1) return false;
    this.data.admins.splice(i, 1);
    this.save();
    return true;
  }
  superAdminCount() {
    return this.data.admins.filter((a) => a.role === 'super').length;
  }
  _publicAdmin(a) {
    return { id: a.id, username: a.username, displayName: a.displayName, role: a.role, createdAt: a.createdAt };
  }

  /* ---------- 票码 ---------- */
  findTicketByCode(code) {
    const c = normalizeCode(code);
    return this.data.tickets.find((t) => t.code === c);
  }
  normalizeTicketInput(input) {
    const code = normalizeCode(input.code);
    const phone = String(input.phone || '').trim();
    const name = String(input.name || '').trim();
    const ticketType = String(input.ticketType || '').trim() || '普通观众票';
    const zone = String(input.zone || '').trim() || '主展馆';
    const entryDate = String(input.entryDate || '').trim();
    const status = normalizeStatus(input.status);
    const note = String(input.note || '').trim();
    const errors = [];
    if (!code || code.length < 4 || code.length > 40) errors.push('入场码长度需为 4-40 位');
    if (!isMobile(phone)) errors.push('手机号格式不正确');
    if (!name) errors.push('姓名不能为空');
    if (!isValidDate(entryDate)) errors.push('入场日期格式应为 YYYY-MM-DD');
    return { value: { code, phone, name, ticketType, zone, entryDate, status, note }, errors };
  }
  addTicket(input, createdBy) {
    const { value, errors } = this.normalizeTicketInput(input);
    if (errors.length) return { error: errors.join('；') };
    if (this.findTicketByCode(value.code)) return { error: `入场码 ${value.code} 已存在` };
    const now = nowText();
    const ticket = { id: newId('tkt'), ...value, createdBy, createdAt: now, updatedAt: now };
    this.data.tickets.push(ticket);
    this.save();
    return { ticket };
  }
  updateTicket(id, patch) {
    const t = this.data.tickets.find((x) => x.id === id);
    if (!t) return { error: '票码不存在' };
    const merged = { ...t, ...patch, code: patch.code ?? t.code };
    const { value, errors } = this.normalizeTicketInput(merged);
    if (errors.length) return { error: errors.join('；') };
    const dup = this.findTicketByCode(value.code);
    if (dup && dup.id !== id) return { error: `入场码 ${value.code} 已被其他记录使用` };
    Object.assign(t, value, { updatedAt: nowText() });
    this.save();
    return { ticket: t };
  }
  deleteTicket(id) {
    const i = this.data.tickets.findIndex((t) => t.id === id);
    if (i === -1) return false;
    this.data.tickets.splice(i, 1);
    this.save();
    return true;
  }
  listTickets({ keyword = '', status = '', page = 1, pageSize = 20 } = {}) {
    const kw = keyword.trim().toLowerCase();
    let rows = this.data.tickets;
    if (status) rows = rows.filter((t) => t.status === status);
    if (kw) rows = rows.filter((t) =>
      t.name.toLowerCase().includes(kw) ||
      t.phone.includes(kw) ||
      t.code.toLowerCase().includes(kw) ||
      t.ticketType.toLowerCase().includes(kw) ||
      t.zone.toLowerCase().includes(kw)
    );
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return { total, page, pageSize, items: rows.slice(start, start + pageSize) };
  }
  stats() {
    const tickets = this.data.tickets;
    const byStatus = {};
    for (const s of STATUSES) byStatus[s] = 0;
    for (const t of tickets) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    const today = nowText().slice(0, 10);
    const todayVerified = this.data.logs.filter((l) =>
      l.ok && l.time.startsWith(today)).length;
    return {
      totalTickets: tickets.length,
      totalLogs: this.data.logs.length,
      todayQueries: this.data.logs.filter((l) => l.time.startsWith(today)).length,
      todayVerified,
      byStatus,
      totalAdmins: this.data.admins.length
    };
  }

  /* ---------- 查询记录 ---------- */
  addLog(entry) {
    const log = { id: newId('log'), time: nowText(), ...entry };
    this.data.logs.push(log);
    // 仅保留最近 50000 条
    if (this.data.logs.length > 50000) {
      this.data.logs = this.data.logs.slice(-50000);
    }
    this.save();
    return log;
  }
  listLogs({ keyword = '', result = '', page = 1, pageSize = 20 } = {}) {
    const kw = keyword.trim().toLowerCase();
    let rows = this.data.logs;
    if (result === 'success') rows = rows.filter((l) => l.ok);
    if (result === 'fail') rows = rows.filter((l) => !l.ok);
    if (kw) rows = rows.filter((l) =>
      (l.phone || '').includes(kw) ||
      (l.code || '').toLowerCase().includes(kw) ||
      (l.name || '').toLowerCase().includes(kw)
    );
    rows = rows.slice().sort((a, b) => (a.time < b.time ? 1 : -1));
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return { total, page, pageSize, items: rows.slice(start, start + pageSize) };
  }
}

module.exports = { Store, STATUSES, normalizeStatus };
