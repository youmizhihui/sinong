<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { api, type FnosUser } from '../api'
import { store } from '../store'
import { ArrowLeft, Plus, MoreHorizontal, Check, BookOpen, Luggage, Briefcase, Layers, Users, Lock } from 'lucide-vue-next'

const router = useRouter()

interface LedgerMember { user_id: string; perm: string }
interface Ledger {
  id: string
  name: string
  icon?: string
  is_default: number
  type?: 'private' | 'shared'
  owner_uid?: string | null
  entryCount?: number
  members?: LedgerMember[]
}

const ledgers = ref<Ledger[]>([])
const currentId = ref<string | null>(null)
const loading = ref(true)
const showMenu = ref(false)
const menuTarget = ref<Ledger | null>(null)
const showAdd = ref(false)
const addName = ref('')
const addIcon = ref('book-open')
const addType = ref<'private' | 'shared'>('shared')
const showEdit = ref(false)
const editName = ref('')
const editType = ref<'private' | 'shared'>('private')
const showMembers = ref(false)
const memberTarget = ref<Ledger | null>(null)
const memberList = ref<LedgerMember[]>([])
const fnosUsers = ref<FnosUser[]>([])
const saving = ref(false)

const TEMPLATES = [
  { icon: 'book-open', label: '日常' },
  { icon: 'luggage', label: '旅行' },
  { icon: 'briefcase', label: '生意' },
  { icon: 'layers', label: '其他' },
]
const ICONS = { 'book-open': BookOpen, luggage: Luggage, briefcase: Briefcase, layers: Layers } as const

