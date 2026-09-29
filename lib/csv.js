'use strict';

/** 按 RFC4180 解析 CSV（支持双引号包裹、""转义、\r\n / \n / \r 换行） */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  const rows = [];
  let field = '', row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
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
      pushField();
    } else if (c === '\n') {
      pushField(); pushRow();
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      pushField(); pushRow();
    } else {
      field += c;
    }
  }
  // 收尾
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

function escapeCSV(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(headers, rows) {
  const head = headers.map(h => escapeCSV(h.label)).join(',');
  const body = rows.map(r => headers.map(h => escapeCSV(r[h.key])).join(',')).join('\r\n');
  return '﻿' + head + '\r\n' + body + '\r\n'; // BOM 方便 Excel 识别中文
}

const HEADER_MAP = {
  '入场码': 'code', '票码': 'code', '码': 'code', 'code': 'code',
  '姓名': 'name', '观众姓名': 'name', 'name': 'name',
  '手机号': 'phone', '手机': 'phone', '电话': 'phone', 'phone': 'phone',
  '票种': 'ticketType', '类型': 'ticketType', 'type': 'ticketType',
  '展区': 'zone', '所属展区': 'zone', 'zone': 'zone',
  '入场日期': 'entryDate', '日期': 'entryDate', 'date': 'entryDate', 'eventdate': 'entryDate'
};

/**
 * 解析票码导入文本（CSV 或制表符分隔均可）
 * @returns {{headers:string[], records:Array, errors:Array}}
 */
function parseTickets(text) {
  // 允许直接粘贴 TSV
  if (text.includes('\t') && !text.includes(',')) text = text.replace(/\t/g, ',');
  const rows = parseCSV(text);
  const errors = [];
  if (rows.length < 2) {
    return { headers: [], records: [], errors: ['文件为空或只有表头，无数据行'] };
  }
  const rawHeaders = rows[0].map(h => h.trim());
  const keys = rawHeaders.map(h => HEADER_MAP[h] || HEADER_MAP[String(h).toLowerCase().replace(/\s/g, '')]);
  if (!keys.includes('code')) {
    return { headers: rawHeaders, records: [], errors: ['缺少必需列：入场码（可用表头：入场码 / code）'] };
  }
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const rec = { __row: i + 1 };
    keys.forEach((k, idx) => {
      if (k) rec[k] = (cells[idx] || '').trim();
    });
    records.push(rec);
  }
  return { headers: rawHeaders, records, errors };
}

module.exports = { parseTickets, toCSV, escapeCSV };
