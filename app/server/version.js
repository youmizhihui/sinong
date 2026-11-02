/**
 * 应用版本号 —— 程序内的唯一来源。
 *
 * 背景：fnOS 真机上程序进程读不到包根的 manifest（权限/布局限制），
 * 因此运行时展示的版本号不再从 manifest 读取，改为此处常量。
 *
 * 发版时两处都要改：
 *   1. 本文件 VERSION（程序内展示：侧栏、settings API、MCP serverInfo）
 *   2. 项目根目录 manifest 的 version= 行（fpk 打包用）
 */
module.exports = { VERSION: '1.2.5' };
