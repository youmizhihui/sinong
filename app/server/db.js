'use strict';
/**
 * db.js — 司农记账 SQLite 数据层
 * 使用 Node 内置 node:sqlite（零 npm 依赖）。
 * 金额统一以「分」为单位的整数存储。
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

let db = null;

/** 生成 id：前缀 + 时间戳 + 随机串 */
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** 默认分类种子（§5.2：支出 9 大类 / 收入 6 类，二级结构） */
const DEFAULT_CATEGORIES = {
  expense: [
    { id: 'cat_exp_food', name: '餐饮', icon: 'utensils', children: [
      ['cat_exp_food_breakfast', '早餐', 'coffee'], ['cat_exp_food_lunch', '午餐', 'utensils'], ['cat_exp_food_dinner', '晚餐', 'utensils-crossed'],
      ['cat_exp_food_drink', '饮料水果', 'cup-soda'], ['cat_exp_food_snack', '零食', 'cookie'], ['cat_exp_food_tobacco', '烟酒', 'wine'],
      ['cat_exp_food_takeout', '外卖', 'shopping-bag'], ['cat_exp_food_grocery', '买菜原料', 'carrot'], ['cat_exp_food_other', '其他餐饮', 'utensils'] ] },
    { id: 'cat_exp_transport', name: '交通', icon: 'bus', children: [
      ['cat_exp_transport_bus', '公交地铁', 'bus'], ['cat_exp_transport_taxi', '打车', 'car'], ['cat_exp_transport_gas', '加油', 'fuel'],
      ['cat_exp_transport_park', '停车', 'parking-circle'], ['cat_exp_transport_toll', '过路费', 'signpost'], ['cat_exp_transport_repair', '维修保养', 'wrench'],
      ['cat_exp_transport_other', '其他交通', 'bus'] ] },
    { id: 'cat_exp_shopping', name: '购物', icon: 'shopping-bag', children: [
      ['cat_exp_shopping_clothes', '服饰鞋包', 'shirt'], ['cat_exp_shopping_cosmetics', '化妆品', 'spray-can'],
      ['cat_exp_shopping_daily', '日用品', 'package'], ['cat_exp_shopping_digital', '电子产品', 'smartphone'],
      ['cat_exp_shopping_home', '家居百货', 'sofa'], ['cat_exp_shopping_baby', '宝宝用品', 'baby'],
      ['cat_exp_shopping_other', '其他购物', 'shopping-bag'] ] },
    { id: 'cat_exp_housing', name: '居住', icon: 'home', children: [
      ['cat_exp_housing_rent', '房租', 'building-2'], ['cat_exp_housing_mortgage', '房贷', 'landmark'], ['cat_exp_housing_water', '水费', 'droplets'],
      ['cat_exp_housing_electric', '电费', 'zap'], ['cat_exp_housing_gas', '燃气费', 'flame'], ['cat_exp_housing_property', '物业费', 'building'],
      ['cat_exp_housing_network', '网络', 'wifi'], ['cat_exp_housing_phone', '话费', 'phone'], ['cat_exp_housing_other', '其他居住', 'home'] ] },
    { id: 'cat_exp_entertainment', name: '娱乐', icon: 'film', children: [
      ['cat_exp_entertainment_movie', '电影演出', 'film'], ['cat_exp_entertainment_game', '游戏', 'gamepad-2'],
      ['cat_exp_entertainment_travel', '旅游', 'plane'], ['cat_exp_entertainment_fitness', '运动健身', 'dumbbell'],
      ['cat_exp_entertainment_other', '其他娱乐', 'film'] ] },
    { id: 'cat_exp_medical', name: '医疗', icon: 'cross', children: [
      ['cat_exp_medical_drug', '药品', 'pill'], ['cat_exp_medical_clinic', '门诊', 'stethoscope'], ['cat_exp_medical_hospital', '住院', 'hospital'],
      ['cat_exp_medical_checkup', '体检', 'activity'], ['cat_exp_medical_other', '其他医疗', 'cross'] ] },
    { id: 'cat_exp_education', name: '教育', icon: 'graduation-cap', children: [
      ['cat_exp_education_tuition', '学费', 'graduation-cap'], ['cat_exp_education_training', '培训', 'presentation'],
      ['cat_exp_education_books', '书籍', 'book-open'], ['cat_exp_education_other', '其他教育', 'graduation-cap'] ] },
    { id: 'cat_exp_human', name: '人情', icon: 'gift', children: [
      ['cat_exp_human_gift', '随礼', 'gift'], ['cat_exp_human_redpacket', '红包', 'gift'],
      ['cat_exp_human_filial', '孝敬', 'heart-handshake'], ['cat_exp_human_other', '其他人情', 'gift'] ] },
    { id: 'cat_exp_other', name: '其他', icon: 'more-horizontal', children: [
      ['cat_exp_other_express', '快递', 'package'], ['cat_exp_other_pet', '宠物', 'paw-print'],
      ['cat_exp_other_repair', '维修', 'wrench'], ['cat_exp_other_misc', '其他支出', 'more-horizontal'] ] },
  ],
  income: [
    { id: 'cat_inc_salary', name: '工资', icon: 'wallet', children: [
      ['cat_inc_salary_monthly', '月薪', 'wallet'], ['cat_inc_salary_bonus', '年终奖', 'trophy'] ] },
    { id: 'cat_inc_bonus', name: '奖金', icon: 'trophy', children: [['cat_inc_bonus_other', '其他奖金', 'trophy']] },
    { id: 'cat_inc_invest', name: '理财', icon: 'trending-up', children: [
      ['cat_inc_invest_interest', '利息', 'percent'], ['cat_inc_invest_fund', '基金', 'trending-up'], ['cat_inc_invest_stock', '股票', 'candlestick-chart'] ] },
    { id: 'cat_inc_parttime', name: '兼职', icon: 'briefcase', children: [['cat_inc_parttime_other', '其他兼职', 'briefcase']] },
    { id: 'cat_inc_redpacket', name: '红包', icon: 'gift', children: [['cat_inc_redpacket_other', '其他红包', 'gift']] },
    { id: 'cat_inc_other', name: '其他收入', icon: 'more-horizontal', children: [
      ['cat_inc_other_misc', '其他收入', 'more-horizontal'], ['cat_inc_other_refund', '退款', 'rotate-ccw'] ] },
  ],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS account (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  name       TEXT NOT NULL,
  balance    INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT,
  template   TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  type       TEXT NOT NULL DEFAULT 'shared',
  owner_uid  TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_share (
  ledger_id TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  perm      TEXT NOT NULL DEFAULT 'rw',
  PRIMARY KEY (ledger_id, user_id)
);

CREATE TABLE IF NOT EXISTS category (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  icon       TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_frequent INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry (
  id                TEXT PRIMARY KEY,
  ledger_id         TEXT NOT NULL,
  account_id        TEXT NOT NULL,
  to_account_id     TEXT,
  flow_type         TEXT NOT NULL,
  amount            INTEGER NOT NULL,
  category_id       TEXT,
  note              TEXT DEFAULT '',
  counterparty      TEXT,
  recorded_by       TEXT,
  member_id         TEXT,
  reimbursable      INTEGER NOT NULL DEFAULT 0,
  reimburse_target  TEXT,
  reimburse_status  TEXT,
  reimbursed_amount INTEGER NOT NULL DEFAULT 0,
  refund_status     TEXT NOT NULL DEFAULT 'none',
  refunded_amount   INTEGER NOT NULL DEFAULT 0,
  related_entry_id  TEXT,
  periodic_id       TEXT,
  entry_date        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entry_ledger_date ON entry(ledger_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_entry_account ON entry(account_id);

CREATE TABLE IF NOT EXISTS attachment (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL,
  file_name  TEXT NOT NULL,
  file_path  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS periodic (
  id             TEXT PRIMARY KEY,
  ledger_id      TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  category_id    TEXT,
  name           TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  flow_type      TEXT NOT NULL DEFAULT 'expense',
  mode           TEXT NOT NULL,
  frequency      TEXT NOT NULL,
  interval_days  INTEGER,
  start_date     TEXT NOT NULL,
  end_date       TEXT,
  last_posted_at TEXT,
  remind_day     INTEGER,
  status         TEXT NOT NULL DEFAULT 'active',
  note           TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget (
  id          TEXT PRIMARY KEY,
  ledger_id   TEXT NOT NULL,
  category_id TEXT,
  month       TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  relation   TEXT,
  fnos_uid   TEXT UNIQUE,
  avatar     TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_user (
  uid        TEXT PRIMARY KEY,
  name       TEXT,
  last_seen  TEXT NOT NULL
);
`;

/**
 * 初始化数据库。dataDir 为空时用于内存测试。
 * @param {string} dataDir 数据目录（TRIM_PKGVAR 或调试目录）
 */
function initDb(dataDir) {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = dataDir ? path.join(dataDir, 'sinong.db') : ':memory:';
  db = new DatabaseSync(dbPath);
  // 性能优化：WAL 模式 + 正常同步 + 锁等待
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA temp_store=MEMORY');
  db.exec(SCHEMA);
  migrate();
  seedCategories();
  seedDefaultLedger();
  seedDefaultAccount();
  return db;
}

/** 轻量迁移：老库补新增列 */
function migrate() {
  const catCols = db.prepare('PRAGMA table_info(category)').all();
  if (!catCols.some((c) => c.name === 'is_frequent')) {
    db.exec('ALTER TABLE category ADD COLUMN is_frequent INTEGER NOT NULL DEFAULT 0');
  }
  const lgCols = db.prepare('PRAGMA table_info(ledger)').all();
  if (!lgCols.some((c) => c.name === 'type')) {
    db.exec("ALTER TABLE ledger ADD COLUMN type TEXT NOT NULL DEFAULT 'shared'");
  }
  if (!lgCols.some((c) => c.name === 'owner_uid')) {
    db.exec('ALTER TABLE ledger ADD COLUMN owner_uid TEXT');
  }
  // 回填系统默认二级分类的 icon（老数据 icon 为 null）
  const iconMap = {};
  for (const groups of Object.values(DEFAULT_CATEGORIES)) {
    for (const g of groups) {
      for (const [cid, _cname, cicon] of g.children) {
        if (cicon) iconMap[cid] = cicon;
      }
    }
  }
  const upd = db.prepare('UPDATE category SET icon=? WHERE id=? AND (icon IS NULL OR icon=\'\')');
  for (const [cid, cicon] of Object.entries(iconMap)) {
    upd.run(cicon, cid);
  }
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

/** 幂等写入默认分类 */
function seedCategories() {
  const now = new Date().toISOString();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO category (id,type,parent_id,name,icon,is_default,sort,created_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  let sort1 = 0;
  for (const [type, groups] of Object.entries(DEFAULT_CATEGORIES)) {
    let sort2 = 0;
    for (const g of groups) {
      ins.run(g.id, type, null, g.name, g.icon, 1, sort1++, now);
      for (const [cid, cname, cicon] of g.children) {
        ins.run(cid, type, g.id, cname, cicon || null, 1, sort2++, now);
      }
    }
  }
}

/** 幂等创建默认账本（首次使用时，私有类型，owner_uid 待首次访问时绑定） */
function seedDefaultLedger() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM ledger').get();
  if (row.n === 0) {
    const now = new Date().toISOString();
    const id = genId('lg');
    db.prepare('INSERT INTO ledger (id,name,icon,template,is_default,type,owner_uid,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, '日常账本', 'book-open', 'daily', 1, 'private', null, now);
  }
}

/** 幂等创建默认账户：安装即有一个「现金」账户 */
function seedDefaultAccount() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM account').get();
  if (row.n === 0) {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO account (id,type,name,balance,note,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(genId('acc'), 'cash', '现金', 0, null, 0, now, now);
  }
}

/** 默认分类种子（供前端/测试引用） */
function getDefaultCategories() {
  return DEFAULT_CATEGORIES;
}

/** 记录登录用户访问（幂等 upsert） */
function touchUser(uid, name) {
  if (!uid || uid === 'local-user') return;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO app_user (uid,name,last_seen) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET name=COALESCE(excluded.name,name), last_seen=excluded.last_seen')
    .run(uid, name || null, now);
}

/** 获取所有已知用户 */
function getUsers() {
  return db.prepare('SELECT uid, name, last_seen FROM app_user ORDER BY last_seen DESC').all();
}

module.exports = { initDb, getDb, genId, DEFAULT_CATEGORIES, getDefaultCategories, touchUser, getUsers };
