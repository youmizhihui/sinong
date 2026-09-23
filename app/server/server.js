'use strict';
/**
 * server.js — 司农记账后端
 * 纯 Node 内置模块（node:http / node:sqlite），零 npm 依赖。
 *
 * 运行模式：
 *  - fnOS：Unix Socket（TRIM_APPDEST/app.sock），数据存 TRIM_PKGVAR
 *  - 本地调试：node server.js --port 18099 --data-dir <dir>
 *
 * API 前缀：本地无前缀；fnOS 网关转发 /app/sinong → 本服务（自动剥离前缀）。
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { initDb, getDb, genId, touchUser, getUsers } = require('./db');
const { parseWorkbook, doImport, extractWorkbookStructure } = require('./import');
const XLSX = require('xlsx');

/** 导入预览缓存：token → 解析结果（5分钟有效） */
const importCache = new Map();
// ==================== AI 导入格式识别 ====================
const AI_SYSTEM_PROMPT = `你是 Excel 记账账单格式分析专家。用户会提供记账软件导出的 Excel 文件结构样本（每个 sheet 列出前 12 行，r=行号，c=列字母，v=单元格内容截断）。
请分析每个 sheet：
1. 业务类型 type：expense(支出)/income(收入)/transfer(转账)/loan(借贷)/repay(收款还款)/skip(非账单数据，跳过)
2. 表头行 headerRow：数据表头所在行号（1 起始）。若样本中没有明显表头，根据内容推断数据起始行。
3. 字段映射 fields：date(日期)/amount(金额)/category(分类或类别，可含大类小类)/categoryParent(大类)/categoryChild(小类)/note(备注描述)/account(账户)/accountFrom(转出账户)/accountTo(转入账户)/member(成员或消费人)/type(类型列，若每行用类型区分收支)/merchant(商家)/reimburse(报销标记)。
   fields 的值填列字母（如 A、C）或表头列名（如"消费日期"）。
   category 与 categoryParent/categoryChild 至少给一个；分不清就给 category。
4. 只返回 JSON，不要任何其他文字：
{"sheets":[{"sheet":"sheet名","type":"expense","headerRow":2,"fields":{"date":"A","amount":"C","category":"B","note":"D","account":"E"}}]}
如果 sheet 无法判断为账单，type 返回 "skip"。`;

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****' + key.slice(-2);
  return key.slice(0, 3) + '****' + key.slice(-4);
}

async function callAi(structure) {
  const db = getDb();
  const url = db.prepare("SELECT value FROM setting WHERE key='ai_url'").get()?.value;
  const model = db.prepare("SELECT value FROM setting WHERE key='ai_model'").get()?.value;
  const key = db.prepare("SELECT value FROM setting WHERE key='ai_key'").get()?.value;
  if (!url || !model) throw httpError(400, '请先在「设置 - AI 识别配置」中填写 API 地址和模型');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    let endpoint = url;
    if (!/\/chat\/completions$/.test(endpoint)) endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`; // Ollama 等本地服务可免密钥
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(structure) },
        ],
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw httpError(502, `AI 接口错误 ${res.status}：${data?.error?.message || res.statusText}`);
    }
    const text = data.choices?.[0]?.message?.content || '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw httpError(502, 'AI 返回内容不是有效 JSON');
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!parsed.sheets || !Array.isArray(parsed.sheets)) throw httpError(502, 'AI 返回缺少 sheets 字段');
    return parsed;
  } catch (e) {
    if (e && e.status) throw e;
    if (e && e.name === 'AbortError') throw httpError(504, 'AI 请求超时（45 秒），请检查接口地址或网络');
    throw httpError(502, `AI 调用失败：${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

const MAX_BODY = 4 * 1024 * 1024; // 4MB（后续附件上传单独走 multipart）

// ==================== 参数解析 ====================
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = parseInt(argVal('port', '0'), 10);
// 数据目录：优先用 fnOS 共享目录（出现在"应用文件"里），其次 TRIM_PKGVAR/data，本地调试用 --data-dir
function resolveDataDir() {
  const explicit = argVal('data-dir', null);
  if (explicit) return explicit;
  const sharePaths = process.env.TRIM_DATA_SHARE_PATHS;
  if (sharePaths) {
    const first = sharePaths.split(':')[0];
    if (first && fs.existsSync(first)) return first;
  }
  const pkgVar = process.env.TRIM_PKGVAR;
  if (pkgVar) return path.join(pkgVar, 'data');
  return null;
}
const DATA_DIR = resolveDataDir();

// 老数据迁移：TRIM_PKGVAR/sinong.db → DATA_DIR/sinong.db
function migrateOldData() {
  const pkgVar = process.env.TRIM_PKGVAR;
  if (!pkgVar || !DATA_DIR || DATA_DIR === pkgVar) return;
  const oldDb = path.join(pkgVar, 'sinong.db');
  const newDb = path.join(DATA_DIR, 'sinong.db');
  if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.renameSync(oldDb, newDb);
      console.log('[sinong] migrated db to shared data dir');
    } catch (e) {
      console.error('[sinong] db migration failed:', e.message);
    }
  }
  const oldAtt = path.join(pkgVar, 'attachments');
  const newAtt = path.join(DATA_DIR, 'attachments');
  if (fs.existsSync(oldAtt) && !fs.existsSync(newAtt)) {
    try {
      fs.renameSync(oldAtt, newAtt);
      console.log('[sinong] migrated attachments to shared data dir');
    } catch (e) {
      console.error('[sinong] attachments migration failed:', e.message);
    }
  }
}
migrateOldData();
// 模式判定：显式 --port → 端口直连模式（fnOS 端口服务 / 本地调试）；
// 未指定端口且存在 TRIM_APPDEST → 统一网关 Unix Socket 模式（保留，系统升级后可切回）。
const SOCKET_PATH = PORT === 0 && process.env.TRIM_APPDEST
  ? path.join(process.env.TRIM_APPDEST, argVal('socket', 'app.sock'))
  : null;

// 静态目录：server.js 所在目录的 ../www
const WWW_ROOT = path.resolve(__dirname, '..', 'www');

// ==================== 工具 ====================
function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/** 读取原始请求体（附件上传用） */
function readRaw(req, maxSize) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxSize) { reject(new Error('file too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 简易 multipart/form-data 解析（单文件，字段名 file） */
function parseMultipart(buf, contentType) {
  const m = /boundary=(.+)$/i.exec(contentType || '');
  if (!m) return [];
  const boundary = '--' + m[1].replace(/^"|"$/g, '');
  const parts = [];
  const text = buf.toString('latin1');
  const blocks = text.split(boundary);
  for (const block of blocks) {
    const idx = block.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    const head = block.slice(0, idx);
    const bodyStart = idx + 4;
    let bodyEnd = block.length;
    if (block.endsWith('\r\n')) bodyEnd -= 2;
    const nameM = /name="([^"]*)"/.exec(head);
    const fnM = /filename="([^"]*)"/.exec(head);
    if (nameM) {
      const raw = block.slice(bodyStart, bodyEnd);
      const body = Buffer.from(raw, 'latin1');
      parts.push({ name: nameM[1], filename: fnM ? fnM[1] : null, body });
    }
  }
  return parts;
}

function parseJson(res, body, cb) {
  if (body === null) { sendJson(res, 400, { error: 'invalid json' }); return false; }
  return true;
}

/** 可信用户身份：网关头优先（本地调试回退 local-user；生产环境无身份返回 null） */
function getUser(req) {
  const uid = req.headers['x-trim-userid'];
  const name = req.headers['x-trim-username'];
  // 生产环境（飞牛网关）必须有可信身份；本地调试（无 TRIM_APPNAME）回退 local-user
  if (!uid && process.env.TRIM_APPNAME) return null;
  return { uid: uid || 'local-user', name: name || uid || 'local-user' };
}

/** 校验当前用户是否有权访问指定账本 */
function canAccessLedger(uid, ledgerId) {
  if (!ledgerId) return false;
  const l = getDb().prepare('SELECT type, owner_uid FROM ledger WHERE id=?').get(ledgerId);
  if (!l) return false;
  if (l.type === 'private') return l.owner_uid === uid;
  const s = getDb().prepare('SELECT 1 FROM ledger_share WHERE ledger_id=? AND (user_id=? OR user_id=\'*\')').get(ledgerId, uid);
  return !!s;
}
function requireLedgerAccess(uid, ledgerId) {
  if (!canAccessLedger(uid, ledgerId)) throw httpError(403, '无权访问该账本');
}

