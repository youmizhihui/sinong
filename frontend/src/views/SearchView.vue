<script setup lang="ts">
defineOptions({ name: 'SearchView' })
import { ref, computed, watch, onMounted, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Entry, type EntriesData, type Member } from '../api'
import { store, fmtMoney } from '../store'
import { Search, ArrowLeft, ReceiptText, ArrowLeftRight, ArrowUp } from 'lucide-vue-next'
import { iconForCat } from '../catIcons'

const route = useRoute()
const router = useRouter()

const keyword = ref(String(route.query.q || ''))
const entries = ref<Entry[]>([])
const members = ref<Member[]>([])
const agg = ref<NonNullable<EntriesData['search']> | null>(null)
const total = ref(0)
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const showTop = ref(false)
const loadedIds = new Set<string>()

function qs() {
  return `ledgerId=${store.settings.currentLedgerId ?? ''}&keyword=${encodeURIComponent(keyword.value.trim())}`
}

async function search() {
  if (!keyword.value.trim()) return
  loadedIds.clear()
  loading.value = true
  try {
    const d = await api.get<EntriesData>(`entries?${qs()}&limit=100&offset=0`)
    entries.value = d.entries
    d.entries.forEach((e) => loadedIds.add(e.id))
    agg.value = d.search || null
    total.value = d.total
    hasMore.value = d.hasMore
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const d = await api.get<EntriesData>(`entries?${qs()}&limit=100&offset=${entries.value.length}`)
    const fresh = d.entries.filter((e) => !loadedIds.has(e.id))
    fresh.forEach((e) => loadedIds.add(e.id))
    entries.value = [...entries.value, ...fresh]
    hasMore.value = d.hasMore
  } catch (e) {
    console.error(e)
  }
  loadingMore.value = false
}

function onWinScroll() {
  showTop.value = window.scrollY > 400
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 120) loadMore()
}
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }

/** 输入框被自带 X 清空后重置结果 */
watch(keyword, (v) => {
  if (!v.trim() && entries.value.length) {
    entries.value = []
    agg.value = null
    total.value = 0
    hasMore.value = false
  }
})

/** 按日分组（倒序，组内按时间倒序） */
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
    .map(([date, list]) => ({ date, list: [...list].sort(byTime) }))
})

function fmtDate(d: string) {
  const y = d.slice(0, 4), m = d.slice(5, 7), day = d.slice(8, 10)
  const thisYear = new Date().getFullYear()
  return Number(y) === thisYear ? `${Number(m)}月${Number(day)}日` : `${y}年${Number(m)}月${Number(day)}日`
}
function timeHM(e: Entry) { return e.entryDate.slice(11, 16) }
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
function memberName(e: Entry) {
  return members.value.find((m) => m.id === e.memberId)?.name || '自己'
}
function subLabel(e: Entry) {
  const parts: string[] = []
  if (e.categoryName && e.note) parts.push(e.categoryName)
  parts.push(memberName(e))
  parts.push(timeHM(e))
  if (e.flowType === 'transfer') parts.push(`${e.accountName || '?'} → ${e.toAccountName || '?'}`)
  else if (e.accountName) parts.push(e.accountName)
  if (e.platform) parts.push(e.platform)
  return parts.join(' · ')
}

onMounted(() => {
  window.addEventListener('scroll', onWinScroll, { passive: true })
  api.get<Member[]>('members').then((ms) => (members.value = ms)).catch(() => {})
  search()
})
onDeactivated(() => {
  window.removeEventListener('scroll', onWinScroll)
})
</script>

<template>
  <div class="page search">
    <!-- 顶部：返回 + 搜索框 -->
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <div class="sbox">
        <Search :size="15" class="sbox-ico" />
        <input
          v-model="keyword"
          type="search"
          enterkeyhint="search"
          class="sbox-input"
          placeholder="搜索备注、分类、成员"
          @keydown.enter="search"
        />
      </div>
      <van-button size="small" round type="primary" @click="search">搜索</van-button>
    </div>

    <!-- 聚合统计 -->
    <div v-if="agg" class="card agg-card">
      <div class="agg-main">
        <span class="agg-num num">{{ agg.count }}</span>
        <span class="agg-unit">笔命中</span>
        <span class="muted agg-total">共 {{ total }} 条</span>
      </div>
      <div class="agg-grid">
        <div class="agg-item">
          <span class="agg-label">支出</span>
          <span class="num money-expense">{{ fmtMoney(agg.expense) }}</span>
        </div>
        <div class="agg-item">
          <span class="agg-label">收入</span>
          <span class="num money-income">{{ fmtMoney(agg.income) }}</span>
        </div>
        <div class="agg-item">
          <span class="agg-label">转账</span>
          <span class="num">{{ fmtMoney(agg.transfer) }}</span>
        </div>
        <div class="agg-item">
          <span class="agg-label">净支出</span>
          <span class="num money-expense">{{ fmtMoney(agg.netExpense) }}</span>
        </div>
      </div>
    </div>

    <!-- 结果列表 -->
    <div class="card list-card">
      <template v-if="loading">
        <van-skeleton avatar :row="4" style="padding: 12px;" />
      </template>
      <template v-else-if="entries.length === 0">
        <div class="empty">
          <ReceiptText :size="34" />
          <p>{{ keyword ? '没有找到相关记录' : '输入关键词搜索备注或分类' }}</p>
        </div>
      </template>
      <template v-else>
        <div v-for="g in groups" :key="g.date" class="day-group">
          <div class="day-head">
            <span>{{ fmtDate(g.date) }}</span>
            <span class="muted">{{ g.list.length }} 笔</span>
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

    <!-- 回到顶部 -->
    <button v-if="showTop" class="back-top" @click="scrollTop"><ArrowUp :size="18" /></button>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.back { padding: 6px; color: var(--text); display: flex; flex-shrink: 0; }
.sbox {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 20px; padding: 7px 12px;
}
.sbox-ico { color: var(--text2); flex-shrink: 0; }
.sbox-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 14px; color: var(--text); }

.agg-card { padding: 14px; }
.agg-main { display: flex; align-items: baseline; gap: 6px; margin-bottom: 10px; }
.agg-num { font-size: 26px; font-weight: 700; color: var(--text); }
.agg-unit { font-size: 13px; color: var(--text2); }
.agg-total { margin-left: auto; font-size: 12px; }
.agg-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.agg-item {
  display: flex; flex-direction: column; gap: 4px;
  background: var(--bg); border-radius: 10px; padding: 8px;
  min-width: 0;
}
.agg-label { font-size: 11px; color: var(--text2); }
.agg-item .num { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.list-card { padding: 6px 14px 12px; margin-top: 12px; }
.day-group { margin-top: 8px; }
.day-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: var(--text2);
  padding: 8px 0 2px; border-bottom: 1px dashed var(--border);
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
