/**
 * Excel 导入解析：支持挖财等多 sheet 格式（支出/收入/转账/借入借出/收款还款）
 * 自动识别 sheet 类型 + 表头映射 + 名称匹配（分类/账户/成员），返回预览数据。
 */
const XLSX = require('xlsx');
const { getDb, genId } = require('./db');

/** 字段别名表：表头名 → 标准字段 */
const FIELD_ALIASES = {
  date: ['消费日期', '收入日期', '转账时间', '借贷时间', '日期', '时间', '记账日期', '消费时间', '日期时间'],
  type: ['类型', '收支类型', '账单类型'],
  categoryParent: ['支出大类', '收入大类', '大类', '一级分类', '分类', '类别'],
  categoryChild: ['支出小类', '小类', '二级分类', '子分类'],
  amount: ['消费金额', '收入金额', '转出金额', '金额', '支出金额', 'price', 'amount'],
  amountIn: ['转入金额'],
  account: ['账户', '支付方式', '账号', '付款账户', '收付账户'],
  accountFrom: ['转出账户', '借贷账户'],
  accountTo: ['转入账户'],
  note: ['备注', '说明', '描述', 'remark', 'note'],
  reimburse: ['报销'],
  memberAmount: ['成员金额', '分摊', '成员'],
  member: ['参与人', '消费人', '操作人'],
  merchant: ['商家', '商户', '付款方'],
  platform: ['消费平台', '平台', '购物平台', '购买渠道'],
  tag: ['标签'],
  loanType: ['借贷类型'],
};

/** sheet 名 → 类型 */
function detectSheetType(name) {
  if (/支出|消费|expense/i.test(name)) return 'expense';
  if (/收入|income|salary/i.test(name)) return 'income';
  if (/转账|transfer/i.test(name)) return 'transfer';
  if (/借入借出|借贷|loan/i.test(name)) return 'loan';
  if (/收款还款|收款|还款|repay/i.test(name)) return 'repay';
  return null;
}

/** 检测单 sheet 新格式：扫描前 15 行找表头（含"日期时间"+"类型"+"类别"+"金额"） */
function findSingleSheetHeader(rows) {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] || [];
    const hasDate = row.some((c) => /日期时间|日期|时间/.test(String(c || '')));
    const hasType = row.some((c) => String(c || '').trim() === '类型');
    const hasCategory = row.some((c) => /类别|分类/.test(String(c || '')));
    const hasAmount = row.some((c) => String(c || '').trim() === '金额');
    if (hasDate && hasType && hasCategory && hasAmount) return i;
  }
  return -1;
}

/** 清理账户名："XX银行信用卡(主卡) 8600" → "XX银行信用卡(主卡)" */
function cleanAccountName(name) {
  if (!name) return name;
  return name.replace(/\s+\d{4}$/, '').trim();
}

/** 解析转账账户字段："XX银行信用卡(主卡) 8600：-11.75，现金：+11.75" → {from, to} */
function parseTransferAccounts(text) {
  if (!text) return { from: '', to: '' };
  const s = String(text).trim();
  const matches = [...s.matchAll(/([^：:，,]+)[：:]\s*([+-]?[\d.]+)/g)];
  if (matches.length >= 2) {
    const first = { name: cleanAccountName(matches[0][1].trim()), amount: parseFloat(matches[0][2]) };
    const second = { name: cleanAccountName(matches[1][1].trim()), amount: parseFloat(matches[1][2]) };
    const from = first.amount <= 0 ? first : second;
    const to = first.amount <= 0 ? second : first;
    return { from: from.name, to: to.name };
  }
  // 降级：用逗号/，分割取前两个
  const parts = s.split(/[，,]/).map((p) => cleanAccountName(p.split(/[：:]/)[0].trim()));
  return { from: parts[0] || '', to: parts[1] || '' };
}

