# 展会通 · 展会入场码查询系统

观众凭 **手机号 + 入场码** 查询参展信息（姓名、票种、入场日期、所属展区、核验状态）；
后台支持 **多管理员** 新增票码、批量导入、查看查询记录。

## 快速开始

```bash
npm install     # 安装依赖（express + sql.js，纯 JS 无原生编译）
npm start       # 启动服务，默认 http://localhost:3000
npm run seed    # （可选）导入 5 条演示票码，需服务已启动
```

| 入口 | 地址 |
|---|---|
| 观众查询页 | http://localhost:3000/ |
| 管理后台 | http://localhost:3000/admin.html |

**默认管理员**：`admin` / `admin123`（首次启动自动创建，请登录后在「管理员 → 修改我的密码」中修改）

## 功能

### 观众端
- 手机号 + 入场码查询，入场码不区分大小写
- 展示：姓名、票种、入场日期、所属展区、核验状态（未核验 / 已核验 / 已作废）
- 每次查询均记录日志（成功与失败）

### 管理后台
- **数据概览**：票码总数、各状态数量、今日查询量
- **票码管理**：单个新增、按姓名/手机号/入场码搜索、状态筛选、核销 / 恢复 / 作废 / 删除、分页
- **批量导入**：粘贴 CSV 文本，每行 `姓名,手机号,入场码,票种,入场日期,展区`，单次最多 2000 条，逐行校验并报告失败原因
- **查询记录**：观众查询流水（时间、手机号、入场码、结果、IP）
- **多管理员**：新增 / 删除管理员（不可删除自己，至少保留一个）、修改本人密码

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/query` | 观众查询 `{phone, code}` |
| POST | `/api/admin/login` | 管理员登录，返回 token |
| GET | `/api/admin/stats` | 数据概览 |
| GET/POST | `/api/admin/tickets` | 票码列表（分页/搜索/筛选）/ 新增 |
| POST | `/api/admin/tickets/batch` | 批量导入 `{rows:[...]}` |
| PATCH/DELETE | `/api/admin/tickets/:id` | 修改核验状态 / 删除 |
| GET | `/api/admin/logs` | 查询记录（分页） |
| GET/POST/DELETE | `/api/admin/admins[/:id]` | 管理员管理 |
| POST | `/api/admin/password` | 修改本人密码 |

后台接口均需请求头 `X-Token: <登录返回的 token>`，会话 12 小时滑动过期。

## 技术说明

- **后端**：Node.js + Express，零原生依赖
- **数据库**：SQLite（sql.js，WASM 运行），数据落盘 `data/expo.db`，写操作防抖自动保存
- **安全**：scrypt 加盐哈希存储密码、时序安全比较、参数化 SQL、token 会话
- **前端**：原生 HTML/CSS/JS，深色商务科技风（玻璃拟态 + 网格光晕背景），移动端自适应

## 目录结构

```
server.js            # 服务入口
seed.js              # 演示数据导入（通过 API）
src/
  db.js              # SQLite 初始化 / 持久化 / 默认管理员
  auth.js            # 密码哈希 + token 会话
  routes/public.js   # 观众查询 API
  routes/admin.js    # 后台管理 API
public/
  index.html         # 观众查询页
  admin.html         # 管理后台
  css/style.css      # 商务科技风样式
  js/query.js        # 查询页逻辑
  js/admin.js        # 后台逻辑
data/expo.db         # SQLite 数据文件（已 gitignore）
```
