import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { tab: true } },
  { path: '/accounts', name: 'accounts', component: () => import('./views/AccountsView.vue'), meta: { tab: true } },
  { path: '/budget', name: 'budget', component: () => import('./views/BudgetView.vue'), meta: { tab: true } },
  { path: '/reports', name: 'reports', component: () => import('./views/ReportsView.vue'), meta: { tab: true } },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { tab: true } },
  { path: '/entry', name: 'entry', component: () => import('./views/EntryView.vue'), meta: { tab: false } },
  { path: '/detail/:id', name: 'detail', component: () => import('./views/DetailView.vue'), meta: { tab: false } },
  { path: '/members', name: 'members', component: () => import('./views/MembersView.vue'), meta: { tab: false } },
  { path: '/categories', name: 'categories', component: () => import('./views/CategoriesView.vue'), meta: { tab: false } },
  { path: '/ledgers', name: 'ledgers', component: () => import('./views/LedgersView.vue'), meta: { tab: false } },
  { path: '/periodics', name: 'periodics', component: () => import('./views/PeriodicsView.vue'), meta: { tab: false } },
  { path: '/calendar', name: 'calendar', component: () => import('./views/CalendarView.vue'), meta: { tab: false } },
  { path: '/account/:id', name: 'account', component: () => import('./views/AccountDetailView.vue'), meta: { tab: false } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
