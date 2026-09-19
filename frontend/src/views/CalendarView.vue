<script setup lang="ts">
defineOptions({ name: 'CalendarView' })
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, type Entry, type Member } from '../api'
import { store, fmtMoney } from '../store'
import { ChevronLeft, ChevronRight, ArrowLeft, ReceiptText, ChevronDown, ArrowLeftRight } from 'lucide-vue-next'
import { iconForCat } from '../catIcons'
import { DatePicker as VanDatePicker} from 'vant';

const router = useRouter()
const entries = ref<Entry[]>([])
const members = ref<Member[]>([])
const loading = ref(true)

const now = new Date()
const calY = ref(now.getFullYear())
const calM = ref(now.getMonth() + 1)
const showYM = ref(false)
const ymPickerValue = ref([String(calY.value), String(calM.value).padStart(2, '0')])

function onYMConfirm({ selectedValues }: { selectedValues: string[] }) {
  calY.value = Number(selectedValues[0])
  calM.value = Number(selectedValues[1])
  showYM.value = false
  load()
}

const pad = (n: number) => String(n).padStart(2, '0')
const monthStr = computed(() => `${calY.value}-${pad(calM.value)}`)

async function load() {
  loading.value = true
  try {
    const [d, ms] = await Promise.all([
      api.get<{ entries: Entry[] }>(`entries?ledgerId=${store.settings.currentLedgerId ?? ''}&month=${monthStr.value}`),
      api.get<Member[]>('members').catch(() => [] as Member[]),
    ])
    entries.value = d.entries
    members.value = ms
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

function calMove(dir: number) {
  let m = calM.value + dir
  let y = calY.value
  if (m < 1) { m = 12; y-- } else if (m > 12) { m = 1; y++ }
  calY.value = y
  calM.value = m
  load()
}

const calDays = computed(() => new Date(calY.value, calM.value, 0).getDate())
const calBlank = computed(() => (new Date(calY.value, calM.value - 1, 1).getDay() + 6) % 7)
const calToday = computed(() => {
  const t = new Date()
  return t.getFullYear() === calY.value && t.getMonth() + 1 === calM.value ? t.getDate() : 0
})
const ds = (day: number) => `${calY.value}-${pad(calM.value)}-${pad(day)}`

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
function fmtShort(cents: number): string {
  if (cents <= 0) return ''
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function calPick(day: number) {
  store.entryDefaultDate = ds(day)
  router.push('/entry')
}

const monthStat = computed(() => {
  let income = 0, expense = 0, refund = 0
  for (const e of entries.value) {
    if (e.flowType === 'income') income += e.amount
    else if (e.flowType === 'expense') expense += e.amount
    else if (e.flowType === 'refund') refund += e.amount
  }
  return { income, expense, netExpense: expense - refund }
})

function memberName(e: Entry) {
  return members.value.find((m) => m.id === e.memberId)?.name || '自己'
}
function timeHM(e: Entry) { return e.entryDate.slice(11, 16) }

const groups = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const e of entries.value) {
    const day = e.entryDate.slice(0, 10)
    if (!map.has(day)) map.set(day, [])
    map.get(day)!.push(e)
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, list]) => {
    let exp = 0, inc = 0
    for (const e of list) {
      if (e.flowType === 'expense') exp += e.amount
      else if (e.flowType === 'income') inc += e.amount
    }
    return { date, list: list.sort((a, b) => a.entryDate < b.entryDate ? 1 : -1), expense: exp, income: inc }
  })
})

