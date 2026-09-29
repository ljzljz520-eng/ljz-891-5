# 展会入场码查询系统

零依赖的展会入场码核验系统（Node.js 内置模块 + 原生前端）。观众凭手机号与入场码查询入场信息，管理后台支持多管理员票码管理、批量导入与查询记录审计。

## 功能

### 观众端 `/`
- 输入**手机号 + 入场码**核验
- 展示：姓名、票种、入场日期、所属展区、核验状态（手机号脱敏显示）
- 查询限流，失败原因入审计日志

### 管理后台 `/admin`
| 模块 | 能力 |
| --- | --- |
| 数据概览 | 票码总数、今日成功查询、今日查询次数、累计记录、状态分布图 |
| 票码管理 | 新增 / 编辑 / 删除、按姓名/手机号/入场码/票种/展区搜索、按状态筛选、分页 |
| 批量导入 | CSV 文件或粘贴文本，中英表头兼容，逐行校验并返回成功/跳过明细，可下载模板 |
| 导出 | 按当前筛选条件导出 CSV |
| 查询记录 | 全部查询留痕（时间、手机号、入场码、成功/失败、原因、IP） |
| 管理员 | 超级管理员可新增/编辑/删除管理员、重置密码、调整角色（普通管理员不可见） |

- 密码使用 `scrypt` 加盐哈希存储
- 会话为 HMAC 签名的 HttpOnly Cookie（12 小时过期）
- 数据存于 `data/db.json`，原子写入（写临时文件后 rename）

## 快速开始

```bash
npm start
# 或
node server.js
```

- 观众查询：http://localhost:3000/
- 管理后台：http://localhost:3000/admin
- 默认账号：
  - `admin / admin123`（超级管理员）
  - `manager / manager123`（普通管理员）

环境变量：`PORT`（默认 3000）、`DATA_DIR`（默认 ./data）、`SESSION_SECRET`（生产环境请务必自定义）。

## 批量导入 CSV 格式

首行为表头，列名支持中文/英文，顺序任意：

```csv
入场码,手机号,姓名,票种,所属展区,入场日期,核验状态,备注
EXPO2026-X1,13800001111,张三,普通观众票,A馆 · 智能制造展区,2026-10-15,未核验,
```

- 必填列：**入场码、手机号、姓名、入场日期**（票种/展区缺省有默认值）
- 核验状态可填：未核验 / 已核验 / 已入场 / 已作废（也兼容 待核验、已检票、无效 等别名，默认未核验）
- 重复入场码、格式错误的行将被跳过并在结果中列出行号与原因

## 目录结构

```
server.js            HTTP 服务与全部 API
lib/util.js          密码哈希、签名令牌、限流、校验工具
lib/store.js         JSON 数据存储、票码/管理员/日志业务逻辑、初始数据
lib/csv.js           CSV 解析/序列化与模板
public/
  index.html / css/query.css / js/query.js     观众查询页
  admin.html / css/admin.css / js/admin.js     管理后台
  css/style.css                                共享商务科技风样式
data/db.json         运行后自动生成
```

## 主要 API

- `POST /api/query` 观众查询（公开，限流）
- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET /api/stats`
- `GET/POST /api/tickets`、`PUT/DELETE /api/tickets/:id`
- `POST /api/tickets/import`、`GET /api/tickets/template`、`GET /api/tickets/export`
- `GET /api/logs`
- `GET/POST /api/admins`、`PUT/DELETE /api/admins/:id`（仅超级管理员）
