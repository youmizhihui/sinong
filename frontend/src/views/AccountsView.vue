<script setup lang="ts">
defineOptions({ name: 'AccountsView' })
import { ref, onMounted, onActivated, onDeactivated } from 'vue'
import { useRouter } from 'vue-router'
import { api, type Account, type AccountsData } from '../api'
import { store, fmtMoney } from '../store'
import { Eye, EyeOff, Plus, Wallet, ChevronDown, ChevronUp, ArrowUp, Pencil } from 'lucide-vue-next'
import AccountEditSheet from '../components/AccountEditSheet.vue'

const router = useRouter()
const data = ref<AccountsData | null>(null)
const loading = ref(true)
const collapsed = ref<Record<string, boolean>>({})
const showForm = ref(false)
/** 有值为编辑，为空为新增 */
const editingAccount = ref<Account | null>(null)
const showTop = ref(false)

const TYPE_LABEL: Record<string, string> = {
  cash: '现金', savings: '储蓄卡', credit: '信用卡', online: '网络账户',
  investment: '投资账户', stored: '储值卡', receivable: '应收应付', archived: '已封存',
}
const TYPE_DESC: Record<string, string> = {
  cash: '钱包、手头现金', savings: '银行储蓄卡', credit: '信用卡（负债）',
  online: '微信/支付宝等', investment: '基金、股票等', stored: '购物卡、会员卡', receivable: '应收、应付、借款',
  archived: '不再使用的卡/账户',
}

function openCreate() {
  editingAccount.value = null
  showForm.value = true
}
function openEdit(a: Account) {
  editingAccount.value = a
  showForm.value = true
}

async function load() {
  data.value = await api.get<AccountsData>('accounts?scope=all')
  loading.value = false
}

function onWinScroll() {
  showTop.value = window.scrollY > 400
}
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }

onMounted(() => {
  load()
  window.addEventListener('scroll', onWinScroll, { passive: true })
})
onActivated(() => {
  window.addEventListener('scroll', onWinScroll, { passive: true })
  if (store.accountsDirty) {
    store.accountsDirty = false
    load()
  }
})
onDeactivated(() => {
  window.removeEventListener('scroll', onWinScroll)
})

/** 弹层保存成功：刷新列表 */
async function afterSaved() {
  await load()
}

function toggle(t: string) {
  collapsed.value[t] = !collapsed.value[t]
}
onActivated(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <span class="page-title">账户</span>
      <button class="head-add" @click="openCreate"><Plus :size="20" /></button>
    </div>

    <!-- 净资产卡 -->
    <div class="hero card">
      <div class="hero-row">
        <span class="muted">净资产</span>
        <span class="eye" @click="store.settings.hideAmount = !store.settings.hideAmount">
          <EyeOff v-if="store.settings.hideAmount" :size="16" />
          <Eye v-else :size="16" />
        </span>
      </div>
      <div v-if="loading" class="hero-sk" />
      <div v-else class="hero-amount num">
        {{ store.settings.hideAmount ? '****' : fmtMoney(data?.netWorth ?? 0) }}
      </div>
      <div v-if="loading" class="hero-sk-sub" />
      <div v-else class="hero-sub muted">
        总资产 {{ store.settings.hideAmount ? '**' : fmtMoney(data?.totalAssets ?? 0) }}
        · 总负债 {{ store.settings.hideAmount ? '**' : fmtMoney(data?.totalLiabilities ?? 0) }}
      </div>
    </div>

    <!-- 分组列表 -->
    <div class="card groups">
      <template v-if="loading">
        <van-skeleton avatar :row="2" v-for="i in 3" :key="i" style="padding: 10px 2px;" />
      </template>
      <template v-else>
        <div v-for="g in (data?.groups ?? [])" :key="g.type" class="group">
        <div class="group-head" @click="toggle(g.type)">
          <div class="group-name">
            <span class="muted">{{ TYPE_LABEL[g.type] || g.type }} ({{ g.count }})</span>
            <ChevronDown v-if="collapsed[g.type]" :size="16" class="muted" />
            <ChevronUp v-else :size="16" class="muted" />
          </div>
          <span class="num group-total">{{ fmtMoney(g.total) }}</span>
        </div>
        <template v-if="!collapsed[g.type]">
          <div v-for="a in g.items" :key="a.id" class="row" :class="{ archived: a.type === 'archived' }" @click="router.push(`/account/${a.id}`)">
            <span class="icon-badge"><Wallet :size="18" /></span>
            <div class="row-main">
              <div class="row-title">
                {{ a.name }}
                <span v-if="a.is_private" class="private-tag">私有</span>
                <span v-if="a.type === 'archived'" class="archived-tag">已封存</span>
              </div>
              <div class="muted">{{ a.note || TYPE_DESC[a.type] || '' }}</div>
            </div>
            <span class="num" :class="a.currentBalance < 0 ? 'money-expense' : ''">{{ fmtMoney(a.currentBalance) }}</span>
            <button class="row-edit" title="编辑账户" @click.stop="openEdit(a)"><Pencil :size="14" /></button>
          </div>
        </template>
      </div>
      </template>
    </div>

    <!-- 新增 / 编辑账户（与账户详情页共用同一弹层组件） -->
    <AccountEditSheet v-model:show="showForm" :account="editingAccount" @saved="afterSaved" />

    <!-- 回到顶部 -->
    <button v-if="showTop" class="back-top" @click="scrollTop"><ArrowUp :size="18" /></button>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 12px; }
.hero { background: linear-gradient(135deg, var(--brand) 0%, #FF8E5E 100%); border: none; color: #fff; }
.hero-row { display: flex; justify-content: space-between; align-items: center; }
.hero-row .muted { color: rgba(255, 255, 255, 0.75); }
.eye { cursor: pointer; padding: 4px; }
.hero-amount { font-size: 28px; font-weight: 700; margin: 6px 0 2px; }
.hero-sub { color: rgba(255, 255, 255, 0.8) !important; }
.hero-sk {
  width: 60%; height: 34px; border-radius: 8px; margin: 10px 0 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.16) 25%, rgba(255,255,255,0.3) 37%, rgba(255,255,255,0.16) 63%);
  background-size: 400% 100%; animation: sk 1.4s ease infinite;
}
.hero-sk-sub {
  width: 40%; height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.14) 25%, rgba(255,255,255,0.26) 37%, rgba(255,255,255,0.14) 63%);
  background-size: 400% 100%; animation: sk 1.4s ease infinite;
}
@keyframes sk { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

.groups { padding: 4px 14px 12px; }
.group-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 0 6px; cursor: pointer;
}
.group-name { display: flex; align-items: center; gap: 4px; }
.group-total { font-weight: 600; }
.row-main { flex: 1; min-width: 0; }
.row-title { font-size: 14px; display: flex; align-items: center; gap: 6px; }
.archived-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: #F3F4F6; color: #9CA3AF; font-weight: 400;
}
.private-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: #FEF3C7; color: #92400E; font-weight: 400;
}
.row.archived { opacity: 0.55; }
.row-edit {
  padding: 4px; margin-left: 2px;
  color: var(--text2); display: flex; flex-shrink: 0;
}

.page-head { display: flex; align-items: center; justify-content: space-between; }
.head-add { padding: 6px; color: var(--brand); display: flex; }

.back-top {
  position: fixed; right: 16px; bottom: 80px;
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--card); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text2); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  z-index: 10;
}
</style>
