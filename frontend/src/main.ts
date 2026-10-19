import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { Popup, Skeleton, Button } from 'vant'
import '@vant/touch-emulator'
import 'vant/lib/index.css'
import './assets/main.css'

const app = createApp(App).use(router).use(Popup).use(Skeleton).use(Button)

// PC 端滚动容器拖动支持：普通 CSS 滚动容器（分类网格、账户列表等）在 PC 上按住鼠标
// 会选中文字而不是滚动。这里实现"按住拖动滚动"（类触屏体验），并阻止文本选择。
function setupPcDragScroll() {
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return

  let scroller: HTMLElement | null = null
  let startX = 0
  let startY = 0
  let startTop = 0
  let startLeft = 0
  let moved = false

  function findScroller(el: HTMLElement | null): HTMLElement | null {
    let cur: HTMLElement | null = el
    while (cur && cur !== document.body) {
      // Picker 列由 @vant/touch-emulator 处理，跳过避免冲突
      if (cur.classList.contains('van-picker-column')) return null
      const st = getComputedStyle(cur)
      const canY = /auto|scroll/.test(st.overflowY) && cur.scrollHeight > cur.clientHeight + 2
      const canX = /auto|scroll/.test(st.overflowX) && cur.scrollWidth > cur.clientWidth + 2
      if (canY || canX) return cur
      cur = cur.parentElement
    }
    return null
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable]')) return
    const sc = findScroller(t)
    if (!sc) return
    // 接近滚动条区域时跳过，保留滚动条拖动
    const r = sc.getBoundingClientRect()
    if (e.clientX > r.right - 14 || e.clientY > r.bottom - 14) return
    scroller = sc
    startX = e.clientX
    startY = e.clientY
    startTop = sc.scrollTop
    startLeft = sc.scrollLeft
    moved = false
    e.preventDefault()
  })
  document.addEventListener('mousemove', (e) => {
    if (!scroller) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
    moved = true
    e.preventDefault()
    scroller.scrollTop = startTop - dy
    scroller.scrollLeft = startLeft - dx
  })
  document.addEventListener('mouseup', () => {
    scroller = null
  })
}
setupPcDragScroll()

router.isReady().then(() => {
  app.mount('#app')
  // 启动页淡出：最短显示 400ms，避免闪一下
  const splash = document.getElementById('splash')
  if (splash) {
    setTimeout(() => {
      splash.classList.add('hide')
      setTimeout(() => splash.remove(), 450)
    }, 400)
  }
})
