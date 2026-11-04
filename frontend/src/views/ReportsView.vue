<script setup lang="ts">
defineOptions({ name: 'ReportsView' })
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, type Category, type Member, type Account } from '../api'
import { store, fmtMoney } from '../store'
import { iconForCat } from '../catIcons'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Users, Tags, Wallet, CalendarClock, ArrowDownUp } from 'lucide-vue-next'

// ==================== 类型 ====================
interface CatAgg { categoryId: string; name: string; amount: number; pct: number; subs: { categoryId: string; name: string; amount: number; pct: number }[] }
interface NameAgg { id: string; name: string; amount: number; pct: number }
interface QueryEntry {
  id: string; flowType: string; amount: number; note: string | null; entryDate: string
  categoryId: string | null; categoryName: string | null; categoryIcon: string | null; categoryParentIcon: string | null
  accountName: string | null; toAccountName: string | null; memberId: string | null; platform: string | null
}
interface QueryResult {
  range: { from: string; to: string; days: number }
  summary: {
    income: number; expense: number; refund: number; netExpense: number; balance: number
    count: number; dailyAvg: number
    prevIncome: number; prevExpense: number
    incomeChange: number | null; expenseChange: number | null
  }
  byCategory: CatAgg[]
  byMember: NameAgg[]
  byAccount: NameAgg[]
  /** 类型筛「全部」时额外返回的收入口径组，其余类型不返回 */
  byCategoryIncome?: CatAgg[]
  byMemberIncome?: NameAgg[]
  byAccountIncome?: NameAgg[]
  byMonth: { month: string; income: number; expense: number; refund: number; netExpense: number }[]
  entries: { items: QueryEntry[]; page: number; pageSize: number; total: number; hasMore: boolean }
}

const router = useRouter()

// ==================== 筛选状态 ====================
const mode = ref<'month' | 'year' | 'custom'>('month')
const y = ref(new Date().getFullYear())
const m = ref(new Date().getMonth() + 1)
const customFrom = ref(`${y.value}-${String(m.value).padStart(2, '0')}-01`)
const customTo = ref(todayStr())
const selMembers = ref<string[]>([])
const selCats = ref<string[]>([])
const selAccounts = ref<string[]>([])
const flowType = ref<'all' | 'expense' | 'income'>('all')

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const p2 = (n: number) => String(n).padStart(2, '0')

/** 当前时间范围（entry_date 为 'YYYY-MM-DD HH:MM:SS'，按天比较） */
const range = computed(() => {
  if (mode.value === 'month') {
    const last = new Date(y.value, m.value, 0).getDate()
    return { from: `${y.value}-${p2(m.value)}-01`, to: `${y.value}-${p2(m.value)}-${p2(last)}` }
  }
  if (mode.value === 'year') return { from: `${y.value}-01-01`, to: `${y.value}-12-31` }
  return { from: customFrom.value, to: customTo.value }
})
const timeLabel = computed(() => {
  if (mode.value === 'month') return `${y.value}年${m.value}月`
  if (mode.value === 'year') return `${y.value}年`
  return `${range.value.from.slice(5).replace('-', '/')} ~ ${range.value.to.slice(5).replace('-', '/')}`
})
function shift(delta: number) {
  if (mode.value === 'month') {
    const d = new Date(y.value, m.value - 1 + delta, 1)
    y.value = d.getFullYear()
    m.value = d.getMonth() + 1
  } else if (mode.value === 'year') {
    y.value += delta
  }
}

// ==================== 弹层 ====================
const showPop = ref<'' | 'time' | 'type' | 'member' | 'cat' | 'acc'>('')
const popMode = ref<'month' | 'year' | 'custom'>('month')
const popFrom = ref('')
const popTo = ref('')
const members = ref<Member[]>([])
const accounts = ref<Account[]>([])
const catTree = ref<{ expense: Category[]; income: Category[] }>({ expense: [], income: [] })
// 弹层内先改草稿，点右上「确定」才应用（避免勾一下就打一次接口）；左上「取消」直接丢弃
const draftMembers = ref<string[]>([])
const draftCats = ref<string[]>([])
const draftAccounts = ref<string[]>([])
const draftType = ref<'all' | 'expense' | 'income'>('all')

