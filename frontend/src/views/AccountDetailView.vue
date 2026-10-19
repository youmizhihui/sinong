<script setup lang="ts">
defineOptions({ name: 'AccountDetailView' })
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Entry, type Member } from '../api'
import { store, fmtMoney } from '../store'
import { ArrowLeft, Pencil, ReceiptText, Trash2, ArrowLeftRight, ArrowUp } from 'lucide-vue-next'
import { iconForCat } from '../catIcons'
import { showToast, showConfirmDialog } from 'vant'

const route = useRoute()
const router = useRouter()
const accountId = route.params.id as string

const account = ref<any>(null)
const entries = ref<Entry[]>([])
const members = ref<Member[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(true)
const offset = ref(0)
const PAGE_SIZE = 50
const showEdit = ref(false)
const editForm = ref({ name: '', note: '', type: 'cash' })
const showTop = ref(false)

const TYPE_LABEL: Record<string, string> = {
  cash: '现金', savings: '储蓄卡', credit: '信用卡', online: '网络账户',
  investment: '投资账户', stored: '储值卡', receivable: '应收应付', archived: '已封存',
}

async function load() {
  loading.value = true
  offset.value = 0
  hasMore.value = true
  try {
    const [acc, d, ms] = await Promise.all([
      api.get<any>(`accounts/${accountId}`).catch(() => null),
      api.get<{ entries: Entry[]; hasMore: boolean }>(`entries?accountId=${accountId}&limit=${PAGE_SIZE}&offset=0`),
      api.get<Member[]>('members').catch(() => [] as Member[]),
    ])
    account.value = acc
    entries.value = d.entries
    hasMore.value = d.hasMore
    members.value = ms
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
      `entries?accountId=${accountId}&limit=${PAGE_SIZE}&offset=${entries.value.length}`
    )
    const ids = new Set(entries.value.map((e) => e.id))
    for (const e of d.entries) if (!ids.has(e.id)) entries.value.push(e)
    hasMore.value = d.hasMore
  } catch (e) {
    console.error(e)
  }
  loadingMore.value = false
}

function onScroll() {
  const el = document.documentElement
  showTop.value = el.scrollTop > 400
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
    loadMore()
  }
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
  editForm.value = { name: account.value.name, note: account.value.note || '', type: account.value.type }
  showEdit.value = true
}

async function saveEdit() {
  if (!editForm.value.name.trim()) { showToast('请输入账户名称'); return }
  try {
    await api.put(`accounts/${accountId}`, {
      name: editForm.value.name.trim(),
      note: editForm.value.note.trim() || null,
      type: editForm.value.type,
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

const groups = computed(() => {
  const map = new Map<string, Entry[]>()
  for (const e of entries.value) {
    const day = e.entryDate.slice(0, 10)
    if (!map.has(day)) map.set(day, [])
    map.get(day)!.push(e)
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, list]) => ({
    date, list: list.sort((a, b) => a.entryDate < b.entryDate ? 1 : -1),
  }))
})

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

    <!-- 流水列表 -->
    <div class="card list-card" style="margin-top: 12px;">
      <template v-if="loading">
        <van-skeleton avatar :row="3" style="padding: 12px;" />
      </template>
      <template v-else-if="entries.length === 0">
        <div class="empty">
          <ReceiptText :size="34" />
          <p>该账户暂无流水</p>
        </div>
      </template>
      <template v-else>
        <div v-for="g in groups" :key="g.date" class="day-group">
          <div class="day-head"><span>{{ fmtDate(g.date) }}</span></div>
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
        <div v-if="loadingMore" class="load-more">加载中…</div>
        <div v-else-if="!hasMore && entries.length > PAGE_SIZE" class="load-more end">没有更多了</div>
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
.back-top {
  position: fixed; right: 16px; bottom: 80px;
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--card); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text2); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  z-index: 10;
}
</style>
