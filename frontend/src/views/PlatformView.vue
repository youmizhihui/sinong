<script setup lang="ts">
defineOptions({ name: 'PlatformView' })
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { ArrowLeft, Plus, X, ShoppingBag } from 'lucide-vue-next'
import { api, type PlatformItem } from '../api'

const router = useRouter()
const platforms = ref<PlatformItem[]>([])
const loading = ref(true)
const saving = ref(false)

// 新增
const showAdd = ref(false)
const addName = ref('')
// 编辑
const showEdit = ref(false)
const editing = ref<PlatformItem | null>(null)
const editName = ref('')

async function load() {
  try {
    platforms.value = await api.get<PlatformItem[]>('platforms')
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loading.value = false
  }
}

function openAdd() {
  addName.value = ''
  showAdd.value = true
}
async function addPlat() {
  const name = addName.value.trim()
  if (!name) { showToast('请输入平台名称'); return }
  saving.value = true
  try {
    await api.post('platforms', { name })
    showAdd.value = false
    showToast('已添加')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}

function openEdit(p: PlatformItem) {
  editing.value = p
  editName.value = p.name
  showEdit.value = true
}
async function saveEdit() {
  if (!editing.value) return
  const name = editName.value.trim()
  if (!name) { showToast('请输入平台名称'); return }
  saving.value = true
  try {
    await api.put(`platforms/${editing.value.id}`, { name })
    showEdit.value = false
    showToast('已保存')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!editing.value) return
  try {
    await showConfirmDialog({
      title: '删除平台',
      message: `删除「${editing.value.name}」？已记录的历史账单不受影响。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--expense)',
    })
  } catch { return }
  saving.value = true
  try {
    await api.del(`platforms/${editing.value.id}`)
    showEdit.value = false
    showToast('已删除')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page platforms">
    <!-- 顶部 -->
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">消费平台</span>
      <button class="add-btn" @click="openAdd"><Plus :size="20" /></button>
    </div>

    <template v-if="loading">
      <van-skeleton title :row="4" style="padding: 16px;" />
    </template>
    <template v-else>
      <div class="card">
        <button
          v-for="p in platforms" :key="p.id"
          class="plat-row" @click="openEdit(p)"
        >
          <span class="p-icon"><ShoppingBag :size="14" /></span>
          <span class="plat-name">{{ p.name }}</span>
          <span class="muted">›</span>
        </button>
        <div v-if="!platforms.length" class="muted" style="padding: 28px 0; text-align: center;">
          暂无消费平台，点右上角 + 添加
        </div>
      </div>
      <div class="muted" style="padding: 10px 16px; font-size: 12px;">
        记一笔时从中选择，删除平台不影响历史账单。
      </div>
    </template>

    <!-- 新增弹层 -->
    <van-popup v-model:show="showAdd" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">添加平台</span>
        <button class="pop-close" @click="showAdd = false"><X :size="18" /></button>
      </div>
      <div class="form-body">
        <input v-model="addName" class="name-input" maxlength="12" placeholder="平台名称（如 京东）" />
        <button class="save-btn" :disabled="saving" @click="addPlat">保存</button>
      </div>
    </van-popup>

    <!-- 编辑弹层 -->
    <van-popup v-model:show="showEdit" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">编辑平台</span>
        <button class="pop-close" @click="showEdit = false"><X :size="18" /></button>
      </div>
      <div class="form-body">
        <input v-model="editName" class="name-input" maxlength="12" placeholder="平台名称" />
        <button class="save-btn" :disabled="saving" @click="saveEdit">保存</button>
        <button class="del-btn" :disabled="saving" @click="remove">
          <X :size="14" /> 删除该平台
        </button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; }
.add-btn { padding: 6px; color: var(--brand); }
.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 16px; font-weight: 600; }
.pop-close { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; background: var(--bg); }
.form-body { padding: 8px 16px 20px; }
.name-input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); font-size: 15px; color: var(--text); }
.save-btn { width: 100%; margin-top: 16px; padding: 13px 0; border-radius: 12px; background: var(--brand); color: #fff; font-size: 15px; font-weight: 600; }
.del-btn { width: 100%; margin-top: 10px; padding: 12px 0; border-radius: 12px; background: transparent; border: 1px solid var(--border); color: var(--expense); font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.plat-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: none; border: none; border-bottom: 1px solid var(--border); text-align: left; }
.plat-row:last-child { border-bottom: none; }
.p-icon { display: flex; color: var(--text2); }
.plat-name { flex: 1; font-size: 15px; color: var(--text); }
</style>
