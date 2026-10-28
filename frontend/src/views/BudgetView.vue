<script setup lang="ts">
defineOptions({ name: 'BudgetView' })
import { ref, computed, onMounted, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { api, type Category } from '../api'
import { store, fmtMoney } from '../store'
import { ChevronLeft, ChevronRight, ChevronDown, Plus, X, Target } from 'lucide-vue-next'

interface Budget {
  id: string
  ledger_id: string
  category_id: string | null
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
/** total = 总预算（右上角加号）；cat = 分类子预算 */
const formMode = ref<'total' | 'cat'>('total')
/** 在哪个一级分类预算下添加二级子预算（null = 添加一级分类预算） */
const formParent = ref<Budget | null>(null)
const fAmount = ref('')
const fCatId = ref('')
const showCat = ref(false)
const saving = ref(false)

const monthKey = computed(() => `${y.value}-${String(m.value).padStart(2, '0')}`)
const catNames = new Map<string, string>()
const catParentMap = new Map<string, string>()
const catName = (id: string | null) => (id ? catNames.get(id) || '未分类' : '总预算')
const catParentId = (id: string) => catParentMap.get(id) || ''

/** 一级分类 */
const parentCats = computed(() => cats.value.filter((c) => !c.parent_id))

const totalRow = computed(() => items.value.find((b) => !b.category_id) || null)
const catBudgets = computed(() => items.value.filter((b) => b.category_id))
/** 一级分类预算 */
const l1Budgets = computed(() => catBudgets.value.filter((b) => !catParentId(b.category_id!)))
const l2BudgetsOf = (l1Id: string) => catBudgets.value.filter((b) => catParentId(b.category_id!) === l1Id)
/** 父级分类没有预算的二级预算（兜底展示，正常操作不会产生） */
const orphanBudgets = computed(() =>
  catBudgets.value.filter((b) => {
    const pid = catParentId(b.category_id!)
    return pid ? !items.value.some((x) => x.category_id === pid) : false
  })
)

// 汇总卡（仅在没有总预算、只有分类预算时展示）
const sumBudget = computed(() => items.value.reduce((s, b) => s + b.amount, 0))
const sumSpent = computed(() => items.value.reduce((s, b) => s + b.spent, 0))
const sumPct = computed(() => (sumBudget.value ? Math.round((sumSpent.value / sumBudget.value) * 100) : 0))
const sumLeft = computed(() => sumBudget.value - sumSpent.value)
const sumOver = computed(() => sumSpent.value > sumBudget.value)

function pctOf(b: Budget) {
  return Math.round((b.spent / (b.amount || 1)) * 100)
}
function pctClass(p: number) {
  return p >= 100 ? 'over' : p >= 80 ? 'warn' : 'ok'
}

// ---- 树形折叠 ----
const collapsedTotal = ref(false)
const folded = ref<Record<string, boolean>>({})
function toggleFold(id: string) {
  folded.value[id] = !folded.value[id]
}

/** 添加子预算时，上级预算剩余可分配金额 */
const allocLeft = computed<number | null>(() => {
  if (editing.value || formMode.value !== 'cat') return null
  if (formParent.value) {
    return formParent.value.amount - l2BudgetsOf(formParent.value.category_id!).reduce((s, x) => s + x.amount, 0)
  }
  if (totalRow.value) {
    return totalRow.value.amount - l1Budgets.value.reduce((s, x) => s + x.amount, 0)
  }
  return null
})

async function loadCats() {
  try {
    const d = await api.get<{ groups: Category[] }>('categories?type=expense')
    cats.value = d.groups.flatMap((g) => [g, ...(g.children || [])])
    for (const c of cats.value) {
      catNames.set(c.id, c.name)
      catParentMap.set(c.id, c.parent_id || '')
    }
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

/** 右上角加号：没有总预算 → 创建；已有 → 编辑 */
function openTotal() {
  if (totalRow.value) { openEdit(totalRow.value); return }
  editing.value = null
  formMode.value = 'total'
  formParent.value = null
  fAmount.value = ''
  showForm.value = true
}
/** 总预算卡片上的加号：添加一级分类预算 */
function openAddL1() {
  editing.value = null
  formMode.value = 'cat'
  formParent.value = null
  fCatId.value = ''
  fAmount.value = ''
  showForm.value = true
}
/** 一级分类卡片上的加号：添加二级子预算 */
function openAddL2(p: Budget) {
  editing.value = null
  formMode.value = 'cat'
  formParent.value = p
  fCatId.value = ''
  fAmount.value = ''
  showForm.value = true
}
function openEdit(b: Budget) {
  editing.value = b
  formMode.value = b.category_id ? 'cat' : 'total'
  formParent.value = null
  fAmount.value = String(b.amount / 100)
  fCatId.value = b.category_id || ''
  showForm.value = true
}

const formTitle = computed(() => {
  if (editing.value) return editing.value.category_id ? `编辑「${catName(editing.value.category_id)}」预算` : '编辑总预算'
  if (formMode.value === 'total') return '设置本月总预算'
  if (formParent.value) return `给「${catName(formParent.value.category_id)}」添加子预算`
  return '添加一级分类预算'
})

/** 分类选择列表：添加二级 → 父分类的子分类；添加一级 → 全部一级分类（都排除已设置预算的） */
const pickOptions = computed<Category[]>(() => {
  const budgeted = new Set(items.value.map((b) => b.category_id))
  if (formParent.value) {
    return cats.value.filter((c) => c.parent_id === formParent.value!.category_id && !budgeted.has(c.id))
  }
  return parentCats.value.filter((c) => !budgeted.has(c.id))
})

async function save() {
  const amtFen = Math.round(Number(fAmount.value) * 100)
  if (!Number.isFinite(amtFen) || amtFen <= 0) { showToast('请输入正确金额'); return }
  if (formMode.value === 'cat' && !editing.value && !fCatId.value) { showToast('请选择分类'); return }
  saving.value = true
  try {
    if (editing.value) {
      await api.put(`budgets/${editing.value.id}`, { amount: amtFen })
    } else {
      await api.post('budgets', {
        ledgerId: store.settings.currentLedgerId,
        categoryId: formMode.value === 'total' ? null : fCatId.value,
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
  const hasChildren = editing.value.category_id && l2BudgetsOf(editing.value.category_id).length > 0
  try {
    await showConfirmDialog({
      title: '删除预算',
      message: hasChildren
        ? `删除「${catName(editing.value.category_id)}」的预算？其下子预算将一并删除。`
        : `删除「${catName(editing.value.category_id)}」的预算？`,
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
      <button class="add-btn" @click="openTotal"><Plus :size="20" /></button>
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
      <div v-if="items.length === 0" class="card placeholder">
        <p class="muted">本月还没有总预算。点右上角 + 设置总预算，然后在总预算卡片上点 + 添加分类子预算。</p>
      </div>
      <template v-else>
        <!-- 无总预算时的汇总卡 -->
        <div v-if="!totalRow" class="total-card">
          <div class="total-head">
            <span class="muted">本月预算合计</span>
            <span class="total-amt" :class="sumOver ? 'over' : ''">{{ fmtMoney(sumBudget) }}</span>
          </div>
          <div class="big-track">
            <div class="big-fill" :class="pctClass(sumPct)" :style="{ width: Math.min(100, sumPct) + '%' }" />
          </div>
          <div class="total-sub">
            <span class="muted">已用 {{ fmtMoney(sumSpent) }} · {{ sumPct }}%</span>
            <span :class="sumOver ? 'over-text' : 'ok-text'">
              {{ sumOver ? `超支 ${fmtMoney(Math.abs(sumLeft))}` : `剩余 ${fmtMoney(sumLeft)}` }}
            </span>
          </div>
        </div>

        <!-- 总预算卡片 -->
        <div v-if="totalRow" class="bud-card total" :class="{ over: totalRow.spent > totalRow.amount }" @click="openEdit(totalRow)">
          <div class="bud-row">
            <span class="bud-name">
              <button v-if="l1Budgets.length" class="fold-btn" @click.stop="collapsedTotal = !collapsedTotal">
                <ChevronDown v-if="!collapsedTotal" :size="15" /><ChevronRight v-else :size="15" />
              </button>
              <Target :size="16" class="total-ico" /> 总预算<span class="muted scope">所有分类</span>
            </span>
            <button class="mini-add" @click.stop="openAddL1"><Plus :size="13" /> 子预算</button>
          </div>
          <div class="bud-row">
            <span></span>
            <span class="bud-amt">{{ fmtMoney(totalRow.spent) }} <i class="muted">/ {{ fmtMoney(totalRow.amount) }}</i></span>
          </div>
          <div class="big-track">
            <div class="big-fill" :class="pctClass(pctOf(totalRow))" :style="{ width: Math.min(100, pctOf(totalRow)) + '%' }" />
          </div>
          <div class="bud-sub muted">
            <span>{{ pctOf(totalRow) }}%</span>
            <span v-if="totalRow.spent > totalRow.amount" class="over-text">超支 {{ fmtMoney(totalRow.spent - totalRow.amount) }}</span>
            <span v-else>剩余 {{ fmtMoney(totalRow.amount - totalRow.spent) }}</span>
          </div>
        </div>

        <!-- 分类子预算树（总预算卡片上的箭头可折叠全部子预算） -->
        <div v-if="catBudgets.length && !(totalRow && collapsedTotal)" class="bud-tree">
          <template v-for="b in l1Budgets" :key="b.id">
            <div class="tree-node">
              <div class="bud-card l1" :class="{ over: b.spent > b.amount }" @click="openEdit(b)">
                <div class="bud-row">
                  <span class="bud-name">
                    <button v-if="l2BudgetsOf(b.category_id!).length" class="fold-btn" @click.stop="toggleFold(b.id)">
                      <ChevronDown v-if="!folded[b.id]" :size="15" /><ChevronRight v-else :size="15" />
                    </button>
                    {{ catName(b.category_id) }}
                  </span>
                  <button class="mini-add" @click.stop="openAddL2(b)"><Plus :size="13" /></button>
                </div>
                <div class="bud-row">
                  <span></span>
                  <span class="bud-amt">{{ fmtMoney(b.spent) }} <i class="muted">/ {{ fmtMoney(b.amount) }}</i></span>
                </div>
                <div class="big-track">
                  <div class="big-fill" :class="pctClass(pctOf(b))" :style="{ width: Math.min(100, pctOf(b)) + '%' }" />
                </div>
                <div class="bud-sub muted">
                  <span>{{ pctOf(b) }}%</span>
                  <span v-if="b.spent > b.amount" class="over-text">超支 {{ fmtMoney(b.spent - b.amount) }}</span>
                  <span v-else>剩余 {{ fmtMoney(b.amount - b.spent) }}</span>
                </div>
              </div>
              <!-- 二级子预算 -->
              <div v-if="!folded[b.id] && l2BudgetsOf(b.category_id!).length" class="bud-tree sub">
                <div
                  v-for="s in l2BudgetsOf(b.category_id!)" :key="s.id"
                  class="bud-card l2" :class="{ over: s.spent > s.amount }"
                  @click="openEdit(s)"
                >
                  <div class="bud-row">
                    <span class="bud-name sub-name">{{ catName(s.category_id) }}</span>
                    <span class="bud-amt">{{ fmtMoney(s.spent) }} <i class="muted">/ {{ fmtMoney(s.amount) }}</i></span>
                  </div>
                  <div class="big-track thin">
                    <div class="big-fill" :class="pctClass(pctOf(s))" :style="{ width: Math.min(100, pctOf(s)) + '%' }" />
                  </div>
                  <div class="bud-sub muted">
                    <span>{{ pctOf(s) }}%</span>
                    <span v-if="s.spent > s.amount" class="over-text">超支 {{ fmtMoney(s.spent - s.amount) }}</span>
                    <span v-else>剩余 {{ fmtMoney(s.amount - s.spent) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <!-- 父级无预算的二级预算，平级兜底展示 -->
          <div v-for="s in orphanBudgets" :key="s.id" class="tree-node">
            <div class="bud-card l1" :class="{ over: s.spent > s.amount }" @click="openEdit(s)">
              <div class="bud-row">
                <span class="bud-name">{{ catName(s.category_id) }}</span>
                <span class="bud-amt">{{ fmtMoney(s.spent) }} <i class="muted">/ {{ fmtMoney(s.amount) }}</i></span>
              </div>
              <div class="big-track thin">
                <div class="big-fill" :class="pctClass(pctOf(s))" :style="{ width: Math.min(100, pctOf(s)) + '%' }" />
              </div>
              <div class="bud-sub muted">
                <span>{{ pctOf(s) }}%</span>
                <span v-if="s.spent > s.amount" class="over-text">超支 {{ fmtMoney(s.spent - s.amount) }}</span>
                <span v-else>剩余 {{ fmtMoney(s.amount - s.spent) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- 添加/编辑弹层 -->
    <van-popup v-model:show="showForm" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">{{ formTitle }}</span>
        <button class="pop-close" @click="showForm = false"><X :size="18" /></button>
      </div>
      <div class="form-body">
        <button v-if="formMode === 'cat' && !editing" class="picker-row" @click="showCat = true">
          <span class="muted">分类</span>
          <span :class="{ 'picked': fCatId }">{{ fCatId ? catName(fCatId) : (formParent ? '选择子分类' : '选择一级分类') }} ›</span>
        </button>
        <div v-if="formMode === 'total'" class="type-tip">总预算统计本账本当月全部支出，可在下方按分类继续拆分</div>
        <div v-if="formMode === 'cat' && formParent" class="type-tip">只统计「{{ catName(formParent.category_id) }} · {{ fCatId ? catName(fCatId) : '所选分类' }}」的支出</div>
        <div v-if="allocLeft !== null" class="type-tip alloc-tip">上级预算剩余可分配 {{ fmtMoney(allocLeft) }} 元</div>
        <input v-model="fAmount" type="number" inputmode="decimal" class="name-input" placeholder="预算金额（元）" />
        <button class="save-btn" :disabled="saving" @click="save">保存</button>
        <button v-if="editing" class="del-btn" :disabled="saving" @click="remove">删除该预算</button>
      </div>
    </van-popup>

    <!-- 分类选择 -->
    <van-popup v-model:show="showCat" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">{{ formParent ? `选择「${catName(formParent.category_id)}」的子分类` : '选择一级分类' }}</span>
        <button class="pop-close" @click="showCat = false"><X :size="18" /></button>
      </div>
      <div class="cat-pick-body">
        <div v-if="pickOptions.length === 0" class="muted" style="padding: 12px 0 20px; text-align: center;">
          {{ formParent ? '该分类下没有可添加的子分类' : '没有可添加的一级分类' }}
        </div>
        <div v-else class="cat-pick-chips">
          <button
            v-for="c in pickOptions" :key="c.id"
            class="cat-pick-chip" :class="{ active: fCatId === c.id }"
            @click="fCatId = c.id; showCat = false"
          >{{ c.name }}</button>
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
.big-track.thin { height: 8px; }
.big-fill { height: 100%; border-radius: 5px; transition: width 0.3s; }
.big-fill.ok { background: linear-gradient(90deg, var(--brand), #FF8E5E); }
.big-fill.warn { background: #F5A623; }
.big-fill.over { background: var(--expense); }
.total-sub { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; }

.bud-tree { display: flex; flex-direction: column; gap: 10px; margin-left: 14px; padding-left: 14px; border-left: 2px solid var(--border); }
.bud-tree.sub { margin-left: 12px; }
.tree-node { display: flex; flex-direction: column; gap: 10px; }
.bud-card { padding: 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
.bud-card.over { border-color: var(--expense); }
.bud-card.total { border-color: var(--brand); background: var(--brand-soft); }
.bud-card.l2 { padding: 12px 14px; }
.fold-btn { display: flex; padding: 2px; margin-right: 5px; color: var(--text2); }
.sub-name { font-weight: 500; }
.total-ico { vertical-align: -2px; color: var(--brand); }
.scope { font-weight: 400; font-size: 12px; margin-left: 6px; }
.mini-add { display: flex; align-items: center; gap: 2px; padding: 4px 9px; border-radius: 13px; background: var(--bg); border: 1px solid var(--border); color: var(--brand); font-size: 12px; font-weight: 500; }
.mini-add:active { opacity: 0.7; }
.type-tip { font-size: 12px; color: var(--text2); margin-bottom: 10px; text-align: center; }
.alloc-tip { color: var(--brand); font-weight: 500; }
.picked { color: var(--brand); font-weight: 600; }
.bud-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.bud-name { font-size: 14px; font-weight: 600; display: flex; align-items: center; }
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
.cat-pick-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-pick-chip { padding: 8px 14px; border-radius: 16px; background: var(--bg); border: 1px solid var(--border); font-size: 13px; color: var(--text2); }
.cat-pick-chip.active { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
</style>
