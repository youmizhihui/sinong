<script setup lang="ts">
defineOptions({ name: 'HomeView' })
import { ref, computed, onMounted, onActivated, onDeactivated } from 'vue'
import { useRouter } from 'vue-router'
import { api, type Entry, type Member, type Ledger } from '../api'
import { store, loadSettings, fmtMoney } from '../store'
import { Eye, EyeOff, ReceiptText, BookOpen, ChevronDown, ChevronLeft, ChevronRight, X, ArrowUp, ArrowLeftRight } from 'lucide-vue-next'
import { iconForCat } from '../catIcons'

const router = useRouter()

const entries = ref<Entry[]>([])
const members = ref<Member[]>([])
const ledgers = ref<Ledger[]>([])
const loading = ref(true)
const showLedger = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)
const loadedIds = new Set<string>()

async function load() {
  loadedIds.clear()
  try {
    const [d, ms, ls] = await Promise.all([
      api.get<{ entries: Entry[]; hasMore: boolean }>(`entries?ledgerId=${store.settings.currentLedgerId ?? ''}&limit=300`),
      api.get<Member[]>('members').catch(() => [] as Member[]),
      api.get<{ ledgers: Ledger[] }>('ledgers').catch(() => ({ ledgers: [] as Ledger[] })),
    ])
    entries.value = d.entries
    d.entries.forEach((e) => loadedIds.add(e.id))
    hasMore.value = d.hasMore
    members.value = ms
    ledgers.value = ls.ledgers
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const d = await api.get<{ entries: Entry[]; hasMore: boolean }>(
      `entries?ledgerId=${store.settings.currentLedgerId ?? ''}&limit=300&offset=${entries.value.length}`
    )
    const fresh = d.entries.filter((e) => !loadedIds.has(e.id))
    fresh.forEach((e) => loadedIds.add(e.id))
    entries.value = [...entries.value, ...fresh]
    hasMore.value = d.hasMore
  } catch (e) {
    console.error(e)
  }
  loadingMore.value = false
}

const currentLedgerName = computed(() => {
  const l = ledgers.value.find((x) => x.id === store.settings.currentLedgerId)
  if (l) return l.name
  return ledgers.value[0]?.name || '默认账本'
})

async function switchLedger(l: Ledger) {
  if (l.id === store.settings.currentLedgerId) { showLedger.value = false; return }
  await api.put('settings', { currentLedgerId: l.id })
  await loadSettings()
  loading.value = true
  await load()
  showLedger.value = false
}

function memberName(e: Entry) {
  return members.value.find((m) => m.id === e.memberId)?.name || '自己'
}
/** 每行显示 HH:mm（不显示秒） */
function timeHM(e: Entry) {
  return e.entryDate.slice(11, 16)
}

const todayStr = new Date().toISOString().slice(0, 10)
const thisMonth = new Date().toISOString().slice(0, 7)
const thisYear = new Date().getFullYear()

