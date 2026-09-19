<script setup lang="ts">
defineOptions({ name: 'BudgetView' })
import { ref, computed, onMounted, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { api, type Category } from '../api'
import { store, fmtMoney } from '../store'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-vue-next'

interface Budget {
  id: string
  ledger_id: string
  category_id: string
  month: string
  amount: number
  spent: number
}

const y = ref(new Date().getFullYear())
const m = ref(new Date().getMonth() + 1)
const items = ref<Budget[]>([])
const cats = ref<Category[]>([])
const loading = ref(true)

const showForm = ref(false)
const editing = ref<Budget | null>(null)
const fAmount = ref('')
const fCatId = ref('')
const showCat = ref(false)
const saving = ref(false)

const monthKey = computed(() => `${y.value}-${String(m.value).padStart(2, '0')}`)
const catNames = new Map<string, string>()
const catName = (id: string) => catNames.get(id) || '未分类'

const totalBudget = computed(() => items.value.reduce((s, b) => s + b.amount, 0))
const totalSpent = computed(() => items.value.reduce((s, b) => s + b.spent, 0))
const totalPct = computed(() => (totalBudget.value ? Math.round((totalSpent.value / totalBudget.value) * 100) : 0))
const totalLeft = computed(() => totalBudget.value - totalSpent.value)
const totalOver = computed(() => totalSpent.value > totalBudget.value)

function pctClass(p: number) {
  return p >= 100 ? 'over' : p >= 80 ? 'warn' : 'ok'
}

async function loadCats() {
  try {
    const d = await api.get<{ groups: Category[] }>('categories?type=expense')
    cats.value = d.groups.flatMap((g) => [g, ...(g.children || [])])
    for (const c of cats.value) catNames.set(c.id, c.name)
  } catch { /* ignore */ }
}

async function load() {
  loading.value = true
  try {
    const d = await api.get<{ items: Budget[] }>(
      `budgets?ledgerId=${store.settings.currentLedgerId ?? ''}&month=${monthKey.value}`
    )
    items.value = d.items
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loading.value = false
  }
}

function shift(delta: number) {
  const d = new Date(y.value, m.value - 1 + delta, 1)
  y.value = d.getFullYear()
  m.value = d.getMonth() + 1
}
onMounted(async () => { await loadCats(); await load() })
watch(monthKey, load)

function openAdd() {
  editing.value = null
  fAmount.value = ''
  fCatId.value = ''
  showForm.value = true
}
function openEdit(b: Budget) {
  editing.value = b
  fAmount.value = String(b.amount / 100)
  fCatId.value = b.category_id
  showForm.value = true
}

async function save() {
  const amtFen = Math.round(Number(fAmount.value) * 100)
  if (!Number.isFinite(amtFen) || amtFen <= 0) { showToast('请输入正确金额'); return }
  if (!fCatId.value) { showToast('请选择分类'); return }
  saving.value = true
  try {
    if (editing.value) {
      await api.put(`budgets/${editing.value.id}`, { amount: amtFen })
    } else {
      await api.post('budgets', {
        ledgerId: store.settings.currentLedgerId,
        categoryId: fCatId.value,
        month: monthKey.value,
        amount: amtFen,
      })
    }
    showForm.value = false
    showToast('已保存')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!editing.value) return
  try {
    await showConfirmDialog({
      title: '删除预算',
      message: `删除「${catName(editing.value.category_id)}」的预算？`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--expense)',
    })
  } catch { return }
  try {
    await api.del(`budgets/${editing.value.id}`)
    showForm.value = false
    showToast('已删除')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  }
}
</script>

