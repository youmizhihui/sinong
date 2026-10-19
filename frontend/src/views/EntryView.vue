<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showConfirmDialog, DatePicker as VanDatePicker, TimePicker as VanTimePicker, PickerGroup as VanPickerGroup } from 'vant'
import { api, type Account, type Category, type AccountsData, type Entry, type Member, type Attachment, type PlatformItem } from '../api'
import { iconForCat, iconForGroup } from '../catIcons'
import { store, fmtMoney } from '../store'
import {
  ArrowLeft, ArrowRight, Utensils, Check,
  CalendarDays, Wallet, Delete, X, ChevronDown, Camera, BadgeCheck, User, ShoppingBag,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
// 编辑模式：/entry?edit=<id>
const editingId = computed(() => route.query.edit as string | undefined)

const flowType = ref<'expense' | 'income' | 'transfer'>('expense')
const amountText = ref('')       // 金额输入态（元，字符串，保留小数点中间态）
const note = ref('')
const accountId = ref('')
const toAccountId = ref('')
const categoryId = ref('')
const activeGroup = ref('')
const reimbursable = ref(false)   // 可报销标记（仅支出）
const memberId = ref('')          // 成员（空 = 自己）
const platform = ref('')          // 消费平台（空 = 不选）

// 弹层开关
const showCat = ref(false)
const showAcc = ref(false)
const showDate = ref(false)
const accPickTarget = ref<'from' | 'to'>('from')
const isPc = ref(false)
const initLoading = ref(true)
function onPcResize() { isPc.value = window.innerWidth >= 768; recenterPopup() }

const accounts = ref<Account[]>([])
const accGroups = ref<AccountsData['groups']>([])
const cats = ref<Category[]>([])
const members = ref<Member[]>([])
const showMember = ref(false)
const showPlatform = ref(false)
/** 消费平台列表（后端管理，用户可自定义增删改） */
const platforms = ref<PlatformItem[]>([])
const saving = ref(false)
const done = ref(false)
// 图片凭证（第一版：本地预览 + 删除；上传落库接口下一步接入）
const fileInput = ref<HTMLInputElement | null>(null)
const images = ref<{ url: string; name: string }[]>([])
const existing = ref<Attachment[]>([])
const ATT_BASE = import.meta.env.BASE_URL
function attUrl(u?: string) { return u ? ATT_BASE + u : '' }

const FLOW_TABS: { key: 'expense' | 'income' | 'transfer'; label: string }[] = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' },
]
const TYPE_LABEL: Record<string, string> = {
  cash: '现金', savings: '储蓄卡', credit: '信用卡', online: '网络账户',
  investment: '投资账户', stored: '储值卡', receivable: '应收应付', archived: '已封存',
}

// 金额（分）由输入态字符串计算，避免换算吃掉小数点
const amount = computed(() => {
  const n = Math.round(parseFloat(amountText.value || '0') * 100)
  return Number.isFinite(n) && n >= 0 ? n : 0
})

// 过滤非法字符（桌面手动输入时）
watch(amountText, (v) => {
  if (/[^\d.]/.test(v)) amountText.value = v.replace(/[^\d.]/g, '')
})

// 分类
const catGroups = computed(() => cats.value.filter((c) => !c.parent_id))
const activeChildren = computed(() => {
  const g = cats.value.find((c) => c.id === activeGroup.value)
  return (g?.children || []).map((c) => ({ ...c, parentIcon: g?.icon }))
})
const currentCat = computed(() =>
  cats.value.flatMap((g) => g.children || []).find((c) => c.id === categoryId.value),
)
const currentCatName = computed(() => currentCat.value?.name || '')
const currentCatIcon = computed(() => {
  const g = cats.value.find((x) => x.id === activeGroup.value)
  return currentCat.value ? { ...currentCat.value, parentIcon: g?.icon } : undefined
})
// 常用分类：常用（is_frequent）优先，其余补齐，取前 12
const quickCats = computed(() => {
  const kids = cats.value.flatMap((g) => (g.children || []).map((c) => ({ ...c, parentIcon: g.icon })))
  return [...kids]
    .sort((a, b) => (b.is_frequent ?? 0) - (a.is_frequent ?? 0))
    .slice(0, 12)
})