/** 列索引 → 列字母（0 → A） */
function colLetter(n) {
  let s = '';
  n = n + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * 提取 Excel 结构信息（供 AI 分析）：每个 sheet 的名字 + 前 12 行样本。
 * 只取结构样本，不发送全部数据，控制 token 消耗。
 * @param {Buffer} buffer
 */
function extractWorkbookStructure(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return {
      sheet: name,
      rowCount: rows.length,
      rows: rows.slice(0, 12).map((r, i) => ({
        r: i + 1,
        cells: (r || []).map((c, j) => ({ c: colLetter(j), v: String(c).slice(0, 30) })),
      })),
    };
  });
}

/** AI 返回的字段引用 → 列索引（支持 'A'/'C' 列字母 或 表头名） */
function resolveFieldIndexes(rows, headerRow, fields) {
  const header = rows[headerRow] || [];
  const fm = {};
  for (const [field, ref] of Object.entries(fields || {})) {
    if (!ref) continue;
    const s = String(ref).trim();
    if (/^[A-Za-z]{1,3}$/.test(s)) {
      let idx = 0;
      for (const ch of s.toUpperCase()) idx = idx * 26 + (ch.charCodeAt(0) - 64);
      fm[field] = idx - 1;
    } else {
      const idx = header.findIndex((c) => String(c || '').trim() === s || String(c || '').trim().includes(s));
      if (idx >= 0) fm[field] = idx;
    }
  }
  return fm;
}

