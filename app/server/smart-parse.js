'use strict';

/**
 * 快速记账文本解析（本地规则层，纯函数、不依赖数据库）
 *
 * 输入一段口语化文本（如「早上8点包子5」「昨天打车23块」），
 * 输出结构化的记账字段：金额、分类路径、置信度与识别轨迹。
 *
 * 只识别分类和金额，不识别日期/时刻（识别出来的日期不准，一律记当前时间）。
 * 分层：时刻摘除 → 金额 → 关键词规则（含二级）→ 餐次推断
 * 设计约束：
 *  - 时刻里的数字不参与金额（「早上8点」的 8 不是钱）：先摘除时间表达式再扫金额；
 *    摘除只为了保护金额扫描，摘掉的时间本身不进识别结果
 *  - 金额优先带单位（元/块/￥），否则取最后一个合法裸数字
 *  - 关键词规则表按顺序匹配，命中即得一级/二级分类（如「红方印」→ 餐饮-烟酒）
 *  - 餐饮命中但没有具体二级时按当前时刻落餐次（早餐/午餐/晚餐/夜宵，常识时段）
 *  - 文本里明确写了「早餐/午饭」等词时直接用词面，优先于其他规则
 *
 * 调用方（server.js 路由）负责把 categoryPath 映射为账本内真实的 categoryId。
 */

/**
 * 关键词规则表：触发词 → [一级分类, 二级分类|null]（内置写死，仅覆盖默认分类，用户不可见）
 * 顺序即优先级：前面的规则先命中。餐饮的早/午/晚/夜宵由词面与时段单独处理。
 */
