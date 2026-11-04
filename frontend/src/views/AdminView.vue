<script setup lang="ts">
defineOptions({ name: 'AdminView' })
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import { api, type FnosUser, type AdminLedger, type AdminAccount } from '../api'
import { store, loadSettings, fmtMoney } from '../store'
import { ArrowLeft, BookOpen, Wallet, Crown, Users, Lock, X, Repeat2 } from 'lucide-vue-next'

const router = useRouter()

const adminLedgers = ref<AdminLedger[]>([])
const adminAccounts = ref<AdminAccount[]>([])
const fnosUsers = ref<FnosUser[]>([])
const loadingUsers = ref(false)

const showLedgers = ref(false)
const showAccounts = ref(false)
const showTransfer = ref(false)
const showUsers = ref(false)

/** 正在分配的目标：kind 决定提交到哪个接口 */
const pickTarget = ref<{
  kind: 'ledger' | 'account' | 'transfer'
  id: string
  name: string
  currentUid?: string | null
  privateFlag?: boolean
} | null>(null)
const saving = ref(false)

onMounted(() => {
  // 直接进此页时 settings 可能还没拉到 isAdmin，补一次
  if (!store.settings.isAdmin) loadSettings()
})

function openLedgers() {
  showLedgers.value = true
  loadLedgers()
}
async function loadLedgers() {
  try {
    const d = await api.get<{ ledgers: AdminLedger[] }>('admin/ledgers')
    adminLedgers.value = d.ledgers
  } catch (e) {
    showToast((e as Error).message)
    showLedgers.value = false
  }
}

function openAccounts() {
  showAccounts.value = true
  loadAccounts()
}
async function loadAccounts() {
  try {
    const d = await api.get<{ accounts: AdminAccount[] }>('admin/accounts')
    adminAccounts.value = d.accounts
  } catch (e) {
    showToast((e as Error).message)
    showAccounts.value = false
  }
}

function openTransfer() {
  showTransfer.value = true
}

async function loadUsers() {
  loadingUsers.value = true
  try {
    const d = await api.get<{ users: FnosUser[] }>('users')
    fnosUsers.value = d.users.filter((u) => u.uid)
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loadingUsers.value = false
  }
}

function openPick(target: { kind: 'ledger' | 'account' | 'transfer'; id: string; name: string; currentUid?: string | null; privateFlag?: boolean }) {
  pickTarget.value = target
  loadUsers().then(() => { showUsers.value = true })
}

function pickDisabled(u: FnosUser) {
  const t = pickTarget.value
  if (!t || t.kind === 'transfer') return false
  return !!t.currentUid && u.uid === t.currentUid
}

