<script setup lang="ts">
defineOptions({ name: 'ReportsView' })
import { ref, computed, onMounted, watch } from 'vue'
import { api, type Category } from '../api'
import { store, fmtMoney } from '../store'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from 'lucide-vue-next'

interface Summary {
  income: number
  expense: number
  refund: number
  transfer: number
  netExpense: number
  balance: number
  categories: { categoryId: string; amount: number }[]
}
interface Trend {
  month: string
  income: number
  expense: number
  netExpense: number
}

const y = ref(new Date().getFullYear())
const m = ref(new Date().getMonth() + 1)
const summary = ref<Summary | null>(null)
const trend = ref<Trend[]>([])
const loading = ref(true)
const catNames = new Map<string, string>()

const monthKey = computed(() => `${y.value}-${String(m.value).padStart(2, '0')}`)

async function loadCats() {
  try {
    for (const t of ['expense', 'income'] as const) {
      const d = await api.get<{ groups: Category[] }>(`categories?type=${t}`)
      for (const g of d.groups) {
        catNames.set(g.id, g.name)
        for (const c of g.children || []) catNames.set(c.id, c.name)
      }
    }
  } catch { /* 分类映射失败不阻塞 */ }
}

async function load() {
  loading.value = true
  try {
    const lid = store.settings.currentLedgerId ?? ''
    const [s, t] = await Promise.all([
      api.get<Summary>(`reports/summary?ledgerId=${lid}&month=${monthKey.value}`),
      api.get<{ items: Trend[] }>(`reports/trend?ledgerId=${lid}&months=6`),
    ])
    summary.value = s
    trend.value = t.items
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function shift(delta: number) {
  const d = new Date(y.value, m.value - 1 + delta, 1)
  y.value = d.getFullYear()
  m.value = d.getMonth() + 1
}
onMounted(async () => {
  await loadCats()
  await load()
})
watch(monthKey, load)

const expCats = computed(() => {
  if (!summary.value) return []
  const total = summary.value.expense || 1
  return summary.value.categories
    .map((c) => ({ ...c, name: catNames.get(c.categoryId) || '未分类', pct: Math.round((c.amount / total) * 100) }))
    .slice(0, 8)
})
const maxTrend = computed(() => {
  const all = trend.value.flatMap((t) => [t.income, t.expense, t.netExpense])
  return Math.max(1, ...all)
})
</script>

<template>
  <div class="page reports">
    <div class="page-title">报表</div>

    <!-- 月份切换 -->
    <div class="month-bar">
      <button class="m-btn" @click="shift(-1)"><ChevronLeft :size="18" /></button>
      <span class="m-label">{{ y }}年{{ m }}月</span>
      <button class="m-btn" @click="shift(1)"><ChevronRight :size="18" /></button>
    </div>

    <template v-if="loading">
      <van-skeleton title :row="4" style="padding: 16px;" />
    </template>
    <template v-else>
      <!-- 月度统计 -->
      <div class="stat-card">
        <div class="stat">
          <span class="stat-label">收入</span>
          <span class="stat-num income">{{ fmtMoney(summary?.income || 0) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">支出</span>
          <span class="stat-num expense">{{ fmtMoney(summary?.expense || 0) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">结余</span>
          <span class="stat-num" :class="(summary?.balance ?? 0) >= 0 ? 'income' : 'expense'">
            {{ fmtMoney(summary?.balance ?? 0) }}
          </span>
        </div>
        <div class="stat-sub muted">
          退款 {{ fmtMoney(summary?.refund || 0) }} · 转账 {{ fmtMoney(summary?.transfer || 0) }}
        </div>
      </div>

      <!-- 支出构成 -->
      <div class="card section">
        <div class="sec-head"><TrendingDown :size="16" /> 支出构成</div>
        <div v-if="expCats.length === 0" class="muted" style="padding: 8px 0;">本月暂无支出</div>
        <div v-else class="bars">
          <div v-for="c in expCats" :key="c.categoryId" class="bar-row">
            <span class="bar-name">{{ c.name }}</span>
            <div class="bar-track">
              <div class="bar-fill expense-fill" :style="{ width: c.pct + '%' }" />
            </div>
            <span class="bar-val">{{ fmtMoney(c.amount) }}</span>
            <span class="bar-pct muted">{{ c.pct }}%</span>
          </div>
        </div>
      </div>

      <!-- 近 6 月趋势 -->
      <div class="card section">
        <div class="sec-head"><TrendingUp :size="16" /> 近 6 月趋势</div>
        <div class="trend">
          <div v-for="t in trend" :key="t.month" class="trend-col">
            <div class="trend-bars">
              <div
                class="trend-bar income"
                :style="{ height: Math.max(3, Math.round((t.income / maxTrend) * 64)) + 'px' }"
              />
              <div
                class="trend-bar expense"
                :style="{ height: Math.max(3, Math.round((t.netExpense / maxTrend) * 64)) + 'px' }"
              />
            </div>
            <span class="trend-month muted">{{ t.month.slice(5) }}月</span>
          </div>
        </div>
        <div class="trend-legend muted">
          <span><i class="dot income" />收入</span>
          <span><i class="dot expense" />净支出</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.reports { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }
.month-bar { display: flex; align-items: center; justify-content: space-between; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; }
.m-btn { padding: 4px; color: var(--text2); display: flex; }
.m-label { font-size: 15px; font-weight: 600; }

.stat-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
.stat { flex: 1 1 80px; display: flex; flex-direction: column; gap: 4px; }
.stat-label { font-size: 12px; color: var(--text2); }
.stat-num { font-size: 18px; font-weight: 700; }
.stat-num.income { color: var(--income); }
.stat-num.expense { color: var(--expense); }
.stat-sub { width: 100%; font-size: 11px; }

.section { padding: 14px; }
.sec-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--text); }
.bars { display: flex; flex-direction: column; gap: 10px; }
.bar-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.bar-name { width: 56px; flex-shrink: 0; color: var(--text); }
.bar-track { flex: 1; height: 8px; border-radius: 4px; background: var(--bg); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; }
.expense-fill { background: var(--expense); }
.bar-val { width: 62px; text-align: right; font-weight: 600; }
.bar-pct { width: 34px; text-align: right; font-size: 11px; }

.trend { display: flex; gap: 6px; align-items: flex-end; justify-content: space-between; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.trend-bars { display: flex; align-items: flex-end; gap: 3px; height: 68px; }
.trend-bar { width: 10px; border-radius: 3px 3px 0 0; }
.trend-bar.income { background: var(--income); }
.trend-bar.expense { background: var(--expense); }
.trend-month { font-size: 10px; }
.trend-legend { display: flex; gap: 16px; margin-top: 10px; font-size: 11px; align-items: center; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
.dot.income { background: var(--income); }
.dot.expense { background: var(--expense); }
</style>
