<script setup lang="ts">
defineOptions({ name: 'SettingsView' })
import { Settings as SettingsIcon, Users, Tags, BookOpen, CalendarClock, Upload, Download, BrainCircuit, ShoppingBag, Plug, Copy, RefreshCw } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { ref } from 'vue'
import { api, type ImportPreview, type AiConfig } from '../api'
import { store } from '../store'
import { showToast, showConfirmDialog, Switch as VanSwitch } from 'vant'

const router = useRouter()
const saving = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const preview = ref<ImportPreview | null>(null)
const showPreview = ref(false)
const uploadedFile = ref<File | null>(null)

// ---- AI 识别配置 ----
const showAiConfig = ref(false)
const aiSaving = ref(false)
const aiAnalyzing = ref(false)
const aiForm = ref<AiConfig & { key: string }>({ url: '', model: '', hasKey: false, keyMask: '', key: '' })

// 常用 AI 服务快捷选择
const AI_SERVICES = [
  { label: '自定义（手动填写）', url: '', model: '' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Kimi', url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Ollama 本地（免密钥）', url: 'http://localhost:11434/v1', model: '' },
]
const aiService = ref('')
function pickAiService() {
  const s = AI_SERVICES.find((x) => x.label === aiService.value)
  if (s) {
    aiForm.value.url = s.url
    aiForm.value.model = s.model
  }
}

const aiTesting = ref(false)
const aiTestResult = ref<{ ok: boolean; msg: string } | null>(null)

