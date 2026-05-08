<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

type Endpoint = 'generations' | 'edits'

interface HistoryItem {
  id: string
  prompt: string
  model?: string
  endpoint: Endpoint
  imageUrl: string
  proxiedUrl?: string
  revisedPrompt?: string
  createdAt: string
}

interface SessionState {
  user?: { id: number; email?: string; username?: string; balance?: number; status?: string }
  imageGroup?: { id: number; name: string } | null
  imageKey?: { id: number; name: string; created?: boolean } | null
  apiKeyError?: string
  history: HistoryItem[]
}

const STORAGE_KEY = 'sub2api-image-manual-key'
const DEFAULT_MODEL = 'gpt-image-2'
const params = new URLSearchParams(window.location.search)
const bridge = {
  userId: params.get('user_id') || '',
  token: params.get('token') || '',
  theme: params.get('theme') || 'light',
}

const session = reactive<SessionState>({ history: [] })
const loading = ref(true)
const generating = ref(false)
const sessionError = ref('')
const actionError = ref('')
const endpoint = ref<Endpoint>('generations')
const selectedImage = ref<HistoryItem | null>(null)
const uploadName = ref('')
const uploadFile = ref<File | null>(null)
const showManualKey = ref(false)
const manualApiKey = ref('')

const form = reactive({
  prompt: '',
  model: DEFAULT_MODEL,
  size: '1024x1024',
  quality: '',
  n: 1,
})

const userLabel = computed(() => session.user?.username || session.user?.email || (session.user?.id ? `用户 #${session.user.id}` : '未获取用户'))
const balanceLabel = computed(() => typeof session.user?.balance === 'number' ? `$${session.user.balance.toFixed(4)}` : '--')
const latestImage = computed(() => selectedImage.value || session.history[0] || null)
const hasAutoKey = computed(() => !!session.imageKey)
const hasManualKey = computed(() => !!manualApiKey.value.trim())
const canGenerate = computed(() => !loading.value && !generating.value && !sessionError.value && (hasAutoKey.value || hasManualKey.value))
const keyStatusText = computed(() => {
  if (hasAutoKey.value) return `已自动使用：${session.imageKey?.name || '用户 API Key'}`
  if (hasManualKey.value) return '正在使用浏览器保存的手动 API Key'
  return '未获取到 API Key，请手动填写后使用'
})

function authHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-sub2api-user-id': bridge.userId,
    'x-sub2api-token': bridge.token,
  }
}

function multipartHeaders(): HeadersInit {
  return {
    'x-sub2api-user-id': bridge.userId,
    'x-sub2api-token': bridge.token,
  }
}

