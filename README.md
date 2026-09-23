# 司农记账

> 司农已到，账房已开。钱谷之事，交给司农。

**司农记账**是一款部署在飞牛 fnOS NAS 上的本地优先家庭记账应用。数据全部存储在你自己的 NAS 上，不上传任何第三方服务器，无广告，无追踪。

## 为什么叫司农

「大司农」是古代掌管钱谷租税、国家财政的官职。司农记账取其意 —— 帮你管好家里的钱谷之事。

## 核心特点

- **数据本地存储**：所有记账数据存在你的 NAS 上，SQLite 数据库，不经过任何第三方服务器
- **无广告无追踪**：没有开屏广告、没有信息流推荐、没有用户行为分析
- **家庭共享记账**：支持私人账本和共享账本，全家人各记各的，同一账本共享可见
- **飞牛账号登录**：接入 fnOS 统一账号体系，多用户隔离
- **完整记账能力**：支出 / 收入 / 转账、二级分类、常用分类、报销管理、退款、周期账、图片凭证（最多 3 张）
- **报表与预算**：分类统计、趋势分析、月度预算
- **数据导入导出**：支持 Excel 导入（智能识别表头、多格式适配）、Excel 导出备份
- **响应式界面**：手机端和 PC 端自适应

## 适用场景

- 家庭日常收支记录
- 个人私人账本（别人看不到）
- 家庭共享账本（全家都能看、都能记）
- 报销管理（可报销标记、报销进度跟踪）
- 从其他记账 App 迁移数据

## 技术架构

```
frontend/   Vue3 + Vite + TypeScript + Vant 4 + lucide（手机 / PC 自适应）
app/server/ Node.js 22 + node:sqlite（后端 API，数据落 SQLite）
app/ui/      fnOS 统一网关入口配置
cmd/         fnOS 生命周期脚本（install/start/stop/uninstall）
wizard/      fnOS 安装 / 卸载向导
```

- 后端：Node.js 22 内置 `node:sqlite`，金额以分（整数）存储
- 部署：fnOS 统一网关（`micro_app=true`），无需独立端口
- 身份：接入 fnOS 统一账号体系，网关 Header 可信身份校验
- 数据目录：通过 `config/resource` data-share 共享，卸载时可选择保留或删除

## 本地开发

环境要求：Node.js 22+（后端 `node:sqlite` 需要 Node 22.5+）、npm。

```bash
# 1. 安装依赖
cd frontend && npm install
cd ../app/server && npm install

# 2. 一键启动（Windows）
# 回到项目根目录，双击 dev.bat，或手动执行：
node app/server/server.js --port 18099 --data-dir .devdb   # 后端
cd frontend && npm run dev                                  # 前端 http://localhost:5173
```

## 打包发布

```bash
# 1. 构建前端
cd frontend && npm run build

# 2. 拷贝到应用目录
# 将 frontend/dist 内容复制到 app/www/

# 3. 使用 fnpack 打包（需先下载 fnpack CLI）
fnpack build
```

产物为 `sinong.fpk`，可在飞牛 fnOS 应用中心本地安装。

## 安装

在飞牛 fnOS 应用中心中安装「司农记账」，或通过本地安装 `.fpk` 包。

依赖：fnOS 1.2.0401 及以上版本、nodejs_v22。

## 隐私说明

- 所有数据存储在你的 NAS 本地，应用不会向任何外部服务器发送数据
- 应用不收集用户行为、不展示广告
- 卸载应用时可选择保留或删除数据

## 提交问题与建议

如果你在使用中遇到 Bug、有功能建议或体验问题，欢迎 [提交 Issue](https://github.com/youmizhihui/sinong/issues/new)。

提交时请尽量包含：

- **问题描述**：遇到了什么问题
- **复现步骤**：怎么操作出现的
- **预期行为**：你觉得应该怎样
- **实际行为**：实际发生了什么
- **环境信息**：fnOS 版本、应用版本、手机 / PC 浏览器
- **截图**：有截图更好

## 版本

当前版本：**v1.0.0**（开发中）

应用版本号可在应用内「设置」页面底部查看。

## 免责声明

本应用按「现状」提供，作者不对因使用本应用造成的任何数据丢失或财务问题承担责任。建议定期导出数据备份。

---

*钱谷之事，交给司农。*
