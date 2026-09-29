'use strict';
const crypto = require('crypto');
const { scryptSync, randomBytes, timingSafeEqual } = crypto;

/**
 * scrypt 密码哈希
 * 格式: scrypt$N$r$p$<saltHex>$<hashHex>
 */
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const N = 16384, r = 8, p = 1, keylen = 64;
  const hash = scryptSync(String(password), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return {
    salt,
    passwordHash: `scrypt$${N}$${r}$${p}$${salt}$${hash.toString('hex')}`
  };
}

function verifyPassword(password, stored) {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = +parts[1], r = +parts[2], p = +parts[3];
    const salt = parts[4];
    const expected = Buffer.from(parts[5], 'hex');
    const actual = scryptSync(String(password), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