async function parseResponse(res: Response) {
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`)
  return data
}

async function loadSession() {
  loading.value = true
  sessionError.value = ''
  actionError.value = ''
  try {
    if (!bridge.userId || !bridge.token) throw new Error('iframe URL 缺少 user_id/token，请从 Sub2API 自定义页面进入。')
    const data = await fetch('/api/session', { headers: authHeaders() }).then(parseResponse)
    Object.assign(session, data)
    selectedImage.value = session.history[0] || null
    showManualKey.value = !data.imageKey
  } catch (e: any) {
    sessionError.value = e?.message || String(e)
    showManualKey.value = true
  } finally {
    loading.value = false
  }
}

async function refreshHistory() {
  if (sessionError.value) return
  const data = await fetch('/api/history', { headers: authHeaders() }).then(parseResponse)
  session.history = data.items || []
}

function imageSrc(item: HistoryItem) {
  return item.proxiedUrl || item.imageUrl
}

function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  uploadFile.value = file
  uploadName.value = file?.name || ''
}

async function submit() {
  actionError.value = ''
  if (!canGenerate.value) return
  generating.value = true
  try {
    if (!form.prompt.trim()) throw new Error('请输入提示词')
    let data: any
    const manual = hasAutoKey.value ? '' : manualApiKey.value.trim()
    if (endpoint.value === 'generations') {
      data = await fetch('/api/images/generations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...form, model: DEFAULT_MODEL, prompt: form.prompt.trim(), n: Number(form.n) || 1, manual_api_key: manual }),
      }).then(parseResponse)
    } else {
      if (!uploadFile.value) throw new Error('请先上传要编辑的图片')
      const fd = new FormData()
      fd.append('image', uploadFile.value)
      fd.append('prompt', form.prompt.trim())
      fd.append('model', DEFAULT_MODEL)
      fd.append('size', form.size)
      fd.append('n', String(Number(form.n) || 1))
      if (form.quality) fd.append('quality', form.quality)
      if (manual) fd.append('manual_api_key', manual)
      data = await fetch('/api/images/edits', { method: 'POST', headers: multipartHeaders(), body: fd }).then(parseResponse)
    }
    session.history = data.history || []
    selectedImage.value = session.history[0] || null
  } catch (e: any) {
    actionError.value = e?.message || String(e)
  } finally {
    generating.value = false
  }
}

function useExample(text: string) { form.prompt = text }

function downloadImage(item: HistoryItem) {
  const a = document.createElement('a')
  a.href = imageSrc(item)
  a.download = `image-${item.id}.png`
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

watch(manualApiKey, (value) => localStorage.setItem(STORAGE_KEY, value))

onMounted(() => {
  document.documentElement.dataset.theme = bridge.theme
  manualApiKey.value = localStorage.getItem(STORAGE_KEY) || ''
  loadSession()
})
</script>

<template>
  <main class="page">
    <header class="topbar">
      <div class="title-area">
        <div class="logo">图</div>
        <div>
          <h1>在线生图</h1>
          <p>默认模型：gpt-image-2，使用当前 Sub2API 用户密钥调用图片接口</p>
        </div>
      </div>
      <div class="user-info">
        <div>
          <span>当前用户</span>
          <strong>{{ userLabel }}</strong>
        </div>
        <div>
          <span>账户余额</span>
          <strong>{{ balanceLabel }}</strong>
        </div>
        <div>
          <span>生图分组</span>
          <strong>{{ session.imageGroup?.name || '未绑定' }}</strong>
        </div>
      </div>
    </header>

    <section class="notice" :class="{ error: sessionError || (session.apiKeyError && !hasManualKey), success: !sessionError && hasAutoKey }">
      <div>
        <strong v-if="loading">正在获取用户信息...</strong>
        <strong v-else-if="sessionError">用户信息获取失败</strong>
        <strong v-else>{{ keyStatusText }}</strong>
        <p v-if="sessionError">{{ sessionError }}</p>
        <p v-else-if="session.apiKeyError && !hasManualKey">{{ session.apiKeyError }}</p>
        <p v-else>如果自动获取失败，可以手动填写 API Key；手动密钥只保存在当前浏览器。</p>
      </div>
      <button class="secondary" type="button" :disabled="loading" @click="showManualKey = !showManualKey">
        {{ showManualKey ? '收起' : '填写 API Key' }}
      </button>
    </section>

    <section v-if="showManualKey" class="manual-key">
      <label>
        <span>手动 API Key</span>
        <input v-model="manualApiKey" type="password" autocomplete="off" placeholder="请输入 Sub2API 用户密钥" />
      </label>
    </section>

    <section class="layout">
      <form class="panel controls" @submit.prevent="submit">
        <div class="tabs">
          <button type="button" :class="{ active: endpoint === 'generations' }" @click="endpoint = 'generations'">生成图片</button>
          <button type="button" :class="{ active: endpoint === 'edits' }" @click="endpoint = 'edits'">编辑图片</button>
        </div>

        <label class="field prompt">
          <span>提示词</span>
          <textarea v-model="form.prompt" :disabled="!!sessionError" placeholder="描述图片内容、风格、构图、光线和细节..."></textarea>
        </label>

        <div v-if="endpoint === 'edits'" class="upload">
          <label>
            <input :disabled="!!sessionError" type="file" accept="image/*" @change="onPickFile" />
            <strong>{{ uploadName || '上传要编辑的图片' }}</strong>
            <small>支持 PNG / JPG / WebP</small>
          </label>
        </div>

        <div class="grid-fields">
          <label class="field">
            <span>尺寸</span>
            <select v-model="form.size" :disabled="!!sessionError">
              <option>1024x1024</option>
              <option>1024x1536</option>
              <option>1536x1024</option>
              <option>1792x1024</option>
              <option>1024x1792</option>
              <option>512x512</option>
            </select>
          </label>
          <label class="field">
            <span>质量</span>
            <select v-model="form.quality" :disabled="!!sessionError">
              <option value="">默认</option>
              <option>low</option>
              <option>medium</option>
              <option>high</option>
              <option>standard</option>
              <option>hd</option>
            </select>
          </label>
          <label class="field">
            <span>数量</span>
            <input v-model.number="form.n" :disabled="!!sessionError" type="number" min="1" max="4" />
          </label>
        </div>

        <div class="examples">
          <button type="button" :disabled="!!sessionError" @click="useExample('简洁白色官网风格的 AI 生图产品主视觉，柔和光线，干净留白，现代科技感')">官网主视觉</button>
          <button type="button" :disabled="!!sessionError" @click="useExample('写实商业摄影，一杯咖啡放在白色桌面，清晨自然光，高级简洁')">商业摄影</button>
          <button type="button" :disabled="!!sessionError" @click="useExample('简洁 3D 图标，白色背景，圆润的 AI 芯片，轻微阴影')">3D 图标</button>
        </div>

        <p v-if="actionError" class="inline-error">{{ actionError }}</p>

        <button class="primary" :disabled="!canGenerate" type="submit">
          <span v-if="generating">正在生成...</span>
          <span v-else-if="sessionError">用户信息不可用</span>
          <span v-else-if="!hasAutoKey && !hasManualKey">请先填写 API Key</span>
          <span v-else>{{ endpoint === 'generations' ? '生成图片' : '编辑图片' }}</span>
        </button>
      </form>

      <section class="panel preview-panel">
        <div class="preview">
          <img v-if="latestImage" :src="imageSrc(latestImage)" alt="Generated image" />
          <div v-else class="empty-preview">
            <div class="empty-icon">✦</div>
            <h2>等待生成图片</h2>
            <p>生成结果会显示在这里。</p>
          </div>
          <div v-if="latestImage" class="preview-actions">
            <button type="button" @click="downloadImage(latestImage)">下载 / 打开</button>
            <button type="button" @click="refreshHistory">刷新历史</button>
          </div>
        </div>

        <div class="history">
          <div class="history-head">
            <strong>最近生成</strong>
            <span>{{ session.history.length }} 张</span>
          </div>
          <div v-if="session.history.length === 0" class="empty-history">暂无历史图片</div>
          <div v-else class="history-list">
            <button v-for="item in session.history" :key="item.id" type="button" class="history-item" :class="{ active: latestImage?.id === item.id }" @click="selectedImage = item">
              <img :src="imageSrc(item)" alt="history" />
              <span>{{ item.prompt }}</span>
            </button>
          </div>
        </div>
      </section>
    </section>
  </main>
</template>
