<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import TabBar from './components/TabBar.vue'
import SideBar from './components/SideBar.vue'
import { loadSettings } from './store'

const isDesktop = ref(false)
function onResize() { isDesktop.value = window.innerWidth >= 768 }
onMounted(() => {
  loadSettings()
  onResize()
  window.addEventListener('resize', onResize)
})
onUnmounted(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <div class="shell">
    <SideBar v-if="isDesktop" />
    <main class="main">
      <RouterView v-slot="{ Component }">
        <keep-alive :include="['HomeView','AccountsView','BudgetView','ReportsView','SettingsView']" :max="5">
          <component :is="Component" />
        </keep-alive>
      </RouterView>
    </main>
  </div>
  <TabBar />
</template>