// 账户
const selAccId = computed(() => (accPickTarget.value === 'to' ? toAccountId.value : accountId.value))
const fromAccName = computed(() => accounts.value.find((a) => a.id === accountId.value)?.name || '')
const toAccName = computed(() => accounts.value.find((a) => a.id === toAccountId.value)?.name || '')
const memberName = computed(() => members.value.find((m) => m.id === memberId.value)?.name || '自己')

// 日期时间（PickerGroup：左时间、右日期）
/** 首页月历选中的日期（YYYY-MM-DD）优先：选中日 + 当前时刻；消费后清空 */
const defaultDate = store.entryDefaultDate
store.entryDefaultDate = null
const initDate = (() => {
  if (defaultDate) {
    const [y, m, d] = defaultDate.split('-').map(Number)
    const t = new Date()
    return new Date(y, m - 1, d, t.getHours(), t.getMinutes(), t.getSeconds())
  }
  return new Date()
})()
const entryDate = ref(initDate)

// 弹层定位：手机端全宽底部弹出；PC 端与记账内容块（.page.entry）同宽同左缘
const popupLeft = ref('0px')
const popupWidth = ref('100%')
function recenterPopup() {
  if (!isPc.value) return
  const el = document.querySelector('.entry')
  if (!el) return
  const r = el.getBoundingClientRect()
  popupLeft.value = `${r.left}px`
  popupWidth.value = `${r.width}px`
}

// PickerGroup：左时间、右日期；年份范围 1949 ~ 3000
const minDate = new Date(1949, 0, 1)
const maxDate = new Date(3000, 11, 31)
const groupTimeValue = ref<string[]>(['00', '00'])
const groupDateValue = ref<string[]>(['2025', '01', '01'])