const KEYWORD_RULES = [
  // ---- 交通（具体子类在前，兜底"其他交通"在后）----
  { parent: '交通', sub: '打车', words: ['打车', '出租车', '滴滴', '网约车', '的士', '车费'] },
  { parent: '交通', sub: '公交地铁', words: ['公交', '地铁', '轻轨'] },
  { parent: '交通', sub: '加油', words: ['加油', '油费'] },
  { parent: '交通', sub: '停车', words: ['停车'] },
  { parent: '交通', sub: '过路费', words: ['过路费', '高速费', '高速'] },
  { parent: '交通', sub: '维修保养', words: ['保养', '修车', '汽修'] },
  { parent: '交通', sub: '其他交通', words: ['高铁', '火车', '动车', '机票', '飞机', '船票', '客运', '车票'] },
  // ---- 餐饮：落到具体二级的关键词（餐次词另有 MEAL_WORDS 优先处理）----
  { parent: '餐饮', sub: '饮料水果', words: ['奶茶', '咖啡', '果汁', '饮料', '可乐', '雪碧', '矿泉水', '水果'] },
  { parent: '餐饮', sub: '零食', words: ['零食', '面包', '蛋糕', '甜点', '甜品', '薯片', '饼干', '瓜子', '坚果', '冰棍', '雪糕'] },
  { parent: '餐饮', sub: '烟酒', words: ['红方印', '香烟', '茅台', '五粮液', '剑南春', '玉溪', '芙蓉王', '利群', '云烟', '中华烟', '烟', '啤酒', '白酒', '红酒', '洋酒', '酒'] },
  { parent: '餐饮', sub: '外卖', words: ['外卖', '美团', '饿了么'] },
  { parent: '餐饮', sub: '买菜原料', words: ['买菜', '菜场', '菜市场', '猪肉', '牛肉', '羊肉', '鸡蛋', '蔬菜', '大米', '粮油'] },
  // ---- 餐饮：泛化关键词，只定一级，餐次靠时段推断 ----
  { parent: '餐饮', sub: null, words: [
    '包子', '馒头', '花卷', '豆浆', '油条', '粥', '早茶', '面条', '米粉', '米线', '饺子', '馄饨',
    '快餐', '盒饭', '炒饭', '炒面', '盖浇饭', '汉堡', '披萨', '炸鸡', '烧烤', '火锅',
    '麻辣烫', '小龙虾', '食堂', '饭钱', '餐费', '吃饭', '聚餐', '请客',
  ] },
  // ---- 购物 ----
  { parent: '购物', sub: '服饰鞋包', words: ['衣服', '裤子', '裙子', '衬衫', 'T恤', '鞋子', '鞋', '袜子', '帽子', '皮带'] },
  { parent: '购物', sub: '化妆品', words: ['化妆品', '口红', '面膜', '护肤品', '香水', '精华'] },
  { parent: '购物', sub: '日用品', words: ['日用品', '纸巾', '抽纸', '卫生纸', '洗衣液', '洗发水', '牙膏', '牙刷', '沐浴露'] },
  { parent: '购物', sub: '电子产品', words: ['手机', '电脑', '平板', '耳机', '充电器', '充电宝', '手表', '键盘', '鼠标'] },
  { parent: '购物', sub: '家居百货', words: ['家具', '沙发', '床垫', '桌子', '台灯', '锅', '碗', '筷子'] },
  { parent: '购物', sub: '宝宝用品', words: ['奶粉', '尿布', '纸尿裤', '玩具', '宝宝用品'] },
  { parent: '购物', sub: '其他购物', words: ['超市', '网购', '淘宝', '京东', '拼多多', '购物'] },
  // ---- 居住（含话费，默认分类里话费在居住下）----
  { parent: '居住', sub: '房租', words: ['房租', '租金'] },
  { parent: '居住', sub: '房贷', words: ['房贷', '月供'] },
  { parent: '居住', sub: '水费', words: ['水费'] },
  { parent: '居住', sub: '电费', words: ['电费'] },
  { parent: '居住', sub: '燃气费', words: ['燃气', '煤气', '天然气'] },
  { parent: '居住', sub: '物业费', words: ['物业'] },
  { parent: '居住', sub: '网络', words: ['网费', '宽带'] },
  { parent: '居住', sub: '话费', words: ['话费', '流量', '手机费', '充值'] },
  // ---- 娱乐 ----
  { parent: '娱乐', sub: '电影演出', words: ['电影', '演唱会', '演出', '话剧', '剧本杀'] },
  { parent: '娱乐', sub: '游戏', words: ['游戏', 'steam', 'Steam', '点卡', '皮肤'] },
  { parent: '娱乐', sub: '旅游', words: ['旅游', '旅行', '门票', '景点', '景区', '酒店', '民宿'] },
  { parent: '娱乐', sub: '运动健身', words: ['健身', '运动', '跑步', '瑜伽', '游泳', '球'] },
  // ---- 医疗 ----
  { parent: '医疗', sub: '药品', words: ['买药', '药费', '药店', '药'] },
  { parent: '医疗', sub: '门诊', words: ['挂号', '看病', '门诊', '打针', '输液'] },
  { parent: '医疗', sub: '住院', words: ['住院', '手术'] },
  { parent: '医疗', sub: '体检', words: ['体检'] },
  // ---- 教育 ----
  { parent: '教育', sub: '学费', words: ['学费', '报名费'] },
  { parent: '教育', sub: '培训', words: ['培训', '课程', '网课', '辅导'] },
  { parent: '教育', sub: '书籍', words: ['买书', '教材', '书本', '书'] },
  // ---- 人情 ----
  { parent: '人情', sub: '红包', words: ['红包', '压岁钱'] },
  { parent: '人情', sub: '随礼', words: ['随礼', '礼金', '份子'] },
  { parent: '人情', sub: '孝敬', words: ['孝敬', '给爸妈', '给父母'] },
  // ---- 其他 ----
  { parent: '其他', sub: '快递', words: ['快递', '邮费', '寄件', '寄快递'] },
  { parent: '其他', sub: '宠物', words: ['猫粮', '狗粮', '猫砂', '宠物', '疫苗'] },
  { parent: '其他', sub: '维修', words: ['维修', '修理'] },
];

/** 时段→餐次（分钟数，常识值）：夜宵 21:00-次日5:00，早餐 5:00-10:30，午餐 10:30-16:00，晚餐 16:00-21:00 */
function mealSlotOf(minutes) {
  if (minutes >= 21 * 60 || minutes < 5 * 60) return '夜宵';
  if (minutes < 10 * 60 + 30) return '早餐';
  if (minutes < 16 * 60) return '午餐';
  return '晚餐';
}

/** 文本中直接写了餐次词 → 直接用词面 */
const MEAL_WORDS = { 早餐: '早餐', 早饭: '早餐', 早茶: '早餐', 午餐: '午餐', 午饭: '午餐', 晚餐: '晚餐', 晚饭: '晚餐', 夜宵: '夜宵', 宵夜: '夜宵' };

