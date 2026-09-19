<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { api, type Category } from '../api'
import { iconForGroup, iconForCat, AVAILABLE_ICONS } from '../catIcons'
import { ArrowLeft, Plus, Star, X } from 'lucide-vue-next'

const router = useRouter()
const type = ref<'expense' | 'income'>('expense')
const cats = ref<Category[]>([])
const loading = ref(true)

// 编辑弹层
const showEdit = ref(false)
const editing = ref<Category | null>(null)
const editName = ref('')
const editIcon = ref('')
const editFrequent = ref(false)
const saving = ref(false)
// 新增弹层
const showAdd = ref(false)
const addParentId = ref('')
const addName = ref('')
const addIcon = ref('utensils')

const TYPE_TABS: { key: 'expense' | 'income'; label: string }[] = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
]

const groups = computed(() => cats.value.filter((c) => !c.parent_id))
const childrenOf = (g: Category) => cats.value.filter((c) => c.parent_id === g.id)

async function load() {
  try {
    const d = await api.get<{ groups: Category[] }>(`categories?type=${type.value}`)
    cats.value = d.groups.flatMap((g) => [g, ...(g.children || [])])
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    loading.value = false
  }
}
function switchType(t: 'expense' | 'income') {
  type.value = t
  loading.value = true
  load()
}
onMounted(load)