const typeLabel = computed(() => ({ all: '全部', expense: '支出', income: '收入' })[flowType.value])
const memberLabel = computed(() => (selMembers.value.length ? `成员·${selMembers.value.length}` : '成员'))
const catLabel = computed(() => (selCats.value.length ? `分类·${selCats.value.length}` : '分类'))
const accLabel = computed(() => (selAccounts.value.length ? `账户·${selAccounts.value.length}` : '账户'))

/** 打开筛选弹层：当前值复制成草稿 */
function openPop(p: 'type' | 'member' | 'cat' | 'acc') {
  draftType.value = flowType.value
  draftMembers.value = [...selMembers.value]
  draftCats.value = [...selCats.value]
  draftAccounts.value = [...selAccounts.value]
  showPop.value = p
}
/** 右上「确定」：草稿写回筛选条件 */
function applyPop() {
  if (showPop.value === 'type') flowType.value = draftType.value
  else if (showPop.value === 'member') selMembers.value = [...draftMembers.value]
  else if (showPop.value === 'cat') selCats.value = [...draftCats.value]
  else if (showPop.value === 'acc') selAccounts.value = [...draftAccounts.value]
  showPop.value = ''
}
/** 左上「取消」：丢弃草稿 */
function cancelPop() {
  showPop.value = ''
}

function openTimePop() {
  popMode.value = mode.value
  popFrom.value = customFrom.value
  popTo.value = customTo.value
  showPop.value = 'time'
}
function confirmTime() {
  if (popMode.value === 'custom') {
    if (!popFrom.value || !popTo.value || popFrom.value > popTo.value) return
    customFrom.value = popFrom.value
    customTo.value = popTo.value
    mode.value = 'custom'
  } else {
    mode.value = popMode.value
  }
  showPop.value = ''
}
function toggleSel(list: string[], id: string) {
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}
/** 一级分类勾选态：自身或任一二级被选中 */
function catParentOn(list: string[], g: Category): boolean {
  return list.includes(g.id) || (g.children || []).some((c) => list.includes(c.id))
}

// ==================== 数据加载 ====================
const loading = ref(true)
const loadingMore = ref(false)
const data = ref<QueryResult | null>(null)
const entries = ref<QueryEntry[]>([])
let seq = 0

function queryUrl(page: number) {
  const p = new URLSearchParams()
  p.set('from', range.value.from)
  p.set('to', range.value.to)
  p.set('type', flowType.value)
  if (selMembers.value.length) p.set('memberIds', selMembers.value.join(','))
  if (selCats.value.length) p.set('categoryIds', selCats.value.join(','))
  if (selAccounts.value.length) p.set('accountIds', selAccounts.value.join(','))
  p.set('page', String(page))
  p.set('pageSize', '50')
  const lid = store.settings.currentLedgerId
  if (lid) p.set('ledgerId', lid)
  return `reports/query?${p.toString()}`
}

async function load() {
  if (mode.value === 'custom' && (!range.value.from || !range.value.to || range.value.from > range.value.to)) return
  const my = ++seq
  loading.value = true
  try {
    const d = await api.get<QueryResult>(queryUrl(1))
    if (my !== seq) return
    data.value = d
    entries.value = d.entries.items
    // 月模式下同时拉近 6 月趋势
    if (mode.value === 'month') {
      api.get<{ items: Trend[] }>(`reports/trend?${lidQ()}months=6`).then((t) => {
        if (my === seq) trend.value = t.items
      }).catch(() => { /* 趋势失败不阻塞 */ })
    } else {
      trend.value = []
    }
  } catch (e) {
    if (my === seq) console.error(e)
  } finally {
    if (my === seq) loading.value = false
  }
}
function lidQ() {
  const lid = store.settings.currentLedgerId
  return lid ? `ledgerId=${lid}&` : ''
}
async function loadMore() {
  const d = data.value
  if (!d || loadingMore.value || !d.entries.hasMore) return
  loadingMore.value = true
  try {
    const next = await api.get<QueryResult>(queryUrl(d.entries.page + 1))
    // 加载更多期间筛选变了就丢弃
    if (next.range.from === d.range.from && next.range.to === d.range.to) {
      entries.value.push(...next.entries.items)
      data.value = { ...d, entries: next.entries }
    }
  } catch { /* 静默 */ }
  loadingMore.value = false
}

