const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'expo.db');

let db = null;
let saveTimer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  ticket_type TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  zone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(code, phone)
);
CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets(phone);
CREATE TABLE IF NOT EXISTS query_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  success INTEGER NOT NULL,
  message TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  }, 150);
}

function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (db) fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

async function initDb() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();
  db.run(SCHEMA);

  // 首次启动创建默认管理员 admin / admin123
  const row = all("SELECT COUNT(*) AS c FROM admins")[0];
  if (row.c === 0) {
    const { salt, hash } = hashPassword('admin123');
    run('INSERT INTO admins (username, password_hash, salt) VALUES (?,?,?)', ['admin', hash, salt]);
    console.log('[init] 已创建默认管理员 admin / admin123 ，请登录后尽快修改');
  }

  process.on('SIGINT', () => { saveNow(); process.exit(0); });
  process.on('SIGTERM', () => { saveNow(); process.exit(0); });
  return db;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

module.exports = { initDb, all, get, run, saveNow };