function openEdit(c: Category) {
  editing.value = c
  editName.value = c.name
  editIcon.value = c.icon || ''
  editFrequent.value = !!c.is_frequent
  showEdit.value = true
}
async function toggleFrequent(c: Category) {
  try {
    await api.put(`categories/${c.id}`, { is_frequent: c.is_frequent ? 0 : 1 })
    c.is_frequent = c.is_frequent ? 0 : 1
    showToast(c.is_frequent ? '已设为常用' : '已取消常用')
  } catch (e) {
    showToast((e as Error).message)
  }
}
async function saveEdit() {
  if (!editName.value.trim()) { showToast('请输入分类名称'); return }
  if (!editing.value) return
  saving.value = true
  try {
    await api.put(`categories/${editing.value.id}`, {
      name: editName.value.trim(),
      icon: editIcon.value || null,
      is_frequent: editFrequent.value ? 1 : 0,
    })
    showEdit.value = false
    showToast('已保存')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}
async function remove(c: Category) {
  try {
    await showConfirmDialog({
      title: '删除分类',
      message: `删除「${c.name}」？默认分类与已有流水引用的分类无法删除。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--expense)',
    })
  } catch {
    return
  }
  try {
    await api.del(`categories/${c.id}`)
    showEdit.value = false
    showToast('已删除')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  }
}

function openAdd() {
  addName.value = ''
  addParentId.value = groups.value[0]?.id || ''
  showAdd.value = true
}
async function addCat() {
  if (!addName.value.trim()) { showToast('请输入分类名称'); return }
  if (!addParentId.value) { showToast('请选择所属大类'); return }
  saving.value = true
  try {
    await api.post('categories', { type: type.value, parentId: addParentId.value, name: addName.value.trim(), icon: addIcon.value || null })
    showAdd.value = false
    showToast('已添加')
    await load()
  } catch (e) {
    showToast((e as Error).message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page cats">
    <!-- 顶部 -->
    <div class="head">
      <button class="back" @click="router.back()"><ArrowLeft :size="20" /></button>
      <span class="title">分类管理</span>
      <button class="add-btn" @click="openAdd"><Plus :size="20" /></button>
    </div>

    <div class="tabs">
      <button
        v-for="t in TYPE_TABS" :key="t.key"
        class="ftab" :class="{ active: type === t.key }"
        @click="switchType(t.key)"
      >{{ t.label }}</button>
    </div>

    <template v-if="loading">
      <van-skeleton title :row="4" style="padding: 16px;" />
    </template>
    <template v-else>
      <div v-for="g in groups" :key="g.id" class="card group">
        <div class="group-head">
          <span class="group-name">
            <span class="g-icon"><component :is="iconForGroup(g.icon)" :size="14" /></span>
            {{ g.name }}
          </span>
          <span class="muted">{{ childrenOf(g).length }} 个</span>
        </div>
        <div class="cat-list">
          <button
            v-for="c in childrenOf(g)" :key="c.id"
            class="cat-row" @click="openEdit(c)"
          >
            <span class="c-icon"><component :is="iconForCat({ ...c, parentIcon: g.icon })" :size="13" /></span>
            <span class="cat-name">{{ c.name }}</span>
            <span
              class="freq-star" :class="{ on: !!c.is_frequent }"
              @click.stop="toggleFrequent(c)"
            ><Star :size="15" /></span>
          </button>
        </div>
      </div>
    </template>

    <!-- 编辑弹层 -->
    <van-popup v-model:show="showEdit" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">编辑分类</span>
        <button class="pop-close" @click="showEdit = false"><X :size="18" /></button>
      </div>
      <div class="form-body">
        <input v-model="editName" class="name-input" maxlength="12" placeholder="分类名称" />
        <div class="icon-picker-label muted">选择图标</div>
        <div class="icon-picker">
          <button
            v-for="ic in AVAILABLE_ICONS" :key="ic.key"
            class="icon-item" :class="{ active: editIcon === ic.key }"
            @click="editIcon = ic.key"
          ><component :is="ic.comp" :size="16" /></button>
        </div>
        <div class="freq-row" @click="editFrequent = !editFrequent">
          <span class="muted">设为常用（记一笔快捷区优先显示）</span>
          <span class="freq-toggle" :class="{ on: editFrequent }">
            <span class="freq-dot" />
          </span>
        </div>
        <button class="save-btn" :disabled="saving" @click="saveEdit">保存</button>
        <button v-if="editing && !editing.is_default" class="del-btn" :disabled="saving" @click="remove(editing)">
          <X :size="14" /> 删除该分类
        </button>
      </div>
    </van-popup>

    <!-- 新增弹层 -->
    <van-popup v-model:show="showAdd" position="bottom" round>
      <div class="pop-head">
        <span class="pop-title">添加分类</span>
        <button class="pop-close" @click="showAdd = false"><X :size="18" /></button>
      </div>
      <div class="form-body">
        <div class="rel-label muted">所属大类</div>
        <div class="parent-chips">
          <button
            v-for="g in groups" :key="g.id"
            class="parent-chip" :class="{ active: addParentId === g.id }"
            @click="addParentId = g.id"
          >{{ g.name }}</button>
        </div>
        <input v-model="addName" class="name-input" maxlength="12" placeholder="分类名称（如 咖啡）" style="margin-top: 14px;" />
        <div class="icon-picker-label muted">选择图标</div>
        <div class="icon-picker">
          <button
            v-for="ic in AVAILABLE_ICONS" :key="ic.key"
            class="icon-item" :class="{ active: addIcon === ic.key }"
            @click="addIcon = ic.key"
          ><component :is="ic.comp" :size="16" /></button>
        </div>
        <button class="save-btn" :disabled="saving" @click="addCat">添加</button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.cats { display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.back { padding: 6px; color: var(--text); }
.title { font-size: 16px; font-weight: 600; }
.add-btn { padding: 6px; color: var(--brand); }

.tabs { display: flex; gap: 4px; background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 3px; align-self: flex-start; }
.ftab { padding: 6px 22px; border-radius: 18px; font-size: 13px; color: var(--text2); }
.ftab.active { background: var(--brand); color: #fff; font-weight: 600; }

.group { padding: 12px 14px; }
.group-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.group-name { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.g-icon { display: flex; color: var(--brand); }
.cat-list { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-row {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 16px; font-size: 13px; color: var(--text);
}
.c-icon { display: flex; color: var(--text2); }
.freq-star { color: var(--border); display: flex; }
.freq-star.on { color: var(--brand); }

.pop-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.pop-title { font-size: 15px; font-weight: 600; }
.pop-close { padding: 4px; color: var(--text2); }
.form-body { padding: 4px 16px 18px; }
.name-input {
  width: 100%; padding: 12px 14px; border-radius: 12px;
  background: var(--bg); border: 1px solid var(--border);
  font-size: 15px; color: var(--text);
}
.freq-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 16px; padding: 4px 0; cursor: pointer;
}
.freq-toggle { position: relative; width: 40px; height: 22px; border-radius: 11px; background: var(--border); transition: background 0.2s; }
.freq-toggle.on { background: var(--brand); }
.freq-dot { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left 0.2s; }
.freq-toggle.on .freq-dot { left: 20px; }
.save-btn {
  width: 100%; margin-top: 18px; padding: 13px 0; border-radius: 12px;
  background: var(--brand); color: #fff; font-size: 15px; font-weight: 600;
}
.save-btn:disabled { opacity: 0.4; }
.del-btn {
  width: 100%; margin-top: 10px; padding: 13px 0; border-radius: 12px;
  background: var(--bg); border: 1px solid var(--border);
  color: var(--expense); font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 4px;
}
.rel-label { font-size: 12px; margin-bottom: 8px; }
.parent-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.parent-chip {
  padding: 7px 14px; border-radius: 16px;
  background: var(--bg); border: 1px solid var(--border); font-size: 13px; color: var(--text2);
}
.parent-chip.active { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); font-weight: 600; }
.icon-picker-label { font-size: 12px; margin: 14px 0 8px; }
.icon-picker {
  display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px;
  max-height: 180px; overflow-y: auto;
}
.icon-item {
  display: flex; align-items: center; justify-content: center;
  padding: 8px 0; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text2); cursor: pointer;
}
.icon-item.active {
  background: var(--brand-soft); border-color: var(--brand); color: var(--brand);
}
</style>
