<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { api, type Entry, type Account, type AccountsData, type Category, type Member } from '../api'
import { fmtMoney, store } from '../store'
import {
  ArrowLeft, Trash2, Pencil, Undo2, BadgeCheck,
  CalendarDays, Wallet, User, X, ShoppingBag, FileText,
} from 'lucide-vue-next'

const route = useRoute()
const previewUrl = ref('')
const ATT_BASE = import.meta.env.BASE_URL
function attUrl(u?: string) { return u ? ATT_BASE + u : '' }
function preview(url: string) { previewUrl.value = ATT_BASE + url }
const router = useRouter()

const id = computed(() => route.params.id as string)
const entry = ref<Entry | null>(null)
const accounts = ref<Account[]>([])
const cats = ref<Category[]>([])
const members = ref<Member[]>([])
const loading = ref(true)

// 退款/报销弹窗
const showRefund = ref(false)
const showReimb = ref(false)
const opAmount = ref('')
const opAccId = ref('')
const submitting = ref(false)

const FLOW_LABEL: Record<string, string> = { expense: '支出', income: '收入', transfer: '转账', refund: '退款' }

async function load() {
  try {
    entry.value = await api.get<Entry>(`entries/${id.value}`)
  } catch (e) {
    showToast((e as Error).message)
    router.replace('/')
  } finally {
    loading.value = false
  }
}

async function loadAccounts() {
  const d = await api.get<AccountsData>('accounts')
  accounts.value = Object.values(d.groups).flatMap((g) => g.items)
}
async function loadCats() {
  const [ex, inc] = await Promise.all([
    api.get<{ groups: Category[] }>('categories?type=expense'),
    api.get<{ groups: Category[] }>('categories?type=income'),
  ])
  cats.value = [...ex.groups, ...inc.groups]
}
async function loadMembers() {
  try {
    members.value = await api.get<Member[]>('members')
  } catch { /* 无成员接口容错 */ }
}

onMounted(() => {
  Promise.all([load(), loadAccounts(), loadCats(), loadMembers()])
})

const amountText = computed(() => {
  const e = entry.value
  if (!e) return ''
  const sign = e.flowType === 'income' ? '+' : e.flowType === 'transfer' ? '' : '-'
  return `${sign}${fmtMoney(e.amount)}`
})
const catName = computed(() => {
  const e = entry.value
  if (!e?.categoryId) return ''
  return cats.value.flatMap((g) => g.children || []).find((c) => c.id === e.categoryId)?.name || ''
})
const accName = computed(() => accounts.value.find((a) => a.id === entry.value?.accountId)?.name || '')
const toAccName = computed(() => accounts.value.find((a) => a.id === entry.value?.toAccountId)?.name || '')
const memberName = computed(() => {
  const e = entry.value
  if (!e?.memberId) return ''
  return members.value.find((m) => m.id === e.memberId)?.name || ''
})
const timeText = computed(() => {
  const d = entry.value?.entryDate
  if (!d) return ''
  const [ymd, hm] = d.split(' ')
  const [y, m, day] = ymd.split('-')
  return `${y}年${Number(m)}月${Number(day)}日 ${(hm || '').slice(0, 5)}`
})
const refundText = computed(() => {
  const e = entry.value
  if (!e || e.flowType !== 'expense') return ''
  if (e.refundedAmount > 0) return `已退 ${fmtMoney(e.refundedAmount)}${e.refundStatus === 'full' ? '（全额）' : '（部分）'}`
  return ''
})
const reimburseText = computed(() => {
  const e = entry.value
  if (!e || !e.reimbursable) return ''
  if (e.reimbursedAmount > 0) return `已报 ${fmtMoney(e.reimbursedAmount)}${e.reimburseStatus === 'done' ? '（已结清）' : '（部分）'}`
  return ''
})
const refundRemain = computed(() => {
  const e = entry.value
  return e ? e.amount - (e.refundedAmount || 0) : 0
})
const reimburseRemain = computed(() => {
  const e = entry.value
  return e ? e.amount - (e.reimbursedAmount || 0) : 0
})
const canRefund = computed(() => {
  const e = entry.value
  return (
    !!e &&
    e.flowType === 'expense' &&
    e.reimburseStatus !== 'done' &&   // 已报销结清的不再退款
    e.refundStatus !== 'full' &&
    refundRemain.value > 0
  )
})
const canReimburse = computed(() => {
  const e = entry.value
  return !!e && !!e.reimbursable && e.reimburseStatus !== 'done' && reimburseRemain.value > 0
})

