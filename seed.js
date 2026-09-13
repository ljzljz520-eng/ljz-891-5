// 演示数据导入（通过 API，需服务已启动）：node seed.js [baseUrl]
const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';

const DEMO_TICKETS = [
  { name: '张伟', phone: '13800138001', code: 'EXPO-A1001', ticket_type: 'VIP 贵宾票', entry_date: '2026-09-20', zone: 'A1 · 智能制造展区' },
  { name: '李娜', phone: '13800138002', code: 'EXPO-A1002', ticket_type: '普通票', entry_date: '2026-09-20', zone: 'B2 · 数字科技展区' },
  { name: '王强', phone: '13800138003', code: 'EXPO-B2001', ticket_type: '专业观众票', entry_date: '2026-09-21', zone: 'C3 · 未来出行展区' },
  { name: '赵敏', phone: '13800138004', code: 'EXPO-B2002', ticket_type: '团体票', entry_date: '2026-09-21', zone: 'A1 · 智能制造展区' },
  { name: '陈杰', phone: '13800138005', code: 'EXPO-C3001', ticket_type: 'VIP 贵宾票', entry_date: '2026-09-22', zone: 'D4 · 绿色能源展区' },
];

(async () => {
  const login = await fetch(BASE + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  }).then((r) => r.json());
  if (!login.token) { console.error('登录失败:', login.error); process.exit(1); }

  const res = await fetch(BASE + '/api/admin/tickets/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Token': login.token },
    body: JSON.stringify({ rows: DEMO_TICKETS }),
  }).then((r) => r.json());

  console.log(`导入成功 ${res.inserted} 条`, res.failed && res.failed.length ? `跳过 ${res.failed.length} 条（可能已存在）` : '');
  // 将一条置为已核验、一条置为已作废，便于演示不同状态
  const list = await fetch(BASE + '/api/admin/tickets?size=50', { headers: { 'X-Token': login.token } }).then((r) => r.json());
  const byCode = Object.fromEntries(list.rows.map((t) => [t.code, t.id]));
  const patch = (code, status) => fetch(BASE + '/api/admin/tickets/' + byCode[code], {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Token': login.token },
    body: JSON.stringify({ status }),
  });
  if (byCode['EXPO-A1002']) await patch('EXPO-A1002', 'used');
  if (byCode['EXPO-B2002']) await patch('EXPO-B2002', 'revoked');
  console.log('演示状态已设置：EXPO-A1002=已核验，EXPO-B2002=已作废');
})();
