<script setup lang="ts">
defineOptions({ name: 'SettingsView' })
import { Settings as SettingsIcon, Users, Tags, BookOpen, CalendarClock, Upload, Download } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { ref } from 'vue'
import { api, type ImportPreview } from '../api'
import { store } from '../store'
import { showToast, showConfirmDialog } from 'vant'

const router = useRouter()
const saving = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const preview = ref<ImportPreview | null>(null)
const showPreview = ref(false)

async function toggleHide() {
  store.settings.hideAmount = !store.settings.hideAmount
  saving.value = true
  try { await api.put('settings', { hideAmount: store.settings.hideAmount }) } finally { saving.value = false }
}

function pickFile() { fileInput.value?.click() }

async function exportData() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/export`)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(txt || `导出失败 (${res.status})`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `司农记账_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    showToast((err as Error).message)
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  try {
    const data = await api.upload<ImportPreview>('import/preview', file, file.name)
    preview.value = data
    showPreview.value = true
  } catch (err) {
    showToast((err as Error).message)
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function confirmImport() {
  if (!preview.value) return
  try {
    await showConfirmDialog({
      title: '确认导入',
      message: `将导入 ${preview.value.total} 条记录（支出${preview.value.expenseCount} / 收入${preview.value.incomeCount} / 转账${preview.value.transferCount}），自动创建 ${preview.value.newAccounts.length} 个新账户、${preview.value.newCategories.length} 个新分类、${preview.value.newMembers.length} 个新成员。`,
      confirmButtonText: '开始导入',
    })
  } catch { return }
  importing.value = true
  try {
    const r = await api.post<{ created: number }>('import', { token: preview.value.token, ledgerId: store.settings.currentLedgerId || undefined })
    showToast(`已导入 ${r.created} 条`)
    store.homeDirty = true
    preview.value = null
    showPreview.value = false
  } catch (err) {
    showToast((err as Error).message)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-title">设置</div>
    <div class="card">
      <div class="row" style="cursor: pointer;" @click="toggleHide">
        <span class="icon-badge"><SettingsIcon :size="18" /></span>
        <div class="row-main">
          <div class="row-title">金额显隐</div>
          <div class="muted">{{ store.settings.hideAmount ? '已隐藏（点击显示）' : '显示金额（点击隐藏）' }}</div>
        </div>
        <span class="muted">{{ saving ? '保存中…' : '' }}</span>
      </div>
    </div>
    <div class="card" style="margin-top: 12px;">
      <div class="row" style="cursor: pointer;" @click="router.push('/members')">
        <span class="icon-badge"><Users :size="18" /></span>
        <div class="row-main">
          <div class="row-title">家庭成员</div>
          <div class="muted">添加家人，记一笔时选择谁花的</div>
        </div>
        <span class="muted">›</span>
      </div>
      <div class="row" style="cursor: pointer;" @click="router.push('/categories')">
        <span class="icon-badge"><Tags :size="18" /></span>
        <div class="row-main">
          <div class="row-title">分类管理</div>
          <div class="muted">自定义分类、设置常用</div>
        </div>
        <span class="muted">›</span>
      </div>
      <div class="row" style="cursor: pointer;" @click="router.push('/ledgers')">
        <span class="icon-badge"><BookOpen :size="18" /></span>
        <div class="row-main">
          <div class="row-title">账本</div>
          <div class="muted">切换 / 新建 / 重命名账本</div>
        </div>
        <span class="muted">›</span>
      </div>
      <div class="row" style="cursor: pointer;" @click="router.push('/periodics')">
        <span class="icon-badge"><CalendarClock :size="18" /></span>
        <div class="row-main">
          <div class="row-title">周期账</div>
          <div class="muted">房租工资等固定收支自动记账</div>
        </div>
        <span class="muted">›</span>
      </div>
    </div>
    <div class="card" style="margin-top: 12px;">
      <div class="row" style="cursor: pointer;" @click="pickFile">
        <span class="icon-badge"><Upload :size="18" /></span>
        <div class="row-main">
          <div class="row-title">导入数据</div>
          <div class="muted">智能识别 Excel 表头，支持支出/收入/转账/借贷多 sheet，自动匹配分类账户</div>
        </div>
        <span class="muted">{{ importing ? '解析中…' : '›' }}</span>
      </div>
      <div class="row" style="cursor: pointer; border-top: 1px solid var(--border);" @click="exportData">
        <span class="icon-badge"><Download :size="18" /></span>
        <div class="row-main">
          <div class="row-title">导出数据</div>
          <div class="muted">导出当前账本全部记录为 Excel（支出/收入/转账分 sheet）</div>
        </div>
        <span class="muted">›</span>
      </div>
    </div>
    <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display: none" @change="onFile" />

    <!-- 导入预览弹层 -->
    <van-popup v-model:show="showPreview" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">导入预览</span>
        <button class="pop-close" @click="showPreview = false"><span style="font-size:20px;">×</span></button>
      </div>
      <div class="form-body">
        <div class="import-stats">
          <div class="stat-item"><span class="stat-num">{{ preview?.expenseCount || 0 }}</span><span class="stat-label">支出</span></div>
          <div class="stat-item"><span class="stat-num">{{ preview?.incomeCount || 0 }}</span><span class="stat-label">收入</span></div>
          <div class="stat-item"><span class="stat-num">{{ preview?.transferCount || 0 }}</span><span class="stat-label">转账</span></div>
          <div class="stat-item"><span class="stat-num">{{ preview?.total || 0 }}</span><span class="stat-label">合计</span></div>
        </div>
        <div class="import-new-row">
          <span v-if="preview?.newAccounts.length" class="new-chip">新账户 {{ preview.newAccounts.length }}</span>
          <span v-if="preview?.newCategories.length" class="new-chip">新分类 {{ preview.newCategories.length }}</span>
          <span v-if="preview?.newMembers.length" class="new-chip">新成员 {{ preview.newMembers.length }}</span>
        </div>
        <div v-if="preview?.warnings.length" class="import-warn">
          <div v-for="(w, i) in preview.warnings" :key="i" class="warn-item">⚠ {{ w }}</div>
        </div>
        <button class="save-btn" style="margin-top: 16px;" :disabled="importing" @click="confirmImport">
          {{ importing ? '导入中…' : `确认导入 ${preview?.total || 0} 条` }}
        </button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.pop-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px 12px; border-bottom: 1px solid var(--border);
}
.pop-title { font-size: 16px; font-weight: 600; }
.pop-close { padding: 4px 8px; color: var(--text2); background: none; border: none; cursor: pointer; }
.form-body { padding: 16px 18px 24px; }
.import-stats {
  display: flex; gap: 8px; margin-bottom: 16px;
}
.stat-item {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 12px 4px; background: var(--bg); border-radius: 10px;
}
.stat-num { font-size: 22px; font-weight: 700; color: var(--brand); }
.stat-label { font-size: 12px; color: var(--text2); margin-top: 2px; }
.import-new-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.new-chip {
  padding: 4px 10px; border-radius: 12px; font-size: 12px;
  background: var(--brand-soft); color: var(--brand); font-weight: 500;
}
.import-warn { margin-bottom: 12px; }
.warn-item { font-size: 12px; color: var(--expense); margin-bottom: 4px; }
.save-btn {
  width: 100%; padding: 12px; border: none; border-radius: 12px;
  background: var(--brand); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
}
.save-btn:disabled { opacity: 0.5; }
</style>