/* ---- 首页月历（仅当月展示，左右箭头跳转到月历页） ---- */
const now = new Date()
const calY = now.getFullYear()
const calM = now.getMonth() + 1
const calDays = new Date(calY, calM, 0).getDate()
const calBlank = (new Date(calY, calM - 1, 1).getDay() + 6) % 7
const calToday = now.getDate()
const pad = (n: number) => String(n).padStart(2, '0')
const ds = (day: number) => `${calY}-${pad(calM)}-${pad(day)}`
function dayStat(day: number): { exp: number; inc: number } {
  const s = ds(day)
  let exp = 0, ref = 0, inc = 0
  for (const e of entries.value) {
    if (!e.entryDate.startsWith(s)) continue
    if (e.flowType === 'expense') exp += e.amount
    else if (e.flowType === 'refund') ref += e.amount
    else if (e.flowType === 'income') inc += e.amount
  }
  return { exp: exp - ref, inc }
}
const dayExp = (d: number) => dayStat(d).exp
const dayInc = (d: number) => dayStat(d).inc
function fmtShort(cents: number): string {
  if (cents <= 0) return ''
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function calPick(day: number) {
  store.entryDefaultDate = ds(day)
  router.push('/entry')
}
function goCalendar() { router.push('/calendar') }

/** 本月数据（固定当前自然月） */
const month = computed(() => {
  let income = 0, expense = 0, refund = 0
  for (const e of entries.value) {
    if (!e.entryDate.startsWith(thisMonth)) continue
    if (e.flowType === 'income') income += e.amount
    else if (e.flowType === 'expense') expense += e.amount
    else if (e.flowType === 'refund') refund += e.amount
  }
  return { income, expense, netExpense: expense - refund }
})

/** 按日分组（倒序，同一天合并；组内按时间倒序） */
const groups = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const e of entries.value) {
    const day = e.entryDate.slice(0, 10)
    if (!map.has(day)) map.set(day, [])
    map.get(day)!.push(e)
  }
  const byTime = (a: Entry, b: Entry) =>
    a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : a.createdAt < b.createdAt ? 1 : -1
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => {
      list.sort(byTime)
      let expense = 0, income = 0
      for (const e of list) {
        if (e.flowType === 'expense') expense += e.amount
        else if (e.flowType === 'income') income += e.amount
      }
      return { date, list, expense, income }
    })
})

function fmtDate(d: string) {
  const y = d.slice(0, 4), m = d.slice(5, 7), day = d.slice(8, 10)
  return Number(y) === thisYear ? `${Number(m)}月${Number(day)}日` : `${y}年${Number(m)}月${Number(day)}日`
}

/** 回到顶部 */
const showTop = ref(false)
function onWinScroll() {
  showTop.value = window.scrollY > 400
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 120) loadMore()
}
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }

function typeLabel(e: Entry) {
  if (e.flowType === 'expense') return e.note || e.categoryName || '支出'
  if (e.flowType === 'income') return e.note || e.categoryName || '收入'
  if (e.flowType === 'transfer') return e.note || '转账'
  return e.note || '退款'
}
function entryIcon(e: Entry) {
  if (e.flowType === 'transfer') return ArrowLeftRight
  return iconForCat({ id: e.categoryId || '', icon: e.categoryIcon, parentIcon: e.categoryParentIcon }, ReceiptText)
}
function subLabel(e: Entry) {
  const parts: string[] = []
  if (e.categoryName && e.note) parts.push(e.categoryName)
  parts.push(memberName(e))
  parts.push(timeHM(e))
  if (e.flowType === 'transfer') {
    parts.push(`${e.accountName || '?'} → ${e.toAccountName || '?'}`)
  } else if (e.accountName) {
    parts.push(e.accountName)
  }
  return parts.join(' · ')
}

onMounted(() => {
  load()
  window.addEventListener('scroll', onWinScroll, { passive: true })
  // 空闲时预加载记一笔页面 chunk，点进去时零等待
  const preload = () => import('./EntryView.vue')
  if ('requestIdleCallback' in window) requestIdleCallback(preload)
  else setTimeout(preload, 800)
})
onActivated(() => {
  window.addEventListener('scroll', onWinScroll, { passive: true })
  if (store.homeDirty) {
    store.homeDirty = false
    load()
  }
})
onDeactivated(() => {
  window.removeEventListener('scroll', onWinScroll)
})
</script>