watch(range, load)
watch([selMembers, selCats, selAccounts, flowType], load, { deep: true })

async function loadBase() {
  try {
    const ms = await api.get<Member[]>('members')
    members.value = ms
  } catch { /* 成员接口容错 */ }
  try {
    const acc = await api.get<{ groups: { type: string; items: Account[] }[] }>('accounts')
    accounts.value = acc.groups.filter((g) => g.type !== 'archived').flatMap((g) => g.items)
  } catch { /* 账户接口容错 */ }
  try {
    for (const t of ['expense', 'income'] as const) {
      const d = await api.get<{ groups: Category[] }>(`categories?type=${t}`)
      catTree.value[t] = d.groups
    }
  } catch { /* 分类接口容错 */ }
}

onMounted(async () => {
  await loadBase()
  await load()
})

// ==================== 展示计算 ====================
interface Trend { month: string; income: number; expense: number; netExpense: number }
const trend = ref<Trend[]>([])
const compName = computed(() => (flowType.value === 'income' ? '收入构成' : '支出构成'))
/** 构成分节：类型筛「全部」时支出、收入两组都显示，其余只显示对应口径一组 */
const compSections = computed<{ key: 'expense' | 'income'; title: string; list: CatAgg[] }[]>(() => {
  if (flowType.value === 'all') {
    return [
      { key: 'expense', title: '支出构成', list: data.value?.byCategory || [] },
      { key: 'income', title: '收入构成', list: data.value?.byCategoryIncome || [] },
    ]
  }
  return [{ key: flowType.value === 'income' ? 'income' : 'expense', title: compName.value, list: data.value?.byCategory || [] }]
})
const memberSections = computed<{ title: string; list: NameAgg[] }[]>(() => {
  const kindLabel = flowType.value === 'income' ? '收入' : '支出'
  if (flowType.value === 'all') {
    return [
      { title: '成员支出占比', list: data.value?.byMember || [] },
      { title: '成员收入占比', list: data.value?.byMemberIncome || [] },
    ]
  }
  return [{ title: `成员${kindLabel}占比`, list: data.value?.byMember || [] }]
})
const accountSections = computed<{ title: string; list: NameAgg[] }[]>(() => {
  const kindLabel = flowType.value === 'income' ? '收入' : '支出'
  if (flowType.value === 'all') {
    return [
      { title: '账户支出占比', list: data.value?.byAccount || [] },
      { title: '账户收入占比', list: data.value?.byAccountIncome || [] },
    ]
  }
  return [{ title: `账户${kindLabel}占比`, list: data.value?.byAccount || [] }]
})
const maxTrend = computed(() => {
  const all = trend.value.length
    ? trend.value.flatMap((t) => [t.income, t.expense])
    : (data.value?.byMonth || []).flatMap((t) => [t.income, t.expense])
  return Math.max(1, ...all)
})
const trendCols = computed<{ label: string; income: number; expense: number }[]>(() => {
  if (trend.value.length) {
    return trend.value.map((t) => ({ label: `${t.month.slice(5)}月`, income: t.income, expense: t.netExpense }))
  }
  return (data.value?.byMonth || []).map((t) => ({ label: `${t.month.slice(5)}月`, income: t.income, expense: t.netExpense }))
})
const expanded = ref<string[]>([])
function toggleExpand(id: string) {
  const i = expanded.value.indexOf(id)
  if (i >= 0) expanded.value.splice(i, 1)
  else expanded.value.push(id)
}
/** 一级分类勾选/取消：勾上=选一级（服务端展开全部二级）；取消=连其下已勾的二级一起清掉 */
function toggleCatParent(list: string[], g: Category) {
  const kidIds = (g.children || []).map((c) => c.id)
  const next = catParentOn(list, g)
    ? list.filter((id) => id !== g.id && !kidIds.includes(id))
    : [...list.filter((id) => !kidIds.includes(id)), g.id]
  list.splice(0, list.length, ...next)
}
const memberNameOf = (id: string | null) => (id ? members.value.find((x) => x.id === id)?.name || '' : '')