// ---- MCP 接入配置 ----
const showMcp = ref(false)
const mcpInfo = ref<{ token: string; port: number; masked: string; enabled: boolean; status: string } | null>(null)
const mcpResetting = ref(false)
const mcpPortInput = ref('')
const mcpEnabled = ref(false)
const mcpSaving = ref(false)
const mcpChecking = ref(false)
const mcpPortMsg = ref('')
const mcpPortOk = ref(false)
async function loadMcp() {
  try {
    mcpInfo.value = await api.get<{ token: string; port: number; masked: string; enabled: boolean; status: string }>('mcp')
    mcpPortInput.value = String(mcpInfo.value.port)
    mcpEnabled.value = mcpInfo.value.enabled
  } catch { /* 静默 */ }
}
async function saveMcpPort() {
  const newPort = parseInt(mcpPortInput.value, 10)
  const oldPort = mcpInfo.value?.port
  if (newPort === oldPort) {
    mcpPortMsg.value = ''
    return
  }
  mcpChecking.value = true
  mcpPortMsg.value = ''
  try {
    const r = await api.post<{ available: boolean; message: string }>('mcp/check-port', { port: newPort })
    mcpChecking.value = false
    if (!r.available) {
      mcpPortOk.value = false
      mcpPortMsg.value = ''
      showToast('端口被其他应用占用，请更换端口')
      return
    }
    await api.put('mcp/config', { port: newPort })
    mcpPortOk.value = true
    mcpPortMsg.value = ''
    showToast('端口可用，请在飞牛应用中心重启司农记账生效')
  } catch (e: any) {
    mcpChecking.value = false
    mcpPortOk.value = false
    showToast((e as Error).message)
  }
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制')
  } catch {
    // HTTP 环境降级：用临时 textarea
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      showToast('已复制')
    } catch {
      showToast('复制失败，请手动复制')
    }
  }
}
async function copyMcpConfig() {
  const port = mcpInfo.value?.port || 38898
  const token = mcpInfo.value?.token || ''
  const cfg = JSON.stringify({ mcpServers: { sinong: { url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
  await copyText(cfg)
}
async function onToggleMcp(val: boolean) {
  try {
    await api.put('mcp/config', { enabled: val })
    showToast(val ? '已开启，请在飞牛应用中心重启司农记账生效' : '已关闭，请在飞牛应用中心重启司农记账生效')
  } catch (e: any) {
    showToast((e as Error).message)
  }
}
async function resetMcp() {
  try {
    await showConfirmDialog({ title: '重置 MCP Token', message: '重置后旧 Token 将立即失效，需要在 AI 客户端重新配置。', confirmButtonText: '重置' })
  } catch { return }
  mcpResetting.value = true
  try {
    mcpInfo.value = await api.post<{ token: string; port: number; masked: string; enabled: boolean; status: string }>('mcp/reset', {})
    showToast('MCP Token 已重置')
  } catch (err) {
    showToast((err as Error).message)
  } finally {
    mcpResetting.value = false
  }
}
async function testAi() {
  if (!aiForm.value.url.trim() || !aiForm.value.model.trim()) {
    showToast('请先填写 API 地址与模型名称')
    return
  }
  aiTesting.value = true
  aiTestResult.value = null
  try {
    const r = await api.post<{ ok: boolean; message: string }>('ai/test', {
      url: aiForm.value.url,
      model: aiForm.value.model,
      key: aiForm.value.key,
    })
    aiTestResult.value = { ok: true, msg: r.message }
  } catch (err) {
    aiTestResult.value = { ok: false, msg: (err as Error).message }
  } finally {
    aiTesting.value = false
  }
}

async function loadAiConfig() {
  try {
    const c = await api.get<AiConfig>('ai/config')
    aiForm.value = { ...c, key: '' }
  } catch { /* 静默：未配置时保持空 */ }
}

async function saveAiConfig() {
  if (!aiForm.value.url.trim() || !aiForm.value.model.trim()) {
    showToast('API 地址与模型名必填')
    return
  }
  aiSaving.value = true
  try {
    const r = await api.put<{ hasKey: boolean; keyMask: string }>('ai/config', {
      url: aiForm.value.url,
      model: aiForm.value.model,
      key: aiForm.value.key,
    })
    aiForm.value.hasKey = r.hasKey
    aiForm.value.keyMask = r.keyMask
    aiForm.value.key = ''
    showToast('AI 配置已保存')
    showAiConfig.value = false
  } catch (err) {
    showToast((err as Error).message)
  } finally {
    aiSaving.value = false
  }
}

/** 用 AI 重新识别当前上传文件的格式，覆盖预览结果 */
async function aiAnalyze() {
  if (!uploadedFile.value) return
  aiAnalyzing.value = true
  try {
    const data = await api.upload<ImportPreview>('import/ai-analyze', uploadedFile.value, uploadedFile.value.name)
    preview.value = data
    const used = data.ai?.sheets?.filter((s) => s.type !== 'skip').length || 0
    showToast(used ? `AI 已识别 ${used} 个数据 sheet` : 'AI 未识别到账单数据，请检查配置或文件')
  } catch (err) {
    showToast((err as Error).message)
  } finally {
    aiAnalyzing.value = false
  }
}

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
  uploadedFile.value = file
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
    uploadedFile.value = null
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
      <div class="row" style="cursor: pointer; border-top: 1px solid var(--border);" @click="router.push('/platforms')">
        <span class="icon-badge"><ShoppingBag :size="18" /></span>
        <div class="row-main">
          <div class="row-title">消费平台</div>
          <div class="muted">管理记一笔可选的平台（京东、淘宝等）</div>
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
      <div class="row" style="cursor: pointer; border-top: 1px solid var(--border);" @click="showAiConfig = true; loadAiConfig()">
        <span class="icon-badge"><BrainCircuit :size="18" /></span>
        <div class="row-main">
          <div class="row-title">AI 识别配置</div>
          <div class="muted">{{ aiForm.hasKey ? `已配置 ${aiForm.model}` : '规则识别不满意时，可让 AI 重新判断格式' }}</div>
        </div>
        <span class="muted">›</span>
      </div>
      <div class="row" style="cursor: pointer; border-top: 1px solid var(--border);" @click="showMcp = true; loadMcp()">
        <span class="icon-badge"><Plug :size="18" /></span>
        <div class="row-main">
          <div class="row-title">MCP 接入</div>
          <div class="muted">让 AI 助手（ClawBot 等）远程记账</div>
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
        <div class="ai-bar">
          <button class="ai-btn" :disabled="aiAnalyzing || importing" @click="aiAnalyze">
            {{ aiAnalyzing ? 'AI 识别中…' : (preview?.ai ? 'AI 已识别 · 重新识别' : 'AI 识别格式') }}
          </button>
          <span class="ai-hint">规则识别不满意时，让 AI 重新判断表头与字段</span>
        </div>
        <button class="save-btn" style="margin-top: 8px;" :disabled="importing" @click="confirmImport">
          {{ importing ? '导入中…' : `确认导入 ${preview?.total || 0} 条` }}
        </button>
      </div>
    </van-popup>

    <!-- AI 识别配置弹层 -->
    <van-popup v-model:show="showAiConfig" position="center" round>
      <div class="ai-pop">
        <div class="pop-head">
          <span class="pop-title">AI 识别配置</span>
          <button class="pop-close" @click="showAiConfig = false"><span style="font-size:20px;">×</span></button>
        </div>
        <div class="form-body">
          <div class="ai-field">
            <label>常用服务（快捷选择）</label>
            <select v-model="aiService" @change="pickAiService" class="ai-select">
              <option v-for="s in AI_SERVICES" :key="s.label" :value="s.label">{{ s.label }}</option>
            </select>
          </div>
          <div class="ai-field">
            <label>API 地址</label>
            <input v-model="aiForm.url" placeholder="https://api.deepseek.com/v1 或 …/v1/chat/completions" />
          </div>
          <div class="ai-field">
            <label>模型名称</label>
            <input v-model="aiForm.model" placeholder="gpt-4o-mini / deepseek-chat" />
          </div>
          <div class="ai-field">
            <label>API 密钥</label>
            <input v-model="aiForm.key" type="password" :placeholder="aiForm.hasKey ? `已保存 ${aiForm.keyMask}，留空保持不变` : 'sk-…'" />
          </div>
          <div class="ai-tip">密钥仅保存在本机数据库，界面回显时脱敏；Ollama 等本地服务可留空密钥。</div>
          <button class="ai-test-btn" :disabled="aiTesting" @click="testAi">{{ aiTesting ? '测试中…' : '测试连接' }}</button>
          <div v-if="aiTestResult" class="ai-test-result" :class="aiTestResult.ok ? 'ok' : 'fail'">{{ aiTestResult.msg }}</div>
          <button class="save-btn" :disabled="aiSaving" @click="saveAiConfig">{{ aiSaving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </van-popup>

    <!-- MCP 接入弹层 -->
    <van-popup v-model:show="showMcp" position="center" round>
      <div class="ai-pop">
        <div class="pop-head">
          <span class="pop-title">MCP 接入</span>
          <button class="pop-close" @click="showMcp = false"><span style="font-size:20px;">×</span></button>
        </div>
        <div class="form-body">
          <div class="ai-field">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <label style="margin:0;">启用 MCP Server</label>
              <van-switch v-model="mcpEnabled" size="22px" @change="onToggleMcp" />
            </div>
            <div v-if="mcpInfo?.status && mcpInfo.status !== 'running' && mcpEnabled" class="ai-tip" style="color: var(--expense); margin-top:4px;">
              ⚠ MCP 服务未运行：{{ mcpInfo.status }}
            </div>
            <div v-else-if="mcpInfo?.status === 'running'" class="ai-tip" style="color: #52c41a; margin-top:4px;">
              ● MCP 服务运行中
            </div>
          </div>
          <div class="ai-field">
            <label>MCP 端口</label>
            <div class="port-row">
              <input v-model="mcpPortInput" type="number" min="1024" max="65535" style="flex:1;" />
              <van-button size="small" type="primary" :loading="mcpSaving" @click="saveMcpPort">保存</van-button>
            </div>
            <div v-if="mcpPortMsg" class="ai-tip" :style="{marginTop:'6px', color: mcpPortOk ? '#52c41a' : 'var(--expense)'}">{{ mcpPortMsg }}</div>
            <div class="ai-tip" style="margin-top:4px;">⚠ 请勿将此端口暴露到公网，仅在局域网内使用。</div>
          </div>
          <div class="ai-field">
            <label>接入地址</label>
            <div style="display:flex;align-items:center;gap:4px;">
              <input :value="`http://127.0.0.1:${mcpInfo?.port || 38898}/mcp`" readonly style="flex:1;" />
              <button class="copy-btn" title="复制" @click="copyText(`http://127.0.0.1:${mcpInfo?.port || 38898}/mcp`)"><Copy :size="16" /></button>
            </div>
          </div>
          <div class="ai-field">
            <label>访问 Token</label>
            <div style="display:flex;align-items:center;gap:4px;">
              <input :value="mcpInfo?.token || ''" readonly style="flex:1;" />
              <button class="copy-btn" title="复制" @click="copyText(mcpInfo?.token || '')"><Copy :size="16" /></button>
              <button class="copy-btn" title="重置" @click="resetMcp"><RefreshCw :size="16" /></button>
            </div>
          </div>
          <div class="ai-tip">在 AI 客户端（ClawBot/OpenClaw 等）中配置上述地址和 Token，即可通过对话自动记账。不配置不影响正常手动记账。</div>
          <div class="ai-field">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <label style="margin:0;">配置示例（JSON）</label>
              <button class="copy-btn" style="padding:2px 6px;font-size:12px;" title="复制" @click="copyMcpConfig"><Copy :size="12" /> 复制</button>
            </div>
            <pre class="mcp-example">{
  "mcpServers": {
    "sinong": {
      "url": "http://127.0.0.1:{{ mcpInfo?.port || 38898 }}/mcp",
      "headers": {
        "Authorization": "Bearer {{ mcpInfo?.token || '你的token' }}"
      }
    }
  }
}</pre>
          </div>
        </div>
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
.ai-bar { display: flex; align-items: center; gap: 10px; margin: 12px 0; }
.ai-btn {
  flex-shrink: 0; padding: 8px 14px; border: 1px solid var(--brand); border-radius: 20px;
  background: var(--brand-soft); color: var(--brand); font-size: 13px; font-weight: 600; cursor: pointer;
}
.ai-btn:disabled { opacity: 0.5; }
.ai-hint { font-size: 12px; color: var(--text2); line-height: 1.5; }
.ai-pop { width: min(92vw, 360px); }
.ai-field { margin-bottom: 12px; }
.ai-field label { display: block; font-size: 13px; color: var(--text2); margin-bottom: 6px; }
.ai-field input {
  width: 100%; box-sizing: border-box; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  font-size: 14px; color: var(--text); outline: none;
}
.ai-field input:focus { border-color: var(--brand); }
.ai-select {
  width: 100%; box-sizing: border-box; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  font-size: 14px; color: var(--text); outline: none;
}
.ai-select:focus { border-color: var(--brand); }
.ai-tip { font-size: 12px; color: var(--text2); margin-bottom: 16px; line-height: 1.6; }
.ai-test-btn {
  width: 100%; padding: 11px; border: 1px solid var(--brand); border-radius: 12px;
  background: transparent; color: var(--brand); font-size: 14px; font-weight: 600; cursor: pointer; margin-bottom: 10px;
}
.ai-test-btn:disabled { opacity: 0.5; }
.ai-test-result { font-size: 12px; margin-bottom: 12px; line-height: 1.5; word-break: break-all; }
.ai-test-result.ok { color: #52c41a; }
.ai-test-result.fail { color: var(--expense); }
.mcp-example {
  margin: 0; padding: 10px 12px; border-radius: 8px;
  background: var(--bg); border: 1px solid var(--border);
  font-size: 11px; line-height: 1.5; color: var(--text);
  white-space: pre-wrap; word-break: break-all;
}
.copy-btn {
  background: none; border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); cursor: pointer; padding: 6px 8px; display: flex;
  align-items: center; font-size: 16px; flex-shrink: 0;
}
.copy-btn:hover { color: var(--brand); border-color: var(--brand); }
.port-row { display: flex; gap: 8px; align-items: center; }
</style>
