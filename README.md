# 展会入场码查询系统

零第三方依赖的轻量展会入场服务：**观众自助查询 + 多管理员后台**。
原生 Node.js（≥18）实现，JSON 文件持久化，开箱即用。

## 功能

### 观众端 `/`
- 输入 **手机号 + 入场码**，一步查询：
  - 姓名、票种、入场日期、所属展区、核验状态
- 三种状态：未核验 / 已核验 / 已停用（停用码给出醒目提示）
- 查无结果统一文案，防止入场码/手机号枚举

### 管理后台 `/admin`
- **数据概览**：票码总数、核验率、各展区分布、今日/累计查询量
- **票码管理**：新增、编辑、删除、一键核验；多条件筛选（码/姓名/手机号、状态、展区、日期）
- **批量导入**：CSV 文件（拖拽/点选）或直接粘贴；支持中/英文表头与引号转义；
  重复码与坏数据逐行报告；提供模板下载与当前筛选结果导出
- **查询记录**：全部访客查询留痕（成功/失败、失败原因、手机号脱敏、时间、IP、查询快照）
- **多管理员**：超级管理员可新增/编辑/停用/删除管理员、重置密码；
  普通管理员可管理票码但不能管理账号；会话 7 天有效，停用即失效

## 快速开始

```bash
npm start          # 或 node server.js
# 自定义端口 PORT=8080 node server.js
```

首次启动自动写入示例数据并在控制台打印账号：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 超级管理员 | `admin` | `admin123` |
| 普通管理员 | `staff01` | `staff1234` |

> 请登录后立即修改默认密码。

- 访客页：http://localhost:3000/
- 后台：http://localhost:3000/admin
- 示例票码：`EXPO2026A0001` / 手机号 `13800138000`

## CSV 导入格式（需含表头，UTF-8）

```csv
入场码,姓名,手机号,票种,展区,入场日期
EXPO2026A0001,张三,13800138000,VIP通票,主展区A馆,2026-10-15
```

英文表头 `code,name,phone,type,zone,date` 同样支持；单次上限 5MB。

## 安全设计

- 密码：`scrypt`（N=16384）加盐哈希，登录校验恒定时间比较
- 会话：随机 32 字节 token，`HttpOnly; SameSite=Lax` Cookie
- 限流：查询 15 次 / 登录 8 次（每 IP 每 5 分钟）
- 输入：手机号、入场码、日期等服务端强校验，响应头防嗅探/防嵌套
- 前端所有数据插值 HTML 转义，防 XSS
- 查询防枚举：码不存在与手机号不匹配返回相同提示

## 目录结构

```
server.js          HTTP 服务与全部 API
lib/store.js       JSON 文件存储（原子写盘）
lib/auth.js        scrypt 密码哈希
lib/csv.js         CSV 解析/生成（中文表头、BOM、TSV 兼容）
lib/util.js        校验、内存限流、响应工具
public/index.html  观众查询页
public/admin.html  管理后台
public/css/js…     样式与前端脚本
data/db.json       运行时自动生成（已 gitignore）
```

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/query` | 观众查询（公开，限流） |
| POST | `/api/admin/login` / `logout` | 登录 / 登出 |
| GET | `/api/admin/stats` | 概览统计 |
| GET/POST | `/api/admin/tickets` | 票码列表（筛选分页）/ 新增 |
| PUT/DELETE | `/api/admin/tickets/:id` | 编辑 / 删除 |
| POST | `/api/admin/tickets/:id/verify` | 现场核验 |
| POST | `/api/admin/import` | CSV 批量导入 |
| GET | `/api/admin/export`、`/template.csv` | 导出 / 模板 |
| GET | `/api/admin/logs` | 查询记录 |
| GET/POST/PUT/DELETE | `/api/admin/admins` | 管理员管理（仅超管） |

> 数据量建议万级以内；更大规模可将 `lib/store.js` 替换为 SQLite/PostgreSQL，接口层无需改动。