async function load() {
  try {
    const d = await api.get<{ ledgers: Ledger[]; currentLedgerId: string | null }>('ledgers')
    ledgers.value = d.ledgers
    currentId.value = d.currentLedgerId
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function switchLedger(l: Ledger) {
  if (l.id === currentId.value) return
  await api.put('settings', { currentLedgerId: l.id })
  store.settings.currentLedgerId = l.id
  currentId.value = l.id
  showToast(`已切换到「${l.name}」`)
}

function openMenu(l: Ledger) {
  menuTarget.value = l
  showMenu.value = true
}
async function editLedger() {
  showMenu.value = false
  if (!menuTarget.value) return
  editName.value = menuTarget.value.name
  editType.value = menuTarget.value.type || 'private'
  showEdit.value = true
}
async function saveEdit() {
  if (!editName.value.trim()) { showToast('请输入账本名称'); return }
  if (!menuTarget.value) return
  saving.value = true
  try {
    await api.put(`ledgers/${menuTarget.value.id}`, { name: editName.value.trim(), type: editType.value })
    showEdit.value = false
    showToast('已保存')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}
async function removeLedger() {
  showMenu.value = false
  const l = menuTarget.value
  if (!l) return
  try {
    await showConfirmDialog({
      title: '删除账本',
      message: `删除「${l.name}」？默认账本与有流水的账本不可删除。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--expense)',
    })
  } catch {
    return
  }
  try {
    await api.del(`ledgers/${l.id}`)
    showToast('已删除')
    await load()
    if (currentId.value === l.id) {
      store.settings.currentLedgerId = null
      currentId.value = null
    }
  } catch (e) {
    showToast((e as Error).message)
  }
}

function openAdd() {
  addName.value = ''
  addIcon.value = 'book-open'
  addType.value = 'shared'
  showAdd.value = true
}
async function addLedger() {
  if (!addName.value.trim()) { showToast('请输入账本名称'); return }
  saving.value = true
  try {
    await api.post('ledgers', { name: addName.value.trim(), icon: addIcon.value, type: addType.value })
    showAdd.value = false
    showToast('已创建')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}

async function openMembers(l: Ledger) {
  showMenu.value = false
  memberTarget.value = l
  memberList.value = l.members || []
  try {
    const d = await api.get<{ users: FnosUser[] }>('users')
    fnosUsers.value = d.users
  } catch {
    fnosUsers.value = []
  }
  showMembers.value = true
}
function isMember(uid: string) {
  return memberList.value.some((m) => m.user_id === uid || m.user_id === '*')
}
function isAdmin(uid: string) {
  return memberList.value.some((m) => (m.user_id === uid || m.user_id === '*') && m.perm === 'admin')
}
async function toggleMember(u: FnosUser) {
  if (!memberTarget.value) return
  if (isAdmin(u.uid)) return
  if (isMember(u.uid)) {
    try {
      await api.del(`ledgers/${memberTarget.value.id}/members/${u.uid}`)
      memberList.value = memberList.value.filter((m) => m.user_id !== u.uid)
      showToast('已移除')
      await load()
    } catch (e) { showToast((e as Error).message) }
  } else {
    try {
      await api.post(`ledgers/${memberTarget.value.id}/members`, { userId: u.uid, perm: 'rw' })
      memberList.value.push({ user_id: u.uid, perm: 'rw' })
      showToast('已添加')
      await load()
    } catch (e) { showToast((e as Error).message) }
  }
}
</script>

<template>
  <div class="page ledgers">
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">账本</span>
      <button class="add-btn" @click="openAdd"><Plus :size="20" /></button>
    </div>

    <van-skeleton v-if="loading" title :row="3" style="padding: 16px;" />
    <div v-else class="ledger-list">
      <div
        v-for="l in ledgers" :key="l.id"
        class="ledger-card" :class="{ current: l.id === currentId }"
        @click="switchLedger(l)"
      >
        <span class="ledger-icon">
          <component :is="ICONS[l.icon as keyof typeof ICONS] || BookOpen" :size="20" />
        </span>
        <div class="ledger-main">
          <div class="ledger-name">
            {{ l.name }}
            <span v-if="l.is_default" class="default-tag">默认</span>
            <span v-if="l.type === 'private'" class="type-tag private"><Lock :size="10" /> 私人</span>
            <span v-else class="type-tag shared"><Users :size="10" /> 共享</span>
          </div>
          <div class="muted">{{ l.entryCount ?? 0 }} 笔</div>
        </div>
        <button class="more-btn" @click.stop="openMenu(l)"><MoreHorizontal :size="18" /></button>
      </div>
    </div>

    <p class="tip muted">点击账本切换当前记账账本；所有页面按当前账本显示数据。</p>

    <!-- 行操作菜单 -->
    <van-popup v-model:show="showMenu" position="bottom" round>
      <div class="menu-head">
        <span class="pop-title">{{ menuTarget?.name }}</span>
        <button class="pop-close" @click="showMenu = false"><MoreHorizontal :size="18" /></button>
      </div>
      <div class="menu-body">
        <button class="menu-item" @click="editLedger">重命名</button>
        <button v-if="menuTarget?.type !== 'private'" class="menu-item" @click="openMembers(menuTarget!)">成员管理</button>
        <button class="menu-item danger" @click="removeLedger">删除账本</button>
      </div>
    </van-popup>

    <!-- 新建弹层 -->
    <van-popup v-model:show="showAdd" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">新建账本</span>
        <button class="pop-close" @click="showAdd = false"><Plus :size="18" /></button>
      </div>
      <div class="form-body">
        <div class="rel-label muted">账本类型</div>
        <div class="tmpl-chips">
          <button class="tmpl-chip" :class="{ active: addType === 'shared' }" @click="addType = 'shared'">
            <Users :size="14" /> 共享账本
          </button>
          <button class="tmpl-chip" :class="{ active: addType === 'private' }" @click="addType = 'private'">
            <Lock :size="14" /> 私人账本
          </button>
        </div>
        <div class="rel-label muted" style="margin-top: 14px;">类型模板</div>
        <div class="tmpl-chips">
          <button
            v-for="t in TEMPLATES" :key="t.icon"
            class="tmpl-chip" :class="{ active: addIcon === t.icon }"
            @click="addIcon = t.icon"
          >
            <component :is="ICONS[t.icon as keyof typeof ICONS]" :size="16" /> {{ t.label }}
          </button>
        </div>
        <input v-model="addName" class="name-input" maxlength="12" placeholder="账本名称（如 家庭账本）" style="margin-top: 14px;" />
        <button class="save-btn" :disabled="saving" @click="addLedger">创建</button>
      </div>
    </van-popup>

    <!-- 编辑弹层 -->
    <van-popup v-model:show="showEdit" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">编辑账本</span>
        <button class="pop-close" @click="showEdit = false"><Plus :size="18" /></button>
      </div>
      <div class="form-body">
        <input v-model="editName" class="name-input" maxlength="12" placeholder="账本名称" />
        <div class="type-select">
          <button class="type-opt" :class="{ on: editType === 'private' }" @click="editType = 'private'">
            <Lock :size="16" /> 私人账本
          </button>
          <button class="type-opt" :class="{ on: editType === 'shared' }" @click="editType = 'shared'">
            <Users :size="16" /> 共享账本
          </button>
        </div>
        <div v-if="editType === 'shared'" class="type-tip">转为共享后可在成员管理中添加家人</div>
        <button class="save-btn" :disabled="saving" @click="saveEdit">保存</button>
      </div>
    </van-popup>

    <!-- 成员管理弹层 -->
    <van-popup v-model:show="showMembers" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">成员管理 · {{ memberTarget?.name }}</span>
        <button class="pop-close" @click="showMembers = false"><Plus :size="18" /></button>
      </div>
      <div class="form-body">
        <div class="rel-label muted">勾选可访问此账本的飞牛用户（家人需先打开过一次司农记账才会出现在列表）</div>
        <div v-if="fnosUsers.length" class="member-list">
          <div v-for="u in fnosUsers" :key="u.uid" class="member-row" :class="{ disabled: isAdmin(u.uid) }">
            <span class="member-id">{{ u.name || u.uid }}</span>
            <span class="member-perm">{{ isAdmin(u.uid) ? '管理员' : isMember(u.uid) ? '可读写' : '未共享' }}</span>
            <button v-if="!isAdmin(u.uid)" class="member-check" :class="{ on: isMember(u.uid) }" @click="toggleMember(u)">
              <Check v-if="isMember(u.uid)" :size="14" />
            </button>
            <span v-else class="member-lock">管理员</span>
          </div>
        </div>
        <div v-else class="muted" style="padding: 16px 0; text-align: center;">暂无已知用户，让家人先打开一次司农记账</div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.ledgers { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.title { font-size: 16px; font-weight: 600; }
.add-btn { padding: 6px; color: var(--brand); }

.ledger-list { display: flex; flex-direction: column; gap: 10px; }
.ledger-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px; background: var(--card);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer;
}
.ledger-card.current { border-color: var(--brand); background: var(--brand-soft); }
.ledger-icon {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: var(--brand-soft); color: var(--brand);
}
.ledger-card.current .ledger-icon { background: var(--brand); color: #fff; }
.ledger-main { flex: 1; min-width: 0; }
.ledger-name { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; }
.default-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px;
  background: var(--bg); color: var(--text2); border: 1px solid var(--border);
}
.type-tag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; padding: 1px 7px; border-radius: 8px; font-weight: 500;
}
.type-tag.private { background: #F3F4F6; color: #6B7280; border: 1px solid #E5E7EB; }
.type-tag.shared { background: var(--brand-soft); color: var(--brand); border: 1px solid var(--brand); }
.member-list { display: flex; flex-direction: column; gap: 8px; }
.member-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: var(--bg); border-radius: 10px; border: 1px solid var(--border);
}
.member-id { flex: 1; font-size: 14px; font-weight: 500; }
.member-perm { font-size: 12px; color: var(--text2); }
.member-del { padding: 4px; color: var(--expense); display: flex; }
.member-check {
  width: 22px; height: 22px; border-radius: 6px;
  border: 1.5px solid var(--border); background: var(--card);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.member-check.on { background: var(--brand); border-color: var(--brand); }
.member-lock { font-size: 11px; color: var(--text2); }
.member-row.disabled { opacity: 0.7; }
.current-badge { color: var(--brand); display: flex; }
.more-btn { padding: 6px; color: var(--text2); display: flex; }
.tip { font-size: 12px; text-align: center; }

.menu-head, .pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); display: flex; }
.menu-body { padding: 4px 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.menu-item {
  padding: 13px 0; border-radius: 12px; background: var(--bg);
  border: 1px solid var(--border); font-size: 15px; color: var(--text);
}
.menu-item.danger { color: var(--expense); }
.form-body { padding: 4px 16px 18px; }
.rel-label { font-size: 12px; margin-bottom: 8px; }
.tmpl-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.tmpl-chip {
  display: flex; align-items: center; gap: 5px;
  padding: 8px 14px; border-radius: 16px;
  background: var(--bg); border: 1px solid var(--border); font-size: 13px; color: var(--text2);
}
.tmpl-chip.active { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
.name-input {
  width: 100%; padding: 12px 14px; border-radius: 12px;
  background: var(--bg); border: 1px solid var(--border);
  font-size: 15px; color: var(--text);
}
.type-select { display: flex; gap: 10px; margin-top: 12px; }
.type-opt {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 12px 0; border-radius: 12px; background: var(--bg);
  border: 1px solid var(--border); font-size: 14px; color: var(--text2);
}
.type-opt.on { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
.type-tip { font-size: 12px; color: var(--text2); margin-top: 8px; text-align: center; }
.save-btn {
  width: 100%; margin-top: 18px; padding: 13px 0; border-radius: 12px;
  background: var(--brand); color: #fff; font-size: 15px; font-weight: 600;
}
.save-btn:disabled { opacity: 0.4; }
</style>
