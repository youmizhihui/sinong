# 司农记账 - AI 接手指南

> 你是司农记账项目的开发者。读完本文件后你应该能直接开始写代码，不用再问基本问题。

## 项目一句话

部署在飞牛 fnOS NAS 上的**本地优先家庭记账应用**，Vue3 + Node.js，数据全在本地 SQLite，无云服务。

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端 | Vue3 + Vite + TypeScript + Vant 4 + lucide-vue-next | Node 22+ |
| 后端 | Node.js 22 内置 `node:sqlite`（DatabaseSync，零 npm 依赖） | 仅 xlsx 一个依赖 |
| 数据库 | SQLite，金额以**分（整数）**存储 | 无 ORM，直接 SQL |
| 身份 | fnOS 网关 Header 注入 `X-Trim-Userid`，不做自己的登录 | |
| 打包 | fnpack → .fpk，飞牛应用中心本地安装 | |

## 目录结构

```
sinong/
├── app/
│   ├── server/
│   │   ├── server.js      # 后端入口，所有 API 路由都在这一个文件里
│   │   └── db.js          # 建表、migration、seed、连接
│   └── ui/                # fnOS 统一网关配置
├── frontend/
│   ├── src/
│   │   ├── api.ts         # API 封装 + TypeScript 类型定义（Account/Ledger/Entry 都在这）
│   │   ├── store.ts       # 全局状态（settings/currentLedgerId）
│   │   ├── views/
│   │   │   ├── HomeView.vue       # 首页：本月收支、账本切换、最近流水
│   │   │   ├── EntryView.vue     # 记一笔：支出/收入/转账
│   │   │   ├── AccountsView.vue  # 账户管理
│   │   │   ├── LedgersView.vue    # 账本管理 + 成员管理
│   │   │   └── SettingsView.vue   # 设置
│   │   └── main.ts / App.vue
│   └── dist/             # build 产物，拷贝到 app/www/
├── cmd/                  # fnOS 生命周期脚本（install/start/stop）
├── wizard/               # 安装/卸载向导
├── dev-backend.bat       # 开发：启动后端（端口 18099）
├── dev-frontend.bat      # 开发：启动前端（端口 5173）
├── dev-stop.bat          # 开发：停止前后端
└── dev-restart.bat       # 开发：重启前后端
```

## 关键约定（必须遵守）

### 金额
- **永远用分（整数）**，不用小数。1 元 = 100 分。
- SQL 里 `amount` 列恒为正数，方向由 `flow_type`（expense/income/transfer）决定。

### 数据库表核心字段
```sql
account:  id, type, name, balance, is_private, owner_uid, note, sort, created_at, updated_at
ledger:   id, name, icon, template, is_default, type('shared'|'private'), owner_uid, created_at
entry:    id, ledger_id, account_id, to_account_id, category_id, flow_type, amount, note, entry_date, member_id
ledger_share: ledger_id, user_id, perm   -- user_id='*' 表示所有人可见
category: id, type('expense'|'income'), parent_id, name, icon, is_frequent, sort
```

### 隐私隔离规则（v1.2.0 新增）
- `is_private=1` 的账户是私有账户，只有 `owner_uid=当前用户` 能看到
- 共享账本（`type='shared'`）：只显示 `is_private=0` 的账户
- 私人账本（`type='private'`）：只显示 `is_private=1 AND owner_uid=当前用户` 的账户
- 账户管理页调 `/api/accounts?scope=all` 看全部，记一笔页默认 `scope=ledger` 按账本过滤
- 转账本类型时，自动同步只在当前账本使用的账户属性；跨账本共用的账户跳过并提示

### API 风格
- RESTful，返回 JSON
- 错误用 `httpError(status, message)` 抛出，前端 catch 后 showToast
- 需要用户身份时 `getUser(req)` 从网关 Header 拿

### 前端
- 组件库用 Vant 4，图标用 `lucide-vue-next`（不要用 vant-icon，渲染有问题）
- 复制功能在 HTTP 环境下要降级到 `document.execCommand('copy')`，`navigator.clipboard` 不可用
- 所有新页面/组件写完跑 `npx vue-tsc --noEmit` 确认类型通过

### Git
- **不要自动提交**，等用户明确说"提交代码"再 commit
- commit message 用中文，简述改动

### 协作方式
- 开发时**只编辑代码**；验证、测试、git 提交、打包 .fpk 等动作，等用户明确提示才执行，不要主动做。

## 开发环境速启

```powershell
# 后端（端口 18099，数据在 .devdb/sinong.db）
node app/server/server.js --port 18099 --data-dir .devdb

# 前端（端口 5173，代理到 18099）
cd frontend; npm run dev
```

或直接双击 `dev-restart.bat`。

## 当前版本

**v1.2.3** - 账期视图全面化（所有账户按月分组统计、可自定义账单日、账期翻页）+ 账期日期算法修复

> 版本号两处维护（真机进程读不到 manifest，运行时展示不依赖它）：
> - 程序内唯一来源：`app/server/version.js` 的 VERSION（侧栏/settings API/MCP serverInfo 显示）
> - 打包用：项目根目录 `manifest` 的 `version=` 行
> 发版时两处都改，并同步更新 `CHANGELOG.md`。
> 发新版时同步更新 `CHANGELOG.md`（完整更新日志，最新在最上）和 manifest 的 changelog 字段。

## 常见坑（踩过的坑，别再踩）

1. **category vs entry 列名不同**：category 表用 `type`，entry 表用 `flow_type`，写 SQL 前先看建表语句
2. **category 表没有 updated_at 列**
3. **加新字段后老数据是 NULL**：WHERE 过滤要用 `IS NULL` 或回填，不能直接等值匹配
4. **PowerShell 发 HTTP 中文 body 乱码**：要手动转 UTF-8 字节
5. **fnOS manifest 的 os_min_version 别乱写**，容易拼错版本号导致安装被拒
6. **MCP Server 的记账工具 description 要引导 AI 先调 list_* 工具**，别让 AI 瞎传分类名

## 你现在要做什么？

用户会直接告诉你任务。如果是新功能，先问清楚：
1. 影响哪些表？要不要 migration？
2. 前端改哪个页面？
3. 有没有隐私/权限影响？

不要问"项目用什么技术栈"这种基础问题，本文件已经写了。