/** 按 AI 映射解析单个 sheet（type 固定，或每行用类型列区分） */
function parseAiSheet(rows, spec, headerRow, catIdx, accIdx, memIdx, result) {
  const fm = resolveFieldIndexes(rows, headerRow, spec.fields || {});
  const sheetType = spec.type || 'expense';
  const hasTypeCol = fm.type !== undefined;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;

    const entryDate = fm.date !== undefined ? parseDate(row[fm.date]) : null;
    if (!entryDate) continue;
    const rowType = hasTypeCol ? String(row[fm.type] || '').trim() : sheetType;
    const amount = fm.amount !== undefined ? parseAmount(row[fm.amount]) : 0;
    const note = (fm.note !== undefined ? String(row[fm.note] ?? '').trim() : '')
      || (fm.merchant !== undefined ? String(row[fm.merchant] ?? '').trim() : '');
    const categoryFull = (fm.category !== undefined ? String(row[fm.category] ?? '').trim() : '')
      || (fm.categoryChild !== undefined ? String(row[fm.categoryChild] ?? '').trim() : '')
      || (fm.categoryParent !== undefined ? String(row[fm.categoryParent] ?? '').trim() : '');
    const [parent, child] = categoryFull.split('/').map((s) => s.trim());
    const accountRaw = cleanAccountName(fm.account !== undefined ? String(row[fm.account] ?? '').trim() : '');
    const accountFrom = cleanAccountName(fm.accountFrom !== undefined ? String(row[fm.accountFrom] ?? '').trim() : '');
    const accountTo = cleanAccountName(fm.accountTo !== undefined ? String(row[fm.accountTo] ?? '').trim() : '');
    const memberName = parseMember(fm.member !== undefined ? String(row[fm.member] ?? '').trim() : '');
    const reimburse = fm.reimburse !== undefined ? String(row[fm.reimburse] ?? '').trim() : '';
    const platformRaw = fm.platform !== undefined ? String(row[fm.platform] ?? '').trim() : '';

    if (rowType === 'expense' || rowType === '支出' || rowType === '消费') {
      let categoryId = null;
      if (parent && child) {
        const key = `${parent}|${child}`;
        categoryId = catIdx.index[key] || null;
        if (!categoryId) result.newCategories.set(key, 'expense');
      } else if (parent) {
        categoryId = catIdx.parentIndex[parent] || null;
        if (!categoryId) result.newCategories.set(parent, 'expense');
      }
      let accountId = null;
      if (accountRaw) {
        accountId = accIdx[accountRaw] || null;
        if (!accountId) result.newAccounts.add(accountRaw);
      }
      let memberId = null;
      if (memberName) {
        memberId = memIdx[memberName] || null;
        if (!memberId) result.newMembers.add(memberName);
      }
      result.expense.push({
        entryDate, amount, categoryId, categoryName: child || parent || '其他', categoryParent: parent || null,
        accountId, accountName: accountRaw || '现金',
        memberId, memberName: memberName || '',
        reimbursable: reimburse === '可报销' || reimburse === '待报销' || reimburse === '是',
        platform: platformRaw || null,
        note, rowNum: i + 1,
      });
    } else if (rowType === 'income' || rowType === '收入') {
      let categoryId = parent ? catIdx.parentIndex[parent] || null : null;
      if (parent && !categoryId) result.newCategories.set(parent, 'income');
      let accountId = null;
      if (accountRaw) {
        accountId = accIdx[accountRaw] || null;
        if (!accountId) result.newAccounts.add(accountRaw);
      }
      let memberId = null;
      if (memberName) {
        memberId = memIdx[memberName] || null;
        if (!memberId) result.newMembers.add(memberName);
      }
      result.income.push({
        entryDate, amount, categoryId, categoryName: parent || '其他收入',
        accountId, accountName: accountRaw || '现金',
        memberId, memberName: memberName || '',
        platform: platformRaw || null,
        note, rowNum: i + 1,
      });
    } else if (rowType === 'transfer' || rowType === '转账') {
      let from = accountFrom || '';
      let to = accountTo || '';
      if (!from && !to && accountRaw) {
        const parsed = parseTransferAccounts(accountRaw);
        from = parsed.from;
        to = parsed.to;
      }
      let fromId = null, toId = null;
      if (from) {
        fromId = accIdx[from] || null;
        if (!fromId) result.newAccounts.add(from);
      }
      if (to) {
        toId = accIdx[to] || null;
        if (!toId) result.newAccounts.add(to);
      }
      result.transfer.push({
        entryDate, amount, fromAccountId: fromId, fromAccountName: from || '',
        toAccountId: toId, toAccountName: to || '',
        platform: platformRaw || null,
        note, rowNum: i + 1,
      });
    } else if (rowType === 'loan' || rowType === '借贷' || rowType === 'repay' || rowType === '收款还款' || rowType === '借入借出') {
      const LOAN_ACC = '借入借出';
      if (!accIdx[LOAN_ACC]) result.newAccounts.add(LOAN_ACC);
      const isOutflow = /借出|还款|付出|贷出/.test(categoryFull || rowType);
      let accountId = null;
      if (accountRaw) {
        accountId = accIdx[accountRaw] || null;
        if (!accountId) result.newAccounts.add(accountRaw);
      }
      result.transfer.push({
        entryDate, amount,
        fromAccountId: isOutflow ? accountId : null,
        fromAccountName: isOutflow ? (accountRaw || '现金') : LOAN_ACC,
        toAccountId: isOutflow ? null : accountId,
        toAccountName: isOutflow ? LOAN_ACC : (accountRaw || '现金'),
        platform: platformRaw || null,
        note: `[${categoryFull || '借贷'}] ${note}`.trim(),
        rowNum: i + 1,
      });
    }
  }
}

