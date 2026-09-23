/**
 * API 封装 — 基于 vite BASE_URL 拼接前缀（dev=/，build=/app/sinong/），
 * 确保在 fnOS 网关前缀下请求路径正确；本地开发由 vite proxy 转发到后端调试端口。
 */
const BASE = import.meta.env.BASE_URL

export interface ApiResp<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}api/${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    throw new Error('登录已失效，请重新登录飞牛后刷新页面')
  }
  const json: ApiResp<T> = await res.json()
  if (!json.ok) throw new Error(json.error || `请求失败(${res.status})`)
  return json.data as T
}

/** multipart 单文件上传（附件） */
async function uploadFile<T>(path: string, blob: Blob, filename: string): Promise<T> {
  const fd = new FormData()
  fd.append('file', blob, filename)
  const res = await fetch(`${BASE}api/${path}`, { method: 'POST', body: fd })
  if (res.status === 401) {
    throw new Error('登录已失效，请重新登录飞牛后刷新页面')
  }
  const json: ApiResp<T> = await res.json()
  if (!json.ok) throw new Error(json.error || `上传失败(${res.status})`)
  return json.data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, blob: Blob, filename: string) => uploadFile<T>(path, blob, filename),
}

// ---------- 类型 ----------
export interface Account {
  id: string
  type: string
  name: string
  balance: number
  note?: string
  currentBalance: number
}

export interface AccountGroup {
  type: string
  count: number
  total: number
  items: Account[]
}

export interface AccountsData {
  groups: AccountGroup[]
  netWorth: number
  totalAssets: number
  totalLiabilities: number
}

export interface Ledger {
  id: string
  name: string
  icon?: string
  template?: string
  is_default: number
}

export interface LedgersData {
  ledgers: Ledger[]
  currentLedgerId: string | null
}

export interface Category {
  id: string
  type: string
  parent_id?: string | null
  name: string
  icon?: string
  is_default: number
  is_frequent?: number
  sort?: number
  children?: Category[]
}

export interface Entry {
  id: string
  ledgerId: string
  accountId: string
  accountName?: string | null
  toAccountId?: string | null
  toAccountName?: string | null
  flowType: 'expense' | 'income' | 'transfer' | 'refund'
  amount: number
  categoryId?: string | null
  categoryName?: string | null
  categoryIcon?: string | null
  categoryParentIcon?: string | null
  note: string
  counterparty?: string
  recordedBy?: string
  memberId?: string | null
  reimbursable: boolean
  reimburseTarget?: string | null
  reimburseStatus?: string | null
  reimbursedAmount: number
  refundStatus: string
  refundedAmount: number
  relatedEntryId?: string | null
  periodicId?: string | null
  entryDate: string
  createdAt: string
  attachments: Attachment[]
}

export interface Attachment {
  id: string
  fileName: string
  mime: string
  size: number
  url?: string
}

export interface EntrySummary {
  income: number
  expense: number
  refund: number
  netExpense: number
}

export interface Member {
  id: string
  name: string
  relation?: string
  fnos_uid?: string | null
}

export interface Settings {
  currentLedgerId: string | null
  hideAmount: boolean
}

export interface FnosUser {
  uid: string
  name: string | null
  last_seen: string
}

export interface ImportPreview {
  token: string
  expenseCount: number
  incomeCount: number
  transferCount: number
  total: number
  newCategories: string[]
  newAccounts: string[]
  newMembers: string[]
  warnings: string[]
  ai?: AiMapping
}

export interface AiMapping {
  sheets: {
    sheet: string
    type: string
    headerRow: number
    fields: Record<string, string>
  }[]
}

export interface AiConfig {
  url: string
  model: string
  hasKey: boolean
  keyMask: string
}