<template>
  <div class="page home">
    <div class="home-left">
    <!-- 本月收支（顶部集成账本切换） -->
    <div class="hero card">
      <div class="hero-head">
        <button class="hero-ledger" @click="showLedger = true">
          <BookOpen :size="15" />
          {{ currentLedgerName }}
          <ChevronDown :size="13" class="chip-arrow" />
        </button>
        <span class="hero-eye" @click="store.settings.hideAmount = !store.settings.hideAmount">
          <EyeOff v-if="store.settings.hideAmount" :size="16" />
          <Eye v-else :size="16" />
        </span>
      </div>
      <div class="hero-label" @click="router.push('/calendar')" style="cursor:pointer;">
        本月支出 <ChevronRight :size="12" style="vertical-align:middle;opacity:0.7;" />
      </div>
      <div class="hero-amount num">
        {{ store.settings.hideAmount ? '****' : fmtMoney(month.netExpense) }}
      </div>
      <div class="hero-sub muted">
        本月收入 {{ store.settings.hideAmount ? '****' : fmtMoney(month.income) }}
      </div>
    </div>

    <!-- 月历（当月展示，左右箭头跳月历页） -->
    <div class="cal-card card">
      <div class="cal-head">
        <span class="cal-title">{{ calY }}年{{ calM }}月</span>
        <div class="cal-nav">
          <button class="cal-arrow" @click="goCalendar"><ChevronLeft :size="16" /></button>
          <button class="cal-arrow" @click="goCalendar"><ChevronRight :size="16" /></button>
        </div>
      </div>
      <div class="cal-week">
        <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w" class="cal-week-cell">{{ w }}</span>
      </div>
      <div class="cal-grid">
        <span v-for="i in calBlank" :key="'b' + i" class="cal-cell" />
        <div
          v-for="d in calDays" :key="d"
          class="cal-cell" :class="{ today: d === calToday }"
          @click="calPick(d)"
        >
          <span class="cal-day">{{ d }}</span>
          <span v-if="dayExp(d) > 0" class="cal-amt exp">{{ fmtShort(dayExp(d)) }}</span>
          <span v-if="dayInc(d) > 0" class="cal-amt inc">{{ fmtShort(dayInc(d)) }}</span>
        </div>
      </div>
    </div>
    </div>

    <!-- 明细（按日分组） -->
    <div class="card list-card">
      <template v-if="loading">
        <van-skeleton avatar :row="4" style="padding: 12px;" />
      </template>
      <template v-else-if="entries.length === 0">
        <div class="empty">
          <ReceiptText :size="34" />
          <p>还没有记录，点底部「记一笔」开始</p>
        </div>
      </template>
      <template v-else>
        <div v-for="g in groups" :key="g.date" class="day-group">
          <div class="day-head">
            <span>{{ fmtDate(g.date) }} <template v-if="g.date === todayStr">（今）</template></span>
            <span class="muted">
              支 {{ fmtMoney(g.expense) }}
              <template v-if="g.income > 0"> · 收 {{ fmtMoney(g.income) }}</template>
            </span>
          </div>
          <div v-for="e in g.list" :key="e.id" class="row" @click="router.push(`/detail/${e.id}`)">
            <span class="icon-badge" :class="e.flowType">
              <component :is="entryIcon(e)" :size="18" />
            </span>
            <div class="row-main">
              <div class="row-title">{{ typeLabel(e) }}</div>
              <div class="muted">{{ subLabel(e) }}</div>
            </div>
            <span class="num" :class="e.flowType === 'income' ? 'money-income' : 'money-expense'">
              {{ e.flowType === 'expense' || e.flowType === 'transfer' ? '-' : '' }}{{ fmtMoney(e.amount) }}
            </span>
          </div>
        </div>
        <div class="load-more">
          <span v-if="loadingMore">加载中…</span>
          <span v-else-if="!hasMore">没有更多了</span>
        </div>
      </template>
    </div>

    <!-- 账本切换弹层 -->
    <van-popup v-model:show="showLedger" position="center" round class="ledger-pop">
      <div class="pop-head">
        <span class="pop-title">选择账本</span>
        <button class="pop-close" @click="showLedger = false"><X :size="18" /></button>
      </div>
      <div class="ledger-list">
        <button
          v-for="l in ledgers" :key="l.id"
          class="ledger-item" :class="{ sel: l.id === store.settings.currentLedgerId }"
          @click="switchLedger(l)"
        >
          <BookOpen :size="15" class="li-icon" />
          <span class="li-name">{{ l.name }}</span>
          <span v-if="l.id === store.settings.currentLedgerId" class="li-check">✓</span>
        </button>
        <button class="ledger-manage" @click="router.push('/ledgers')">管理账本 →</button>
      </div>
    </van-popup>

    <!-- 回到顶部 -->
    <button v-if="showTop" class="back-top" @click="scrollTop"><ArrowUp :size="18" /></button>
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 12px; }
.home-left { display: flex; flex-direction: column; gap: 14px; }
.ledger-pop { width: 92vw; max-width: 360px; max-height: 70vh; display: flex; flex-direction: column; }
.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 8px; }
.pop-title { font-size: 16px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); display: flex; }
.ledger-list { display: flex; flex-direction: column; gap: 2px; padding: 4px 12px 16px; overflow-y: auto; }
.ledger-item {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 12px; border-radius: 12px; font-size: 14px;
}
.ledger-item.sel { background: var(--brand-soft); color: var(--brand); font-weight: 600; }
.li-icon { color: var(--text2); }
.ledger-item.sel .li-icon { color: var(--brand); }
.li-name { flex: 1; text-align: left; }
.ledger-manage {
  margin: 6px 8px 0; padding: 10px 0; text-align: center;
  border-radius: 12px; border: 1px dashed var(--border);
  color: var(--brand); font-size: 13px;
}
.hero { background: linear-gradient(135deg, var(--brand) 0%, #FF8E5E 100%); border: none; color: #fff; }
.hero-head { display: flex; justify-content: space-between; align-items: center; }
.hero-ledger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 16px;
  background: rgba(255, 255, 255, 0.18); color: #fff;
  font-size: 13px; font-weight: 600;
}
.chip-arrow { opacity: 0.75; }
.hero-eye { cursor: pointer; padding: 4px; }
.hero-label { font-size: 12px; color: rgba(255, 255, 255, 0.78); margin-top: 10px; }
.hero-amount { font-size: 30px; font-weight: 700; margin: 2px 0 2px; }
.hero-sub { color: rgba(255, 255, 255, 0.8) !important; }

/* 月历卡 */
.cal-card { padding: 14px; margin-top: 4px; }
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cal-title { font-size: 15px; font-weight: 700; color: var(--text); }
.cal-nav { display: flex; align-items: center; gap: 8px; }
.cal-arrow {
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--bg); color: var(--text2); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
}
.cal-week { display: grid; grid-template-columns: repeat(7, 1fr); }
.cal-week-cell { text-align: center; font-size: 11px; color: var(--text2); padding: 2px 0; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-top: 2px; }
.cal-cell {
  height: 40px; border-radius: 8px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 1px; position: relative;
  min-width: 0; overflow: hidden;
}
.cal-day { font-size: 12px; font-weight: 500; color: var(--text); line-height: 1.1; }
.cal-amt {
  font-size: 9px; line-height: 1.2;
  width: 100%; min-width: 0; text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0 2px;
}
.cal-amt.exp { color: var(--expense); font-weight: 700; }
.cal-amt.inc { color: var(--income); font-weight: 700; }
/* 今天：空心高亮 */
.cal-cell.today { outline: 1.5px solid var(--brand); outline-offset: -1.5px; border-radius: 8px; }
.cal-cell.today .cal-day { font-weight: 700; color: var(--brand); }
.cal-cell.today .cal-amt { color: var(--text2); }

.list-card { padding: 6px 14px 12px; }
.day-group { margin-top: 8px; }
.day-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: var(--text2);
  padding: 8px 0 2px; border-bottom: 1px dashed var(--border);
}
.row-main { flex: 1; min-width: 0; }
.row { cursor: pointer; }
.row-title { font-size: 14px; }

/* PC：左列（收支卡+月历）与明细左右分栏 */
@media (min-width: 768px) {
  .home { display: flex; flex-direction: row; align-items: flex-start; gap: 16px; }
  .home-left { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; gap: 16px; }
  .list-card { flex: 1; min-width: 0; }
  .hero-amount { font-size: 36px; }
}
.empty { text-align: center; color: var(--text2); padding: 40px 0 30px; }
.empty p { margin-top: 8px; }
.load-more { text-align: center; color: var(--text2); font-size: 12px; padding: 16px 0 8px; }
.back-top {
  position: fixed; right: 20px; bottom: 100px;
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--brand); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(255, 107, 74, 0.35);
  z-index: 100;
}
</style>