const p2 = (n) => String(n).padStart(2, '0');

/**
 * @param {string} text 用户输入文本
 * @param {{now?: Date}} opts 当前时间（缺省取系统时间）
 * @returns {{amountFen: number|null, categoryPath: string[]|null, confidence: number, trace: string[], note: string}}
 *   amountFen 金额（分）；categoryPath 如 ['餐饮','早餐']；不返回时间（时间由表单自己管理）
 */
function parseQuickEntry(text, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const original = String(text || '').trim();
  let work = original;
  const trace = [];

  // ---- 1) 摘除时间表达式（中文时刻词 + 数字点 / HH:MM）----
  // 只为了防止「早上8点」的 8 被当成金额，摘掉的时间本身不进识别结果
  const cm = /(凌晨|清晨|早上|早晨|上午|中午|午后|下午|傍晚|晚上|夜里|深夜|半夜)?\s*(\d{1,2})\s*[点时]\s*(?:([半\d]{1,2})\s*分?)?/.exec(work);
  if (cm && Number(cm[2]) <= 24) {
    const h = Number(cm[2]);
    const m = cm[3] ? (cm[3] === '半' ? 30 : Number(cm[3]) % 100) : 0;
    if (h <= 23 && m <= 59) work = work.replace(cm[0], ' ');
  } else {
    const hm = /(\d{1,2}):([0-5]\d)/.exec(work);
    if (hm) work = work.replace(hm[0], ' ');
  }

  // ---- 2) 金额：带单位优先，否则取最后一个合法裸数字 ----
  let amountFen = null;
  const um = /(?:¥|￥)?(\d+(?:\.\d+)?)\s*(?:元|块钱|块|圆|rmb|RMB)/.exec(work);
  if (um) {
    amountFen = Math.round(parseFloat(um[1]) * 100);
    trace.push(`金额:「${um[1]}元」`);
  } else {
    const numRe = /(\d+(?:\.\d+)?)/g;
    let m2 = null;
    let last = null;
    while ((m2 = numRe.exec(work))) {
      const after = work.slice(m2.index + m2[0].length, m2.index + m2[0].length + 1);
      // 紧跟日期/时间/折扣单位的数字不是金额（时刻已摘除，此处兜底「8号」「7折」等）
      if (after && /[年月日号点时分钟秒周星期折]/.test(after)) continue;
      last = m2[1];
    }
    if (last) {
      amountFen = Math.round(parseFloat(last) * 100);
      trace.push(`金额:「${last}」`);
    }
  }
  if (amountFen !== null && (amountFen <= 0 || amountFen > 100000000)) {
    amountFen = null;
    trace.pop();
  }

  // ---- 3) 分类关键词：词面餐次词优先，再走规则表 ----
  let parentName = null;
  let subName = null;
  const mealWord = Object.keys(MEAL_WORDS).find((w) => work.includes(w));
  if (mealWord) {
    parentName = '餐饮';
    subName = MEAL_WORDS[mealWord];
    trace.push(`餐次:「${mealWord}」→${parentName}-${subName}`);
  } else {
    for (const rule of KEYWORD_RULES) {
      const w = rule.words.find((x) => work.includes(x));
      if (!w) continue;
      parentName = rule.parent;
      subName = rule.sub;
      trace.push(`分类:「${w}」→${parentName}${subName ? '-' + subName : ''}`);
      break;
    }
  }
  // 餐饮但文本没写餐次 → 按当前时刻推断（不识别文本时间）
  if (parentName === '餐饮' && !subName) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    subName = mealSlotOf(minutes);
    trace.push(`时段:${p2(now.getHours())}:${p2(now.getMinutes())}→${subName}`);
  }

  // ---- 4) 置信度 ----
  let confidence = 0;
  if (parentName && amountFen !== null) confidence = 0.9;
  else if (parentName) confidence = 0.6;
  else if (amountFen !== null) confidence = 0.4;

  return {
    amountFen,
    categoryPath: parentName ? (subName ? [parentName, subName] : [parentName]) : null,
    confidence,
    trace,
    note: original,
  };
}

module.exports = { parseQuickEntry };
