const crypto = require('crypto');

const TTL = 12 * 60 * 60 * 1000; // 会话 12 小时
const sessions = new Map(); // token -> { username, expires }

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, expires: Date.now() + TTL });
  return token;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-token'];
  const s = token && sessions.get(token);
  if (!s || s.expires < Date.now()) {
    if (s) sessions.delete(token);
    return res.status(401).json({ error: '未登录或会话已过期，请重新登录' });
  }
  s.expires = Date.now() + TTL; // 滑动续期
  req.admin = s.username;
  req.token = token;
  next();
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, requireAdmin };