async function pickUser(u: FnosUser) {
  const t = pickTarget.value
  if (!t || saving.value || pickDisabled(u)) return
  const uname = u.name || u.uid

  if (t.kind === 'transfer') {
    try {
      await showConfirmDialog({
        title: '移交管理员',
        message: `把管理员移交给「${uname}」？\n移交后你将失去管理员权限，之后只能由新管理员再次移交回来。`,
        confirmButtonText: '确认移交',
      })
    } catch { return }
    saving.value = true
    try {
      await api.put('admin/transfer', { ownerUid: u.uid })
      showTransfer.value = false
      showUsers.value = false
      showToast('已移交管理员')
      await loadSettings()
      router.back()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      saving.value = false
    }
    return
  }

  const isLedger = t.kind === 'ledger'
  const tips: string[] = []
  if (isLedger) {
    tips.push(t.privateFlag
      ? '私人账本只有归属人能看到，分配后你将无法再看到它的流水'
      : '对方将成为账本所有者，可管理成员与类型')
  } else {
    tips.push(t.privateFlag ? '私有账户只有归属人能看到，你之后将看不到它' : '对方将成为该账户的创建者，可修改其归属、余额与删除')
  }
  try {
    await showConfirmDialog({
      title: isLedger ? '分配账本' : '分配账户',
      message: `把「${t.name}」分配给「${uname}」？\n${tips.join('\n')}`,
      confirmButtonText: '确认分配',
    })
  } catch { return }
  saving.value = true
  try {
    const url = isLedger ? `admin/ledgers/${t.id}/owner` : `admin/accounts/${t.id}/owner`
    await api.put(url, { ownerUid: u.uid })
    showToast(`已分配给「${uname}」`)
    showUsers.value = false
    if (isLedger) await loadLedgers()
    else await loadAccounts()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page admin">
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">管理员功能</span>
      <span class="head-placeholder"></span>
    </div>

    <div class="card">
      <div class="row" style="cursor: default;">
        <span class="icon-badge admin-badge"><Crown :size="18" /></span>
        <div class="row-main">
          <div class="row-title">你是本应用的管理员</div>
          <div class="muted">管理员是最早进入司农记账的用户，无主账目归属你也归你；可在这里找回与重新分配账目归属</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="row" style="cursor: pointer;" @click="openLedgers">
        <span class="icon-badge"><BookOpen :size="18" /></span>
        <div class="row-main">
          <div class="row-title">账本找回</div>
          <div class="muted">查看全部账本归属，重新分配给任何家人</div>
        </div>
        <span class="muted">›</span>
      </div>
      <div class="row" style="cursor: pointer;" @click="openAccounts">
        <span class="icon-badge"><Wallet :size="18" /></span>
        <div class="row-main">
          <div class="row-title">账户找回</div>
          <div class="muted">查看全部账户归属，重新分配给任何家人</div>
        </div>
        <span class="muted">›</span>
      </div>
      <div class="row" style="cursor: pointer; border-top: 1px solid var(--border);" @click="openTransfer">
        <span class="icon-badge"><Repeat2 :size="18" /></span>
        <div class="row-main">
          <div class="row-title">移交管理员</div>
          <div class="muted">把管理员身份让给家人，自己退回普通用户</div>
        </div>
        <span class="muted">›</span>
      </div>
    </div>

    <p class="tip muted">管理员能调整归属，但看不到别人私人账本里的流水内容。</p>

    <!-- 账本找回 -->
    <van-popup v-model:show="showLedgers" position="bottom" round :style="{ height: '82%' }">
      <div class="pop-head">
        <span class="pop-title">账本找回</span>
        <button class="pop-close" @click="showLedgers = false"><X :size="18" /></button>
      </div>
      <div class="pop-body">
        <p class="pop-tip muted">全库共 {{ adminLedgers.length }} 本账本。点「分配」可把归属让给任何家人，包括你自己。</p>
        <div class="item-list">
          <div v-for="l in adminLedgers" :key="l.id" class="item-row">
            <div class="item-main">
              <div class="item-name">
                {{ l.name }}
                <span v-if="l.is_default" class="tag">默认</span>
                <span v-if="l.type === 'private'" class="tag private"><Lock :size="10" /> 私人</span>
                <span v-else class="tag shared"><Users :size="10" /> 共享</span>
              </div>
              <div class="muted item-sub">
                归属：{{ l.ownerName || '无主' }} · {{ l.entryCount ?? 0 }} 笔<span v-if="l.memberNames?.length"> · 成员 {{ l.memberNames.join('、') }}</span>
              </div>
            </div>
            <button class="assign-btn" @click="openPick({ kind: 'ledger', id: l.id, name: l.name, currentUid: l.owner_uid, privateFlag: l.type === 'private' })">分配</button>
          </div>
        </div>
      </div>
    </van-popup>

    <!-- 账户找回 -->
    <van-popup v-model:show="showAccounts" position="bottom" round :style="{ height: '82%' }">
      <div class="pop-head">
        <span class="pop-title">账户找回</span>
        <button class="pop-close" @click="showAccounts = false"><X :size="18" /></button>
      </div>
      <div class="pop-body">
        <p class="pop-tip muted">全库共 {{ adminAccounts.length }} 个账户。分配只改变归属，不动流水记录。</p>
        <div class="item-list">
          <div v-for="a in adminAccounts" :key="a.id" class="item-row">
            <div class="item-main">
              <div class="item-name">
                {{ a.name }}
                <span v-if="a.is_private" class="tag private"><Lock :size="10" /> 私有</span>
                <span v-else class="tag shared">共享</span>
              </div>
              <div class="muted item-sub">归属：{{ a.ownerName || '无主' }} · 余额 {{ fmtMoney(a.currentBalance) }}</div>
            </div>
            <button class="assign-btn" @click="openPick({ kind: 'account', id: a.id, name: a.name, currentUid: a.owner_uid, privateFlag: !!a.is_private })">分配</button>
          </div>
        </div>
      </div>
    </van-popup>

    <!-- 移交管理员 -->
    <van-popup v-model:show="showTransfer" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">移交管理员</span>
        <button class="pop-close" @click="showTransfer = false"><X :size="18" /></button>
      </div>
      <div class="pop-body">
        <p class="pop-tip muted">选择一位家人接任管理员。移交后你立即失去管理员权限与管理员功能入口。</p>
        <button class="assign-btn wide" @click="openPick({ kind: 'transfer', id: '', name: '管理员' })">选择接任者</button>
      </div>
    </van-popup>

    <!-- 用户选择 -->
    <van-popup v-model:show="showUsers" position="bottom" round :style="{ height: '60%' }">
      <div class="pop-head">
        <span class="pop-title">{{ pickTarget?.kind === 'transfer' ? '选择接任者' : '分配给' }}</span>
        <button class="pop-close" @click="showUsers = false"><X :size="18" /></button>
      </div>
      <div class="pop-body">
        <p v-if="pickTarget && pickTarget.kind !== 'transfer'" class="pop-tip muted">把「{{ pickTarget.name }}」分配给：</p>
        <div v-if="fnosUsers.length" class="item-list">
          <div
            v-for="u in fnosUsers" :key="u.uid"
            class="item-row" :class="{ disabled: pickDisabled(u) }"
            @click="pickUser(u)"
          >
            <span class="icon-badge"><Users :size="18" /></span>
            <div class="item-main">
              <div class="item-name">{{ u.name || u.uid }}</div>
              <div class="muted item-sub">{{ pickTarget?.currentUid === u.uid ? '当前归属' : u.uid }}</div>
            </div>
            <Crown v-if="pickTarget?.kind === 'transfer'" :size="16" class="crown-hint" />
          </div>
        </div>
        <div v-else class="muted empty-tip">{{ loadingUsers ? '加载中…' : '暂无其他用户，让家人先打开一次司农记账' }}</div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.admin { display: flex; flex-direction: column; gap: 12px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.title { font-size: 16px; font-weight: 600; }
.head-placeholder { width: 32px; }
.admin-badge { background: #FFF7E6; color: #D48806; }
.tip { font-size: 12px; text-align: center; }

.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); display: flex; }
.pop-body { padding: 4px 16px 18px; overflow-y: auto; }
.pop-tip { font-size: 12px; line-height: 1.6; margin: 4px 0 12px; }
.item-list { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; }
.item-row {
  display: flex; align-items: center; gap: 10px;
  padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
  cursor: pointer;
}
.item-row.disabled { opacity: 0.55; cursor: not-allowed; }
.item-main { flex: 1; min-width: 0; }
.item-name { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; }
.item-sub { font-size: 12px; margin-top: 2px; }
.tag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; padding: 1px 7px; border-radius: 8px; font-weight: 500;
}
.tag.private { background: #F3F4F6; color: #6B7280; border: 1px solid #E5E7EB; }
.tag.shared { background: var(--brand-soft); color: var(--brand); border: 1px solid var(--brand); }
.assign-btn {
  padding: 7px 14px; border-radius: 10px; font-size: 13px; font-weight: 600;
  background: var(--brand-soft); color: var(--brand); border: 1px solid var(--brand);
  white-space: nowrap;
}
.assign-btn.wide { width: 100%; padding: 12px 0; margin-top: 4px; }
.crown-hint { color: #D48806; }
.empty-tip { text-align: center; padding: 24px 0; font-size: 13px; }
</style>