/** 解析单 sheet 新格式 */
function parseSingleSheet(rows, headerRow, catIdx, accIdx, memIdx, result) {
  const headerMap = mapHeader(rows[headerRow]);
  // 确保默认"现金"账户存在（Excel 账户为空时默认用现金）
  if (!accIdx['现金']) result.newAccounts.add('现金');
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;

    const entryDate = parseDate(getVal(row, headerMap, 'date'));
    if (!entryDate) continue;

    const flowType = String(getVal(row, headerMap, 'loanType') || getVal(row, headerMap, 'type') || '').trim();
    const categoryFull = getVal(row, headerMap, 'categoryParent') || getVal(row, headerMap, 'categoryChild') || '';
    const [parent, child] = categoryFull.split('/').map((s) => s.trim());
    const amount = parseAmount(getVal(row, headerMap, 'amount'));
    const accountRaw = cleanAccountName(getVal(row, headerMap, 'account') || '');
    const memberRaw = getVal(row, headerMap, 'memberAmount') || getVal(row, headerMap, 'member') || '';
    const memberName = parseMember(memberRaw);
    const note = getVal(row, headerMap, 'note') || '';
    const platformRaw = getVal(row, headerMap, 'platform') || '';

    if (flowType === '支出' || flowType === 'expense') {
      let categoryId = null;
      if (parent && child) {
        const key = `${parent}|${child}`;
        categoryId = catIdx.index[key] || null;
        if (!categoryId) result.newCategories.set(key, 'expense');
      } else if (parent) {
        categoryId = catIdx.parentIndex[parent] || null;
        if (!categoryId) result.newCategories.set(parent, 'expense');
      }
      let accountId = null;
      if (accountRaw) {
        accountId = accIdx[accountRaw] || null;
        if (!accountId) result.newAccounts.add(accountRaw);
      }
      let memberId = null;
      if (memberName) {
        memberId = memIdx[memberName] || null;
        if (!memberId) result.newMembers.add(memberName);
      }
      result.expense.push({
        entryDate, amount, categoryId, categoryName: child || parent || '其他', categoryParent: parent || null,
        accountId, accountName: accountRaw || '现金',
        memberId, memberName: memberName || '',
        reimbursable: false, platform: platformRaw || null, note, rowNum: i + 1,
      });
    } else if (flowType === '收入' || flowType === 'income') {
      let categoryId = parent ? catIdx.parentIndex[parent] || null : null;
      if (parent && !categoryId) result.newCategories.set(parent, 'income');
      let accountId = null;
      if (accountRaw) {
        accountId = accIdx[accountRaw] || null;
        if (!accountId) result.newAccounts.add(accountRaw);
      }
      let memberId = null;
      if (memberName) {
        memberId = memIdx[memberName] || null;
        if (!memberId) result.newMembers.add(memberName);
      }
      result.income.push({
        entryDate, amount, categoryId, categoryName: parent || '其他收入',
        accountId, accountName: accountRaw || '现金',
        memberId, memberName: memberName || '',
        platform: platformRaw || null, note, rowNum: i + 1,
      });
    } else if (flowType === '转账' || flowType === 'transfer') {
      const { from, to } = parseTransferAccounts(accountRaw);
      let fromId = null, toId = null;
      if (from) {
        fromId = accIdx[from] || null;
        if (!fromId) result.newAccounts.add(from);
      }
      if (to) {
        toId = accIdx[to] || null;
        if (!toId) result.newAccounts.add(to);
      }
      result.transfer.push({
        entryDate, amount, fromAccountId: fromId, fromAccountName: from || '',
        toAccountId: toId, toAccountName: to || '',
        platform: platformRaw || null, note, rowNum: i + 1,
      });
    } else if (flowType === '借贷' || flowType === 'loan') {
      // 借出/还款：普通账户 → 借入借出；借入/收款：借入借出 → 普通账户
      const LOAN_ACC = '借入借出';
      if (!accIdx[LOAN_ACC]) result.newAccounts.add(LOAN_ACC);
      const isOutflow = /借出|还款|付出|贷出/.test(categoryFull);
      const accName = cleanAccountName(accountRaw);
      let accountId = null;
      if (accName) {
        accountId = accIdx[accName] || null;
        if (!accountId) result.newAccounts.add(accName);
      }
      result.transfer.push({
        entryDate, amount,
        fromAccountId: isOutflow ? accountId : null,
        fromAccountName: isOutflow ? (accName || '现金') : LOAN_ACC,
        toAccountId: isOutflow ? null : accountId,
        toAccountName: isOutflow ? LOAN_ACC : (accName || '现金'),
        platform: platformRaw || null,
        note: `[${categoryFull || '借贷'}] ${note}`.trim(),
        rowNum: i + 1,
      });
    }
  }
}

/** 表头行 → 字段映射 {标准字段: 列索引} */
function mapHeader(row) {
  const map = {};
  row.forEach((cell, idx) => {
    const val = String(cell || '').trim();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((a) => val === a || val.includes(a))) {
        if (!map[field]) map[field] = idx;
      }
    }
  });
  return map;
}

