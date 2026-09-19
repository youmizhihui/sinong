import { reactive } from 'vue'
import { api, type Settings } from './api'

/** 全局轻量状态 */
export const store = reactive({
  settings: { currentLedgerId: null, hideAmount: false } as Settings,
  loaded: false,
  /** 首页月历选中的日期（YYYY-MM-DD），记一笔挂载时消费后清空 */
  entryDefaultDate: null as string | null,
  /** 首页数据是否需要刷新（记一笔/详情修改后置 true） */
  homeDirty: false,
  /** 账户列表是否需要刷新（删除/编辑账户后置 true） */
  accountsDirty: false,
})

export async function loadSettings() {
  try {
    store.settings = await api.get<Settings>('settings')
  } catch (e) {
    console.warn('loadSettings failed', e)
  }
  store.loaded = true
}

/** 金额格式化：分 → 元，千分位 */
export function fmtMoney(cents: number): string {
  const v = Math.abs(cents) / 100
  const s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (cents < 0 ? '-' : '') + s
}
