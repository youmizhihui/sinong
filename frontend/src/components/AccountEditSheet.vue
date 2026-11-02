<script setup lang="ts">
/**
 * 账户新增 / 编辑弹层（账户页与账户详情页共用）
 * - 传 account 即为编辑，不传为新增
 * - 弹层按钮规范：头部左「取消」右「保存」，底部不放确定/取消
 * - 改「共享 / 私有」归属前会按使用情况二次确认
 */
import { ref, computed, watch } from 'vue'
import { showToast, showConfirmDialog } from 'vant'
import { api, type Account } from '../api'
import { store } from '../store'

const props = defineProps<{ show: boolean; account?: Account | null }>()
const emit = defineEmits<{ 'update:show': [boolean]; saved: [] }>()

const TYPE_LABEL: Record<string, string> = {
  cash: '现金', savings: '储蓄卡', credit: '信用卡', online: '网络账户',
  investment: '投资账户', stored: '储值卡', receivable: '应收应付', archived: '已封存',
}
const TYPE_DESC: Record<string, string> = {
  cash: '钱包、手头现金', savings: '银行储蓄卡', credit: '信用卡（负债）',
  online: '微信/支付宝等', investment: '基金、股票等', stored: '购物卡、会员卡',
  receivable: '应收、应付、借款', archived: '不再使用的卡/账户',
}

const EMPTY_FORM = {
  type: 'cash', name: '', note: '', balance: '', isPrivate: false, statementDay: 1, statementDayIncluded: false,
}
const form = ref({ ...EMPTY_FORM })
const saving = ref(false)

const isEdit = computed(() => !!props.account?.id)
/** 归属（共享 ⇄ 私有）只有创建者能改：共享账户全家都在用，谁都能勾成私有等于让别人的账消失 */
const canEditPrivacy = computed(() => !isEdit.value || props.account?.canManage !== false)
/** 新建不提供「已封存」（封存是状态不是类型）；编辑时可以封存 */
const formTypes = computed(() => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(TYPE_LABEL)) {
    if (k === 'archived' && !isEdit.value) continue
    out[k] = v
  }
  return out
})

watch(() => props.show, (v) => { if (v) init() })

function init() {
  const a = props.account
  form.value = a
    ? {
        type: a.type,
        name: a.name,
        note: a.note || '',
        balance: '',
        isPrivate: !!a.is_private,
        statementDay: a.statement_day || 1,
        statementDayIncluded: !!a.statement_day_included,
      }
    : { ...EMPTY_FORM }
}

function close() {
  emit('update:show', false)
}

/** 归属变更确认：私有→共享会暴露给其他成员；共享→私有会让共享账本用不了它 */
async function confirmPrivacyChange(): Promise<boolean> {
  const a = props.account
  if (!a || !!a.is_private === form.value.isPrivate) return true
  if (form.value.isPrivate) {
    const u = await api.get<{ sharedEntries: number }>(`accounts/${a.id}/usage`).catch(() => null)
    const n = u?.sharedEntries || 0
    if (n > 0) {
      try {
        await showConfirmDialog({
          title: '改为私有账户',
          message: `该账户在共享账本中有 ${n} 笔流水。改为私有后，共享账本里将不再显示该账户，也不能再用它记账（历史流水保留，不会删除）。是否继续？`,
          confirmButtonText: '继续',
        })
      } catch { return false }
    }
  } else {
    try {
      await showConfirmDialog({
        title: '改为共享账户',
        message: '改为共享后，家庭所有成员都能看到该账户的名称与余额。是否继续？',
        confirmButtonText: '继续',
      })
    } catch { return false }
  }
  return true
}

