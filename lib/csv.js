'use strict';
const { normalizeStatus } = require('./store');

/* 支持引号、逗号、换行的标准 CSV 解析 */
function parseCsv(text) {
  // 去 BOM
  text = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // 忽略，等 \n
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/* CSV 字段转义 */
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n');
}

/* 表头别名映射（中英文名都支持） */
const HEADER_ALIASES = {
  '入场码': 'code', '票码': 'code', '码': 'code', 'code': 'code',
  '手机号': 'phone', '手机': 'phone', '电话': 'phone', 'phone': 'phone', 'mobile': 'phone',
  '姓名': 'name', '名字': 'name', '观众姓名': 'name', 'name': 'name',
  '票种': 'ticketType', '票种类型': 'ticketType', '类型': 'ticketType',
  'tickettype': 'ticketType', 'ticket type': 'ticketType', 'type': 'ticketType',
  '展区': 'zone', '所属展区': 'zone', '展馆': 'zone', '区域': 'zone', 'zone': 'zone',
  '入场日期': 'entryDate', '日期': 'entryDate', '参观日期': 'entryDate',
  'date': 'entryDate', 'entrydate': 'entryDate',
  '核验状态': 'status', '状态': 'status', 'status': 'status',
  '备注': 'note', '说明': 'note', 'note': 'note', 'remark': 'note'
};

function parseTicketCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: '文件为空或缺少数据行（需包含表头）' };
  const header = rows[0].map((h) => HEADER_ALIASES[String(h).trim().toLowerCase()] || null);
  const pick = (cells, key) => {
    const idx = header.indexOf(key);
    return idx === -1 ? '' : (cells[idx] || '').trim();
  };
  const required = ['code', 'phone', 'name'];
  for (const k of required) {
    if (!header.includes(k)) {
      return { error: `缺少必需列：${{ code: '入场码', phone: '手机号', name: '姓名' }[k]}` };
    }
  }
  const records = [];
  rows.slice(1).forEach((cells, i) => {
    records.push({
      _line: i + 2,
      code: pick(cells, 'code'),
      phone: pick(cells, 'phone'),
      name: pick(cells, 'name'),
      ticketType: pick(cells, 'ticketType') || '普通观众票',
      zone: pick(cells, 'zone') || '主展馆',
      entryDate: pick(cells, 'entryDate'),
      status: normalizeStatus(pick(cells, 'status')),
      note: pick(cells, 'note')
    });
  });
  return { records };
}

/* 把 Excel 复制的日期数字等做简单兼容；此处保持原样由 store 校验 */

const TICKET_HEADERS = [
  ['code', '入场码'], ['phone', '手机号'], ['name', '姓名'],
  ['ticketType', '票种'], ['zone', '所属展区'], ['entryDate', '入场日期'],
  ['status', '核验状态'], ['note', '备注']
];
function ticketsToCsv(tickets) {
  return toCsv(
    TICKET_HEADERS.map(([, zh]) => zh),
    tickets.map((t) => TICKET_HEADERS.map(([key]) => t[key]))
  );
}
const TEMPLATE_CSV = '﻿入场码,手机号,姓名,票种,所属展区,入场日期,核验状态,备注\r\n' +
  'EXPO2026-DEMO01,13800001111,示例观众,普通观众票,A馆 · 智能制造展区,2026-10-15,未核验,批量导入模板示例\r\n';

module.exports = { parseCsv, toCsv, parseTicketCsv, ticketsToCsv, TEMPLATE_CSV };
