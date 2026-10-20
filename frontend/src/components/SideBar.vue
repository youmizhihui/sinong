<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Home, ChartPie, Wallet, Plus, Settings as SettingsIcon, Landmark, Target } from 'lucide-vue-next'
import { store } from '../store'

const route = useRoute()
const router = useRouter()

const NAV = [
  { name: 'home', label: '首页', icon: Home },
  { name: 'accounts', label: '账户', icon: Wallet },
  { name: 'reports', label: '报表', icon: ChartPie },
  { name: 'budget', label: '预算', icon: Target },
  { name: 'settings', label: '设置', icon: SettingsIcon },
]
const current = computed(() => route.name as string)

function go(name: string) {
  if (current.value === name) return
  router.push({ name })
}

/** PC 侧栏记一笔：默认今天，不继承月历选中日期 */
function newEntry() {
  store.entryDefaultDate = null
  router.push('/entry')
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-icon"><Landmark :size="20" /></span>
      <span class="brand-name">司农记账</span>
    </div>

    <button class="new-btn" @click="newEntry">
      <Plus :size="18" /> 记一笔
    </button>

    <nav class="nav">
      <button
        v-for="n in NAV" :key="n.name"
        class="nav-item" :class="{ active: current === n.name }"
        @click="go(n.name)"
      >
        <component :is="n.icon" :size="18" :stroke-width="current === n.name ? 2.4 : 1.8" />
        <span>{{ n.label }}</span>
      </button>
    </nav>

    <div class="side-foot muted">司农记账 v1.0.1 · 数据仅存于本机</div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 24px 16px;
  min-height: 100dvh;
  position: sticky;
  top: 0;
  align-self: flex-start;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 0 8px 24px; }
.brand-icon {
  width: 38px; height: 38px; border-radius: 12px;
  background: linear-gradient(135deg, var(--brand) 0%, #FF8E5E 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
}
.brand-name { font-size: 17px; font-weight: 700; }

.new-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 12px 0; border-radius: 12px; margin-bottom: 18px;
  background: linear-gradient(135deg, var(--brand) 0%, #FF8E5E 100%);
  color: #fff; font-size: 15px; font-weight: 600;
  box-shadow: 0 4px 12px rgba(255, 107, 74, 0.35);
}
.nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 14px; border-radius: 12px;
  color: var(--text2); font-size: 14px; font-weight: 500;
}
.nav-item:hover { background: var(--bg); }
.nav-item.active { background: var(--brand-soft); color: var(--brand); font-weight: 600; }
.side-foot { margin-top: auto; padding: 8px; font-size: 11px; }
</style>
