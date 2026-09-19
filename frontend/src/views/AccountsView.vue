<script setup lang="ts">
defineOptions({ name: 'AccountsView' })
import { ref, computed, onMounted, onActivated, onDeactivated } from 'vue'
import { useRouter } from 'vue-router'
import { api, type AccountsData } from '../api'
import { store, fmtMoney } from '../store'
import { Eye, EyeOff, Plus, Wallet, ChevronDown, ChevronUp, ArrowUp } from 'lucide-vue-next'

const router = useRouter()
const data = ref<AccountsData | null>(null)
const loading = ref(true)
const collapsed = ref<Record<string, boolean>>({})
const showForm = ref(false)
const form = ref({ type: 'cash', name: '', balance: '' })
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
// 新建账户时可选的类型（封存是状态，不在新建时选择）
const creatableTypes = computed(() => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(TYPE_LABEL)) if (k !== 'archived') out[k] = v
  return out
})

async function load() {
  data.value = await api.get<AccountsData>('accounts')
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

async function create() {
  const balance = Math.round(parseFloat(form.value.balance || '0') * 100)
  await api.post('accounts', {
    type: form.value.type,
    name: form.value.name.trim(),
    balance: Number.isFinite(balance) ? balance : 0,
  })
  showForm.value = false
  form.value = { type: 'cash', name: '', balance: '' }
  await load()
}

function toggle(t: string) {
  collapsed.value[t] = !collapsed.value[t]
}

onMounted(load)
onActivated(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <span class="page-title">账户</span>
      <button class="head-add" @click="showForm = true"><Plus :size="20" /></button>
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
                <span v-if="a.type === 'archived'" class="archived-tag">已封存</span>
              </div>
              <div class="muted">{{ a.note || TYPE_DESC[a.type] || '' }}</div>
            </div>
            <span class="num" :class="a.currentBalance < 0 ? 'money-expense' : ''">{{ fmtMoney(a.currentBalance) }}</span>
          </div>
        </template>
      </div>
      </template>
    </div>

    <!-- 表单弹层 -->
    <div v-if="showForm" class="mask" @click.self="showForm = false">
      <div class="sheet">
        <div class="sheet-title">新增账户</div>
        <div class="type-grid">
          <button
            v-for="(label, t) in creatableTypes" :key="t"
            class="type-item" :class="{ sel: form.type === t }"
            @click="form.type = t"
          >
            <span>{{ label }}</span>
            <small>{{ TYPE_DESC[t] }}</small>
          </button>
        </div>
        <input v-model="form.name" class="field" placeholder="账户名称（必填）" />
        <input v-model="form.balance" class="field" type="number" placeholder="初始余额（元，默认 0，可负）" />
        <div class="sheet-actions">
          <button class="btn ghost" @click="showForm = false">取消</button>
          <button class="btn primary" :disabled="!form.name.trim()" @click="create">保存</button>
        </div>
      </div>
    </div>

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
.row.archived { opacity: 0.55; }

.page-head { display: flex; align-items: center; justify-content: space-between; }
.head-add { padding: 6px; color: var(--brand); display: flex; }

.mask {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: flex-end; justify-content: center;
}
.sheet {
  width: 100%; max-width: 480px;
  background: var(--card);
  border-radius: 18px 18px 0 0;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 12px;
}
.sheet-title { font-size: 16px; font-weight: 600; }
.type-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.type-item {
  border: 1px solid var(--border); border-radius: 10px;
  padding: 8px 10px; text-align: left;
  display: flex; flex-direction: column; gap: 2px;
}
.type-item.sel { border-color: var(--brand); background: var(--brand-soft); }
.type-item small { font-size: 10px; color: var(--text2); }
.field {
  border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; width: 100%;
}
.sheet-actions { display: flex; gap: 10px; }
.btn {
  flex: 1; padding: 12px; border-radius: 10px;
  font-size: 14px; font-weight: 600;
}
.btn.primary { background: var(--brand); color: #fff; }
.btn.primary:disabled { opacity: 0.4; }
.btn.ghost { background: var(--bg); color: var(--text2); }
.back-top {
  position: fixed; right: 16px; bottom: 80px;
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--card); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text2); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  z-index: 10;
}
</style>
