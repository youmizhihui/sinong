<script setup lang="ts">
defineOptions({ name: 'AccountDetailView' })
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Entry, type Member } from '../api'
import { store, fmtMoney } from '../store'
import { ArrowLeft, Pencil, ReceiptText, Trash2, ArrowLeftRight, ArrowUp, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { iconForCat } from '../catIcons'
import { showToast, showConfirmDialog } from 'vant'

const route = useRoute()
const router = useRouter()
const accountId = route.params.id as string

const account = ref<any>(null)
const members = ref<Member[]>([])
const loading = ref(true)
const showEdit = ref(false)
const editForm = ref({ name: '', note: '', type: 'cash', statementDay: 1, statementDayIncluded: false })
const showTop = ref(false)

/** 账期（服务端聚合） */
interface Cycle {
  key: string
  start: string
  end: string
  income: number
  expense: number
  open: number
  close: number
  count: number
}
const cycles = ref<Cycle[]>([])
const hasMoreCycles = ref(false)
const loadingMoreCycles = ref(false)
/** 每期明细：key → entries，展开时按需加载 */
const cycleEntries = ref<Record<string, Entry[]>>({})
const loadingCycle = ref<Record<string, boolean>>({})
const openCycles = ref<Record<string, boolean>>({})

const TYPE_LABEL: Record<string, string> = {
  cash: '现金', savings: '储蓄卡', credit: '信用卡', online: '网络账户',
  investment: '投资账户', stored: '储值卡', receivable: '应收应付', archived: '已封存',
}

async function load() {
  loading.value = true
  try {
    const [acc, cyc, ms] = await Promise.all([
      api.get<any>(`accounts/${accountId}`).catch(() => null),
      api.get<{ cycles: Cycle[]; hasMore: boolean }>(`accounts/${accountId}/cycles`)
        .catch(() => ({ cycles: [] as Cycle[], hasMore: false })),
      api.get<Member[]>('members').catch(() => [] as Member[]),
    ])
    account.value = acc
    cycles.value = cyc.cycles
    hasMoreCycles.value = cyc.hasMore
    members.value = ms
    // 重新载入后：只看最新一期，默认展开
    cycleEntries.value = {}
    openCycles.value = {}
    const first = cyc.cycles[0]
    if (first) {
      openCycles.value[first.key] = true
      loadCycleEntries(first)
    }
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

/** 加载更早的账期（游标 = 当前最早一期） */
async function loadMoreCycles() {
  if (loadingMoreCycles.value || !hasMoreCycles.value) return
  const last = cycles.value[cycles.value.length - 1]
  if (!last) return
  loadingMoreCycles.value = true
  try {
    const d = await api.get<{ cycles: Cycle[]; hasMore: boolean }>(
      `accounts/${accountId}/cycles?before=${encodeURIComponent(last.key)}`
    )
    const known = new Set(cycles.value.map((c) => c.key))
    for (const c of d.cycles) if (!known.has(c.key)) cycles.value.push(c)
    hasMoreCycles.value = d.hasMore
  } catch (e) {
    showToast((e as Error).message)
  }
  loadingMoreCycles.value = false
}

/** 加载某期流水明细（展开时按需拉取，避免一次性拉全量） */
async function loadCycleEntries(c: Cycle) {
  if (cycleEntries.value[c.key] || loadingCycle.value[c.key]) return
  loadingCycle.value[c.key] = true
  try {
    const to = encodeURIComponent(`${c.end} 23:59:59`)
    const d = await api.get<{ entries: Entry[] }>(
      `entries?accountId=${accountId}&from=${c.start}&to=${to}&limit=5000`
    )
    cycleEntries.value[c.key] = d.entries
  } catch (e) {
    console.error(e)
    showToast((e as Error).message)
  }
  loadingCycle.value[c.key] = false
}

function toggleCycle(c: Cycle) {
  const open = !openCycles.value[c.key]
  openCycles.value[c.key] = open
  if (open) loadCycleEntries(c)
}

function onScroll() {
  showTop.value = document.documentElement.scrollTop > 400
}

function scrollTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  load()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})

function openEdit() {
  if (!account.value) return
  editForm.value = {
    name: account.value.name,
    note: account.value.note || '',
    type: account.value.type,
    statementDay: account.value.statement_day || 1,
    statementDayIncluded: !!account.value.statement_day_included,
  }
  showEdit.value = true
}

async function saveEdit() {
  if (!editForm.value.name.trim()) { showToast('请输入账户名称'); return }
  try {
    await api.put(`accounts/${accountId}`, {
      name: editForm.value.name.trim(),
      note: editForm.value.note.trim() || null,
      type: editForm.value.type,
      statementDay: editForm.value.statementDay || 1,
      statementDayIncluded: editForm.value.statementDay > 1 ? editForm.value.statementDayIncluded : false,
    })
    store.accountsDirty = true
    showToast('已保存')
    showEdit.value = false
    await load()
  } catch (e) {
    showToast((e as Error).message)
  }
}

async function delAccount() {
  try {
    await showConfirmDialog({ title: '删除账户', message: '确认删除该账户？无流水的账户才可删除。', confirmButtonText: '删除' })
  } catch { return }
  try {
    await api.del(`accounts/${accountId}`)
    store.accountsDirty = true
    showToast('已删除')
    router.back()
  } catch (e) {
    showToast((e as Error).message)
  }
}

function memberName(e: Entry) {
  return members.value.find((m) => m.id === e.memberId)?.name || '自己'
}
function timeHM(e: Entry) { return e.entryDate.slice(11, 16) }

const stat = computed(() => ({
  income: account.value?.statIncome || 0,
  expense: account.value?.statExpense || 0,
  net: (account.value?.statIncome || 0) - (account.value?.statExpense || 0),
}))

// ---- 账期（服务端聚合，所有账户按账单日分期） ----
function cycleLabel(key: string) {
  return `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`
}
function periodLabel(c: Cycle) {
  return `${c.start.slice(5)} ~ ${c.end.slice(5)}`
}
/** 账期内再按天分组 */
function dayGroupsOf(list: Entry[]) {
  const map = new Map<string, Entry[]>()
  for (const e of list) {
    const day = e.entryDate.slice(0, 10)
    if (!map.has(day)) map.set(day, [])
    map.get(day)!.push(e)
  }
  return [...map.entries()].map(([date, l]) => ({ date, list: l }))
}

function fmtDate(d: string) {
  const y = d.slice(0, 4), m = d.slice(5, 7), day = d.slice(8, 10)
  return Number(y) === new Date().getFullYear() ? `${Number(m)}月${Number(day)}日` : `${y}年${Number(m)}月${Number(day)}日`
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
  if (e.platform) parts.push(e.platform)
  return parts.join(' · ')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="acc-top">
      <button class="back-btn" @click="router.back()"><ArrowLeft :size="18" /></button>
      <span class="acc-page-title">账户详情</span>
      <button class="edit-btn" @click="openEdit"><Pencil :size="16" /></button>
    </div>

    <!-- 账户信息卡 -->
    <div class="acc-hero card">
      <div class="acc-name">{{ account?.name || '—' }}</div>
      <div class="acc-type">{{ TYPE_LABEL[account?.type] || account?.type }}</div>
      <div class="acc-balance num">{{ store.settings.hideAmount ? '****' : fmtMoney(account?.currentBalance ?? 0) }}</div>
      <div class="acc-stat">
        <span>收入 <b class="money-income">{{ fmtMoney(stat.income) }}</b></span>
        <span class="stat-sep">·</span>
        <span>支出 <b class="money-expense">{{ fmtMoney(stat.expense) }}</b></span>
      </div>
      <div v-if="account?.note" class="acc-note">{{ account.note }}</div>
    </div>

    <!-- 流水列表（按账期分组） -->
    <div class="card list-card" style="margin-top: 12px;">
      <template v-if="loading">
        <van-skeleton avatar :row="3" style="padding: 12px;" />
      </template>
      <template v-else-if="cycles.length === 0">
        <div class="empty">
          <ReceiptText :size="34" />
          <p>该账户暂无流水</p>
        </div>
      </template>
      <template v-else>
        <div v-for="c in cycles" :key="c.key" class="cycle-group">
          <div class="cycle-head" @click="toggleCycle(c)">
            <div class="cycle-title">
              <ChevronDown v-if="openCycles[c.key]" :size="15" class="muted" />
              <ChevronRight v-else :size="15" class="muted" />
              <span class="cycle-name">{{ cycleLabel(c.key) }}</span>
              <span class="muted cycle-period">{{ periodLabel(c) }}</span>
            </div>
            <div class="cycle-meta muted">
              <span class="money-income">收入 {{ fmtMoney(c.income) }}</span>
              <span class="money-expense">支出 {{ fmtMoney(c.expense) }}</span>
              <span>期末余额 {{ fmtMoney(c.close) }}</span>
            </div>
          </div>
          <template v-if="openCycles[c.key]">
            <div v-if="loadingCycle[c.key]" class="load-more">加载中…</div>
            <template v-else>
              <div v-for="dg in dayGroupsOf(cycleEntries[c.key] || [])" :key="dg.date" class="day-group cycle-day">
                <div class="day-head"><span>{{ fmtDate(dg.date) }}</span></div>
                <div v-for="e in dg.list" :key="e.id" class="row" @click="router.push(`/detail/${e.id}`)">
                  <span class="icon-badge" :class="e.flowType">
                    <component :is="entryIcon(e)" :size="18" />
                  </span>
                  <div class="row-main">
                    <div class="row-title">{{ e.note || e.categoryName || (e.flowType === 'income' ? '收入' : e.flowType === 'transfer' ? '转账' : '支出') }}</div>
                    <div class="muted">{{ subLabel(e) }}</div>
                  </div>
                  <span class="num" :class="e.flowType === 'income' ? 'money-income' : 'money-expense'">
                    {{ e.flowType === 'expense' || e.flowType === 'transfer' ? '-' : '' }}{{ fmtMoney(Math.abs(e.amount)) }}
                  </span>
                </div>
              </div>
              <div v-if="(cycleEntries[c.key] || []).length === 0" class="load-more end">本期没有流水</div>
            </template>
          </template>
        </div>
        <button v-if="hasMoreCycles" class="load-more-btn" :disabled="loadingMoreCycles" @click="loadMoreCycles">
          {{ loadingMoreCycles ? '加载中…' : '加载更早账期' }}
        </button>
        <div v-else class="load-more end">已到最早一期（{{ cycles.length }} 期）</div>
      </template>
    </div>

    <!-- 回到顶部 -->
    <button v-if="showTop" class="back-top" @click="scrollTop"><ArrowUp :size="18" /></button>

    <!-- 编辑弹层 -->
    <van-popup v-model:show="showEdit" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">编辑账户</span>
        <button class="pop-close" @click="showEdit = false"><span style="font-size:20px;">×</span></button>
      </div>
      <div class="form-body">
        <div class="type-grid">
          <button
            v-for="(label, t) in TYPE_LABEL" :key="t"
            class="type-item" :class="{ sel: editForm.type === t }"
            @click="editForm.type = t"
          >{{ label }}</button>
        </div>
        <input v-model="editForm.name" class="field" placeholder="账户名称" />
        <input v-model="editForm.note" class="field" placeholder="备注（可选）" />
        <div class="credit-box">
          <div class="credit-row">
            <span class="credit-label">账单日</span>
            <select v-model.number="editForm.statementDay" class="field day-select">
              <option v-for="d in 31" :key="d" :value="d">{{ d }} 日</option>
            </select>
          </div>
          <label v-if="editForm.statementDay > 1" class="privacy-row">
            <input v-model="editForm.statementDayIncluded" type="checkbox" />
            <span>账单日消费计入本期账单</span>
            <small>默认不计入，归入下一期</small>
          </label>
          <div class="credit-tip">账期按月分组：1 号即自然月；修改账单日后，历史流水将按新账期重新划分</div>
        </div>
        <button class="save-btn" :disabled="!editForm.name.trim()" @click="saveEdit">保存</button>
        <button class="del-btn" @click="delAccount"><Trash2 :size="14" /> 删除账户</button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.acc-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0 4px;
}
.back-btn, .edit-btn {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--card); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text); cursor: pointer;
}
.acc-page-title { font-size: 16px; font-weight: 600; }
.acc-hero {
  background: linear-gradient(135deg, var(--brand) 0%, #FF8E5E 100%);
  border: none; color: #fff; text-align: center; padding: 20px 14px;
}
.acc-name { font-size: 15px; font-weight: 600; opacity: 0.9; }
.acc-type { font-size: 12px; opacity: 0.7; margin-top: 2px; }
.acc-balance { font-size: 32px; font-weight: 700; margin: 10px 0 6px; }
.acc-stat { font-size: 12px; opacity: 0.85; }
.acc-stat b { font-weight: 600; }
.stat-sep { margin: 0 6px; opacity: 0.5; }
.acc-note { font-size: 12px; opacity: 0.7; margin-top: 6px; }
.empty { text-align: center; color: var(--text2); padding: 40px 0 30px; }
.empty p { margin-top: 8px; }
.pop-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px 12px; border-bottom: 1px solid var(--border);
}
.pop-title { font-size: 16px; font-weight: 600; }
.pop-close { padding: 4px 8px; color: var(--text2); background: none; border: none; cursor: pointer; }
.form-body { padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 12px; }
.type-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.type-item {
  padding: 10px 0; border-radius: 10px; border: 1px solid var(--border);
  background: var(--card); font-size: 13px; cursor: pointer; color: var(--text);
}
.type-item.sel { background: var(--brand-soft); border-color: var(--brand); color: var(--brand); font-weight: 600; }
.field {
  border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; width: 100%;
}
.save-btn {
  padding: 12px; border: none; border-radius: 12px;
  background: var(--brand); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
}
.save-btn:disabled { opacity: 0.5; }
.del-btn {
  padding: 10px; border: none; border-radius: 12px;
  background: var(--bg); color: var(--expense); font-size: 14px;
  display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
}
.load-more {
  text-align: center; padding: 16px 0; font-size: 13px; color: var(--text2);
}
.load-more.end { opacity: 0.5; }
.load-more-btn {
  display: block; width: 100%; margin: 4px 0 6px; padding: 11px 0;
  background: transparent; border: 1px dashed var(--border); border-radius: var(--radius);
  font-size: 13px; color: var(--text2); cursor: pointer;
}
.load-more-btn:disabled { opacity: 0.6; }

/* 信用卡账期分组 */
.cycle-group { border-bottom: 1px solid var(--border); }
.cycle-group:last-of-type { border-bottom: none; }
.cycle-head {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 4px 8px; cursor: pointer;
  background: var(--bg); border-radius: 8px; margin: 6px 0;
}
.cycle-title { display: flex; align-items: center; gap: 6px; }
.cycle-name { font-size: 14px; font-weight: 600; }
.cycle-period { font-size: 12px; }
.cycle-meta { display: flex; gap: 12px; font-size: 11px; padding-left: 21px; flex-wrap: wrap; }
.cycle-day { border-top: none; }
.cycle-group .day-head { padding-left: 4px; }
.credit-box { display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1px dashed var(--border); border-radius: 10px; }
.credit-row { display: flex; align-items: center; gap: 10px; }
.credit-label { font-size: 13px; white-space: nowrap; }
.day-select { flex: 1; padding: 8px 10px; }
.privacy-row { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.privacy-row small { color: var(--text2); font-size: 11px; margin-left: 4px; }
.credit-tip { font-size: 11px; color: var(--text2); }
.back-top {
  position: fixed; right: 16px; bottom: 80px;
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--card); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text2); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  z-index: 10;
}
</style>
