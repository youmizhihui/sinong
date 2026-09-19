<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast, showDialog } from 'vant'
import { api, type Member } from '../api'
import { ArrowLeft, User, Plus, X } from 'lucide-vue-next'

const router = useRouter()
const members = ref<Member[]>([])
const loading = ref(true)

// 新增/编辑弹层
const showForm = ref(false)
const editing = ref<Member | null>(null)
const formName = ref('')
const formRelation = ref('other')
const submitting = ref(false)

const RELATIONS: { key: string; label: string }[] = [
  { key: 'self', label: '自己' },
  { key: 'partner', label: '配偶' },
  { key: 'parent', label: '父母' },
  { key: 'child', label: '子女' },
  { key: 'other', label: '其他' },
]
function relLabel(r?: string) {
  return RELATIONS.find((x) => x.key === r)?.label || '其他'
}

async function load() {
  try {
    members.value = await api.get<Member[]>('members')
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openAdd() {
  editing.value = null
  formName.value = ''
  formRelation.value = 'other'
  showForm.value = true
}
function openEdit(m: Member) {
  if (m.relation === 'self') {
    showDialog({ title: '我', message: '「我」是你本人的成员，可在记一笔中选择，不可删除。' })
    return
  }
  editing.value = m
  formName.value = m.name
  formRelation.value = m.relation || 'other'
  showForm.value = true
}
async function submit() {
  if (!formName.value.trim()) {
    showToast('请输入成员名称')
    return
  }
  submitting.value = true
  try {
    if (editing.value) {
      await api.put(`members/${editing.value.id}`, { name: formName.value.trim(), relation: formRelation.value })
    } else {
      await api.post('members', { name: formName.value.trim(), relation: formRelation.value })
    }
    showForm.value = false
    showToast(editing.value ? '已更新' : '已添加')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    submitting.value = false
  }
}
async function remove(m: Member) {
  try {
    await showConfirmDialog({
      title: '删除成员',
      message: `删除「${m.name}」？已有流水引用时将无法删除。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--expense)',
    })
  } catch {
    return
  }
  try {
    await api.del(`members/${m.id}`)
    showToast('已删除')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  }
}
</script>

<template>
  <div class="page members">
    <!-- 顶部 -->
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">家庭成员</span>
      <button class="add-btn" @click="openAdd"><Plus :size="20" /></button>
    </div>

    <div class="tip muted">同一账本全家共享：记一笔时选择「谁花的」，所有记录大家都能看到。</div>

    <template v-if="loading">
      <van-skeleton title avatar :row="3" style="padding: 16px;" />
    </template>
    <template v-else>
      <div class="card list">
        <div v-for="m in members" :key="m.id" class="row" @click="openEdit(m)">
          <span class="icon-badge"><User :size="18" /></span>
          <div class="row-main">
            <div class="row-title">{{ m.name }}</div>
            <div class="muted">
              {{ relLabel(m.relation) }}
              <template v-if="m.relation === 'self'"> · 本人</template>
            </div>
          </div>
          <button
            v-if="m.relation !== 'self'"
            class="row-del" @click.stop="remove(m)"
          ><X :size="16" /></button>
        </div>
      </div>
    </template>

    <!-- 新增/编辑弹层 -->
    <van-popup v-model:show="showForm" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">{{ editing ? '编辑成员' : '添加成员' }}</span>
        <button class="pop-close" @click="showForm = false"><X :size="18" /></button>
      </div>
      <div class="form-body">
        <input
          v-model="formName" class="name-input" maxlength="12"
          placeholder="成员名称（如 妈妈、小宝）"
        />
        <div class="rel-label muted">关系</div>
        <div class="rel-chips">
          <button
            v-for="r in RELATIONS" :key="r.key"
            class="rel-chip" :class="{ active: formRelation === r.key }"
            @click="formRelation = r.key"
          >{{ r.label }}</button>
        </div>
        <button class="submit" :disabled="submitting" @click="submit">
          {{ editing ? '保存' : '添加' }}
        </button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.members { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.title { font-size: 16px; font-weight: 600; }
.add-btn { padding: 6px; color: var(--brand); }
.tip { font-size: 12px; padding: 0 4px; }

.list { padding: 6px 14px; }
.row { cursor: pointer; }
.row-del { padding: 6px; color: var(--expense); }

.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); }
.form-body { padding: 4px 16px 18px; }
.name-input {
  width: 100%; padding: 12px 14px; border-radius: 12px;
  background: var(--bg); border: 1px solid var(--border);
  font-size: 15px; color: var(--text);
}
.rel-label { font-size: 12px; margin: 14px 0 8px; }
.rel-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.rel-chip {
  padding: 7px 14px; border-radius: 16px;
  background: var(--bg); border: 1px solid var(--border); font-size: 13px; color: var(--text2);
}
.rel-chip.active { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
.submit {
  width: 100%; margin-top: 16px; padding: 13px 0; border-radius: 12px;
  background: var(--brand); color: #fff; font-size: 15px; font-weight: 600;
}
.submit:disabled { opacity: 0.4; }
</style>