async function save() {
  const name = form.value.name.trim()
  if (!name || saving.value) return
  if (!(await confirmPrivacyChange())) return
  saving.value = true
  try {
    const payload = {
      name,
      note: form.value.note.trim() || null,
      type: form.value.type,
      isPrivate: form.value.isPrivate,
      statementDay: form.value.statementDay || 1,
      statementDayIncluded: form.value.statementDay > 1 ? form.value.statementDayIncluded : false,
    }
    if (isEdit.value) {
      await api.put(`accounts/${props.account!.id}`, payload)
    } else {
      const balance = Math.round(parseFloat(form.value.balance || '0') * 100)
      await api.post('accounts', { ...payload, balance: Number.isFinite(balance) ? balance : 0 })
    }
    // 账户变更影响首页与记一笔的账户列表
    store.accountsDirty = true
    store.homeDirty = true
    showToast(isEdit.value ? '已保存' : '已创建')
    close()
    emit('saved')
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <van-popup
    :show="show" position="bottom" round
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="pop-head">
      <button class="head-btn" @click="close">取消</button>
      <span class="pop-title">{{ isEdit ? '编辑账户' : '新增账户' }}</span>
      <button class="head-btn primary" :disabled="!form.name.trim() || saving" @click="save">
        {{ saving ? '保存中' : '保存' }}
      </button>
    </div>

    <div class="body">
      <div class="type-grid">
        <button
          v-for="(label, t) in formTypes" :key="t"
          class="type-item" :class="{ sel: form.type === t }"
          @click="form.type = t"
        >
          <span>{{ label }}</span>
          <small>{{ TYPE_DESC[t] }}</small>
        </button>
      </div>

      <input v-model="form.name" class="field" placeholder="账户名称（必填）" />
      <input v-model="form.note" class="field" placeholder="备注（可选）" />
      <input v-if="!isEdit" v-model="form.balance" class="field" type="number" placeholder="初始余额（元，默认 0，可负）" />

      <div class="credit-box">
        <div class="credit-row">
          <span class="credit-label">账单日</span>
          <select v-model.number="form.statementDay" class="field day-select">
            <option v-for="d in 31" :key="d" :value="d">{{ d }} 日</option>
          </select>
        </div>
        <label v-if="form.statementDay > 1" class="privacy-row">
          <input v-model="form.statementDayIncluded" type="checkbox" />
          <span>账单日消费计入本期账单</span>
          <small>默认不计入，归入下一期</small>
        </label>
        <div class="tip">账期按月分组：1 号即自然月；修改账单日后，历史流水按新账期重新划分</div>
      </div>

      <label class="privacy-row" :class="{ disabled: !canEditPrivacy }">
        <input v-model="form.isPrivate" type="checkbox" :disabled="!canEditPrivacy" />
        <span>私有账户</span>
        <small>{{ canEditPrivacy ? '仅在私人账本中可见，共享成员看不到' : '家庭共用账户，只有创建者能改归属' }}</small>
      </label>

      <slot name="footer" />
    </div>
  </van-popup>
</template>

<style scoped>
.pop-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 8px;
}
.pop-title { font-size: 15px; font-weight: 600; }
.head-btn {
  font-size: 14px; color: var(--text2); padding: 4px 2px; min-width: 40px;
  text-align: left;
}
.head-btn.primary { color: var(--brand); font-weight: 600; text-align: right; }
.head-btn:disabled { opacity: 0.4; }
.body {
  padding: 6px 16px calc(18px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 12px;
  max-height: 72vh; overflow-y: auto;
}
.type-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
.type-item {
  border: 1px solid var(--border); border-radius: 10px;
  padding: 8px 10px; text-align: left;
  display: flex; flex-direction: column; gap: 2px;
  background: var(--card); color: var(--text);
}
.type-item.sel { border-color: var(--brand); background: var(--brand-soft); }
.type-item small { font-size: 10px; color: var(--text2); }
.field {
  border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; width: 100%;
  background: var(--card); color: var(--text);
}
.privacy-row { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.privacy-row small { color: var(--text2); font-size: 11px; margin-left: 4px; }
.privacy-row.disabled { opacity: 0.55; cursor: default; }
.credit-box {
  display: flex; flex-direction: column; gap: 10px;
  padding: 10px; border: 1px dashed var(--border); border-radius: 10px;
}
.credit-row { display: flex; align-items: center; gap: 10px; }
.credit-label { font-size: 13px; white-space: nowrap; }
.day-select { flex: 1; padding: 8px 10px; }
.tip { font-size: 11px; color: var(--text2); line-height: 1.5; }
</style>