/** 从行中取字段值 */
function getVal(row, map, field) {
  const idx = map[field];
  if (idx === undefined) return null;
  const v = row[idx];
  return v === undefined || v === null ? null : String(v).trim();
}

/** 解析金额（元 → 分） */
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  // 系统约定 amount 恒为正整数（分），收支方向由 flow_type 决定；负数统一取绝对值
  return Number.isFinite(n) ? Math.abs(Math.round(n * 100)) : 0;
}

/** 解析日期为 YYYY-MM-DD HH:mm:ss */
function parseDate(v) {
  if (!v) return null;
  // Excel 序列号
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')} ${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}:${String(d.S).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  // 2012-04-03 09:38:27 或 2012/04/03
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')} ${m[4]?.padStart(2, '0') || '00'}:${m[5]?.padStart(2, '0') || '00'}:${m[6]?.padStart(2, '0') || '00'}`;
  }
  return null;
}

/** 从成员字段解析成员名："成员A：39.00" → "成员A"，"成员A：7.75，成员B：7.75" → "成员A"，"自己" → "自己" */
function parseMember(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^([^：:，,]+)[：:]/);
  if (m) return m[1].trim();
  return s;
}

/** 查所有分类名（大类+小类），返回 {parentName: {childName: id}} */
function buildCategoryIndex() {
  const db = getDb();
  const cats = db.prepare('SELECT id, name, parent_id FROM category').all();
  const byId = {};
  cats.forEach((c) => { byId[c.id] = c; });
  const index = {}; // "大类|小类" → id
  cats.forEach((c) => {
    if (c.parent_id) {
      const parent = byId[c.parent_id];
      if (parent) index[`${parent.name}|${c.name}`] = c.id;
    }
  });
  // 大类名 → 第一个小类 id（收入只有大类时用）
  const parentIndex = {};
  cats.forEach((c) => {
    if (!c.parent_id) {
      const firstChild = cats.find((x) => x.parent_id === c.id);
      if (firstChild) parentIndex[c.name] = firstChild.id;
    }
  });
  return { index, parentIndex };
}

/** 查账户名 → id */
function buildAccountIndex() {
  const db = getDb();
  const rows = db.prepare('SELECT id, name FROM account').all();
  const idx = {};
  rows.forEach((r) => { idx[r.name] = r.id; });
  return idx;
}

/** 查成员名 → id */
function buildMemberIndex() {
  const db = getDb();
  const rows = db.prepare('SELECT id, name FROM member').all();
  const idx = {};
  rows.forEach((r) => { idx[r.name] = r.id; });
  return idx;
}

/**
 * 解析 Excel buffer，返回预览数据
 * @param {Buffer} buffer
 * @param {object|null} aiMapping 可选的 AI 识别结果：{ sheets: [{ sheet, type, headerRow, fields }] }
 *   - 提供时跳过规则检测，直接按 AI 映射解析每个 sheet
 *   - 不提供时使用现有规则（sheet 名 + 表头别名自动识别）
 */