/** 流水按日分组 */
const entryGroups = computed(() => {
  const out: { day: string; weekday: string; list: QueryEntry[] }[] = []
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  for (const e of entries.value) {
    const day = e.entryDate.slice(0, 10)
    let g = out.find((x) => x.day === day)
    if (!g) {
      const d = new Date(`${day}T00:00:00`)
      g = { day, weekday: wk[d.getDay()], list: [] }
      out.push(g)
    }
    g.list.push(e)
  }
  return out
})
function entryTitle(e: QueryEntry) {
  return e.note || e.categoryName || '无备注'
}
function entrySub(e: QueryEntry) {
  const bits = [e.accountName || e.toAccountName || '', memberNameOf(e.memberId), e.platform, e.entryDate.slice(11, 16)].filter(Boolean)
  return bits.join(' · ')
}
function amountClass(e: QueryEntry) {
  return e.flowType === 'expense' ? 'expense' : 'income'
}
function amountText(e: QueryEntry) {
  if (e.flowType === 'refund') return `+${fmtMoney(e.amount)}`
  if (e.flowType === 'income') return `+${fmtMoney(e.amount)}`
  return `-${fmtMoney(e.amount)}`
}
function changeText(v: number | null) {
  if (v === null) return '上月无数据'
  return `${v > 0 ? '+' : ''}${v}%`
}
</script>