function openDatePicker() {
  const d = entryDate.value
  const p = (n: number) => String(n).padStart(2, '0')
  groupTimeValue.value = [p(d.getHours()), p(d.getMinutes())]
  groupDateValue.value = [String(d.getFullYear()), p(d.getMonth() + 1), p(d.getDate())]
  recenterPopup()
  showDate.value = true
}
function confirmGroup() {
  const [hh, mm] = groupTimeValue.value
  const [y, mo, dd] = groupDateValue.value
  entryDate.value = new Date(Number(y), Number(mo) - 1, Number(dd), Number(hh), Number(mm))
  showDate.value = false
}
function fmtEntryDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  // 分钟级选择，秒自动取当前时刻（数据库存秒，显示不暴露）
  const s = new Date().getSeconds()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(s)}`
}
const entryDateText = computed(() => {
  const d = entryDate.value
  const t = new Date()
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const y = new Date(t); y.setDate(y.getDate() - 1)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (same(d, t)) return `今天 ${hm}`
  if (same(d, y)) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
})

const canSave = computed(() => {
  if (amount.value <= 0) return false
  if (flowType.value === 'transfer') return !!accountId.value && !!toAccountId.value && accountId.value !== toAccountId.value
  return !!accountId.value
})

function switchFlow(t: 'expense' | 'income' | 'transfer') {
  flowType.value = t
  categoryId.value = ''
  activeGroup.value = ''
  reimbursable.value = false
  if (t !== 'transfer') loadCats(t)
}

async function loadCats(t: 'expense' | 'income') {
  const catData = await api.get<{ groups: Category[] }>(`categories?type=${t}`)
  cats.value = catData.groups
  activeGroup.value = catGroups.value[0]?.id || ''
  // 默认选中第一个二级分类（支出=早餐，收入=首项），实现快速记账
  const kids = catData.groups.flatMap((g) => g.children || [])
  if (kids.length && !kids.some((k) => k.id === categoryId.value)) {
    categoryId.value = kids[0].id
  }
}

function pickCategory(id: string) {
  categoryId.value = id
  const g = cats.value.find((c) => c.id === id)
  if (g && g.children) activeGroup.value = g.id
  else {
    const parent = cats.value.find((c) => c.children?.some((x) => x.id === id))
    if (parent) activeGroup.value = parent.id
  }
  showCat.value = false
}

function openAccPicker(target: 'from' | 'to') {
  accPickTarget.value = target
  showAcc.value = true
}
function pickAcc(a: Account) {
  if (accPickTarget.value === 'to') {
    toAccountId.value = a.id
    if (a.id === accountId.value) accountId.value = ''
  } else {
    accountId.value = a.id
    if (a.id === toAccountId.value) toAccountId.value = ''
  }
  showAcc.value = false
}
function typeLabel(t: string) { return TYPE_LABEL[t] || t }

function fmt(v: number) { return fmtMoney(v) }

function appendNum(d: string) {
  let cur = amountText.value
  if (d === '.') {
    if (cur.includes('.')) return          // 已有小数点
    cur = cur === '' ? '0' : cur           // 首位点 → 0.
  } else {
    if (cur === '0') return                // 整数位已 0，不能再加 0（可输入点）
  }
  if (cur.includes('.')) {
    const dec = cur.split('.')[1]
    if (dec.length >= 2) return            // 最多两位小数
  }
  amountText.value = cur + d
}
function backspace() {
  amountText.value = amountText.value.slice(0, -1)
}

function pickImages() {
  fileInput.value?.click()
}
function onFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  const max = 3 - existing.value.length
  for (const f of Array.from(files)) {
    if (images.value.length >= max) break
    images.value.push({ url: URL.createObjectURL(f), name: f.name })
  }
  ;(e.target as HTMLInputElement).value = ''
}
function removeImg(i: number) {
  URL.revokeObjectURL(images.value[i].url)
  images.value.splice(i, 1)
}
async function removeExisting(a: Attachment) {
  try {
    await api.del(`attachments/${a.id}`)
    existing.value = existing.value.filter((x) => x.id !== a.id)
  } catch (err) {
    showToast((err as Error).message)
  }
}

/** 上传本地新选图片到指定流水 */
async function uploadImages(entryId: string) {
  for (const img of images.value) {
    try {
      const blob = await fetch(img.url).then((r) => r.blob())
      await api.upload<Attachment>(`entries/${entryId}/attachments`, blob, img.name || 'photo.jpg')
    } catch (err) {
      showToast(`图片 ${img.name} 上传失败`)
    }
  }
  for (const img of images.value) URL.revokeObjectURL(img.url)
  images.value = []
}

async function save() {
  if (!canSave.value || saving.value) return
  await doSave(false, false)
}

/** 再记一笔：保存成功后清空表单，留在本页继续记账 */
async function saveAgain() {
  if (!canSave.value || saving.value) return
  await doSave(false, true)
}

/** 再记一笔：只清空金额、备注和图片凭证，保留分类、时间、账户等选择 */
function resetForm() {
  amountText.value = ''
  note.value = ''
  existing.value = []
  for (const img of images.value) URL.revokeObjectURL(img.url)
  images.value = []
}

async function doSave(resetRelations: boolean, keepEditing: boolean) {
  saving.value = true
  const body = {
    ledgerId: store.settings.currentLedgerId,
    accountId: accountId.value,
    toAccountId: flowType.value === 'transfer' ? toAccountId.value : undefined,
    flowType: flowType.value,
    amount: amount.value,
    categoryId: flowType.value === 'transfer' ? undefined : categoryId.value || undefined,
    note: note.value.trim(),
    entryDate: fmtEntryDate(entryDate.value),
    reimbursable: flowType.value === 'expense' ? reimbursable.value : undefined,
    memberId: memberId.value || undefined,
    platform: platform.value || undefined,
    resetRelations: editingId.value ? resetRelations : undefined,
  }
  try {
    let entryId = editingId.value
    if (editingId.value) {
      await api.put(`entries/${editingId.value}`, body)
      entryId = editingId.value
    } else {
      const created = await api.post<Entry>('entries', body)
      entryId = created.id
    }
    // 图片凭证落库
    if (images.value.length > 0 && entryId) await uploadImages(entryId)
    store.homeDirty = true
    if (keepEditing) {
      // 再记一笔：清空表单继续记账
      resetForm()
      showToast('已保存，可继续记账')
      return
    }
    done.value = true
    setTimeout(() => {
      done.value = false
      if (editingId.value) router.back()
      else router.push('/')
    }, editingId.value ? 400 : 500)
  } catch (e) {
    const msg = (e as Error).message
    // 编辑时修改金额会解除报销/退款关联 → 弹确认框，用户确认后带 resetRelations 重试
    if (editingId.value && /resetRelations/.test(msg)) {
      try {
        await showConfirmDialog({
          title: '确认修改',
          message: '修改金额将解除该记录的报销/退款关联：已报销、已退款金额清零，并删除关联的退款、报销流水。是否继续？',
          confirmButtonText: '确认修改',
        })
        await doSave(true, false)
      } catch {
        // 用户取消
      }
    } else {
      showToast(msg)
    }
  } finally {
    saving.value = false
  }
}

/** 编辑模式：加载已有记录并回填 */
async function loadEdit() {
  if (!editingId.value) return
  const e = await api.get<Entry>(`entries/${editingId.value}`)
  flowType.value = e.flowType as 'expense' | 'income' | 'transfer'
  amountText.value = e.amount ? String(e.amount / 100) : ''
  note.value = e.note || ''
  accountId.value = e.accountId || ''
  toAccountId.value = e.toAccountId || ''
  categoryId.value = e.categoryId || ''
  reimbursable.value = !!e.reimbursable
  memberId.value = e.memberId || ''
  platform.value = e.platform || ''
  existing.value = e.attachments || []
  // 日期回填（"YYYY-MM-DD HH:mm"）
  const d = new Date(e.entryDate.replace(' ', 'T'))
  if (!Number.isNaN(d.getTime())) {
    entryDate.value = d
  }
  if (flowType.value !== 'transfer') await loadCats(flowType.value)
}

onMounted(async () => {
  onPcResize()
  window.addEventListener('resize', onPcResize)

  // 并行请求账户、成员、分类（编辑模式并行加载详情）
  const tasks: Promise<unknown>[] = [
    api.get<AccountsData>('accounts').then((d) => {
      const active = d.groups.filter((g) => g.type !== 'archived')
      accounts.value = active.flatMap((g) => g.items)
      accGroups.value = active.filter((g) => g.items.length > 0)
      const cash = accounts.value.find((a) => a.type === 'cash')
      if (cash && !accountId.value && !editingId.value) accountId.value = cash.id
    }),
    api.get<Member[]>('members').then((m) => { members.value = m }).catch(() => { /* 成员接口容错 */ }),
    api.get<PlatformItem[]>('platforms').then((p) => { platforms.value = p }).catch(() => { /* 平台接口容错 */ }),
  ]
  if (editingId.value) {
    tasks.push(loadEdit())
  } else {
    tasks.push(loadCats('expense'))
  }
  await Promise.all(tasks)
  initLoading.value = false
})
</script>

<template>
  <div class="page entry">
    <!-- 顶部 -->
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <div class="tabs">
        <button
          v-for="t in FLOW_TABS" :key="t.key"
          class="ftab" :class="{ active: flowType === t.key }"
          @click="switchFlow(t.key)"
        >{{ t.label }}</button>
      </div>
      <span style="width: 28px"></span>
    </div>

    <!-- 金额行：左分类标签 + 中金额（整体包裹，点标签弹分类） -->
    <div class="amount-box">
      <button v-if="flowType !== 'transfer'" class="cur-cat-tag" :class="{ placeholder: !categoryId }" @click="showCat = true">
        <span class="tag-icon">
          <component v-if="currentCatIcon" :is="iconForCat(currentCatIcon)" :size="14" />
          <Utensils v-else :size="14" />
        </span>
        <span>{{ currentCatName || '选择分类' }}</span>
        <ChevronDown :size="13" class="tag-arrow" />
      </button>
      <input v-model="amountText" inputmode="decimal" placeholder="0.00" class="num" />
    </div>

    <!-- 常用分类（数据加载时仅此区域显示骨架） -->
    <template v-if="flowType !== 'transfer'">
      <van-skeleton v-if="initLoading" title :row="3" style="padding: 12px 0;" />
      <div v-else class="quick-grid">
        <button
          v-for="c in quickCats" :key="c.id"
          class="quick-item" :class="{ sel: categoryId === c.id }"
          @click="pickCategory(c.id)"
        >
          <span class="q-icon"><component :is="iconForCat(c)" :size="14" /></span>
          <span>{{ c.name }}</span>
        </button>
      </div>
    </template>

    <!-- 转账：转出/转入 一行 -->
    <template v-else>
      <div class="card trans">
        <div class="trans-line">
          <button class="trans-col" @click="openAccPicker('from')">
            <span class="muted">转出</span>
            <span class="val" :class="{ dim: !accountId }">{{ fromAccName || '选择账户' }}</span>
          </button>
          <span class="trans-arrow"><ArrowRight :size="16" /></span>
          <button class="trans-col" @click="openAccPicker('to')">
            <span class="muted">转入</span>
            <span class="val" :class="{ dim: !toAccountId }">{{ toAccName || '选择账户' }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- 备注 -->
    <div class="note-row">
      <input v-model="note" placeholder="备注（可选）" />
    </div>

    <!-- 时间 + 账户 + 拍照（一行） -->
    <div class="acc-row">
      <button class="chip" @click="openDatePicker"><CalendarDays :size="14" /> {{ entryDateText }}</button>
      <button v-if="flowType !== 'transfer'" class="chip acc-chip" :class="{ active: !!accountId }" @click="openAccPicker('from')">
        <Wallet :size="14" /> {{ fromAccName || '选择账户' }}
      </button>
      <button v-if="existing.length + images.length < 3" class="chip" @click="pickImages">
        <Camera :size="14" /> {{ existing.length + images.length ? `凭证（${existing.length + images.length}/3）` : '拍照' }}
      </button>
      <button class="chip" :class="{ active: !!platform }" @click="showPlatform = true">
        <ShoppingBag :size="14" /> {{ platform || '消费平台' }}
      </button>
    </div>

    <!-- 可报销 + 成员 -->
    <div class="info-row">
      <button
        v-if="flowType === 'expense'"
        class="chip" :class="{ active: reimbursable }"
        @click="reimbursable = !reimbursable"
      ><BadgeCheck :size="14" /> {{ reimbursable ? '可报销' : '可报销' }}</button>
      <button class="chip" :class="{ active: !!memberId }" @click="showMember = true">
        <User :size="14" /> {{ memberName }}
      </button>
    </div>
    <input ref="fileInput" type="file" accept="image/*" multiple style="display: none" @change="onFiles" />

    <!-- 凭证图片区：仅缩略图（键盘上方） -->
    <div v-if="existing.length + images.length" class="img-area">
      <div v-for="a in existing" :key="a.id" class="img-thumb">
        <img :src="attUrl(a.url)" :alt="a.fileName" />
        <button class="img-del" @click="removeExisting(a)"><X :size="12" /></button>
      </div>
      <div v-for="(img, i) in images" :key="'n' + i" class="img-thumb">
        <img :src="img.url" :alt="img.name" />
        <button class="img-del" @click="removeImg(i)"><X :size="12" /></button>
      </div>
    </div>

    <!-- 数字键盘（缩小）+ 保存 -->
    <div v-if="!isPc" class="keypad-wrap">
      <div class="keypad">
        <button v-for="k in ['1','2','3','4','5','6','7','8','9']" :key="k" class="key" @click="appendNum(k)">{{ k }}</button>
        <button class="key" @click="appendNum('.')">.</button>
        <button class="key" @click="appendNum('0')">0</button>
        <button class="key del" @click="backspace"><Delete :size="18" /></button>
      </div>
      <div class="save-row">
        <button v-if="!editingId" class="save-again" :disabled="!canSave || saving" @click="saveAgain">
          <Check :size="14" /> 再记一笔
        </button>
        <button class="save" :disabled="!canSave || saving" @click="save">
          {{ done ? '✓' : saving ? '…' : '保存' }}
        </button>
      </div>
    </div>

    <!-- PC 保存 -->
    <div v-if="isPc" class="pc-save-row">
      <button v-if="!editingId" class="pc-save-again" :disabled="!canSave || saving" @click="saveAgain">
        <Check :size="14" /> 再记一笔
      </button>
      <button class="pc-save" :disabled="!canSave || saving" @click="save">
        {{ done ? '✓ 已保存' : saving ? '保存中…' : '保存' }}
      </button>
    </div>

    <!-- 分类弹出层 -->
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
          class="cat-item" :class="{ sel: categoryId === c.id }"
          @click="pickCategory(c.id)"
        >
          <span class="cat-icon"><component :is="iconForCat(c)" :size="16" /></span>
          <span>{{ c.name }}</span>
          <Check v-if="categoryId === c.id" :size="12" class="check" />
        </button>
      </div>
    </van-popup>

    <!-- 账户弹出层（大类分组） -->
    <van-popup v-model:show="showAcc" position="bottom" round class="acc-pop">
      <div class="pop-head">
        <span class="pop-title">{{ accPickTarget === 'to' ? '选择转入账户' : '选择账户' }}</span>
        <button class="pop-close" @click="showAcc = false"><X :size="18" /></button>
      </div>
      <div class="acc-groups">
        <div v-for="g in accGroups" :key="g.type" class="acc-group">
          <div class="acc-group-title">{{ typeLabel(g.type) }}（{{ g.count }}）</div>
          <button
            v-for="a in g.items" :key="a.id"
            class="acc-item" :class="{ sel: selAccId === a.id }"
            @click="pickAcc(a)"
          >
            <span class="acc-name">{{ a.name }}</span>
            <span class="muted">{{ fmt(a.currentBalance) }}</span>
          </button>
        </div>
      </div>
    </van-popup>

    <!-- 成员弹出层 -->
    <van-popup v-model:show="showMember" position="bottom" round class="acc-pop">
      <div class="pop-head">
        <span class="pop-title">选择成员</span>
        <button class="pop-close" @click="showMember = false"><X :size="18" /></button>
      </div>
      <div class="acc-groups">
        <button class="acc-item" :class="{ sel: memberId === '' }" @click="memberId = ''; showMember = false">
          <span class="acc-name">自己</span>
          <span class="muted">默认</span>
        </button>
        <button
          v-for="m in members.filter((x) => x.relation !== 'self')" :key="m.id"
          class="acc-item" :class="{ sel: memberId === m.id }"
          @click="memberId = m.id; showMember = false"
        >
          <span class="acc-name">{{ m.name }}</span>
        </button>
      </div>
    </van-popup>

    <!-- 消费平台弹出层 -->
    <van-popup v-model:show="showPlatform" position="bottom" round class="acc-pop">
      <div class="pop-head">
        <span class="pop-title">选择消费平台</span>
        <button class="pop-close" @click="showPlatform = false"><X :size="18" /></button>
      </div>
      <div class="acc-groups">
        <button class="acc-item" :class="{ sel: platform === '' }" @click="platform = ''; showPlatform = false">
          <span class="acc-name">不选</span>
          <span class="muted">留空</span>
        </button>
        <button
          v-for="p in platforms" :key="p.id"
          class="acc-item" :class="{ sel: platform === p.name }"
          @click="platform = p.name; showPlatform = false"
        >
          <span class="acc-name">{{ p.name }}</span>
        </button>
      </div>
    </van-popup>

    <!-- 日期时间弹出层：底部弹出；PC 端与记账内容块同宽 -->
    <van-popup
      v-model:show="showDate"
      position="bottom"
      :style="isPc ? { left: popupLeft, width: popupWidth } : {}"
      round
      class="dt-popup"
    >
      <VanPickerGroup :tabs="['时间', '日期']" @cancel="showDate = false" @confirm="confirmGroup">
        <VanTimePicker v-model="groupTimeValue" />
        <VanDatePicker v-model="groupDateValue" :min-date="minDate" :max-date="maxDate" />
      </VanPickerGroup>
    </van-popup>
  </div>
</template>

<style scoped>
.entry { display: flex; flex-direction: column; gap: 10px; padding-bottom: 0; min-height: calc(100dvh - 24px); }
@media (min-width: 768px) {
  .entry { max-width: 560px; margin: 0 auto; width: 100%; }
}
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.tabs { display: flex; gap: 4px; background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 3px; }
.ftab { padding: 6px 18px; border-radius: 18px; font-size: 13px; color: var(--text2); }
.ftab.active { background: var(--brand); color: #fff; font-weight: 600; }

/* 金额行：整体包裹，左标签 | 中金额 | 右按钮 */
.amount-box {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 14px; padding: 10px 12px;
}
.amount-box .num {
  flex: 1; min-width: 0; background: transparent; text-align: right;
  font-size: 30px; font-weight: 700; color: var(--text);
}

/* 分类标签：左 */
.cur-cat-tag {
  display: flex; align-items: center; gap: 4px; flex-shrink: 0;
  padding: 5px 10px 5px 12px; background: var(--brand-soft);
  border-radius: 16px; font-size: 13px; font-weight: 600; color: var(--brand);
}
.cur-cat-tag.placeholder {
  background: var(--bg); border: 1px solid var(--border);
  color: var(--text2); font-weight: 400;
}
.tag-icon { display: flex; }
.tag-arrow { color: currentColor; opacity: 0.65; flex-shrink: 0; }

/* 常用分类 */
.quick-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 8px;
}
.quick-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 4px; background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; font-size: 11px; color: var(--text);
}
.quick-item.sel { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); font-weight: 600; }
.q-icon { display: flex; }

/* 备注 */
.note-row { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
.note-row input { width: 100%; background: transparent; font-size: 14px; color: var(--text); }

/* 时间/账户 chips */
.acc-row { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.acc-chip { flex: 0 0 auto; }
.info-row { display: flex; gap: 8px; }
.chip {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 12px; background: var(--card); border: 1px solid var(--border);
  border-radius: 18px; font-size: 12px; color: var(--text2);
}
.chip.active { color: var(--brand); border-color: var(--brand); }

/* 转账：转出/转入一行 */
.trans { padding: 6px 12px; }
.trans-line { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.trans-col {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px;
}
.trans-col .muted { font-size: 11px; }
.trans-col .val { font-size: 14px; color: var(--text); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trans-col .val.dim { color: var(--text2); }
.trans-arrow { color: var(--text2); flex-shrink: 0; }

/* 数字键盘（缩小）+ 保存：贴屏幕底部 */
.keypad-wrap { display: flex; gap: 8px; align-items: stretch; margin-top: auto; }
.keypad { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.key {
  padding: 9px 0; font-size: 17px; background: var(--card);
  border: 1px solid var(--border); border-radius: 10px; color: var(--text);
}
.key:active { background: var(--brand-soft); }
.key.del { color: var(--brand); }
.save-row { width: 82px; display: flex; flex-direction: column; gap: 6px; }
.save-again {
  flex: 1; width: 100%; border-radius: 10px;
  background: var(--card); border: 1px solid var(--brand); color: var(--brand);
  font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 3px;
}
.save-again:active { background: var(--brand-soft); }
.save-again:disabled { opacity: 0.4; }
.save {
  flex: 2; width: 100%; border-radius: 12px; background: var(--brand);
  color: #fff; font-size: 15px; font-weight: 600;
}
.save:disabled { opacity: 0.4; }
.pc-save-row { display: flex; gap: 10px; margin-top: 18px; }
.pc-save {
  flex: 1; padding: 13px 0; border-radius: 12px;
  background: linear-gradient(135deg, var(--brand) 0%, #FF8E5E 100%);
  color: #fff; font-size: 15px; font-weight: 600;
}
.pc-save:disabled { opacity: 0.4; }
.pc-save-again {
  padding: 13px 22px; border-radius: 12px;
  background: var(--card); border: 1px solid var(--brand); color: var(--brand);
  font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
.pc-save-again:active { background: var(--brand-soft); }
.pc-save-again:disabled { opacity: 0.4; }

/* 弹出层公共 */
.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); }

/* 分类弹出层 */
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
  border-radius: 12px; font-size: 11px; color: var(--text);
}
.cat-item.sel { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); font-weight: 600; }
.cat-icon { display: flex; }
.check { position: absolute; top: 4px; right: 4px; }

/* 日期时间弹出层 */
/* 图片预览（键盘上方） */
.img-area { display: flex; gap: 8px; flex-wrap: wrap; padding: 2px 0 4px; }
.img-thumb {
  position: relative; width: 64px; height: 64px; flex-shrink: 0;
  border-radius: 10px; overflow: hidden; border: 1px solid var(--border);
}
.img-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.img-del {
  position: absolute; top: 3px; right: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.img-add {
  width: 100%; height: 56px; flex-shrink: 0;
  border-radius: 12px; border: 1px dashed var(--border);
  background: var(--bg); color: var(--text2);
  display: flex; align-items: center; justify-content: center;
  gap: 8px; font-size: 13px; white-space: nowrap;
}

/* 自绘滚轮选择器 */
.wheel {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 6px 16px 18px;
}
.wheel-col { display: flex; flex-direction: column; align-items: center; }
.wheel-btn { padding: 4px 10px; color: var(--text2); }
.wheel-body { width: 76px; text-align: center; }
.wheel-item { font-size: 14px; color: var(--text2); padding: 7px 0; }
.wheel-item.muted { opacity: 0.45; }
.wheel-item.sel { font-size: 21px; font-weight: 700; color: var(--text); }
.wheel-colon { font-size: 20px; font-weight: 700; color: var(--text2); }
.wheel-confirm { flex-shrink: 0; margin-left: 6px; padding: 10px 22px; }

/* 账户弹出层 */
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