function parseWorkbook(buffer, aiMapping) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const catIdx = buildCategoryIndex();
  const accIdx = buildAccountIndex();
  const memIdx = buildMemberIndex();

  const result = {
    expense: [], income: [], transfer: [],
    newCategories: new Map(), newAccounts: new Set(), newMembers: new Set(),
    warnings: [],
  };

  // ---- AI 映射模式 ----
  if (aiMapping && Array.isArray(aiMapping.sheets)) {
    for (const spec of aiMapping.sheets) {
      if (!spec || spec.type === 'skip' || spec.type === '其他') continue;
      const ws = wb.Sheets[spec.sheet];
      if (!ws) {
        result.warnings.push(`AI 映射指定的 sheet「${spec.sheet}」不存在，已跳过`);
        continue;
      }
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const headerRow = Math.max(0, (Number(spec.headerRow) || 1) - 1);
      if (headerRow >= rows.length) {
        result.warnings.push(`Sheet「${spec.sheet}」表头行 ${spec.headerRow} 超出范围，已跳过`);
        continue;
      }
      parseAiSheet(rows, spec, headerRow, catIdx, accIdx, memIdx, result);
    }
    return buildSummary(result);
  }

  // ---- 规则模式 ----
  for (const sheetName of wb.SheetNames) {
    const type = detectSheetType(sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) continue;

    // 新格式：单 sheet，表头不在第1行，用"类型"列区分收支
    const headerRow = findSingleSheetHeader(rows);
    if (headerRow >= 0) {
      parseSingleSheet(rows, headerRow, catIdx, accIdx, memIdx, result);
      continue;
    }

    if (!type) continue;

    const headerMap = mapHeader(rows[0]);
    if (headerMap.date === undefined || (headerMap.amount === undefined && type !== 'transfer')) {
      result.warnings.push(`Sheet「${sheetName}」未识别到日期或金额字段，已跳过`);
      continue;
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;

      const entryDate = parseDate(getVal(row, headerMap, 'date'));
      if (!entryDate) continue;
      const note = getVal(row, headerMap, 'note') || '';

      if (type === 'expense') {
        const parent = getVal(row, headerMap, 'categoryParent');
        const child = getVal(row, headerMap, 'categoryChild');
        const amount = parseAmount(getVal(row, headerMap, 'amount'));
        const accName = getVal(row, headerMap, 'account');
        const reimburse = getVal(row, headerMap, 'reimburse');
        const memberName = parseMember(getVal(row, headerMap, 'memberAmount'));
        const platformRaw = getVal(row, headerMap, 'platform') || '';

        let categoryId = null;
        if (parent && child) {
          const key = `${parent}|${child}`;
          categoryId = catIdx.index[key] || null;
          if (!categoryId) result.newCategories.set(key, 'expense');
        } else if (parent) {
          categoryId = catIdx.parentIndex[parent] || null;
          if (!categoryId) result.newCategories.set(parent, 'expense');
        }

        let accountId = null;
        if (accName) {
          accountId = accIdx[accName] || null;
          if (!accountId) result.newAccounts.add(accName);
        }

        let memberId = null;
        if (memberName) {
          memberId = memIdx[memberName] || null;
          if (!memberId) result.newMembers.add(memberName);
        }

        result.expense.push({
          entryDate, amount, categoryId, categoryName: child || parent || '其他', categoryParent: parent || null,
          accountId, accountName: accName || '现金',
          memberId, memberName: memberName || '',
          reimbursable: reimburse === '可报销' || reimburse === '待报销',
          platform: platformRaw || null,
          note, rowNum: i + 1,
        });
      } else if (type === 'income') {
        const parent = getVal(row, headerMap, 'categoryParent');
        const amount = parseAmount(getVal(row, headerMap, 'amount'));
        const accName = getVal(row, headerMap, 'account');
        const memberName = parseMember(getVal(row, headerMap, 'memberAmount'));
        const platformRaw = getVal(row, headerMap, 'platform') || '';

        let categoryId = parent ? catIdx.parentIndex[parent] || null : null;
        if (parent && !categoryId) result.newCategories.set(parent, 'income');

        let accountId = null;
        if (accName) {
          accountId = accIdx[accName] || null;
          if (!accountId) result.newAccounts.add(accName);
        }

        let memberId = null;
        if (memberName) {
          memberId = memIdx[memberName] || null;
          if (!memberId) result.newMembers.add(memberName);
        }

        result.income.push({
          entryDate, amount, categoryId, categoryName: parent || '其他收入',
          accountId, accountName: accName || '现金',
          memberId, memberName: memberName || '',
          platform: platformRaw || null,
          note, rowNum: i + 1,
        });
      } else if (type === 'transfer') {
        const fromName = getVal(row, headerMap, 'accountFrom') || getVal(row, headerMap, 'account');
        const toName = getVal(row, headerMap, 'accountTo');
        const amount = parseAmount(getVal(row, headerMap, 'amount'));
        const platformRaw = getVal(row, headerMap, 'platform') || '';

        let fromId = null, toId = null;
        if (fromName) {
          fromId = accIdx[fromName] || null;
          if (!fromId) result.newAccounts.add(fromName);
        }
        if (toName) {
          toId = accIdx[toName] || null;
          if (!toId) result.newAccounts.add(toName);
        }

        result.transfer.push({
          entryDate, amount, fromAccountId: fromId, fromAccountName: fromName || '',
          toAccountId: toId, toAccountName: toName || '',
          platform: platformRaw || null,
          note, rowNum: i + 1,
        });
      } else if (type === 'loan' || type === 'repay') {
        // 借入借出/收款还款 → 转账（普通账户 ⇄ 借入借出账户）
        const loanType = getVal(row, headerMap, 'loanType') || '';
        const accName = getVal(row, headerMap, 'account');
        const amount = parseAmount(getVal(row, headerMap, 'amount'));
        const platformRaw = getVal(row, headerMap, 'platform') || '';
        const LOAN_ACC = '借入借出';

        let accountId = null;
        if (accName) {
          accountId = accIdx[accName] || null;
          if (!accountId) result.newAccounts.add(accName);
        }
        if (!accIdx[LOAN_ACC]) result.newAccounts.add(LOAN_ACC);

        // 借出/还款(付出)：普通账户 → 借入借出
        // 借入/收款：借入借出 → 普通账户
        const isOutflow = /借出|还款|付出|贷出/.test(loanType);
        result.transfer.push({
          entryDate, amount,
          fromAccountId: isOutflow ? accountId : null,
          fromAccountName: isOutflow ? (accName || '现金') : LOAN_ACC,
          toAccountId: isOutflow ? null : accountId,
          toAccountName: isOutflow ? LOAN_ACC : (accName || '现金'),
          platform: platformRaw || null,
          note: `[${loanType || '借贷'}] ${note}`.trim(),
          rowNum: i + 1,
        });
      }
    }
  }

  return buildSummary(result);
}