function fmtDate(d: string) {
  const y = d.slice(0, 4), m = d.slice(5, 7), day = d.slice(8, 10)
  const thisYear = new Date().getFullYear()
  return Number(y) === thisYear ? `${Number(m)}月${Number(day)}日` : `${y}年${Number(m)}月${Number(day)}日`
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
onMounted(load)
</script>

<template>
  <div class="page">
    <div class="cal-top">
      <button class="back-btn" @click="router.back()"><ArrowLeft :size="18" /></button>
      <span class="cal-page-title">月历</span>
    </div>

    <div class="cal-card card">
      <div class="cal-head">
        <button class="cal-arrow" @click="calMove(-1)"><ChevronLeft :size="16" /></button>
        <span class="cal-pick" @click="showYM = true">{{ calY }}年{{ calM }}月<ChevronDown :size="12" /></span>
        <button class="cal-arrow" @click="calMove(1)"><ChevronRight :size="16" /></button>
      </div>
      <div class="cal-week">
        <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w" class="cal-week-cell">{{ w }}</span>
      </div>
      <div class="cal-grid">
        <span v-for="i in calBlank" :key="'b' + i" class="cal-cell" />
        <div
          v-for="d in calDays" :key="d"
          class="cal-cell" :class="{ today: d === calToday, selected: false }"
          @click="calPick(d)"
        >
          <span class="cal-day">{{ d }}</span>
          <span class="cal-amt exp" v-if="dayStat(d).exp > 0">{{ fmtShort(dayStat(d).exp) }}</span>
          <span class="cal-amt inc" v-if="dayStat(d).inc > 0">{{ fmtShort(dayStat(d).inc) }}</span>
        </div>
      </div>
      <div class="cal-stat">
        支出 <span class="num money-expense">{{ fmtMoney(monthStat.netExpense) }}</span>
        <span class="stat-sep">·</span>
        收入 <span class="num money-income">{{ fmtMoney(monthStat.income) }}</span>
      </div>
    </div>

    <div class="card list-card" style="margin-top: 12px;">
      <template v-if="loading">
        <van-skeleton avatar :row="4" style="padding: 12px;" />
      </template>
      <template v-else-if="entries.length === 0">
        <div class="empty">
          <ReceiptText :size="34" />
          <p>本月暂无记录</p>
        </div>
      </template>
      <template v-else>
        <div v-for="g in groups" :key="g.date" class="day-group">
          <div class="day-head">
            <span>{{ fmtDate(g.date) }}</span>
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
              <div class="row-title">{{ e.note || e.categoryName || (e.flowType === 'income' ? '收入' : e.flowType === 'transfer' ? '转账' : '支出') }}</div>
              <div class="muted">{{ subLabel(e) }}</div>
            </div>
            <span class="num" :class="e.flowType === 'income' ? 'money-income' : 'money-expense'">
              {{ e.flowType === 'expense' || e.flowType === 'transfer' ? '-' : '' }}{{ fmtMoney(e.amount) }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- 年月选择弹层 -->
    <van-popup v-model:show="showYM" position="bottom" round>
      <VanDatePicker
        v-model="ymPickerValue"
        title="选择年月"
        :columns-type="['year', 'month']"
        :min-date="new Date(2000, 0, 1)"
        :max-date="new Date(2100, 11, 31)"
        @confirm="onYMConfirm"
        @cancel="showYM = false"
      />
    </van-popup>
  </div>
</template>

<style scoped>
.cal-top {
  display: flex; align-items: center; padding: 12px 16px 4px;
}
.back-btn {
  width: 32px; height: 32px; border: none; background: var(--card); border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text);
}
.cal-page-title { font-size: 16px; font-weight: 600; margin-left: 12px; }
.cal-stat {
  text-align: center; padding: 10px 0 4px; font-size: 13px; color: var(--text2);
  border-top: 1px solid var(--border); margin-top: 8px;
}
.stat-sep { margin: 0 8px; color: var(--border); }
.cal-pick {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 2px 6px; border-radius: 6px; cursor: pointer;
}
.cal-pick:hover { background: var(--bg); }
.cal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 8px 10px;
}
.cal-arrow {
  width: 32px; height: 32px; border: none; background: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text2); border-radius: 50%;
}
.cal-arrow:hover { background: var(--bg); }
.empty { text-align: center; color: var(--text2); padding: 40px 0 30px; }
.empty p { margin-top: 8px; }
</style>