<template>
  <div class="page reports">
    <div class="page-title">报表</div>

    <!-- 时间 + 筛选 chips -->
    <div class="filter-bar">
      <template v-if="mode !== 'custom'">
        <button class="f-arrow" @click="shift(-1)"><ChevronLeft :size="16" /></button>
      </template>
      <button class="chip time" :class="{ on: true }" @click="openTimePop">
        <CalendarClock :size="13" />
        <span>{{ timeLabel }}</span>
      </button>
      <template v-if="mode !== 'custom'">
        <button class="f-arrow" @click="shift(1)"><ChevronRight :size="16" /></button>
      </template>
      <button class="chip" :class="{ on: flowType !== 'all' }" @click="openPop('type')">
        <ArrowDownUp :size="13" />
        <span>{{ typeLabel }}</span>
      </button>
      <button class="chip" :class="{ on: selMembers.length > 0 }" @click="openPop('member')">
        <Users :size="13" />
        <span>{{ memberLabel }}</span>
      </button>
      <button class="chip" :class="{ on: selCats.length > 0 }" @click="openPop('cat')">
        <Tags :size="13" />
        <span>{{ catLabel }}</span>
      </button>
      <button class="chip" :class="{ on: selAccounts.length > 0 }" @click="openPop('acc')">
        <Wallet :size="13" />
        <span>{{ accLabel }}</span>
      </button>
    </div>

    <van-skeleton v-if="loading" title :row="4" style="padding: 16px;" />
    <template v-else-if="data">
      <!-- 月度统计 -->
      <div class="stat-card">
        <div class="stat">
          <span class="stat-label">收入</span>
          <span class="stat-num income">{{ fmtMoney(data.summary.income) }}</span>
          <span class="stat-sub muted">{{ changeText(data.summary.incomeChange) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">支出</span>
          <span class="stat-num expense">{{ fmtMoney(data.summary.netExpense) }}</span>
          <span class="stat-sub muted">{{ changeText(data.summary.expenseChange) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">结余</span>
          <span class="stat-num" :class="data.summary.balance >= 0 ? 'income' : 'expense'">{{ fmtMoney(data.summary.balance) }}</span>
          <span class="stat-sub muted">日均 {{ fmtMoney(data.summary.dailyAvg) }} · {{ data.summary.count }} 笔</span>
        </div>
        <div class="stat-sub muted" style="width: 100%;">
          退款 {{ fmtMoney(data.summary.refund) }} · 区间 {{ data.range.from }} ~ {{ data.range.to }}（{{ data.range.days }} 天）
        </div>
      </div>

      <!-- 构成（「全部」时支出/收入两节都显示），点击展开二级 -->
      <div class="card section" v-for="sec in compSections" :key="sec.key">
        <div class="sec-head"><TrendingDown :size="16" /> {{ sec.title }}</div>
        <div v-if="sec.list.length === 0" class="muted empty">当前筛选暂无{{ sec.key === 'income' ? '收入' : '支出' }}</div>
        <div v-else class="bars">
          <template v-for="c in sec.list" :key="c.categoryId">
            <div class="bar-row" :class="{ clickable: c.subs.length > 0 }" @click="c.subs.length && toggleExpand(c.categoryId)">
              <span class="bar-name">{{ c.name }}</span>
              <div class="bar-track">
                <div class="bar-fill" :class="sec.key === 'income' ? 'income-fill' : 'expense-fill'" :style="{ width: c.pct + '%' }" />
              </div>
              <span class="bar-val">{{ fmtMoney(c.amount) }}</span>
              <span class="bar-pct muted">{{ c.pct }}%</span>
            </div>
            <template v-if="c.subs.length && expanded.includes(c.categoryId)">
              <div v-for="s in c.subs" :key="s.categoryId" class="bar-row sub">
                <span class="bar-name">{{ s.name }}</span>
                <div class="bar-track">
                  <div class="bar-fill dim" :class="sec.key === 'income' ? 'income-fill' : 'expense-fill'" :style="{ width: s.pct + '%' }" />
                </div>
                <span class="bar-val">{{ fmtMoney(s.amount) }}</span>
                <span class="bar-pct muted">{{ s.pct }}%</span>
              </div>
            </template>
          </template>
        </div>
        <div v-if="sec.list.some((c) => c.subs.length)" class="muted" style="font-size: 11px; margin-top: 8px;">点分类行可展开二级明细</div>
      </div>

      <!-- 成员占比 / 账户占比（「全部」时支出/收入两节都显示） -->
      <div class="card section" v-for="s in memberSections.filter((x) => x.list.length > 1)" :key="s.title">
        <div class="sec-head"><Users :size="16" /> {{ s.title }}</div>
        <div class="bars">
          <div v-for="mem in s.list" :key="mem.id" class="bar-row">
            <span class="bar-name">{{ mem.name }}</span>
            <div class="bar-track">
              <div class="bar-fill member-fill" :style="{ width: mem.pct + '%' }" />
            </div>
            <span class="bar-val">{{ fmtMoney(mem.amount) }}</span>
            <span class="bar-pct muted">{{ mem.pct }}%</span>
          </div>
        </div>
      </div>
      <div class="card section" v-for="s in accountSections.filter((x) => x.list.length > 1)" :key="s.title">
        <div class="sec-head"><Wallet :size="16" /> {{ s.title }}</div>
        <div class="bars">
          <div v-for="a in s.list" :key="a.id" class="bar-row">
            <span class="bar-name">{{ a.name }}</span>
            <div class="bar-track">
              <div class="bar-fill acc-fill" :style="{ width: a.pct + '%' }" />
            </div>
            <span class="bar-val">{{ fmtMoney(a.amount) }}</span>
            <span class="bar-pct muted">{{ a.pct }}%</span>
          </div>
        </div>
      </div>

      <!-- 趋势：月模式近 6 月，年/自定义模式逐月 -->
      <div class="card section" v-if="trendCols.length > 1">
        <div class="sec-head"><TrendingUp :size="16" /> {{ mode === 'month' ? '近 6 月趋势' : '逐月趋势' }}</div>
        <div class="trend">
          <div v-for="t in trendCols" :key="t.label" class="trend-col">
            <div class="trend-bars">
              <div class="trend-bar income" :style="{ height: Math.max(3, Math.round((t.income / maxTrend) * 64)) + 'px' }" />
              <div class="trend-bar expense" :style="{ height: Math.max(3, Math.round((t.expense / maxTrend) * 64)) + 'px' }" />
            </div>
            <span class="trend-month muted">{{ t.label }}</span>
          </div>
        </div>
        <div class="trend-legend muted">
          <span><i class="dot income" />收入</span>
          <span><i class="dot expense" />净支出</span>
        </div>
      </div>

      <!-- 流水 -->
      <div class="card section">
        <div class="sec-head">
          <ArrowDownUp :size="16" /> 流水
          <span class="muted" style="font-size: 11px; font-weight: 400; margin-left: auto;">共 {{ data.entries.total }} 笔</span>
        </div>
        <div v-if="entries.length === 0" class="muted empty">当前筛选暂无流水</div>
        <template v-else>
          <template v-for="g in entryGroups" :key="g.day">
            <div class="day-head muted">{{ g.day }} {{ g.weekday }}</div>
            <div v-for="e in g.list" :key="e.id" class="entry-row" @click="router.push(`/detail/${e.id}`)">
              <span class="e-icon">
                <component :is="iconForCat({ id: e.categoryId || e.id, icon: e.categoryIcon || e.categoryParentIcon })" :size="15" />
              </span>
              <div class="e-main">
                <div class="e-title">{{ entryTitle(e) }}</div>
                <div class="e-sub muted">{{ entrySub(e) }}</div>
              </div>
              <span class="e-amount" :class="amountClass(e)">{{ amountText(e) }}</span>
            </div>
          </template>
          <button v-if="data.entries.hasMore" class="more-btn" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
          <div v-else class="muted" style="text-align: center; font-size: 11px; padding: 6px 0 0;">没有更多了</div>
        </template>
      </div>
    </template>

    <!-- ==================== 弹层：时间 ==================== -->
    <van-popup :show="showPop === 'time'" position="bottom" round @update:show="(v: boolean) => showPop = v ? 'time' : ''">
      <div class="pop-head">
        <button class="pop-cancel" @click="cancelPop">取消</button>
        <span class="pop-title">时间范围</span>
        <button class="pop-sure" :disabled="popMode === 'custom' && (!popFrom || !popTo || popFrom > popTo)" @click="confirmTime">确定</button>
      </div>
      <div class="pop-body">
        <div class="opt-row">
          <button class="opt" :class="{ on: popMode === 'month' }" @click="popMode = 'month'">按月</button>
          <button class="opt" :class="{ on: popMode === 'year' }" @click="popMode = 'year'">按年</button>
          <button class="opt" :class="{ on: popMode === 'custom' }" @click="popMode = 'custom'">自定义</button>
        </div>
        <div v-if="popMode === 'custom'" class="date-pair">
          <label>开始<input v-model="popFrom" type="date" /></label>
          <label>结束<input v-model="popTo" type="date" /></label>
        </div>
        <div v-if="popMode === 'custom' && popFrom && popTo && popFrom > popTo" class="muted" style="font-size: 12px;">开始日期不能晚于结束日期</div>
      </div>
    </van-popup>

    <!-- ==================== 弹层：类型 ==================== -->
    <van-popup :show="showPop === 'type'" position="bottom" round @update:show="(v: boolean) => showPop = v ? 'type' : ''">
      <div class="pop-head">
        <button class="pop-cancel" @click="cancelPop">取消</button>
        <span class="pop-title">收支类型</span>
        <button class="pop-sure" @click="applyPop">确定</button>
      </div>
      <div class="pop-body">
        <div class="opt-row">
          <button v-for="t in (['all', 'expense', 'income'] as const)" :key="t" class="opt" :class="{ on: draftType === t }" @click="draftType = t">
            {{ { all: '全部', expense: '支出', income: '收入' }[t] }}
          </button>
        </div>
      </div>
    </van-popup>

    <!-- ==================== 弹层：成员 ==================== -->
    <van-popup :show="showPop === 'member'" position="bottom" round @update:show="(v: boolean) => showPop = v ? 'member' : ''">
      <div class="pop-head">
        <button class="pop-cancel" @click="cancelPop">取消</button>
        <span class="pop-title">选择成员</span>
        <button class="pop-sure" @click="applyPop">确定</button>
      </div>
      <div class="pop-body">
        <div class="pop-hint">
          <span class="muted">可多选</span>
          <button class="pop-clear" @click="draftMembers.splice(0)">清空</button>
        </div>
        <div v-if="members.length === 0" class="muted empty">暂无成员</div>
        <label v-for="mem in members" :key="mem.id" class="check-row">
          <input type="checkbox" :checked="draftMembers.includes(mem.id)" @change="toggleSel(draftMembers, mem.id)" />
          <span>{{ mem.name }}<i v-if="mem.isMe" class="muted">（我）</i></span>
        </label>
      </div>
    </van-popup>

    <!-- ==================== 弹层：账户 ==================== -->
    <van-popup :show="showPop === 'acc'" position="bottom" round @update:show="(v: boolean) => showPop = v ? 'acc' : ''">
      <div class="pop-head">
        <button class="pop-cancel" @click="cancelPop">取消</button>
        <span class="pop-title">选择账户</span>
        <button class="pop-sure" @click="applyPop">确定</button>
      </div>
      <div class="pop-body">
        <div class="pop-hint">
          <span class="muted">可多选</span>
          <button class="pop-clear" @click="draftAccounts.splice(0)">清空</button>
        </div>
        <div v-if="accounts.length === 0" class="muted empty">暂无账户</div>
        <label v-for="a in accounts" :key="a.id" class="check-row">
          <input type="checkbox" :checked="draftAccounts.includes(a.id)" @change="toggleSel(draftAccounts, a.id)" />
          <span>{{ a.name }}</span>
        </label>
      </div>
    </van-popup>

    <!-- ==================== 弹层：分类（两级，勾一级含全部二级） ==================== -->
    <van-popup :show="showPop === 'cat'" position="bottom" round @update:show="(v: boolean) => showPop = v ? 'cat' : ''">
      <div class="pop-head">
        <button class="pop-cancel" @click="cancelPop">取消</button>
        <span class="pop-title">选择分类</span>
        <button class="pop-sure" @click="applyPop">确定</button>
      </div>
      <div class="pop-body pop-scroll">
        <div class="pop-hint">
          <span class="muted">勾一级含全部二级</span>
          <button class="pop-clear" @click="draftCats.splice(0)">清空</button>
        </div>
        <div v-for="g in catTree.expense" :key="g.id" class="cat-group">
          <label class="check-row parent">
            <input type="checkbox" :checked="catParentOn(draftCats, g)" @change="toggleCatParent(draftCats, g)" />
            <span class="cat-p-name">{{ g.name }}</span>
          </label>
          <div class="cat-kids">
            <label v-for="c in g.children" :key="c.id" class="check-row">
              <input type="checkbox" :checked="draftCats.includes(c.id)" @change="toggleSel(draftCats, c.id)" />
              <span>{{ c.name }}</span>
            </label>
          </div>
        </div>
        <div class="pop-title sub-title">收入分类</div>
        <div v-for="g in catTree.income" :key="g.id" class="cat-group">
          <label class="check-row parent">
            <input type="checkbox" :checked="catParentOn(draftCats, g)" @change="toggleCatParent(draftCats, g)" />
            <span class="cat-p-name">{{ g.name }}</span>
          </label>
          <div class="cat-kids">
            <label v-for="c in g.children" :key="c.id" class="check-row">
              <input type="checkbox" :checked="draftCats.includes(c.id)" @change="toggleSel(draftCats, c.id)" />
              <span>{{ c.name }}</span>
            </label>
          </div>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.reports { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }

/* 筛选条 */
.filter-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.f-arrow { padding: 4px; color: var(--text2); display: flex; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
.chip { display: flex; align-items: center; gap: 4px; padding: 6px 10px; font-size: 12px; color: var(--text2); background: var(--card); border: 1px solid var(--border); border-radius: 999px; }
.chip.on { color: #854f0b; background: #faeeda; border-color: #ba7517; }

/* 统计卡 */
.stat-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
.stat { flex: 1 1 80px; display: flex; flex-direction: column; gap: 4px; }
.stat-label { font-size: 12px; color: var(--text2); }
.stat-num { font-size: 18px; font-weight: 700; }
.stat-num.income { color: var(--income); }
.stat-num.expense { color: var(--expense); }
.stat-sub { font-size: 11px; }

.section { padding: 14px; }
.sec-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--text); }
.empty { padding: 8px 0; font-size: 13px; }

/* 条形 */
.bars { display: flex; flex-direction: column; gap: 10px; }
.bar-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.bar-row.clickable { cursor: pointer; }
.bar-row.sub { padding-left: 12px; font-size: 12px; }
.bar-name { width: 56px; flex-shrink: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { flex: 1; height: 8px; border-radius: 4px; background: var(--bg); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; }
.bar-fill.dim { opacity: 0.55; }
.expense-fill { background: var(--expense); }
.income-fill { background: var(--income); }
.member-fill { background: #534ab7; }
.acc-fill { background: #185fa5; }
.bar-val { width: 62px; text-align: right; font-weight: 600; }
.bar-pct { width: 34px; text-align: right; font-size: 11px; }

/* 趋势 */
.trend { display: flex; gap: 6px; align-items: flex-end; justify-content: space-between; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.trend-bars { display: flex; align-items: flex-end; gap: 3px; height: 68px; }
.trend-bar { width: 10px; border-radius: 3px 3px 0 0; }
.trend-bar.income { background: var(--income); }
.trend-bar.expense { background: var(--expense); }
.trend-legend { display: flex; gap: 14px; justify-content: center; font-size: 11px; margin-top: 10px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.dot.income { background: var(--income); }
.dot.expense { background: var(--expense); }

/* 流水 */
.day-head { font-size: 11px; padding: 10px 2px 4px; border-bottom: 1px solid var(--border); }
.entry-row { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-bottom: 1px solid var(--border); cursor: pointer; }
.entry-row:last-of-type { border-bottom: none; }
.e-icon { width: 30px; height: 30px; border-radius: 8px; background: var(--bg); display: flex; align-items: center; justify-content: center; color: var(--text2); flex-shrink: 0; }
.e-main { flex: 1; min-width: 0; }
.e-title { font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e-sub { font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e-amount { font-size: 14px; font-weight: 600; flex-shrink: 0; }
.e-amount.expense { color: var(--expense); }
.e-amount.income { color: var(--income); }
.more-btn { width: 100%; margin-top: 10px; padding: 8px; font-size: 13px; color: var(--text2); background: var(--bg); border: none; border-radius: var(--radius); cursor: pointer; }

/* 弹层：头部 左取消 / 中标题 / 右确定（与项目其他弹层一致，按钮不放底部） */
.pop-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px 10px; border-bottom: 1px solid var(--border); }
.pop-cancel { padding: 4px 2px; font-size: 14px; color: var(--text2); background: none; border: none; }
.pop-sure { padding: 4px 2px; font-size: 14px; font-weight: 600; color: var(--text); background: none; border: none; }
.pop-sure:disabled { opacity: 0.4; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-title.sub-title { font-size: 13px; margin: 10px 0 6px; color: var(--text2); }
.pop-body { padding: 14px 16px calc(16px + env(safe-area-inset-bottom)); }
.pop-scroll { max-height: 65vh; overflow-y: auto; }
.pop-hint { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
.pop-clear { font-size: 12px; color: var(--text2); background: none; border: none; padding: 2px 0; }
.opt-row { display: flex; gap: 8px; margin-bottom: 12px; }
.opt { flex: 1; padding: 9px 0; font-size: 13px; text-align: center; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text2); }
.opt.on { color: #854f0b; background: #faeeda; border-color: #ba7517; font-weight: 600; }
.date-pair { display: flex; gap: 10px; margin-bottom: 10px; }
.date-pair label { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text2); }
.date-pair input { padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; background: var(--card); color: var(--text); }
.check-row { display: flex; align-items: center; gap: 10px; padding: 9px 2px; font-size: 14px; cursor: pointer; border-bottom: 1px solid var(--border); }
.check-row.parent { font-weight: 600; }
.cat-group { margin-bottom: 4px; }
.cat-kids { padding-left: 26px; }
.cat-kids .check-row { font-size: 13px; color: var(--text2); }
</style>
