<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast, DatePicker as VanDatePicker } from 'vant'
import { api, type Account, type Category, type AccountsData } from '../api'
import { store } from '../store'
import { iconForCat, iconForGroup } from '../catIcons'
import { ArrowLeft, Plus, RefreshCw, X, ChevronDown, Check, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const router = useRouter()

interface Periodic {
  id: string
  ledger_id: string
  account_id: string
  category_id: string | null
  name: string
  amount: number
  flow_type: string
  frequency: string
  start_date: string
  end_date: string | null
  status: string
  note: string | null
  nextDue: string | null
  created_at: string
}

const items = ref<Periodic[]>([])
const loading = ref(true)
const showForm = ref(false)
const editing = ref<Periodic | null>(null)
const saving = ref(false)
const showMenu = ref(false)
const menuTarget = ref<Periodic | null>(null)

// 表单状态
const fName = ref('')
const fAmount = ref('')
const fFlow = ref<'expense' | 'income'>('expense')
const fFreqMode = ref('monthly')
const fFreqN = ref(1)
const fCategoryId = ref('')
const fAccountId = ref('')
const fStart = ref('')
const fEnd = ref('')
const fNote = ref('')
const showCat = ref(false)
const showAcc = ref(false)
const cats = ref<Category[]>([])
const accounts = ref<Account[]>([])
const activeGroup = ref('')

const TYPE_LABEL: Record<string, string> = {
  cash: '现金', savings: '储蓄卡', credit: '信用卡', online: '网络账户',
  investment: '投资账户', stored: '储值卡', receivable: '应收应付', archived: '已封存',
}
function typeLabel(t: string) { return TYPE_LABEL[t] || t }

// 日期选择器
const showDatePicker = ref(false)
const showYM = ref(false)
const datePickTarget = ref<'start' | 'end'>('start')
const pickY = ref(new Date().getFullYear())
const pickM = ref(new Date().getMonth() + 1)
const pickD = ref(new Date().getDate())
const WEEK_HEADER = ['一', '二', '三', '四', '五', '六', '日']
const today = new Date()
const ymPickerValue = ref([String(pickY.value), String(pickM.value).padStart(2, '0')])
const dayCells = computed(() => {
  const first = new Date(pickY.value, pickM.value - 1, 1).getDay()
  const lead = first === 0 ? 6 : first - 1
  const dim = new Date(pickY.value, pickM.value, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push(d)
  return cells
})
function isToday(d: number | null) {
  return !!d && pickY.value === today.getFullYear() && pickM.value === today.getMonth() + 1 && d === today.getDate()
}
function isSel(d: number | null) {
  return !!d && d === pickD.value
}
function prevMonth() {
  if (pickM.value === 1) { pickM.value = 12; pickY.value-- }
  else pickM.value--
}
function nextMonth() {
  if (pickM.value === 12) { pickM.value = 1; pickY.value++ }
  else pickM.value++
}
function openDatePicker(target: 'start' | 'end') {
  datePickTarget.value = target
  const val = target === 'start' ? fStart.value : fEnd.value
  const d = val ? new Date(val + 'T00:00:00') : new Date()
  pickY.value = d.getFullYear()
  pickM.value = d.getMonth() + 1
  pickD.value = d.getDate()
  showDatePicker.value = true
}
function confirmDate() {
  const s = `${pickY.value}-${String(pickM.value).padStart(2, '0')}-${String(pickD.value).padStart(2, '0')}`
  if (datePickTarget.value === 'start') fStart.value = s
  else fEnd.value = s
  showDatePicker.value = false
}
function openYMPicker() {
  ymPickerValue.value = [String(pickY.value), String(pickM.value).padStart(2, '0')]
  showYM.value = true
}
function onYMConfirm({ selectedValues }: { selectedValues: string[] }) {
  pickY.value = Number(selectedValues[0])
  pickM.value = Number(selectedValues[1])
  const dim = new Date(pickY.value, pickM.value, 0).getDate()
  if (pickD.value > dim) pickD.value = dim
  showYM.value = false
}

const FREQ_MODES = [
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
  { key: 'yearly', label: '每年' },
]

const catGroups = computed(() => cats.value.filter((c) => !c.parent_id))
const activeChildren = computed(() => {
  const g = cats.value.find((c) => c.id === activeGroup.value)
  return (g?.children || []).map((c) => ({ ...c, parentIcon: g?.icon }))
})
const currentCatName = computed(() => {
  const flat = cats.value.flatMap((g) => g.children || [])
  return flat.find((c) => c.id === fCategoryId.value)?.name || '未选'
})
const currentAccName = computed(() => accounts.value.find((a) => a.id === fAccountId.value)?.name || '未选')
const accGroups = computed(() => {
  const map: Record<string, Account[]> = {}
  for (const a of accounts.value) {
    if (!map[a.type]) map[a.type] = []
    map[a.type].push(a)
  }
  return Object.entries(map).map(([type, items]) => ({ type, items, count: items.length }))
})

function freqText(f: string): string {
  const p = String(f).split(':')
  const n = Number(p[1] || 1)
  switch (p[0]) {
    case 'daily': return `每 ${n} 天`
    case 'weekly': return `每 ${n} 周`
    case 'monthly': return `每 ${n} 个月${p[2] ? `（${p[2]} 日）` : ''}`
    case 'yearly': return `每年`
    default: return f
  }
}

async function loadCats() {
  try {
    const d = await api.get<{ groups: Category[] }>(`categories?type=${fFlow.value}`)
    cats.value = d.groups
    activeGroup.value = d.groups[0]?.id || ''
  } catch { cats.value = [] }
}
async function loadAccounts() {
  try {
    const d = await api.get<AccountsData>('accounts')
    accounts.value = Object.values(d.groups).flatMap((g) => g.items)
  } catch { accounts.value = [] }
}

async function load() {
  try {
    const d = await api.get<{ items: Periodic[] }>(`periodic?ledgerId=${store.settings.currentLedgerId ?? ''}`)
    items.value = d.items
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loading.value = false
  }
}
onMounted(async () => { await Promise.all([load(), loadCats(), loadAccounts()]) })

async function syncNow() {
  try {
    const r = await api.post<{ created: number }>('periodic/sync', {})
    showToast(r.created > 0 ? `已生成 ${r.created} 笔到期记录` : '没有到期待生成的记录')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  }
}

function openAdd() {
  editing.value = null
  fName.value = ''
  fAmount.value = ''
  fFlow.value = 'expense'
  fFreqMode.value = 'monthly'
  fFreqN.value = 1
  fCategoryId.value = ''
  fAccountId.value = ''
  fStart.value = new Date().toISOString().slice(0, 10)
  fEnd.value = ''
  fNote.value = ''
  loadCats()
  showForm.value = true
}
function openEdit(p: Periodic) {
  editing.value = p
  fName.value = p.name
  fAmount.value = String(p.amount / 100)
  fFlow.value = p.flow_type as 'expense' | 'income'
  const parts = String(p.frequency).split(':')
  fFreqMode.value = parts[0]
  fFreqN.value = Number(parts[1] || 1)
  fCategoryId.value = p.category_id || ''
  fAccountId.value = p.account_id
  fStart.value = p.start_date
  fEnd.value = p.end_date || ''
  fNote.value = p.note || ''
  loadCats()
  showForm.value = true
}

function openMenu(p: Periodic) {
  menuTarget.value = p
  showMenu.value = true
}
async function toggleStatus() {
  showMenu.value = false
  const p = menuTarget.value
  if (!p) return
  try {
    await api.put(`periodic/${p.id}`, { status: p.status === 'active' ? 'paused' : 'active' })
    showToast(p.status === 'active' ? '已暂停' : '已恢复')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  }
}
async function remove() {
  showMenu.value = false
  const p = menuTarget.value
  if (!p) return
  try {
    await showConfirmDialog({
      title: '删除周期账',
      message: `删除「${p.name}」？已生成的记录会保留。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--expense)',
    })
  } catch { return }
  try {
    await api.del(`periodic/${p.id}`)
    showToast('已删除')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  }
}

async function save() {
  if (!fName.value.trim()) { showToast('请输入名称'); return }
  const amtFen = Math.round(Number(fAmount.value) * 100)
  if (!Number.isFinite(amtFen) || amtFen <= 0) { showToast('请输入正确金额'); return }
  if (!fAccountId.value) { showToast('请选择账户'); return }
  if (!fStart.value) { showToast('请选择开始日期'); return }
  const freq = `${fFreqMode.value}:${fFreqN.value}${fFreqMode.value === 'monthly' ? `:${new Date(fStart.value).getDate()}` : ''}`
  const body: Record<string, unknown> = {
    name: fName.value.trim(),
    amount: amtFen,
    flowType: fFlow.value,
    frequency: freq,
    categoryId: fCategoryId.value || null,
    accountId: fAccountId.value,
    ledgerId: store.settings.currentLedgerId,
    startDate: fStart.value,
    endDate: fEnd.value || null,
    note: fNote.value.trim() || null,
  }
  saving.value = true
  try {
    if (editing.value) await api.put(`periodic/${editing.value.id}`, body)
    else await api.post('periodic', body)
    showForm.value = false
    showToast(editing.value ? '已保存' : '已创建，下次到期自动记账')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}

function pickCat(id: string) {
  fCategoryId.value = id
  const parent = cats.value.find((c) => c.children?.some((x) => x.id === id))
  if (parent) activeGroup.value = parent.id
  showCat.value = false
}
function pickAcc(id: string) {
  fAccountId.value = id
  showAcc.value = false
}
</script>

<template>
  <div class="page periodics">
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">周期账</span>
      <div class="head-right">
        <button class="sync-btn" @click="syncNow"><RefreshCw :size="17" /> 同步到期</button>
        <button class="add-btn" @click="openAdd"><Plus :size="20" /></button>
      </div>
    </div>

    <van-skeleton v-if="loading" title :row="3" style="padding: 16px;" />
    <div v-else-if="items.length === 0" class="card placeholder">
      <p class="muted">还没有周期账。房租、房贷、工资等固定收支，设一次自动记账。</p>
    </div>
    <div v-else class="per-list">
      <div
        v-for="p in items" :key="p.id"
        class="per-card" :class="{ paused: p.status !== 'active' }"
      >
        <div class="per-row" @click="openMenu(p)">
          <div class="per-main">
            <div class="per-name">
              {{ p.name }}
              <span v-if="p.status !== 'active'" class="pause-tag">已暂停</span>
            </div>
            <div class="muted">{{ freqText(p.frequency) }} · 下次 {{ p.nextDue || '—' }}</div>
          </div>
          <div class="per-amt" :class="p.flow_type === 'income' ? 'income' : 'expense'">
            {{ p.flow_type === 'income' ? '+' : '-' }}{{ (p.amount / 100).toFixed(2) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 行操作 -->
    <van-popup v-model:show="showMenu" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">{{ menuTarget?.name }}</span>
        <button class="pop-close" @click="showMenu = false"><X :size="18" /></button>
      </div>
      <div class="menu-body">
        <button class="menu-item" @click="showMenu = false; menuTarget && openEdit(menuTarget)">编辑</button>
        <button class="menu-item" @click="toggleStatus">{{ menuTarget?.status === 'active' ? '暂停' : '恢复' }}</button>
        <button class="menu-item danger" @click="remove">删除</button>
      </div>
    </van-popup>

    <!-- 新建/编辑 -->
    <van-popup v-model:show="showForm" position="bottom" round style="max-height: 88vh;">
      <div class="pop-head">
        <span class="pop-title">{{ editing ? '编辑周期账' : '新建周期账' }}</span>
        <button class="pop-close" @click="showForm = false"><X :size="18" /></button>
      </div>
      <div class="form-body" style="overflow-y: auto;">
        <div class="flow-seg">
          <button class="seg-btn" :class="{ active: fFlow === 'expense' }" @click="fFlow = 'expense'; loadCats()">支出</button>
          <button class="seg-btn" :class="{ active: fFlow === 'income' }" @click="fFlow = 'income'; loadCats()">收入</button>
        </div>
        <input v-model="fName" class="name-input" maxlength="12" placeholder="名称（如 房租 / 工资）" />
        <input v-model="fAmount" class="name-input" style="margin-top: 10px;" type="number" inputmode="decimal" placeholder="金额（元）" />

        <div class="rel-label muted" style="margin-top: 16px;">频率</div>
        <div class="freq-chips">
          <button
            v-for="m in FREQ_MODES" :key="m.key"
            class="freq-chip" :class="{ active: fFreqMode === m.key }"
            @click="fFreqMode = m.key"
          >{{ m.label }}</button>
        </div>
        <div class="step-row">
          <span class="muted">每</span>
          <input v-model.number="fFreqN" type="number" min="1" max="99" class="step-input" />
          <span class="muted">{{ fFreqMode === 'daily' ? '天' : fFreqMode === 'weekly' ? '周' : fFreqMode === 'monthly' ? '个月' : '年' }}</span>
        </div>

        <div class="rel-label muted" style="margin-top: 16px;">记账设置</div>
        <button class="picker-row" @click="showCat = true">
          <span class="muted">分类</span><span>{{ currentCatName }}<ChevronDown :size="15" /></span>
        </button>
        <button class="picker-row" @click="showAcc = true">
          <span class="muted">账户</span><span>{{ currentAccName }}<ChevronDown :size="15" /></span>
        </button>

        <div class="rel-label muted" style="margin-top: 16px;">日期</div>
        <div class="date-row">
          <button class="date-pick-btn" @click="openDatePicker('start')">
            <span class="muted">开始</span>
            <span>{{ fStart || '选择日期' }}</span>
          </button>
          <button class="date-pick-btn" @click="openDatePicker('end')">
            <span class="muted">结束</span>
            <span>{{ fEnd || '不限' }}</span>
          </button>
        </div>
        <input v-model="fNote" class="name-input" style="margin-top: 10px;" maxlength="50" placeholder="备注（可选）" />

        <button class="save-btn" :disabled="saving" @click="save">{{ editing ? '保存' : '创建' }}</button>
      </div>
    </van-popup>

    <!-- 分类选择 -->
    <van-popup v-model:show="showCat" position="center" round class="cat-pop">
      <div class="pop-head">
        <span class="pop-title">选择分类</span>
        <button class="pop-close" @click="showCat = false"><X :size="18" /></button>
      </div>
      <div class="cat-tabs">
        <button
          v-for="g in catGroups" :key="g.id"
          class="ctab" :class="{ active: activeGroup === g.id }"
          @click="activeGroup = g.id"
        >
          <component :is="iconForGroup(g.icon)" :size="14" />
          {{ g.name }}
        </button>
      </div>
      <div class="cat-grid">
        <button
          v-for="c in activeChildren" :key="c.id"
          class="cat-item" :class="{ sel: fCategoryId === c.id }"
          @click="pickCat(c.id)"
        >
          <span class="cat-icon"><component :is="iconForCat(c)" :size="16" /></span>
          <span>{{ c.name }}</span>
          <Check v-if="fCategoryId === c.id" :size="12" class="check" />
        </button>
      </div>
    </van-popup>

    <!-- 账户选择 -->
    <van-popup v-model:show="showAcc" position="bottom" round class="acc-pop">
      <div class="pop-head">
        <span class="pop-title">选择账户</span>
        <button class="pop-close" @click="showAcc = false"><X :size="18" /></button>
      </div>
      <div class="acc-groups">
        <div v-for="g in accGroups" :key="g.type" class="acc-group">
          <div class="acc-group-title">{{ typeLabel(g.type) }}（{{ g.count }}）</div>
          <button
            v-for="a in g.items" :key="a.id"
            class="acc-item" :class="{ sel: fAccountId === a.id }"
            @click="pickAcc(a.id)"
          >
            <span class="acc-name">{{ a.name }}</span>
            <span class="muted">{{ ((a.currentBalance || a.balance || 0) / 100).toFixed(2) }}</span>
          </button>
        </div>
      </div>
    </van-popup>

    <!-- 日期选择：底部月历 -->
    <!-- 年月选择弹出层 -->
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

    <!-- 日期选择弹层：单月月历 -->
    <van-popup v-model:show="showDatePicker" position="bottom" round class="date-pop">
      <div class="pop-head">
        <span class="pop-title">选择日期</span>
        <button class="pop-close" @click="showDatePicker = false"><X :size="18" /></button>
      </div>
      <div class="cal-body">
        <div class="cal-nav">
          <button class="cal-nav-btn" @click="prevMonth"><ChevronLeft :size="18" /></button>
          <button class="cal-title-btn" @click="openYMPicker">
            {{ pickY }}年{{ pickM }}月 <ChevronDown :size="14" />
          </button>
          <button class="cal-nav-btn" @click="nextMonth"><ChevronRight :size="18" /></button>
        </div>
        <div class="cal-week">
          <span v-for="w in WEEK_HEADER" :key="w">{{ w }}</span>
        </div>
        <div class="cal-grid">
          <button
            v-for="(d, i) in dayCells" :key="i"
            class="cal-day" :class="{ blank: !d, today: isToday(d), sel: isSel(d) }"
            @click="d && (pickD = d)"
          >{{ d || '' }}</button>
        </div>
        <button class="dt-confirm" @click="confirmDate">确定</button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.periodics { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.title { font-size: 16px; font-weight: 600; }
.head-right { display: flex; align-items: center; gap: 6px; }
.sync-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 12px; border-radius: 16px;
  background: var(--brand-soft); color: var(--brand); font-size: 12px; font-weight: 600;
}
.add-btn { padding: 6px; color: var(--brand); }

.per-list { display: flex; flex-direction: column; gap: 10px; }
.per-card { padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
.per-card.paused { opacity: 0.55; }
.per-row { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.per-main { flex: 1; min-width: 0; }
.per-name { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; }
.pause-tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--bg); color: var(--text2); border: 1px solid var(--border); }
.per-amt { font-size: 16px; font-weight: 700; }
.per-amt.income { color: var(--income); }
.per-amt.expense { color: var(--expense); }

.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); }
.menu-body { padding: 4px 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.menu-item { padding: 13px 0; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); font-size: 15px; color: var(--text); }
.menu-item.danger { color: var(--expense); }

.form-body { padding: 4px 16px 18px; }
.flow-seg { display: flex; gap: 4px; background: var(--bg); border: 1px solid var(--border); border-radius: 20px; padding: 3px; width: fit-content; margin-bottom: 12px; }
.seg-btn { padding: 6px 26px; border-radius: 18px; font-size: 13px; color: var(--text2); }
.seg-btn.active { background: var(--brand); color: #fff; font-weight: 600; }
.name-input { width: 100%; padding: 12px 14px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); font-size: 15px; color: var(--text); }
.rel-label { font-size: 12px; margin-bottom: 8px; }
.freq-chips { display: flex; gap: 8px; }
.freq-chip { padding: 8px 18px; border-radius: 16px; background: var(--bg); border: 1px solid var(--border); font-size: 13px; color: var(--text2); }
.freq-chip.active { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
.step-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.step-input { width: 56px; padding: 8px 10px; border-radius: 10px; background: var(--bg); border: 1px solid var(--border); font-size: 14px; color: var(--text); text-align: center; }
.picker-row {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border);
  font-size: 14px; color: var(--text); margin-bottom: 10px;
}
.picker-row span { display: flex; align-items: center; gap: 4px; }
.date-row { display: flex; gap: 12px; }
.date-pick-btn {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border);
  font-size: 14px; color: var(--text); text-align: left;
}
.date-pop { max-height: 80vh; display: flex; flex-direction: column; }
.cal-body { padding: 4px 16px 16px; }
.cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cal-nav-btn { padding: 6px; color: var(--text2); }
.cal-title-btn {
  display: flex; align-items: center; gap: 4px;
  font-size: 15px; font-weight: 600; color: var(--text); padding: 4px 8px;
}
.cal-week { display: grid; grid-template-columns: repeat(7, 1fr); }
.cal-week span { text-align: center; font-size: 11px; color: var(--text2); padding: 6px 0; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal-day {
  height: 38px; text-align: center; font-size: 13px; color: var(--text);
  border-radius: 10px;
}
.cal-day.blank { visibility: hidden; }
.cal-day.today { color: var(--brand); font-weight: 700; }
.cal-day.sel { background: var(--brand); color: #fff; font-weight: 700; }
.dt-confirm {
  width: 100%; margin-top: 14px; padding: 11px 0; border-radius: 12px;
  background: var(--brand); color: #fff; font-size: 14px; font-weight: 600;
}
.save-btn { width: 100%; margin-top: 18px; padding: 13px 0; border-radius: 12px; background: var(--brand); color: #fff; font-size: 15px; font-weight: 600; }
.save-btn:disabled { opacity: 0.4; }

.cat-pop { max-height: 70vh; width: 92vw; max-width: 420px; display: flex; flex-direction: column; }
.cat-tabs { display: flex; gap: 6px; overflow-x: auto; padding: 4px 16px 8px; scrollbar-width: none; }
.ctab {
  flex-shrink: 0; padding: 6px 12px; border-radius: 16px;
  background: var(--bg); border: 1px solid var(--border); font-size: 12px; color: var(--text2);
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
}
.ctab.active { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
.cat-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  gap: 8px; padding: 4px 16px 16px; overflow-y: auto;
}
.cat-item {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 4px; background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; font-size: 12px; color: var(--text);
}
.cat-item.sel { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); font-weight: 600; }
.cat-icon { display: flex; }
.check { position: absolute; top: 4px; right: 4px; }
.acc-pop { max-height: 70vh; display: flex; flex-direction: column; }
.acc-groups { overflow-y: auto; padding: 4px 16px 16px; }
.acc-group-title { font-size: 12px; color: var(--text2); padding: 10px 2px 6px; }
.acc-item {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 12px; background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; margin-bottom: 6px;
}
.acc-item.sel { border-color: var(--brand); background: var(--brand-soft); }
.acc-name { font-size: 14px; color: var(--text); font-weight: 500; }
</style>