async function remove() {
  if (!entry.value) return
  try {
    await showConfirmDialog({
      title: '删除记录',
      message: '删除这条记录？删除后不可恢复。',
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--expense)',
    })
  } catch {
    return // 用户取消
  }
  try {
    await api.del(`entries/${id.value}`)
    store.homeDirty = true
    showToast('已删除')
    router.back()
  } catch (e) {
    showToast((e as Error).message)
  }
}

function openRefund() {
  opAmount.value = String(refundRemain.value / 100)   // 默认填最高可退金额
  opAccId.value = entry.value?.accountId || ''
  showRefund.value = true
}
function openReimburse() {
  opAmount.value = String(reimburseRemain.value / 100)  // 默认填可报销总金额
  opAccId.value = accounts.value.find((a) => a.type !== 'credit' && a.type !== 'receivable')?.id || accounts.value[0]?.id || ''
  showReimb.value = true
}
function parseCents(v: string): number {
  const n = Math.round(parseFloat(v || '0') * 100)
  return Number.isFinite(n) && n > 0 ? n : 0
}
async function submitRefund() {
  const cents = parseCents(opAmount.value)
  if (!cents) { showToast('请输入有效退款金额'); return }
  if (!opAccId.value) { showToast('请选择退款账户'); return }
  submitting.value = true
  try {
    await api.post(`entries/${id.value}/refund`, { amount: cents, accountId: opAccId.value })
    store.homeDirty = true
    showRefund.value = false
    showToast('退款成功')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    submitting.value = false
  }
}
async function submitReimburse() {
  const cents = parseCents(opAmount.value)
  if (!cents) { showToast('请输入有效报销金额'); return }
  if (!opAccId.value) { showToast('请选择入账账户'); return }
  submitting.value = true
  try {
    await api.post(`entries/${id.value}/reimburse`, { amount: cents, toAccountId: opAccId.value })
    store.homeDirty = true
    showReimb.value = false
    showToast('报销成功')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page detail">
    <!-- 顶部 -->
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">记录详情</span>
      <button class="del-btn" @click="remove"><Trash2 :size="18" /></button>
    </div>

    <template v-if="loading">
      <van-skeleton title avatar :row="4" style="padding: 16px;" />
    </template>

    <template v-else-if="entry">
      <!-- 金额卡 -->
      <div class="card amount-card" :class="entry.flowType">
        <div class="flow-badge" :class="entry.flowType">{{ FLOW_LABEL[entry.flowType] }}</div>
        <div class="big-amount" :class="entry.flowType">{{ amountText }}</div>
        <div class="muted">{{ catName || (entry.flowType === 'transfer' ? '转账' : '未分类') }}</div>
      </div>

      <!-- 信息卡 -->
      <div class="card info-card">
        <div class="info-row">
          <span class="info-icon"><Wallet :size="15" /></span>
          <span class="info-label">账户</span>
          <span class="info-val">{{ entry.flowType === 'transfer' ? `${accName} → ${toAccName}` : accName }}</span>
        </div>
        <div class="info-row">
          <span class="info-icon"><CalendarDays :size="15" /></span>
          <span class="info-label">时间</span>
          <span class="info-val">{{ timeText }}</span>
        </div>
        <div v-if="memberName" class="info-row">
          <span class="info-icon"><User :size="15" /></span>
          <span class="info-label">成员</span>
          <span class="info-val">{{ memberName }}</span>
        </div>
        <div v-if="entry.platform" class="info-row">
          <span class="info-icon"><ShoppingBag :size="15" /></span>
          <span class="info-label">消费平台</span>
          <span class="info-val">{{ entry.platform }}</span>
        </div>
        <div v-if="entry.note" class="info-row">
          <span class="info-icon"><FileText :size="15" /></span>
          <span class="info-label">备注</span>
          <span class="info-val">{{ entry.note }}</span>
        </div>
        <div v-if="refundText" class="info-row">
          <span class="info-icon"><Undo2 :size="15" /></span>
          <span class="info-label">退款</span>
          <span class="info-val refund">{{ refundText }}</span>
        </div>
        <div v-if="reimburseText || entry.reimbursable" class="info-row">
          <span class="info-icon"><BadgeCheck :size="15" /></span>
          <span class="info-label">报销</span>
          <span class="info-val" :class="entry.reimburseStatus === 'full' ? 'reimb-full' : ''">
            {{ reimburseText || '待报销' }}{{ entry.reimburseTarget ? `（${entry.reimburseTarget}）` : '' }}
          </span>
        </div>
      </div>

      <!-- 附件（凭证图片，点击全屏查看） -->
      <div v-if="entry.attachments.length" class="card attach-card">
        <div class="attach-title">凭证图片（{{ entry.attachments.length }}）</div>
        <div class="attach-grid">
          <button v-for="a in entry.attachments" :key="a.id" class="attach-thumb" @click="preview(a.url || '')">
            <img :src="attUrl(a.url)" :alt="a.fileName" loading="lazy" />
          </button>
        </div>
      </div>

      <!-- 操作区：退款/报销回款流水（系统生成）不可编辑，只保留删除 -->
      <div class="ops">
        <button
          v-if="entry.flowType !== 'refund' && !entry.relatedEntryId"
          class="op primary" @click="router.push(`/entry?edit=${entry.id}`)"
        ><Pencil :size="16" /> 编辑</button>
        <button v-if="canRefund" class="op" @click="openRefund"><Undo2 :size="16" /> 退款</button>
        <button v-if="canReimburse" class="op" @click="openReimburse"><BadgeCheck :size="16" /> 报销</button>
      </div>
      <div v-if="entry.refundStatus === 'full' && entry.flowType === 'expense'" class="done-tip muted">
        已全额退款（{{ fmtMoney(entry.refundedAmount) }} 回到账户）
      </div>
    </template>

    <!-- 退款弹窗 -->
    <!-- 全屏图片查看 -->
    <teleport to="body">
      <div v-if="previewUrl" class="fs-viewer" @click="previewUrl = ''">
        <img :src="previewUrl" alt="凭证" />
        <button class="fs-close"><X :size="26" /></button>
      </div>
    </teleport>

    <van-popup v-model:show="showRefund" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">退款</span>
        <button class="pop-close" @click="showRefund = false"><X :size="18" /></button>
      </div>
      <div class="op-pop-body">
        <div class="op-remain muted">可退余额：{{ fmtMoney(refundRemain) }}</div>
        <input v-model="opAmount" inputmode="decimal" placeholder="0.00" class="op-input" />
        <div class="op-label muted">退回账户</div>
        <div class="acc-list">
          <button
            v-for="a in accounts" :key="a.id"
            class="acc-item" :class="{ sel: opAccId === a.id }"
            @click="opAccId = a.id"
          >
            <span>{{ a.name }}</span>
            <span class="muted">{{ fmtMoney(a.currentBalance) }}</span>
          </button>
        </div>
        <button class="op-submit" :disabled="submitting" @click="submitRefund">确认退款</button>
      </div>
    </van-popup>

    <!-- 报销弹窗 -->
    <van-popup v-model:show="showReimb" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">报销回收</span>
        <button class="pop-close" @click="showReimb = false"><X :size="18" /></button>
      </div>
      <div class="op-pop-body">
        <div class="op-remain muted">
          剩余可报：{{ fmtMoney(reimburseRemain) }}{{ entry?.reimburseTarget ? `（${entry.reimburseTarget}）` : '' }}
        </div>
        <input v-model="opAmount" inputmode="decimal" placeholder="0.00" class="op-input" />
        <div class="op-label muted">入账账户（以转账入账，不计收入）</div>
        <div class="acc-list">
          <button
            v-for="a in accounts" :key="a.id"
            class="acc-item" :class="{ sel: opAccId === a.id }"
            @click="opAccId = a.id"
          >
            <span>{{ a.name }}</span>
            <span class="muted">{{ fmtMoney(a.currentBalance) }}</span>
          </button>
        </div>
        <button class="op-submit" :disabled="submitting" @click="submitReimburse">确认报销</button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.detail { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.title { font-size: 16px; font-weight: 600; }
.del-btn { padding: 6px; color: var(--expense); }

.amount-card { text-align: center; padding: 22px 16px; }
.flow-badge {
  display: inline-block; padding: 3px 12px; border-radius: 12px;
  font-size: 12px; font-weight: 600; margin-bottom: 10px;
}
.flow-badge.expense { background: var(--expense); color: #fff; }
.flow-badge.income { background: var(--income); color: #fff; }
.flow-badge.transfer { background: var(--text2); color: #fff; }
.flow-badge.refund { background: var(--income); color: #fff; }
.big-amount { font-size: 34px; font-weight: 700; margin-bottom: 4px; }
.big-amount.expense { color: var(--expense); }
.big-amount.income, .big-amount.refund { color: var(--income); }

.info-card { padding: 6px 14px; }
.info-row { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--border); }
.info-row:last-child { border-bottom: none; }
.info-icon { color: var(--text2); display: flex; }
.info-label { min-width: 44px; flex-shrink: 0; font-size: 13px; color: var(--text2); }
.info-val { flex: 1; font-size: 14px; color: var(--text); text-align: right; }
.info-val.refund { color: var(--income); }
.info-val.reimb-full { color: var(--income); }

.attach-card { padding: 10px 14px; }
.attach-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.attach-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
.attach-thumb { width: 100%; aspect-ratio: 1; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); background: var(--bg); padding: 0; }
.attach-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fs-viewer {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0, 0, 0, 0.92);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.fs-viewer img { max-width: 100%; max-height: 100%; border-radius: 8px; }
.fs-close {
  position: fixed; top: 18px; right: 18px;
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255, 255, 255, 0.14); color: #fff;
  display: flex; align-items: center; justify-content: center;
}

.ops { display: flex; gap: 10px; }
.op {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 12px 0; border-radius: 12px; font-size: 14px; font-weight: 600;
  background: var(--card); border: 1px solid var(--border); color: var(--text);
}
.op.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.done-tip { text-align: center; font-size: 12px; }

.op-pop-body { padding: 4px 16px 18px; }
.op-remain { font-size: 12px; margin-bottom: 8px; }
.op-input {
  width: 100%; padding: 12px 14px; border-radius: 12px;
  background: var(--bg); border: 1px solid var(--border);
  font-size: 22px; font-weight: 700; color: var(--text); text-align: right;
}
.op-label { font-size: 12px; margin: 14px 0 8px; }
.acc-list { max-height: 34vh; overflow-y: auto; }
.acc-item {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 12px; background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; margin-bottom: 6px; font-size: 14px;
}
.acc-item.sel { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); font-weight: 600; }
.op-submit {
  width: 100%; margin-top: 12px; padding: 13px 0; border-radius: 12px;
  background: var(--brand); color: #fff; font-size: 15px; font-weight: 600;
}
.op-submit:disabled { opacity: 0.4; }

.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); }
</style>