/** 把解析明细汇总为预览摘要 */
function buildSummary(result) {
  return {
    expenseCount: result.expense.length,
    incomeCount: result.income.length,
    transferCount: result.transfer.length,
    total: result.expense.length + result.income.length + result.transfer.length,
    newCategories: [...result.newCategories.keys()],
    newAccounts: [...result.newAccounts],
    newMembers: [...result.newMembers],
    warnings: result.warnings,
    _parsed: result, // 暂存，确认导入时用
  };
}

/**
 * 执行导入：自动创建缺失的分类/账户/成员，然后写入记录
 * @param {object} parsed parseWorkbook 返回的对象（含 _parsed）
 * @param {string} ledgerId 当前账本 ID
 * @param {string} userUid 当前用户 UID
 */
function doImport(parsed, ledgerId, userUid) {
  const db = getDb();
  const now = new Date().toISOString();
  const p = parsed._parsed;
  let created = 0;

  db.exec('BEGIN');
  try {

  // 自动创建缺失账户
  const accIdx = buildAccountIndex();
  // 确保默认"现金"账户存在（导入记录账户为空时默认用现金）
  if (!accIdx['现金']) {
    const id = genId('acc');
    db.prepare('INSERT INTO account (id,type,name,balance,note,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, 'cash', '现金', 0, null, 0, now, now);
    accIdx['现金'] = id;
  }
  for (const name of parsed.newAccounts) {
    if (!accIdx[name]) {
      const id = genId('acc');
      const type = name === '借入借出' ? 'receivable' : 'cash';
      db.prepare('INSERT INTO account (id,type,name,balance,note,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, type, name, 0, null, 999, now, now);
      accIdx[name] = id;
    }
  }

  // 自动创建缺失成员
  const memIdx = buildMemberIndex();
  for (const name of parsed.newMembers) {
    if (!memIdx[name]) {
      const id = genId('mem');
      db.prepare('INSERT INTO member (id,name,relation,fnos_uid,sort,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, 'other', null, 999, userUid, now);
      memIdx[name] = id;
    }
  }

  // 自动创建缺失分类（支出：大类+小类；收入：大类→创建大类+默认小类）
  const catIdx = buildCategoryIndex();
  const allCats = db.prepare('SELECT id, name, parent_id FROM category').all();
  const byId = {};
  allCats.forEach((c) => { byId[c.id] = c; });
  const parentByName = {};
  allCats.forEach((c) => { if (!c.parent_id) parentByName[c.name] = c.id; });

  const catMap = parsed._parsed.newCategories; // Map<key, type>
  for (const [key, catType] of catMap.entries()) {
    if (key.includes('|')) {
      const [pName, cName] = key.split('|');
      let parentId = parentByName[pName];
      if (!parentId) {
        parentId = genId('cat');
        db.prepare('INSERT INTO category (id,type,parent_id,name,icon,is_default,sort,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(parentId, catType, null, pName, 'more-horizontal', 0, 999, now);
        parentByName[pName] = parentId;
      }
      const childId = genId('cat');
      db.prepare('INSERT INTO category (id,type,parent_id,name,icon,is_default,sort,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(childId, catType, parentId, cName, 'more-horizontal', 0, 999, now);
      catIdx.index[key] = childId;
    } else {
      // 收入大类：创建大类+默认小类
      if (!parentByName[key]) {
        const parentId = genId('cat');
        db.prepare('INSERT INTO category (id,type,parent_id,name,icon,is_default,sort,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(parentId, catType, null, key, 'more-horizontal', 0, 999, now);
        parentByName[key] = parentId;
        const childId = genId('cat');
        db.prepare('INSERT INTO category (id,type,parent_id,name,icon,is_default,sort,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(childId, catType, parentId, key, 'more-horizontal', 0, 999, now);
        catIdx.parentIndex[key] = childId;
      }
    }
  }

  // 写入支出
  const insertEntry = db.prepare(`INSERT INTO entry
    (id,ledger_id,flow_type,amount,category_id,account_id,member_id,platform,entry_date,note,reimbursable,recorded_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  for (const e of p.expense) {
    const accountId = e.accountId || accIdx[e.accountName];
    if (!accountId) continue;
    let categoryId = e.categoryId;
    if (!categoryId && e.categoryParent && e.categoryName) {
      categoryId = catIdx.index[`${e.categoryParent}|${e.categoryName}`] || catIdx.parentIndex[e.categoryParent] || null;
    }
    if (!categoryId && e.categoryName) categoryId = catIdx.parentIndex[e.categoryName] || null;
    const memberId = e.memberId || (e.memberName && memIdx[e.memberName]) || null;
    insertEntry.run(genId('ent'), ledgerId, 'expense', e.amount, categoryId, accountId, memberId,
      e.platform || null, e.entryDate, e.note, e.reimbursable ? 1 : 0, userUid, now, now);
    created++;
  }

  // 写入收入
  for (const e of p.income) {
    const accountId = e.accountId || accIdx[e.accountName];
    if (!accountId) continue;
    const categoryId = e.categoryId || (e.categoryName && catIdx.parentIndex[e.categoryName]) || null;
    const memberId = e.memberId || (e.memberName && memIdx[e.memberName]) || null;
    insertEntry.run(genId('ent'), ledgerId, 'income', e.amount, categoryId, accountId, memberId,
      e.platform || null, e.entryDate, e.note, 0, userUid, now, now);
    created++;
  }

  // 写入转账
  const insertTransfer = db.prepare(`INSERT INTO entry
    (id,ledger_id,flow_type,amount,account_id,to_account_id,platform,entry_date,note,recorded_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

  for (const t of p.transfer) {
    const fromId = t.fromAccountId || accIdx[t.fromAccountName];
    const toId = t.toAccountId || accIdx[t.toAccountName];
    if (!fromId || !toId || fromId === toId) continue;
    insertTransfer.run(genId('ent'), ledgerId, 'transfer', t.amount, fromId, toId,
      t.platform || null, t.entryDate, t.note, userUid, now, now);
    created++;
  }

  db.exec('COMMIT');
  return { created };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { parseWorkbook, doImport, extractWorkbookStructure };
