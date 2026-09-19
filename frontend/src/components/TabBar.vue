<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Home, ChartPie, Settings as SettingsIcon, Plus, Wallet, Target } from 'lucide-vue-next'
import { store } from '../store'

const route = useRoute()
const router = useRouter()

const isDesktop = ref(false)
function onResize() { isDesktop.value = window.innerWidth >= 768 }
onMounted(() => { onResize(); window.addEventListener('resize', onResize) })
onUnmounted(() => window.removeEventListener('resize', onResize))

/** 底部导航 5 槽：账户 | 预算 | 中间动态(首页⇄加号) | 报表 | 设置 */
const leftTabs = [
  { name: 'accounts', label: '账户', icon: Wallet },
  { name: 'budget', label: '预算', icon: Target },
]
const rightTabs = [
  { name: 'reports', label: '报表', icon: ChartPie },
  { name: 'settings', label: '设置', icon: SettingsIcon },
]

const current = computed(() => route.name as string)
const isHome = computed(() => current.value === 'home')

/** 中间按钮：非首页 → 首页图标（点击回首页）；首页 → 加号（点击记一笔，默认今天） */
function onCenter() {
  if (isHome.value) {
    store.entryDefaultDate = null
    router.push('/entry')
  } else router.push('/')
}

function go(name: string) {
  if (current.value === name) return
  router.push({ name })
}
</script>

<template>
  <nav v-if="route.meta.tab && !isDesktop" class="tabbar">
    <!-- 左：账户 / 预算 -->
    <button v-for="t in leftTabs" :key="t.name" class="tab" :class="{ active: current === t.name }" @click="go(t.name)">
      <component :is="t.icon" :size="21" :stroke-width="current === t.name ? 2.4 : 1.8" />
      <span>{{ t.label }}</span>
    </button>

    <!-- 中间动态按钮（凸起） -->
    <button class="tab center" @click="onCenter">
      <span class="center-btn" :class="{ home: !isHome }">
        <Home v-if="!isHome" :size="19" :stroke-width="2.4" />
        <Plus v-else :size="21" :stroke-width="2.6" />
      </span>
      <span class="center-label">{{ isHome ? '记一笔' : '首页' }}</span>
    </button>

    <!-- 右：报表 / 设置 -->
    <button v-for="t in rightTabs" :key="t.name" class="tab" :class="{ active: current === t.name }" @click="go(t.name)">
      <component :is="t.icon" :size="21" :stroke-width="current === t.name ? 2.4 : 1.8" />
      <span>{{ t.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  display: flex;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.97);
  backdrop-filter: blur(8px);
  border-top: 1px solid var(--border);
  padding: 10px 4px calc(6px + env(safe-area-inset-bottom));
  z-index: 100;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
  color: #9AA0A6;
  font-size: 10px;
  min-height: 52px;
}
.tab.active { color: var(--brand); font-weight: 600; }
.tab.center { color: var(--brand); }
.center-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--brand) 0%, #FF8E5E 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: -16px;
  margin-bottom: 2px;
  border: 3px solid #fff;
  box-shadow: 0 4px 12px rgba(255, 107, 74, 0.4);
}
.center-label { font-size: 10px; font-weight: 600; }
</style>