<template>
  <div class="page budget">
    <div class="title-row">
      <div class="page-title" style="flex: 1;">预算</div>
      <button class="add-btn" @click="openAdd"><Plus :size="20" /></button>
    </div>

    <div class="month-bar">
      <button class="m-btn" @click="shift(-1)"><ChevronLeft :size="18" /></button>
      <span class="m-label">{{ y }}年{{ m }}月</span>
      <button class="m-btn" @click="shift(1)"><ChevronRight :size="18" /></button>
    </div>

    <template v-if="loading">
      <van-skeleton title :row="4" style="padding: 16px;" />
    </template>
    <template v-else>
      <div v-if="totalBudget > 0" class="total-card">
        <div class="total-head">
          <span class="muted">本月总预算</span>
          <span class="total-amt" :class="totalOver ? 'over' : ''">{{ fmtMoney(totalBudget) }}</span>
        </div>
        <div class="big-track">
          <div class="big-fill" :class="pctClass(totalPct)" :style="{ width: Math.min(100, totalPct) + '%' }" />
        </div>
        <div class="total-sub">
          <span class="muted">已用 {{ fmtMoney(totalSpent) }} · {{ totalPct }}%</span>
          <span :class="totalOver ? 'over-text' : 'ok-text'">
            {{ totalOver ? `超支 ${fmtMoney(Math.abs(totalLeft))}` : `剩余 ${fmtMoney(totalLeft)}` }}
          </span>
        </div>
      </div>

      <div v-if="items.length === 0" class="card placeholder">
        <p class="muted">本月还没有预算。点右上角 ➕ 给支出分类设置预算，超支会红条提醒。</p>
      </div>
      <div v-else class="bud-list">
        <div
          v-for="b in items" :key="b.id"
          class="bud-card" :class="{ over: b.spent > b.amount }"
          @click="openEdit(b)"
        >
          <div class="bud-row">
            <span class="bud-name">{{ catName(b.category_id) }}</span>
            <span class="bud-amt">{{ fmtMoney(b.spent) }} <i class="muted">/ {{ fmtMoney(b.amount) }}</i></span>
          </div>
          <div class="big-track">
            <div class="big-fill" :class="pctClass(Math.round((b.spent / (b.amount || 1)) * 100))"
              :style="{ width: Math.min(100, Math.round((b.spent / (b.amount || 1)) * 100)) + '%' }" />
          </div>
          <div class="bud-sub muted">
            <span>{{ Math.round((b.spent / (b.amount || 1)) * 100) }}%</span>
            <span v-if="b.spent > b.amount" class="over-text">超支 {{ fmtMoney(b.spent - b.amount) }}</span>
            <span v-else>剩余 {{ fmtMoney(b.amount - b.spent) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 添加/编辑 -->
    <van-popup v-model:show="showForm" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">{{ editing ? '编辑预算' : '添加预算' }}</span>
        <button class="pop-close" @click="showForm = false"><X :size="18" /></button>
      </div>
      <div class="form-body">
        <button class="picker-row" @click="showCat = true">
          <span class="muted">分类</span>
          <span>{{ fCatId ? catName(fCatId) : '选择支出分类' }} ›</span>
        </button>
        <input v-model="fAmount" type="number" inputmode="decimal" class="name-input" placeholder="预算金额（元）" />
        <button class="save-btn" :disabled="saving" @click="save">保存</button>
        <button v-if="editing" class="del-btn" :disabled="saving" @click="remove">删除该预算</button>
      </div>
    </van-popup>

    <!-- 分类选择 -->
    <van-popup v-model:show="showCat" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">选择支出分类</span>
        <button class="pop-close" @click="showCat = false"><X :size="18" /></button>
      </div>
      <div class="cat-pick-body">
        <div v-for="g in cats.filter((c) => !c.parent_id)" :key="g.id" class="cat-group">
          <div class="cat-group-name muted">{{ g.name }}</div>
          <div class="cat-pick-chips">
            <button
              v-for="c in cats.filter((x) => x.parent_id === g.id)" :key="c.id"
              class="cat-pick-chip" :class="{ active: fCatId === c.id }"
              @click="fCatId = c.id; showCat = false"
            >{{ c.name }}</button>
          </div>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.budget { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }
.title-row { display: flex; align-items: center; }
.add-btn { padding: 6px; color: var(--brand); }
.month-bar { display: flex; align-items: center; justify-content: space-between; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; }
.m-btn { padding: 4px; color: var(--text2); display: flex; }
.m-label { font-size: 15px; font-weight: 600; }

.total-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.total-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.total-amt { font-size: 22px; font-weight: 700; }
.total-amt.over { color: var(--expense); }
.big-track { height: 10px; border-radius: 5px; background: var(--bg); overflow: hidden; }
.big-fill { height: 100%; border-radius: 5px; transition: width 0.3s; }
.big-fill.ok { background: linear-gradient(90deg, var(--brand), #FF8E5E); }
.big-fill.warn { background: #F5A623; }
.big-fill.over { background: var(--expense); }
.total-sub { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; }

.bud-list { display: flex; flex-direction: column; gap: 10px; }
.bud-card { padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
.bud-card.over { border-color: var(--expense); }
.bud-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.bud-name { font-size: 14px; font-weight: 600; }
.bud-amt { font-size: 14px; font-weight: 600; }
.bud-amt i { font-style: normal; font-weight: 400; }
.bud-sub { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; }
.over-text { color: var(--expense); font-weight: 600; }
.ok-text { color: var(--income); font-weight: 600; }

.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); }
.form-body { padding: 4px 16px 18px; }
.picker-row { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); font-size: 14px; color: var(--text); margin-bottom: 10px; }
.name-input { width: 100%; padding: 12px 14px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); font-size: 15px; color: var(--text); }
.save-btn { width: 100%; margin-top: 16px; padding: 13px 0; border-radius: 12px; background: var(--brand); color: #fff; font-size: 15px; font-weight: 600; }
.save-btn:disabled { opacity: 0.4; }
.del-btn { width: 100%; margin-top: 10px; padding: 13px 0; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); color: var(--expense); font-size: 14px; }

.cat-pick-body { padding: 4px 16px 20px; max-height: 60vh; overflow-y: auto; }
.cat-group { margin-bottom: 12px; }
.cat-group-name { font-size: 12px; margin-bottom: 8px; }
.cat-pick-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-pick-chip { padding: 8px 14px; border-radius: 16px; background: var(--bg); border: 1px solid var(--border); font-size: 13px; color: var(--text2); }
.cat-pick-chip.active { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
</style>