/** 本地日期 YYYY-MM-DD */
function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 本地时间 YYYY-MM-DD HH:mm:ss（含秒，与前端保存格式一致） */
function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- 周期账日期工具 ----
function parseDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
function addMonths(d, n) {
  const nd = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(nd.getFullYear(), nd.getMonth() + 1, 0).getDate();
  nd.setDate(Math.min(d.getDate(), last));
  return nd;
}
/** 计算 from 之后的下一个到期日（频率串 "daily:N" / "weekly:N" / "monthly:N:day" / "yearly:N"） */
function nextDue(p, from) {
  const parts = String(p.frequency).split(':');
  const mode = parts[0];
  const n = Number(parts[1] || 1);
  if (mode === 'daily') return addDays(from, Math.max(1, n));
  if (mode === 'weekly') return addDays(from, 7 * Math.max(1, n));
  if (mode === 'monthly') {
    const day = parts[2] ? Number(parts[2]) : from.getDate();
    const d = addMonths(from, Math.max(1, n));
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day || from.getDate(), last));
    return d;
  }
  if (mode === 'yearly') return addMonths(from, 12 * Math.max(1, n));
  return addDays(from, 1);
}
/** 周期账到期补生成（幂等：从 last_posted_at 之后补到 ≤ 今天） */
function syncPeriodic(db) {
  const todayS = fmtDate(new Date());
  const todayD = parseDate(todayS);
  const rows = db.prepare("SELECT * FROM periodic WHERE status='active' AND (end_date IS NULL OR end_date >= ?)").all(todayS);
  let created = 0;
  for (const p of rows) {
    let cur = p.last_posted_at ? parseDate(p.last_posted_at) : new Date(parseDate(p.start_date).getTime() - 86400000);
    const endD = p.end_date ? parseDate(p.end_date) : null;
    let guard = 0;
    while (guard++ < 1200) {
      const next = nextDue(p, cur);
      if (next > todayD) break;
      if (endD && next > endD) break;
      const eid = genId('en');
      const now = nowIso();
      // 到期日的日期 + 当前时分秒
      const entryTime = nowLocal().slice(10); // ' HH:MM:SS'
      const entryDt = fmtDate(next) + entryTime;
      db.prepare(`INSERT INTO entry (id,ledger_id,account_id,flow_type,amount,category_id,note,counterparty,
        recorded_by,periodic_id,entry_date,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(eid, p.ledger_id, p.account_id, p.flow_type, p.amount, p.category_id,
          p.note || p.name, p.name, 'periodic', p.id, entryDt, now, now);
      cur = next;
      created++;
    }
    if (created) db.prepare('UPDATE periodic SET last_posted_at=? WHERE id=?').run(fmtDate(cur), p.id);
  }
  return created;
}
/** 周期账下次到期日（仅展示用） */
function nextDueDate(p) {
  const todayS = fmtDate(new Date());
  const base = p.last_posted_at ? parseDate(p.last_posted_at) : new Date(parseDate(p.start_date).getTime() - 86400000);
  let cur = base;
  for (let i = 0; i < 1200; i++) {
    const n = nextDue(p, cur);
    if (n >= parseDate(todayS)) return fmtDate(n);
    cur = n;
  }
  return null;
}

function nowIso() { return new Date().toISOString(); }

/** 解析路由参数 {id} */
function paramMatch(pattern, urlPath) {
  const seg = urlPath.split('/');
  const pat = pattern.split('/');
  if (seg.length !== pat.length) return null;
  const out = {};
  for (let i = 0; i < seg.length; i++) {
    if (pat[i].startsWith(':')) out[pat[i].slice(1)] = decodeURIComponent(seg[i]);
    else if (pat[i] !== seg[i]) return null;
  }
  return out;
}

/** 账户余额 = 初始余额 + 流水聚合 */
function accountBalance(stmt, accountId) {
  const rows = stmt.all(accountId);
  let bal = 0;
  for (const r of rows) {
    if (r.flow_type === 'expense') bal -= r.amount;
    else if (r.flow_type === 'income' || r.flow_type === 'refund') bal += r.amount;
    else if (r.flow_type === 'transfer') {
      if (r.account_id === accountId) bal -= r.amount;
      if (r.to_account_id === accountId) bal += r.amount;
    }
  }
  return bal;
}

/** 计算某个（或所有）账户的当前余额 */
function computeBalances() {
  const db = getDb();
  const entries = db.prepare(
    'SELECT account_id, to_account_id, flow_type, amount FROM entry'
  ).all();
  const bal = new Map();
  const add = (id, v) => { if (!id) return; bal.set(id, (bal.get(id) || 0) + v); };
  for (const e of entries) {
    if (e.flow_type === 'expense') add(e.account_id, -e.amount);
    else if (e.flow_type === 'income' || e.flow_type === 'refund') add(e.account_id, e.amount);
    else if (e.flow_type === 'transfer') { add(e.account_id, -e.amount); add(e.to_account_id, e.amount); }
  }
  return bal;
}

/** 成员 self 懒创建：当前用户自动映射成员；用户无账本时自动创建私有日常账本 */
function ensureSelfMember(user) {
  const db = getDb();
  const uid = user.uid || 'local-user';
  let m = db.prepare('SELECT * FROM member WHERE fnos_uid = ?').get(uid);
  if (!m) {
    const id = genId('mem');
    const now = nowIso();
    db.prepare('INSERT INTO member (id,name,relation,fnos_uid,sort,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, user.name || uid, 'self', uid, 0, uid, now);
    m = db.prepare('SELECT * FROM member WHERE id = ?').get(id);
  }
  // 用户无任何可见账本时，自动创建一个私有日常账本
  const has = db.prepare(`
    SELECT COUNT(*) AS n FROM ledger l
    LEFT JOIN ledger_share s ON s.ledger_id=l.id AND (s.user_id=? OR s.user_id='*')
    WHERE (l.type='private' AND l.owner_uid=?) OR (l.type='shared' AND s.user_id IS NOT NULL)
  `).get(uid, uid).n;
  if (has === 0) {
    const id = genId('lg');
    const now = nowIso();
    db.prepare('INSERT INTO ledger (id,name,icon,template,is_default,type,owner_uid,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, '日常账本', 'book-open', 'daily', 1, 'private', uid, now);
    // 设为当前账本
    db.prepare('INSERT OR REPLACE INTO setting (key,value) VALUES (?,?)').run('current_ledger', id);
  }
  return m;
}

// ==================== 业务层 ====================

/** 记一笔（支出/收入/转账） */
function createEntry(user, body) {
  const db = getDb();
  const { ledgerId, accountId, toAccountId, flowType, amount, categoryId, note, counterparty, memberId, entryDate, reimbursable, reimburseTarget } = body;
  if (!ledgerId || !accountId || !flowType || !amount) throw httpError(400, '缺少必填字段');
  requireLedgerAccess(user.uid, ledgerId);
  if (!['expense', 'income', 'transfer'].includes(flowType)) throw httpError(400, '无效流水类型');
  if (!Number.isInteger(amount) || amount <= 0) throw httpError(400, '金额必须为正整数（分）');
  if (flowType === 'transfer' && !toAccountId) throw httpError(400, '转账需指定转入账户');

  const id = genId('en');
  const now = nowIso();
  const date = entryDate || today();
  const selfMember = ensureSelfMember(user);
  db.prepare(`INSERT INTO entry (id,ledger_id,account_id,to_account_id,flow_type,amount,category_id,note,counterparty,
    recorded_by,member_id,reimbursable,reimburse_target,entry_date,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ledgerId, accountId, toAccountId || null, flowType, amount, categoryId || null,
      note || '', counterparty || '自己', user.uid, memberId || selfMember.id,
      flowType === 'expense' && reimbursable ? 1 : 0, flowType === 'expense' ? (reimburseTarget || null) : null,
      date, now, now);
  return getEntryById(id);
}

/** 退款：原支出生成 refund 冲销流水 */
function refundEntry(user, id, body) {
  const db = getDb();
  const orig = db.prepare('SELECT * FROM entry WHERE id = ?').get(id);
  if (!orig) throw httpError(404, '流水不存在');
  requireLedgerAccess(user.uid, orig.ledger_id);
  if (orig.flow_type !== 'expense') throw httpError(400, '只有支出可以退款');

  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0) throw httpError(400, '退款金额必须为正整数（分）');
  const remain = orig.amount - (orig.refunded_amount || 0);
  if (amount > remain) throw httpError(400, `退款金额超过可退余额（剩余 ${remain} 分）`);

  const accountId = body.accountId || orig.account_id;
  const rid = genId('en');
  const now = nowIso();
  db.prepare(`INSERT INTO entry (id,ledger_id,account_id,flow_type,amount,category_id,note,counterparty,
    recorded_by,member_id,refund_status,related_entry_id,entry_date,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rid, orig.ledger_id, accountId, 'refund', amount, orig.category_id, `退款：${orig.note || '原支出'}`,
      orig.counterparty, user.uid, orig.member_id, 'full', id, nowLocal(), now, now);

  const newRefunded = (orig.refunded_amount || 0) + amount;
  const status = newRefunded >= orig.amount ? 'full' : 'partial';
  db.prepare('UPDATE entry SET refunded_amount=?, refund_status=?, updated_at=? WHERE id=?')
    .run(newRefunded, status, now, id);
  return getEntryById(rid);
}

/** 报销回收：应收 → 入账账户转账（不计收入） */
function reimburseEntry(user, id, body) {
  const db = getDb();
  const orig = db.prepare('SELECT * FROM entry WHERE id = ?').get(id);
  if (!orig) throw httpError(404, '流水不存在');
  requireLedgerAccess(user.uid, orig.ledger_id);
  if (!orig.reimbursable) throw httpError(400, '该流水未标记为可报销');

  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0) throw httpError(400, '报销金额必须为正整数（分）');
  const remain = orig.amount - (orig.reimbursed_amount || 0);
  if (amount > remain) throw httpError(400, `报销金额超过剩余可报（剩余 ${remain} 分）`);
  const toAccountId = body.toAccountId;
  if (!toAccountId) throw httpError(400, '请选择入账账户');

  // 生成应收→入账 的转账流水（related 指向原支出）
  const rid = genId('en');
  const now = nowIso();
  db.prepare(`INSERT INTO entry (id,ledger_id,account_id,to_account_id,flow_type,amount,category_id,note,counterparty,
    recorded_by,member_id,reimbursable,reimburse_target,related_entry_id,entry_date,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rid, orig.ledger_id, orig.account_id, toAccountId, 'transfer', amount, orig.category_id,
      `报销回款：${orig.note || '原支出'}`, orig.counterparty, user.uid, orig.member_id, 0, null, id, nowLocal(), now, now);

  const newReimbursed = (orig.reimbursed_amount || 0) + amount;
  const status = newReimbursed >= orig.amount ? 'done' : 'partial';
  db.prepare('UPDATE entry SET reimbursed_amount=?, reimburse_status=?, updated_at=? WHERE id=?')
    .run(newReimbursed, status, now, id);
  return getEntryById(rid);
}

/** 编辑流水：改金额且有关联报销/退款时需确认重置 */
function updateEntry(user, id, body) {
  const db = getDb();
  const orig = db.prepare('SELECT * FROM entry WHERE id = ?').get(id);
  if (!orig) throw httpError(404, '流水不存在');
  requireLedgerAccess(user.uid, orig.ledger_id);

  const fields = [];
  const vals = [];
  const push = (col, v) => { fields.push(`${col}=?`); vals.push(v); };

  if (body.amount !== undefined) {
    if (!Number.isInteger(body.amount) || body.amount <= 0) throw httpError(400, '金额必须为正整数（分）');
    // 有关联（报销/退款）且金额变化 → 需确认
    const hasRelation = (orig.reimbursed_amount > 0) || (orig.refunded_amount > 0) || orig.flow_type === 'refund' || orig.related_entry_id;
    if (hasRelation && body.amount !== orig.amount && !body.resetRelations) {
      throw httpError(409, '修改金额将解除报销/退款关联，请确认后重试（resetRelations=true）');
    }
    if (body.amount !== orig.amount) {
      push('amount', body.amount);
      if (body.resetRelations) {
        push('reimbursed_amount', 0); push('reimburse_status', null);
        push('refunded_amount', 0); push('refund_status', 'none');
        // 解除关联：删除原记录产生的退款/报销流水（连带附件记录与文件）
        const related = db.prepare('SELECT * FROM entry WHERE related_entry_id=?').all(id);
        for (const r of related) {
          const atts = db.prepare('SELECT * FROM attachment WHERE entry_id=?').all(r.id);
          for (const a of atts) {
            try { fs.unlinkSync(a.file_path); } catch (e) { /* 文件可能已不存在 */ }
          }
          db.prepare('DELETE FROM attachment WHERE entry_id=?').run(r.id);
          db.prepare('DELETE FROM entry WHERE id=?').run(r.id);
        }
      }
    }
  }
  if (body.accountId !== undefined) push('account_id', body.accountId);
  if (body.toAccountId !== undefined) push('to_account_id', body.toAccountId || null);
  if (body.categoryId !== undefined) push('category_id', body.categoryId || null);
  if (body.note !== undefined) push('note', body.note);
  if (body.counterparty !== undefined) push('counterparty', body.counterparty);
  if (body.memberId !== undefined) push('member_id', body.memberId || null);
  if (body.entryDate !== undefined) push('entry_date', body.entryDate);
  if (fields.length === 0) return getEntryById(id);

  push('updated_at', nowIso());
  vals.push(id);
  db.prepare(`UPDATE entry SET ${fields.join(',')} WHERE id=?`).run(...vals);
  return getEntryById(id);
}

/** 删除流水（连带退款冲销、附件记录与文件） */
function deleteEntry(user, id) {
  const db = getDb();
  const orig = db.prepare('SELECT * FROM entry WHERE id = ?').get(id);
  if (!orig) throw httpError(404, '流水不存在');
  requireLedgerAccess(user.uid, orig.ledger_id);

  const now = nowIso();
  // 1) 删除关联的退款/报销回款流水（连带附件）
  const related = db.prepare('SELECT * FROM entry WHERE related_entry_id=?').all(id);
  for (const r of related) {
    const atts2 = db.prepare('SELECT * FROM attachment WHERE entry_id=?').all(r.id);
    for (const a of atts2) {
      try { fs.unlinkSync(a.file_path); } catch (e) { /* 文件可能已不存在 */ }
    }
    db.prepare('DELETE FROM attachment WHERE entry_id=?').run(r.id);
    db.prepare('DELETE FROM entry WHERE id=?').run(r.id);
  }
  // 2) 若自己是退款/报销回款流水 → 回退主记录状态
  if (orig.related_entry_id) {
    const parent = db.prepare('SELECT * FROM entry WHERE id=?').get(orig.related_entry_id);
    if (parent) {
      if (orig.flow_type === 'refund') {
        const newAmt = Math.max(0, (parent.refunded_amount || 0) - orig.amount);
        db.prepare('UPDATE entry SET refunded_amount=?, refund_status=?, updated_at=? WHERE id=?')
          .run(newAmt, newAmt >= parent.amount ? 'full' : (newAmt > 0 ? 'partial' : 'none'), now, parent.id);
      } else if (orig.flow_type === 'transfer') {  // 报销回款转账
        const newAmt = Math.max(0, (parent.reimbursed_amount || 0) - orig.amount);
        db.prepare('UPDATE entry SET reimbursed_amount=?, reimburse_status=?, updated_at=? WHERE id=?')
          .run(newAmt, newAmt >= parent.amount ? 'done' : (newAmt > 0 ? 'partial' : 'none'), now, parent.id);
      }
    }
  }
  // 3) 删除附件记录与文件
  const atts = db.prepare('SELECT * FROM attachment WHERE entry_id=?').all(id);
  for (const a of atts) {
    try { fs.unlinkSync(a.file_path); } catch (e) { /* 文件可能已不存在 */ }
  }
  db.prepare('DELETE FROM attachment WHERE entry_id=?').run(id);
  db.prepare('DELETE FROM entry WHERE id=?').run(id);
  return { ok: true };
}

function getEntryById(id) {
  const db = getDb();
  const e = db.prepare('SELECT * FROM entry WHERE id=?').get(id);
  if (!e) return null;
  return decorateEntry(e);
}

/** 将数据库行转成前端字段（snake→camel + 附状态） */
function decorateEntry(e) {
  const atts = getDb().prepare('SELECT id,file_name,file_path,mime,size FROM attachment WHERE entry_id=?').all(e.id)
    .map((a) => ({ id: a.id, fileName: a.file_name, mime: a.mime, size: a.size, url: 'att/' + path.basename(a.file_path) }));
  let cat = e.category_id ? getDb().prepare('SELECT name, icon, parent_id FROM category WHERE id=?').get(e.category_id) : null;
  let parentIcon = null;
  if (cat && cat.parent_id) {
    const parent = getDb().prepare('SELECT icon FROM category WHERE id=?').get(cat.parent_id);
    if (parent) parentIcon = parent.icon;
  }
  const acc = e.account_id ? getDb().prepare('SELECT name FROM account WHERE id=?').get(e.account_id) : null;
  const toAcc = e.to_account_id ? getDb().prepare('SELECT name FROM account WHERE id=?').get(e.to_account_id) : null;
  return {
    id: e.id,
    ledgerId: e.ledger_id,
    accountId: e.account_id,
    accountName: acc?.name || null,
    toAccountId: e.to_account_id,
    toAccountName: toAcc?.name || null,
    flowType: e.flow_type,
    amount: e.amount,
    categoryId: e.category_id,
    categoryName: cat?.name || null,
    categoryIcon: cat?.icon || null,
    categoryParentIcon: parentIcon,
    note: e.note,
    counterparty: e.counterparty,
    recordedBy: e.recorded_by,
    memberId: e.member_id,
    reimbursable: !!e.reimbursable,
    reimburseTarget: e.reimburse_target,
    reimburseStatus: e.reimburse_status,
    reimbursedAmount: e.reimbursed_amount,
    refundStatus: e.refund_status,
    refundedAmount: e.refunded_amount,
    relatedEntryId: e.related_entry_id,
    periodicId: e.periodic_id,
    entryDate: e.entry_date,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    attachments: atts,
  };
}

function httpError(code, msg) {
  const err = new Error(msg);
  err.status = code;
  return err;
}

// ==================== 路由 ====================
function createRouter(user) {
  const db = getDb();
  return {
    // ---- 健康 ----
    'GET /api/health': (_b, _p, req) => {
      const u = getUser(req);
      return { ok: true, app: 'sinong', time: nowIso(), user: u };
    },

    // ---- 账户 ----
    'GET /api/accounts': () => {
      const accs = db.prepare('SELECT * FROM account ORDER BY sort, created_at').all();
      const bals = computeBalances();
      const list = accs.map((a) => ({ ...a, currentBalance: (a.balance || 0) + (bals.get(a.id) || 0) }));
      // 按类型分组统计
      const groups = {};
      for (const a of list) {
        if (!groups[a.type]) groups[a.type] = { type: a.type, count: 0, total: 0, items: [] };
        groups[a.type].count += 1;
        groups[a.type].total += a.currentBalance;
        groups[a.type].items.push(a);
      }
      const netWorth = list.reduce((s, a) => s + a.currentBalance, 0);
      const totalAssets = list.filter((a) => a.currentBalance >= 0).reduce((s, a) => s + a.currentBalance, 0);
      const totalLiabilities = Math.abs(list.filter((a) => a.currentBalance < 0).reduce((s, a) => s + a.currentBalance, 0));
      return { groups: Object.values(groups), netWorth, totalAssets, totalLiabilities };
    },
    'POST /api/accounts': async (body) => {
      const { type, name, balance, note } = body;
      if (!type || !name) throw httpError(400, '类型与名称必填');
      const id = genId('acc');
      const now = nowIso();
      db.prepare('INSERT INTO account (id,type,name,balance,note,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, type, name, Number.isInteger(balance) ? balance : 0, note || null, 0, now, now);
      return db.prepare('SELECT * FROM account WHERE id=?').get(id);
    },
    'GET /api/accounts/:id': (_b, p) => {
      const a = db.prepare('SELECT * FROM account WHERE id=?').get(p.id);
      if (!a) throw httpError(404, '账户不存在');
      const bals = computeBalances();
      const currentBalance = (a.balance || 0) + (bals.get(a.id) || 0);
      // 该账户全部收支统计（不受分页影响）：转入=收入，转出=支出，手动收支同理
      const rows = db.prepare('SELECT flow_type, amount, account_id, to_account_id FROM entry WHERE account_id=? OR to_account_id=?').all(p.id, p.id);
      let income = 0, expense = 0;
      for (const r of rows) {
        if (r.flow_type === 'income' || r.flow_type === 'refund') income += r.amount;
        else if (r.flow_type === 'expense') expense += r.amount;
        else if (r.flow_type === 'transfer') {
          if (r.account_id === p.id) expense += r.amount; // 转出
          else if (r.to_account_id === p.id) income += r.amount; // 转入（含信用卡还款）
        }
      }
      return { ...a, currentBalance, statIncome: income, statExpense: expense };
    },
    'PUT /api/accounts/:id': async (body, p) => {
      const a = db.prepare('SELECT * FROM account WHERE id=?').get(p.id);
      if (!a) throw httpError(404, '账户不存在');
      const fields = []; const vals = [];
      if (body.name !== undefined) { fields.push('name=?'); vals.push(body.name); }
      if (body.note !== undefined) { fields.push('note=?'); vals.push(body.note || null); }
      if (body.type !== undefined) { fields.push('type=?'); vals.push(body.type); }
      if (body.balance !== undefined && Number.isInteger(body.balance)) { fields.push('balance=?'); vals.push(body.balance); }
      if (!fields.length) return db.prepare('SELECT * FROM account WHERE id=?').get(p.id);
      fields.push('updated_at=?'); vals.push(nowIso()); vals.push(p.id);
      db.prepare(`UPDATE account SET ${fields.join(',')} WHERE id=?`).run(...vals);
      return db.prepare('SELECT * FROM account WHERE id=?').get(p.id);
    },
    'DELETE /api/accounts/:id': async (_b, p) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM entry WHERE account_id=? OR to_account_id=?').get(p.id, p.id).n;
      if (n > 0) throw httpError(409, '该账户存在流水，禁止删除');
      db.prepare('DELETE FROM account WHERE id=?').run(p.id);
      return { ok: true };
    },

    // ---- 账本 ----
    'GET /api/ledgers': (_b, _p, req) => {
      const u = getUser(req);
      // 确保默认账本已绑定给当前用户
      ensureSelfMember(u);
      // 可见账本：私人且 owner=自己，或共享且 share 表含自己或 '*'
      const ls = db.prepare(`
        SELECT DISTINCT l.* FROM ledger l
        LEFT JOIN ledger_share s ON s.ledger_id = l.id
        WHERE (l.type = 'private' AND l.owner_uid = ?)
           OR (l.type = 'shared' AND (s.user_id = ? OR s.user_id = '*'))
        ORDER BY l.is_default DESC, l.created_at
      `).all(u.uid, u.uid);
      const cur = db.prepare("SELECT value FROM setting WHERE key='current_ledger'").get();
      const ledgers = ls.map((l) => {
        const n = db.prepare('SELECT COUNT(*) AS n FROM entry WHERE ledger_id=?').get(l.id).n;
        const members = db.prepare('SELECT user_id, perm FROM ledger_share WHERE ledger_id=?').all(l.id);
        return { ...l, entryCount: n, members };
      });
      return { ledgers, currentLedgerId: cur ? cur.value : (ls[0] ? ls[0].id : null) };
    },
    'POST /api/ledgers': async (body, _p, req) => {
      const u = getUser(req);
      const { name, icon, template, type } = body;
      if (!name) throw httpError(400, '账本名称必填');
      const ledgerType = type === 'private' ? 'private' : 'shared';
      const id = genId('lg');
      db.prepare('INSERT INTO ledger (id,name,icon,template,is_default,type,owner_uid,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, name, icon || 'book-open', template || null, 0, ledgerType, u.uid, nowIso());
      if (ledgerType === 'shared') {
        db.prepare('INSERT INTO ledger_share (ledger_id,user_id,perm) VALUES (?,?,?)').run(id, u.uid, 'admin');
      }
      return db.prepare('SELECT * FROM ledger WHERE id=?').get(id);
    },
    'GET /api/ledgers/:id/members': async (_b, p) => {
      const rows = db.prepare('SELECT user_id, perm FROM ledger_share WHERE ledger_id=?').all(p.id);
      return { members: rows };
    },
    'POST /api/ledgers/:id/members': async (body, p) => {
      const { userId, perm } = body;
      if (!userId) throw httpError(400, '用户 ID 必填');
      db.prepare('INSERT OR REPLACE INTO ledger_share (ledger_id,user_id,perm) VALUES (?,?,?)')
        .run(p.id, userId, perm || 'rw');
      return { ok: true };
    },
    'DELETE /api/ledgers/:id/members/:userId': async (_b, p) => {
      db.prepare('DELETE FROM ledger_share WHERE ledger_id=? AND user_id=?').run(p.id, p.userId);
      return { ok: true };
    },
    'PUT /api/ledgers/:id': async (body, p, req) => {
      const l = db.prepare('SELECT * FROM ledger WHERE id=?').get(p.id);
      if (!l) throw httpError(404, '账本不存在');
      const user = getUser(req);
      // 只有 owner 能修改账本类型
      if (body.type !== undefined && l.owner_uid !== user.uid) {
        throw httpError(403, '只有账本所有者能修改类型');
      }
      const fields = []; const vals = [];
      if (body.name !== undefined) { fields.push('name=?'); vals.push(body.name); }
      if (body.icon !== undefined) { fields.push('icon=?'); vals.push(body.icon); }
      if (body.type !== undefined) {
        const newType = body.type === 'shared' ? 'shared' : 'private';
        fields.push('type=?'); vals.push(newType);
      }
      if (!fields.length) return l;
      vals.push(p.id);
      db.prepare(`UPDATE ledger SET ${fields.join(',')} WHERE id=?`).run(...vals);
      // 类型变更时联动处理共享成员
      if (body.type !== undefined) {
        const newType = body.type === 'shared' ? 'shared' : 'private';
        if (newType === 'shared') {
          // 转共享：确保 owner 在共享成员里
          db.prepare('INSERT OR IGNORE INTO ledger_share (ledger_id,user_id,perm) VALUES (?,?,?)')
            .run(p.id, l.owner_uid, 'rw');
        } else {
          // 转私有：清除所有共享成员（owner 仍通过 owner_uid 拥有）
          db.prepare('DELETE FROM ledger_share WHERE ledger_id=?').run(p.id);
        }
      }
      return db.prepare('SELECT * FROM ledger WHERE id=?').get(p.id);
    },
    'DELETE /api/ledgers/:id': async (_b, p) => {
      const l = db.prepare('SELECT * FROM ledger WHERE id=?').get(p.id);
      if (!l) throw httpError(404, '账本不存在');
      if (l.is_default) throw httpError(409, '默认账本禁止删除');
      const n = db.prepare('SELECT COUNT(*) AS n FROM entry WHERE ledger_id=?').get(p.id).n;
      if (n > 0) throw httpError(409, '该账本存在流水，禁止删除');
      db.prepare('DELETE FROM ledger_share WHERE ledger_id=?').run(p.id);
      db.prepare('DELETE FROM ledger WHERE id=?').run(p.id);
      return { ok: true };
    },

    // ---- 预算 ----
    'GET /api/budgets': async (_b, _p, req) => {
      const u = new URL(req.url, 'http://x');
      const user = getUser(req);
      const ledgerId = u.searchParams.get('ledgerId');
      if (ledgerId) requireLedgerAccess(user.uid, ledgerId);
      const month = u.searchParams.get('month'); // YYYY-MM
      const where = ['1=1']; const vals = [];
      if (ledgerId) { where.push('ledger_id=?'); vals.push(ledgerId); }
      if (month) { where.push('month=?'); vals.push(month); }
      const rows = db.prepare(`SELECT * FROM budget WHERE ${where.join(' AND ')} ORDER BY created_at`).all(...vals);
      const items = rows.map((b) => {
        const spent = month
          ? (db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM entry WHERE ledger_id=? AND category_id=? AND flow_type='expense' AND entry_date LIKE ?")
            .get(b.ledger_id, b.category_id, month + '%').s || 0)
          : 0;
        return { ...b, spent };
      });
      return { items };
    },
    'POST /api/budgets': async (body, _p, req) => {
      const user = getUser(req);
      const { ledgerId, categoryId, month, amount } = body;
      if (!ledgerId || !categoryId || !month) throw httpError(400, '账本、分类与月份必填');
      requireLedgerAccess(user.uid, ledgerId);
      if (!Number.isInteger(amount) || amount <= 0) throw httpError(400, '预算金额必须为正整数（分）');
      const exists = db.prepare('SELECT * FROM budget WHERE ledger_id=? AND category_id=? AND month=?').get(ledgerId, categoryId, month);
      if (exists) {
        db.prepare('UPDATE budget SET amount=? WHERE id=?').run(amount, exists.id);
        return db.prepare('SELECT * FROM budget WHERE id=?').get(exists.id);
      }
      const id = genId('bud');
      db.prepare('INSERT INTO budget (id,ledger_id,category_id,month,amount,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, ledgerId, categoryId, month, amount, nowIso());
      return db.prepare('SELECT * FROM budget WHERE id=?').get(id);
    },
    'PUT /api/budgets/:id': async (body, p) => {
      const b = db.prepare('SELECT * FROM budget WHERE id=?').get(p.id);
      if (!b) throw httpError(404, '预算不存在');
      if (body.amount !== undefined) {
        if (!Number.isInteger(body.amount) || body.amount <= 0) throw httpError(400, '预算金额必须为正整数（分）');
        db.prepare('UPDATE budget SET amount=? WHERE id=?').run(body.amount, p.id);
      }
      return db.prepare('SELECT * FROM budget WHERE id=?').get(p.id);
    },
    'DELETE /api/budgets/:id': async (_b, p) => {
      db.prepare('DELETE FROM budget WHERE id=?').run(p.id);
      return { ok: true };
    },
    'GET /api/periodic': async (_b, _p, req) => {
      syncPeriodic(db);
      const u = new URL(req.url, 'http://x');
      const ledgerId = u.searchParams.get('ledgerId');
      const rows = ledgerId
        ? db.prepare('SELECT * FROM periodic WHERE ledger_id=? ORDER BY created_at').all(ledgerId)
        : db.prepare('SELECT * FROM periodic ORDER BY created_at').all();
      return { items: rows.map((p) => ({ ...p, nextDue: nextDueDate(p) })) };
    },
    'POST /api/periodic': async (body) => {
      const { ledgerId, accountId, categoryId, name, amount, flowType, mode, frequency, startDate, endDate, note } = body;
      if (!ledgerId || !accountId || !name) throw httpError(400, '账本、账户与名称必填');
      if (!Number.isInteger(amount) || amount <= 0) throw httpError(400, '金额必须为正整数（分）');
      if (!startDate) throw httpError(400, '开始日期必填');
      const id = genId('per');
      db.prepare(`INSERT INTO periodic (id,ledger_id,account_id,category_id,name,amount,flow_type,mode,frequency,start_date,end_date,note,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, ledgerId, accountId, categoryId || null, name, amount, flowType || 'expense',
          mode || 'monthly', frequency || 'monthly:1', startDate, endDate || null, note || null, nowIso());
      return db.prepare('SELECT * FROM periodic WHERE id=?').get(id);
    },
    'PUT /api/periodic/:id': async (body, p) => {
      const q = db.prepare('SELECT * FROM periodic WHERE id=?').get(p.id);
      if (!q) throw httpError(404, '周期账不存在');
      const fields = []; const vals = [];
      const map = { name: 'name', amount: 'amount', accountId: 'account_id', categoryId: 'category_id',
        flowType: 'flow_type', frequency: 'frequency', startDate: 'start_date', endDate: 'end_date', note: 'note', status: 'status' };
      for (const [k, col] of Object.entries(map)) {
        if (body[k] !== undefined) { fields.push(`${col}=?`); vals.push(body[k] === null ? null : body[k]); }
      }
      if (body.amount !== undefined && !Number.isInteger(body.amount)) throw httpError(400, '金额必须为正整数（分）');
      if (!fields.length) return q;
      vals.push(p.id);
      db.prepare(`UPDATE periodic SET ${fields.join(',')} WHERE id=?`).run(...vals);
      return db.prepare('SELECT * FROM periodic WHERE id=?').get(p.id);
    },
    'DELETE /api/periodic/:id': async (_b, p) => {
      db.prepare('DELETE FROM periodic WHERE id=?').run(p.id);
      return { ok: true };
    },
    'POST /api/periodic/sync': async () => {
      const n = syncPeriodic(db);
      return { ok: true, created: n };
    },

    // ---- 附件 ----
    'POST /api/entries/:id/attachments': async (_b, p, req) => {
      const e = db.prepare('SELECT * FROM entry WHERE id=?').get(p.id);
      if (!e) throw httpError(404, '流水不存在');
      const MAX = 5 * 1024 * 1024;
      const buf = await readRaw(req, MAX);
      const parts = parseMultipart(buf, req.headers['content-type']);
      const file = parts.find((x) => x.name === 'file' && x.filename && x.body.length > 0);
      if (!file) throw httpError(400, '缺少文件字段 file');
      const attDir = path.join(DATA_DIR || '.', 'attachments');
      fs.mkdirSync(attDir, { recursive: true });
      const ext = (path.extname(file.filename) || '.jpg').toLowerCase();
      const id = genId('att');
      const fname = `${id}${ext}`;
      fs.writeFileSync(path.join(attDir, fname), file.body);
      const mime = MIME[ext] || 'image/jpeg';
      db.prepare('INSERT INTO attachment (id,entry_id,file_name,file_path,mime,size,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, p.id, file.filename, path.join(attDir, fname), mime, file.body.length, nowIso());
      return { id, fileName: file.filename, mime, size: file.body.length, url: 'att/' + fname };
    },
    'DELETE /api/attachments/:id': async (_b, p) => {
      const a = db.prepare('SELECT * FROM attachment WHERE id=?').get(p.id);
      if (!a) throw httpError(404, '附件不存在');
      try { fs.unlinkSync(a.file_path); } catch (e) { /* 文件可能已不存在 */ }
      db.prepare('DELETE FROM attachment WHERE id=?').run(p.id);
      return { ok: true };
    },

    // ---- 导入 ----
    'POST /api/import/preview': async (_b, _p, req) => {
      const MAX = 10 * 1024 * 1024;
      const buf = await readRaw(req, MAX);
      const parts = parseMultipart(buf, req.headers['content-type']);
      const file = parts.find((x) => x.name === 'file' && x.filename && x.body.length > 0);
      if (!file) throw httpError(400, '缺少文件字段 file');
      const parsed = parseWorkbook(file.body);
      const token = genId('imp');
      importCache.set(token, parsed);
      setTimeout(() => importCache.delete(token), 5 * 60 * 1000);
      // 返回预览摘要（不含 _parsed 原始数据）
      const { _parsed, ...summary } = parsed;
      return { token, ...summary };
    },
    'POST /api/import': async (body, _p, req) => {
      const { token, ledgerId } = body || {};
      const parsed = importCache.get(token);
      if (!parsed) throw httpError(400, '预览已过期，请重新上传');
      importCache.delete(token);
      const user = getUser(req);
      let lid = ledgerId || (db.prepare('SELECT value FROM setting WHERE key=?').get('current_ledger')?.value) || '';
      // 兜底：没有当前账本时选第一个可见账本
      if (!lid) {
        const first = db.prepare(`SELECT l.id FROM ledger l
          LEFT JOIN ledger_share s ON s.ledger_id=l.id AND (s.user_id=? OR s.user_id='*')
          WHERE (l.type='private' AND l.owner_uid=?) OR (l.type='shared' AND s.user_id IS NOT NULL)
          ORDER BY l.is_default DESC, l.created_at ASC LIMIT 1`).get(user.uid, user.uid);
        if (first) lid = first.id;
      }
      if (!lid) throw httpError(400, '没有可用的账本，请先创建账本');
      const r = doImport(parsed, lid, user.uid);
      return { ok: true, created: r.created, ledgerId: lid };
    },
    // ---- AI 导入格式识别 ----
    'GET /api/ai/config': () => {
      const db = getDb();
      const url = db.prepare("SELECT value FROM setting WHERE key='ai_url'").get()?.value || '';
      const model = db.prepare("SELECT value FROM setting WHERE key='ai_model'").get()?.value || '';
      const key = db.prepare("SELECT value FROM setting WHERE key='ai_key'").get()?.value || '';
      return { url, model, hasKey: !!key, keyMask: key ? maskKey(key) : '' };
    },
    'PUT /api/ai/config': async (body) => {
      const db = getDb();
      const url = String(body.url || '').trim();
      const model = String(body.model || '').trim();
      if (!url || !model) throw httpError(400, 'API 地址与模型名必填');
      db.prepare('INSERT OR REPLACE INTO setting (key,value) VALUES (?,?)').run('ai_url', url);
      db.prepare('INSERT OR REPLACE INTO setting (key,value) VALUES (?,?)').run('ai_model', model);
      if (body.key && String(body.key).trim()) {
        db.prepare('INSERT OR REPLACE INTO setting (key,value) VALUES (?,?)').run('ai_key', String(body.key).trim());
      }
      const key = db.prepare("SELECT value FROM setting WHERE key='ai_key'").get()?.value || '';
      return { ok: true, hasKey: !!key, keyMask: key ? maskKey(key) : '' };
    },
    'POST /api/ai/test': async (body) => {
      const db = getDb();
      const savedUrl = db.prepare("SELECT value FROM setting WHERE key='ai_url'").get()?.value || '';
      const savedModel = db.prepare("SELECT value FROM setting WHERE key='ai_model'").get()?.value || '';
      const savedKey = db.prepare("SELECT value FROM setting WHERE key='ai_key'").get()?.value || '';
      const url = (body && String(body.url || '').trim()) || savedUrl;
      const model = (body && String(body.model || '').trim()) || savedModel;
      const key = (body && String(body.key || '').trim()) || savedKey;
      if (!url || !model) throw httpError(400, '请先填写 API 地址和模型名称');
      let endpoint = url;
      if (!/\/chat\/completions$/.test(endpoint)) endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const t0 = Date.now();
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (key) headers['Authorization'] = `Bearer ${key}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, temperature: 0, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          signal: controller.signal,
        });
        if (res.ok) return { ok: true, message: `连接成功（${Date.now() - t0}ms）`, model };
        const data = await res.json().catch(() => ({}));
        const detail = String(data?.error?.message || data?.message || '').slice(0, 100);
        if (res.status === 401 || res.status === 403) throw httpError(502, `密钥无效或无权限（HTTP ${res.status}）` + (detail ? `：${detail}` : ''));
        if (res.status === 404) throw httpError(502, '地址或模型不存在（HTTP 404）' + (detail ? `：${detail}` : ''));
        if (res.status === 429) throw httpError(502, '请求过于频繁或额度不足（HTTP 429）');
        if ((res.status === 400 || res.status === 422) && /model|not.?found/i.test(detail)) throw httpError(502, '模型不存在或名称错误' + (detail ? `：${detail}` : ''));
        throw httpError(502, `连接失败（HTTP ${res.status}）` + (detail ? `：${detail}` : ''));
      } catch (e) {
        if (e && e.status) throw e;
        if (e && e.name === 'AbortError') throw httpError(504, '连接超时（15 秒），请检查地址或网络');
        throw httpError(502, `地址不通：${e.message}`);
      } finally {
        clearTimeout(timer);
      }
    },
    'POST /api/import/ai-analyze': async (_b, _p, req) => {
      const MAX = 10 * 1024 * 1024;
      const buf = await readRaw(req, MAX);
      const parts = parseMultipart(buf, req.headers['content-type']);
      const file = parts.find((x) => x.name === 'file' && x.filename && x.body.length > 0);
      if (!file) throw httpError(400, '缺少文件字段 file');
      const structure = extractWorkbookStructure(file.body);
      const mapping = await callAi(structure);
      const parsed = parseWorkbook(file.body, mapping);
      const token = genId('imp');
      importCache.set(token, parsed);
      setTimeout(() => importCache.delete(token), 5 * 60 * 1000);
      const { _parsed, ...summary } = parsed;
      return { token, ...summary, ai: mapping };
    },
    'POST /api/ledgers/:id/share': async (body, p) => {
      const userId = body.userId || '*';
      const perm = body.perm || 'rw';
      db.prepare('INSERT OR REPLACE INTO ledger_share (ledger_id,user_id,perm) VALUES (?,?,?)')
        .run(p.id, userId, perm);
      return { ok: true };
    },

    // ---- 分类 ----
    'GET /api/categories': async (_b, _p, req) => {
      const u = new URL(req.url, 'http://x');
      const type = u.searchParams.get('type') || 'expense';
      const rows = db.prepare('SELECT * FROM category WHERE type=? ORDER BY is_default DESC, sort, created_at').all(type);
      const first = rows.filter((r) => !r.parent_id);
      const children = rows.filter((r) => r.parent_id);
      return {
        groups: first.map((g) => ({ ...g, children: children.filter((c) => c.parent_id === g.id) })),
        all: rows,
      };
    },
    'POST /api/categories': async (body) => {
      const { type, parentId, name, icon } = body;
      if (!type || !name) throw httpError(400, '类型与名称必填');
      if (parentId) {
        const p = db.prepare('SELECT * FROM category WHERE id=?').get(parentId);
        if (!p) throw httpError(404, '父分类不存在');
      }
      const id = genId('cat');
      db.prepare('INSERT INTO category (id,type,parent_id,name,icon,is_default,sort,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, type, parentId || null, name, icon || null, 0, 999, nowIso());
      return db.prepare('SELECT * FROM category WHERE id=?').get(id);
    },
    'PUT /api/categories/:id': async (body, p) => {
      const c = db.prepare('SELECT * FROM category WHERE id=?').get(p.id);
      if (!c) throw httpError(404, '分类不存在');
      if (body.name !== undefined && body.name) {
        db.prepare('UPDATE category SET name=? WHERE id=?').run(body.name, p.id);
      }
      if (body.icon !== undefined) {
        db.prepare('UPDATE category SET icon=? WHERE id=?').run(body.icon || null, p.id);
      }
      if (body.is_frequent !== undefined) {
        db.prepare('UPDATE category SET is_frequent=? WHERE id=?').run(body.is_frequent ? 1 : 0, p.id);
      }
      return db.prepare('SELECT * FROM category WHERE id=?').get(p.id);
    },
    'DELETE /api/categories/:id': async (_b, p) => {
      const c = db.prepare('SELECT * FROM category WHERE id=?').get(p.id);
      if (!c) throw httpError(404, '分类不存在');
      if (c.is_default) throw httpError(409, '默认分类禁止删除');
      const used = db.prepare('SELECT COUNT(*) AS n FROM entry WHERE category_id=?').get(p.id).n;
      if (used > 0) throw httpError(409, '该分类已被流水引用，禁止删除');
      db.prepare('DELETE FROM category WHERE id=?').run(p.id);
      return { ok: true };
    },

    // ---- 流水 ----
    'GET /api/entries': async (_b, _p, req) => {
      const u = new URL(req.url, 'http://x');
      const user = getUser(req);
      let ledgerId = u.searchParams.get('ledgerId');
      if (!ledgerId) {
        ledgerId = db.prepare("SELECT value FROM setting WHERE key='current_ledger'").get()?.value;
      }
      if (ledgerId) requireLedgerAccess(user.uid, ledgerId);
      const from = u.searchParams.get('from');
      const to = u.searchParams.get('to');
      const flowType = u.searchParams.get('flowType');
      const categoryId = u.searchParams.get('categoryId');
      const memberId = u.searchParams.get('memberId');
      const accountId = u.searchParams.get('accountId');
      const month = u.searchParams.get('month'); // YYYY-MM，传了则返回该月全量（月历/汇总用）
      const limit = month ? 5000 : Math.min(parseInt(u.searchParams.get('limit') || '500', 10), 5000);
      const offset = parseInt(u.searchParams.get('offset') || '0', 10);
      const where = ['1=1']; const vals = [];
      if (ledgerId) { where.push('ledger_id=?'); vals.push(ledgerId); }
      if (accountId) { where.push('(account_id=? OR to_account_id=?)'); vals.push(accountId, accountId); }
      if (month) { where.push("entry_date LIKE ?"); vals.push(month + '%'); }
      if (from) { where.push('entry_date>=?'); vals.push(from); }
      if (to) { where.push('entry_date<=?'); vals.push(to); }
      if (flowType) { where.push('flow_type=?'); vals.push(flowType); }
      if (categoryId) { where.push('category_id=?'); vals.push(categoryId); }
      if (memberId) { where.push('member_id=?'); vals.push(memberId); }
      const rows = db.prepare(`SELECT * FROM entry WHERE ${where.join(' AND ')} ORDER BY entry_date DESC, created_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM entry WHERE ${where.join(' AND ')}`).get(...vals).n;
      const entries = rows.map(decorateEntry);
      // 汇总（含净支出 = 支出 - 退款）
      let income = 0, expense = 0, refund = 0;
      for (const r of rows) {
        if (r.flow_type === 'income') income += r.amount;
        else if (r.flow_type === 'expense') expense += r.amount;
        else if (r.flow_type === 'refund') refund += r.amount;
      }
      return { entries, total, hasMore: offset + rows.length < total, summary: { income, expense, refund, netExpense: expense - refund } };
    },
    'POST /api/entries': async (body, _p, req) => createEntry(getUser(req), body),
    'GET /api/entries/:id': (_b, p) => {
      const e = getEntryById(p.id);
      if (!e) throw httpError(404, '流水不存在');
      return e;
    },
    'PUT /api/entries/:id': async (body, p, req) => updateEntry(getUser(req), p.id, body),
    'DELETE /api/entries/:id': async (_b, p, req) => deleteEntry(getUser(req), p.id),
    'POST /api/entries/:id/refund': async (body, p, req) => refundEntry(getUser(req), p.id, body),
    'POST /api/entries/:id/reimburse': async (body, p, req) => reimburseEntry(getUser(req), p.id, body),

    // ---- 成员 ----
    'GET /api/users': () => ({ users: getUsers() }),
    'GET /api/members': () => db.prepare('SELECT * FROM member ORDER BY sort, created_at').all(),
    'POST /api/members': async (body, _p, req) => {
      const user = getUser(req);
      const { name, relation } = body;
      if (!name) throw httpError(400, '成员名称必填');
      const id = genId('mem');
      db.prepare('INSERT INTO member (id,name,relation,fnos_uid,sort,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, relation || 'other', null, 999, user.uid, nowIso());
      return db.prepare('SELECT * FROM member WHERE id=?').get(id);
    },
    'PUT /api/members/:id': async (body, p) => {
      const m = db.prepare('SELECT * FROM member WHERE id=?').get(p.id);
      if (!m) throw httpError(404, '成员不存在');
      const fields = []; const vals = [];
      if (body.name !== undefined && body.name) { fields.push('name=?'); vals.push(body.name); }
      if (body.relation !== undefined) { fields.push('relation=?'); vals.push(body.relation); }
      if (!fields.length) return m;
      vals.push(p.id);
      db.prepare(`UPDATE member SET ${fields.join(',')} WHERE id=?`).run(...vals);
      return db.prepare('SELECT * FROM member WHERE id=?').get(p.id);
    },
    'DELETE /api/members/:id': async (_b, p) => {
      const m = db.prepare('SELECT * FROM member WHERE id=?').get(p.id);
      if (!m) throw httpError(404, '成员不存在');
      if (m.relation === 'self') throw httpError(409, '本人成员禁止删除');
      const used = db.prepare('SELECT COUNT(*) AS n FROM entry WHERE member_id=?').get(p.id).n;
      if (used > 0) throw httpError(409, '该成员已有流水引用，禁止删除');
      db.prepare('DELETE FROM member WHERE id=?').run(p.id);
      return { ok: true };
    },

    // ---- 报表 ----
    'GET /api/reports/summary': async (_b, _p, req) => {
      const u = new URL(req.url, 'http://x');
      const ledgerId = u.searchParams.get('ledgerId');
      const month = u.searchParams.get('month'); // YYYY-MM
      const from = u.searchParams.get('from');
      const to = u.searchParams.get('to');
      const where = ['1=1']; const vals = [];
      if (ledgerId) { where.push('ledger_id=?'); vals.push(ledgerId); }
      if (month) { where.push("entry_date LIKE ?"); vals.push(month + '%'); }
      if (from) { where.push('entry_date>=?'); vals.push(from); }
      if (to) { where.push('entry_date<=?'); vals.push(to); }
      const rows = db.prepare(`SELECT * FROM entry WHERE ${where.join(' AND ')}`).all(...vals);
      let income = 0, expense = 0, refund = 0, transfer = 0;
      const catMap = {};
      for (const r of rows) {
        if (r.flow_type === 'income') income += r.amount;
        else if (r.flow_type === 'expense') {
          expense += r.amount;
          const key = r.category_id || 'unknown';
          catMap[key] = (catMap[key] || 0) + r.amount;
        }
        else if (r.flow_type === 'refund') refund += r.amount;
        else if (r.flow_type === 'transfer') transfer += r.amount;
      }
      const netExpense = expense - refund;
      // 分类占比（净支出口径：支出-该分类退款，简化第一版按支出原值）
      const categories = Object.entries(catMap)
        .map(([id, amount]) => ({ categoryId: id, amount }))
        .sort((a, b) => b.amount - a.amount);
      return { income, expense, refund, transfer, netExpense, balance: income - netExpense, categories };
    },
    'GET /api/reports/trend': async (_b, _p, req) => {
      const u = new URL(req.url, 'http://x');
      const ledgerId = u.searchParams.get('ledgerId');
      const months = Math.min(12, Math.max(1, Number(u.searchParams.get('months') || 6)));
      const now = new Date();
      const out = [];
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const rows = ledgerId
          ? db.prepare('SELECT flow_type, amount FROM entry WHERE ledger_id=? AND entry_date LIKE ?').all(ledgerId, key + '%')
          : db.prepare("SELECT flow_type, amount FROM entry WHERE entry_date LIKE ?").all(key + '%');
        let income = 0, expense = 0, refund = 0;
        for (const r of rows) {
          if (r.flow_type === 'income') income += r.amount;
          else if (r.flow_type === 'expense') expense += r.amount;
          else if (r.flow_type === 'refund') refund += r.amount;
        }
        out.push({ month: key, income, expense, netExpense: expense - refund });
      }
      return { items: out };
    },

    // ---- 设置 ----
    'GET /api/settings': (_b, _p, req) => {
      const user = getUser(req);
      // 首次访问时创建 self 成员 + 属于用户的私有日常账本
      ensureSelfMember(user);
      const rows = db.prepare('SELECT key,value FROM setting').all();
      const out = { currentLedgerId: null, hideAmount: false };
      for (const r of rows) {
        if (r.key === 'current_ledger') out.currentLedgerId = r.value;
        else if (r.key === 'hide_amount') out.hideAmount = r.value === '1';
      }
      // 当前账本不可见或为空时，切换到用户可见的第一个账本
      if (!out.currentLedgerId || !canAccessLedger(user.uid, out.currentLedgerId)) {
        const first = db.prepare(`
          SELECT l.id FROM ledger l
          LEFT JOIN ledger_share s ON s.ledger_id=l.id AND (s.user_id=? OR s.user_id='*')
          WHERE (l.type='private' AND l.owner_uid=?) OR (l.type='shared' AND s.user_id IS NOT NULL)
          ORDER BY l.is_default DESC, l.created_at LIMIT 1
        `).get(user.uid, user.uid);
        if (first) {
          out.currentLedgerId = first.id;
          db.prepare('INSERT OR REPLACE INTO setting (key,value) VALUES (?,?)').run('current_ledger', first.id);
        }
      }
      return out;
    },
    'PUT /api/settings': async (body) => {
      const db2 = getDb();
      if (body.currentLedgerId !== undefined)
        db2.prepare('INSERT OR REPLACE INTO setting (key,value) VALUES (?,?)').run('current_ledger', String(body.currentLedgerId));
      if (body.hideAmount !== undefined)
        db2.prepare('INSERT OR REPLACE INTO setting (key,value) VALUES (?,?)').run('hide_amount', body.hideAmount ? '1' : '0');
      return { ok: true };
    },
  };
}

// ==================== 导出 Excel ====================
function exportToExcel(user) {
  const db = getDb();
  const ledgerId = db.prepare("SELECT value FROM setting WHERE key='current_ledger'").get()?.value;
  if (ledgerId) requireLedgerAccess(user.uid, ledgerId);
  const where = ledgerId ? 'WHERE ledger_id=?' : 'WHERE 1=1';
  const vals = ledgerId ? [ledgerId] : [];
  const rows = db.prepare(`SELECT * FROM entry ${where} ORDER BY entry_date ASC, created_at ASC`).all(...vals);

  // 预加载名称映射
  const catMap = new Map();
  for (const c of db.prepare('SELECT id,name,parent_id FROM category').all()) catMap.set(c.id, c);
  const accMap = new Map();
  for (const a of db.prepare('SELECT id,name FROM account').all()) accMap.set(a.id, a.name);
  const memMap = new Map();
  for (const m of db.prepare('SELECT id,name FROM member').all()) memMap.set(m.id, m.name);

  const expenseRows = [['日期', '分类', '子分类', '金额(元)', '账户', '成员', '备注']];
  const incomeRows = [['日期', '分类', '子分类', '金额(元)', '账户', '成员', '备注']];
  const transferRows = [['日期', '转出账户', '转入账户', '金额(元)', '备注']];

  for (const e of rows) {
    const date = e.entry_date || '';
    const amount = (e.amount / 100).toFixed(2);
    const cat = e.category_id ? catMap.get(e.category_id) : null;
    const parentName = cat && cat.parent_id ? catMap.get(cat.parent_id)?.name || '' : '';
    const subName = cat ? (cat.parent_id ? cat.name : '') : '';
    const accName = e.account_id ? accMap.get(e.account_id) || '' : '';
    const toAccName = e.to_account_id ? accMap.get(e.to_account_id) || '' : '';
    const memName = e.member_id ? memMap.get(e.member_id) || '' : '';
    const note = e.note || '';
    if (e.flow_type === 'expense' || e.flow_type === 'refund') {
      expenseRows.push([date, parentName, subName, e.flow_type === 'refund' ? '-' + amount : amount, accName, memName, note]);
    } else if (e.flow_type === 'income') {
      incomeRows.push([date, parentName, subName, amount, accName, memName, note]);
    } else if (e.flow_type === 'transfer') {
      transferRows.push([date, accName, toAccName, amount, note]);
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expenseRows), '支出');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(incomeRows), '收入');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(transferRows), '转账');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ==================== 静态文件 ====================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function serveStatic(res, urlPath) {
  // 附件静态读取：/att/<fname> → <dataDir>/attachments/<fname>
  const attMatch = /^\/att\/([A-Za-z0-9_.-]+)$/.exec(urlPath);
  if (attMatch) {
    const fpath = path.normalize(path.join(path.resolve(DATA_DIR || '.'), 'attachments', attMatch[1]));
    const attRoot = path.resolve(DATA_DIR || '.', 'attachments');
    if (!fpath.startsWith(attRoot)) { res.writeHead(403); res.end('forbidden'); return; }
    const ext = path.extname(fpath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(fpath).pipe(res);
    return;
  }
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(WWW_ROOT, rel));
  // 路径穿越防护：必须仍在 WWW_ROOT 内
  if (!filePath.startsWith(WWW_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ==================== HTTP 服务 ====================
function start() {
  initDb(DATA_DIR);
  const router = createRouter();

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      let p = u.pathname;
      // 剥离网关前缀 /app/sinong
      if (p.startsWith('/app/sinong')) p = p.slice('/app/sinong'.length) || '/';

      // 记录登录用户（用于共享账本成员选择）
      const curUser = getUser(req);
      // 生产环境下 API 请求必须有飞牛登录身份
      if (p.startsWith('/api/') && !curUser) {
        sendJson(res, 401, { error: '未登录，请先登录飞牛' });
        return;
      }
      if (curUser) {
        touchUser(curUser.uid, curUser.name);
        // 确保当前用户在成员列表中（首次访问即创建，不用等记一笔）
        ensureSelfMember(curUser);
      }

      // 导出 Excel（二进制响应，不走 JSON 路由）
      if (p === '/api/export' && req.method === 'GET') {
        const buf = exportToExcel(curUser);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="sinong_export.xlsx"',
          'Cache-Control': 'no-store',
        });
        res.end(buf);
        return;
      }

      if (p.startsWith('/api/')) {
        const method = req.method;
        let matched = null;
        for (const key of Object.keys(router)) {
          const [m, pattern] = key.split(' ');
          if (m !== method) continue;
          const params = paramMatch(pattern, p);
          if (params) { matched = { handler: router[key], params }; break; }
        }
        if (!matched) { sendJson(res, 404, { error: 'api not found' }); return; }
        const isJsonBody = ['POST', 'PUT', 'DELETE'].includes(method) &&
          (req.headers['content-type'] || '').includes('application/json');
        let body = null;
        if (isJsonBody) {
          try { body = await readBody(req); } catch (e) {
            sendJson(res, e.message === 'invalid json' ? 400 : 413, { error: e.message }); return;
          }
        }
        if (body !== null && !parseJson(res, body, null)) return;
        const data = await matched.handler(body, matched.params, req);
        sendJson(res, 200, { ok: true, data });
      } else {
        serveStatic(res, p);
      }
    } catch (e) {
      const code = e.status || 500;
      sendJson(res, code, { ok: false, error: e.message || 'internal error' });
    }
  });

  if (SOCKET_PATH) {
    try { fs.unlinkSync(SOCKET_PATH); } catch (e) { /* 陈旧 socket */ }
    server.listen(SOCKET_PATH, () => {
      console.log(`[sinong] listening on unix socket ${SOCKET_PATH}`);
    });
  } else {
    const port = PORT || 18099;
    // 端口直连模式：监听所有接口（家庭局域网共享），不依赖 fnOS 网关
    server.listen(port, '0.0.0.0', () => {
      console.log(`[sinong] listening on http://0.0.0.0:${port}`);
      console.log(`[sinong] data dir: ${DATA_DIR || '(memory)'}`);
    });
  }
}

start();
