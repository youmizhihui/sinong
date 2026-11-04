<script setup lang="ts">
defineOptions({ name: 'ImportBatchesView' })
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import { api, type ImportBatch } from '../api'
import { ArrowLeft, Undo2, FileSpreadsheet } from 'lucide-vue-next'

const router = useRouter()
const batches = ref<ImportBatch[]>([])
const loading = ref(false)
const undoing = ref<string | null>(null)

onMounted(load)

async function load() {
  loading.value = true
  try {
    const d = await api.get<{ batches: ImportBatch[] }>('import/batches')
    batches.value = d.batches
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loading.value = false
  }
}

function fmtTime(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function undoMessage(b: ImportBatch) {
  const lines = [
    `「${esc(b.fileName || '未命名文件')}」`,
    `将删除该批次剩余的 ${b.entryCount} 条流水（含转账双边），不可恢复。`,
  ]
  if (b.editedCount > 0) lines.push(`注意：其中 ${b.editedCount} 条导入后被手动修改过，撤销时仍会一并删除。`)
  if (b.refundLinkedCount > 0) lines.push(`有 ${b.refundLinkedCount} 条退款记录挂在本批次流水上，撤销后保留退款并解除关联。`)
  return lines.join('<br>')
}

async function undo(b: ImportBatch) {
  try {
    await showConfirmDialog({
      title: '撤销本次导入',
      message: undoMessage(b),
      allowHtml: true,
      confirmButtonText: '确认撤销',
      confirmButtonColor: '#EE0A24',
    })
  } catch {
    return
  }
  undoing.value = b.id
  try {
    const r = await api.del<{ deleted: number; unlinked: number }>(`import/batches/${b.id}`)
    showToast(r.unlinked ? `已删除 ${r.deleted} 条流水，保留 ${r.unlinked} 条退款并解除关联` : `已删除 ${r.deleted} 条流水`)
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    undoing.value = null
  }
}
</script>

<template>
  <div class="page import-batches">
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">导入记录</span>
      <span class="head-placeholder"></span>
    </div>

    <div v-if="!loading && batches.length === 0" class="empty-tip">还没有导入记录</div>

    <div v-for="b in batches" :key="b.id" class="card batch-card">
      <div class="batch-head">
        <span class="icon-badge"><FileSpreadsheet :size="18" /></span>
        <div class="batch-title">
          <div class="file-name">{{ b.fileName || '未命名文件' }}</div>
          <div class="muted">{{ fmtTime(b.createdAt) }} · {{ b.createdByName }} · {{ b.ledgerName }}</div>
        </div>
        <button v-if="b.canUndo" class="undo-btn" :disabled="undoing === b.id || b.entryCount === 0" @click="undo(b)">
          <Undo2 :size="14" />{{ undoing === b.id ? '撤销中…' : '撤销' }}
        </button>
      </div>
      <div class="batch-stats">
        <span>导入 <b>{{ b.createdCount }}</b> 条</span>
        <span v-if="b.skippedDup > 0">跳过重复 {{ b.skippedDup }} 条</span>
        <span v-if="b.totalRows > 0">共 {{ b.totalRows }} 行</span>
        <span>现存 <b>{{ b.entryCount }}</b> 条</span>
      </div>
      <div v-if="b.editedCount > 0" class="batch-warn">其中 {{ b.editedCount }} 条导入后被手动修改过</div>
      <div v-if="b.refundLinkedCount > 0" class="batch-warn">{{ b.refundLinkedCount }} 条退款挂在本批次流水上（撤销时保留退款、解除关联）</div>
    </div>
  </div>
</template>

<style scoped>
.import-batches { display: flex; flex-direction: column; gap: 12px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.title { font-size: 16px; font-weight: 600; }
.head-placeholder { width: 32px; }
.empty-tip { text-align: center; padding: 32px 0; font-size: 13px; color: var(--text2); }
.batch-card { padding: 14px; }
.batch-head { display: flex; align-items: center; gap: 10px; }
.batch-title { flex: 1; min-width: 0; }
.file-name { font-size: 14px; font-weight: 600; word-break: break-all; }
.batch-title .muted { font-size: 12px; margin-top: 2px; }
.undo-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 7px 14px; border-radius: 10px; font-size: 13px; font-weight: 600;
  background: #FEF1F1; color: #EE0A24; border: 1px solid #EE0A24;
  white-space: nowrap;
}
.undo-btn:disabled { opacity: 0.5; }
.batch-stats { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 12px; color: var(--text2); }
.batch-stats b { color: var(--text); }
.batch-warn { margin-top: 6px; font-size: 12px; color: #D48806; }
</style>
