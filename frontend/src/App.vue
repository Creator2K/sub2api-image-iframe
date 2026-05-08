<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

type Endpoint = 'generations' | 'edits'

type ApiKeyOption = {
  id: number
  name: string
  group_id: number | null
  status: string
  group?: { id: number; name: string; platform?: string }
  created?: boolean
}

interface HistoryItem {
  id: string
  prompt: string
  model?: string
  endpoint: Endpoint
  imageUrl: string
  proxiedUrl?: string
  revisedPrompt?: string
  createdAt: string
  loadFailed?: boolean
}

interface SessionState {
  user?: { id: number; email?: string; username?: string; balance?: number; status?: string }
  imageGroup?: { id: number; name: string } | null
  imageKey?: ApiKeyOption | null
  apiKeys?: ApiKeyOption[]
  apiKeyError?: string
  history: HistoryItem[]
}

const t = {
  userPrefix: '\u7528\u6237 #',
  unknownUser: '\u672a\u83b7\u53d6\u7528\u6237',
  autoUsingManualKey: '\u6b63\u5728\u4f7f\u7528\u6d4f\u89c8\u5668\u4fdd\u5b58\u7684\u624b\u52a8 API Key',
  chooseKeyHint: '\u8bf7\u9009\u62e9\u4e00\u4e2a API Key\uff0c\u7cfb\u7edf\u4f1a\u81ea\u52a8\u68c0\u67e5\u662f\u5426\u652f\u6301 gpt-image-2',
  keyNotPureImage: '\u6b64\u5bc6\u94a5\u4e0d\u662f\u6b63\u786e\u7684\u5206\u7ec4\uff0c\u8bf7\u9009\u62e9\u6b63\u786e\u7684\u5206\u7ec4',
  modelFetchFailed: '\u6a21\u578b\u5217\u8868\u83b7\u53d6\u5931\u8d25\uff0c\u8bf7\u66f4\u6362\u5bc6\u94a5\u6216\u624b\u52a8\u586b\u5199 API Key',
  missingIframe: '请从 BeeCode后台进入',
  promptRequired: '\u8bf7\u8f93\u5165\u63d0\u793a\u8bcd',
  uploadRequired: '\u8bf7\u5148\u4e0a\u4f20\u8981\u7f16\u8f91\u7684\u56fe\u7247',
  uploadTooLarge: '\u56fe\u7247\u4e0d\u80fd\u8d85\u8fc7 20MB',
  uploadTypeInvalid: '\u8bf7\u4e0a\u4f20 PNG / JPG / WebP \u56fe\u7247',
  logo: '\u56fe',
  title: 'BeeCode在线生图',
  subtitle: '',
  currentUser: '\u5f53\u524d\u7528\u6237',
  balance: '\u8d26\u6237\u4f59\u989d',
  imageGroup: '\u751f\u56fe\u5206\u7ec4',
  unbound: '\u672a\u7ed1\u5b9a',
  loadingUser: '\u6b63\u5728\u83b7\u53d6\u7528\u6237\u4fe1\u606f...',
  userLoadFailed: '\u7528\u6237\u4fe1\u606f\u83b7\u53d6\u5931\u8d25',
  checkingModels: '\u6b63\u5728\u68c0\u67e5\u6240\u9009\u5bc6\u94a5\u6a21\u578b\u5217\u8868...',
  pureImageOk: '密钥选择正确，可以生成图片。 1K：1$（0.02元/张） 2K：2$ （0.04元/张） 4K：4$ （0.08元/张）',
  pureImageHint: '\u8bf7\u9009\u62e9\u5bf9\u5e94\u7684\u751f\u56fe\u5206\u7ec4',
  noGroup3Key: '\u672a\u627e\u5230\u751f\u56fe\u5206\u7ec4\u5bc6\u94a5\uff0c\u662f\u5426\u7acb\u5373\u521b\u5efa\uff1f',
  creatingKey: '\u6b63\u5728\u521b\u5efa\u5bc6\u94a5...',
  createKey: '\u521b\u5efa\u751f\u56fe\u5bc6\u94a5',
  manualKey: '\u624b\u52a8 API Key',
  collapse: '\u6536\u8d77',
  apiKeyLabel: 'API Key',
  chooseKey: '\u8bf7\u9009\u62e9\u5bc6\u94a5',
  manualPlaceholder: '\u8bf7\u8f93\u5165 Sub2API \u7528\u6237\u5bc6\u94a5',
  generateImage: '\u751f\u6210\u56fe\u7247',
  editImage: '\u7f16\u8f91\u56fe\u7247',
  prompt: '\u63d0\u793a\u8bcd',
  promptPlaceholder: '\u63cf\u8ff0\u56fe\u7247\u5185\u5bb9\u3001\u98ce\u683c\u3001\u6784\u56fe\u3001\u5149\u7ebf\u548c\u7ec6\u8282...',
  uploadEdit: '\u4e0a\u4f20\u8981\u7f16\u8f91\u7684\u56fe\u7247',
  uploadSupport: '\u652f\u6301 PNG / JPG / WebP',
  size: '\u5c3a\u5bf8',
  quality: '\u8d28\u91cf',
  exampleHero: '\u5b98\u7f51\u4e3b\u89c6\u89c9',
  examplePhoto: '\u5546\u4e1a\u6444\u5f71',
  exampleIcon: '3D \u56fe\u6807',
  generating: '\u6b63\u5728\u751f\u6210...',
  userUnavailable: '\u7528\u6237\u4fe1\u606f\u4e0d\u53ef\u7528',
  checkingKey: '\u6b63\u5728\u68c0\u67e5\u5bc6\u94a5...',
  chooseOrFillKey: '\u8bf7\u5148\u9009\u62e9\u6216\u586b\u5199 API Key',
  choosePureKey: '\u8bf7\u9009\u62e9\u7eaf\u751f\u56fe\u5206\u7ec4\u5bc6\u94a5',
  waitingImage: '\u7b49\u5f85\u751f\u6210\u56fe\u7247',
  resultHere: '\u751f\u6210\u7ed3\u679c\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002',
  downloadOpen: '\u4e0b\u8f7d / \u6253\u5f00',
  refreshHistory: '\u5237\u65b0\u5386\u53f2',
  recent: '\u6700\u8fd1\u751f\u6210',
  imageUnit: '\u5f20',
  noHistory: '\u6682\u65e0\u5386\u53f2\u56fe\u7247',
}

const STORAGE_KEY = 'sub2api-image-manual-key'
const DEFAULT_MODEL = 'gpt-image-2'
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const params = new URLSearchParams(window.location.search)
const bridge = {
  userId: params.get('user_id') || '',
  token: params.get('token') || '',
}

const session = reactive<SessionState>({ history: [], apiKeys: [] })
const loading = ref(true)
const generating = ref(false)
const checkingModels = ref(false)
const creatingKey = ref(false)
const sessionError = ref('')
const actionError = ref('')
const modelError = ref('')
const modelOk = ref(false)
const endpoint = ref<Endpoint>('generations')
const selectedImage = ref<HistoryItem | null>(null)
const selectedApiKeyId = ref('')
const uploadName = ref('')
const uploadFile = ref<File | null>(null)
const showManualKey = ref(false)
const manualApiKey = ref('')

const showingPrompt = ref(false)
const showingPromptText = ref('')
const showingError = ref(false)
const showingErrorText = ref('')
const failedImageIds = reactive(new Set<string>())

const form = reactive({ prompt: '', model: DEFAULT_MODEL, size: '1024x1024', quality: '1K' })

const userLabel = computed(() => session.user?.username || session.user?.email || (session.user?.id ? `${t.userPrefix}${session.user.id}` : t.unknownUser))
const balanceLabel = computed(() => typeof session.user?.balance === 'number' ? `$${session.user.balance.toFixed(4)}` : '--')
const latestImage = computed(() => selectedImage.value)
const apiKeys = computed(() => {
  const groupId = Number(session.imageGroup?.id || 0)
  return groupId > 0 ? (session.apiKeys || []).filter((key) => Number(key.group_id) === groupId) : []
})
const selectedKey = computed(() => apiKeys.value.find((k) => String(k.id) === selectedApiKeyId.value) || null)
const hasManualKey = computed(() => !!manualApiKey.value.trim())
const hasSelectedKey = computed(() => !!selectedKey.value)
const canGenerate = computed(() => !loading.value && !generating.value && !checkingModels.value && !creatingKey.value && !sessionError.value && ((hasSelectedKey.value && modelOk.value) || hasManualKey.value))
const keyStatusText = computed(() => {
  if (hasSelectedKey.value && modelOk.value) return `\u5df2\u9009\u62e9\uff1a${selectedKey.value?.name}`
  if (hasSelectedKey.value && modelError.value) return modelError.value
  if (hasManualKey.value) return t.autoUsingManualKey
  return t.chooseKeyHint
})

const sizeOptions = [
  { label: '\u672a\u6307\u5b9a', value: 'auto' },
  { label: '1:1\uff08\u6b63\u65b9\u5f62\uff09', value: '1024x1024' },
  { label: '16:9\uff08\u6a2a\u7248\uff09', value: '1536x864' },
  { label: '4:3\uff08\u6a2a\u7248\uff09', value: '1440x1080' },
  { label: '3:4\uff08\u7ad6\u7248\uff09', value: '1080x1440' },
  { label: '9:16\uff08\u7ad6\u7248\uff09', value: '864x1536' },
]
const qualityOptions = ['1K', '2K', '4K']

function authHeaders(): HeadersInit { return { 'content-type': 'application/json', 'x-sub2api-user-id': bridge.userId, 'x-sub2api-token': bridge.token } }
function multipartHeaders(): HeadersInit { return { 'x-sub2api-user-id': bridge.userId, 'x-sub2api-token': bridge.token } }

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
  modelError.value = ''
  modelOk.value = false
  selectedApiKeyId.value = ''
  try {
    if (!bridge.userId || !bridge.token) throw new Error(t.missingIframe)
    const data = await fetch('/api/session', { headers: authHeaders() }).then(parseResponse)
    Object.assign(session, data)
    selectedImage.value = null
    showManualKey.value = false
    if (apiKeys.value.length > 0) {
      selectedApiKeyId.value = String(apiKeys.value[0].id)
      await checkSelectedKeyModels()
    }
  } catch (e: any) {
    sessionError.value = e?.message || String(e)
    showManualKey.value = true
  } finally { loading.value = false }
}

async function checkSelectedKeyModels() {
  modelError.value = ''
  modelOk.value = false
  if (!selectedApiKeyId.value) return
  checkingModels.value = true
  try {
    const data = await fetch(`/api/keys/${encodeURIComponent(selectedApiKeyId.value)}/models`, { headers: authHeaders() }).then(parseResponse)
    const models: string[] = Array.isArray(data.models) ? data.models : []
    if (data.supportsImage2 !== true || models.length !== 1 || models[0] !== DEFAULT_MODEL) {
      modelError.value = t.keyNotPureImage
      return
    }
    modelOk.value = true
  } catch (e: any) { modelError.value = e?.message || t.modelFetchFailed }
  finally { checkingModels.value = false }
}

async function refreshHistory() {
  if (sessionError.value) return
  const data = await fetch('/api/history', { headers: authHeaders() }).then(parseResponse)
  session.history = data.items || []
}

function imageSrc(item: HistoryItem) { return item.proxiedUrl || item.imageUrl }
function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  actionError.value = ''
  uploadFile.value = null
  uploadName.value = ''
  if (!file) return
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    input.value = ''
    actionError.value = t.uploadTypeInvalid
    return
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    input.value = ''
    actionError.value = t.uploadTooLarge
    return
  }
  uploadFile.value = file
  uploadName.value = file.name
}


async function createImageKey() {
  actionError.value = ''
  if (sessionError.value || creatingKey.value) return
  creatingKey.value = true
  try {
    const data = await fetch('/api/keys', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ group_id: session.imageGroup?.id, name: '\u751f\u56fe' }),
    }).then(parseResponse)
    const key = data.key as ApiKeyOption
    const others = (session.apiKeys || []).filter((item) => item.id !== key.id)
    session.apiKeys = [...others, key]
    selectedApiKeyId.value = String(key.id)
    showManualKey.value = false
    await checkSelectedKeyModels()
  } catch (e: any) {
    actionError.value = e?.message || String(e)
  } finally {
    creatingKey.value = false
  }
}

async function submit() {
  actionError.value = ''
  if (!canGenerate.value) return
  generating.value = true
  try {
    if (!form.prompt.trim()) throw new Error(t.promptRequired)
    let data: any
    const manual = hasManualKey.value ? manualApiKey.value.trim() : ''
    const basePayload = { ...form, model: DEFAULT_MODEL, prompt: form.prompt.trim(), n: 1, size: form.size, quality: form.quality, api_key_id: manual ? undefined : Number(selectedApiKeyId.value), manual_api_key: manual }
    if (endpoint.value === 'generations') {
      data = await fetch('/api/images/generations', { method: 'POST', headers: authHeaders(), body: JSON.stringify(basePayload) }).then(parseResponse)
    } else {
      if (!uploadFile.value) throw new Error(t.uploadRequired)
      const fd = new FormData()
      fd.append('image', uploadFile.value)
      for (const [k, v] of Object.entries(basePayload)) if (v !== undefined && v !== null && v !== '') fd.append(k, String(v))
      data = await fetch('/api/images/edits', { method: 'POST', headers: multipartHeaders(), body: fd }).then(parseResponse)
    }
    session.history = data.history || []
    selectedImage.value = session.history[0] || null
  } catch (e: any) {
    actionError.value = e?.message || String(e)
    showingErrorText.value = actionError.value
    showingError.value = true
  }
  finally { generating.value = false }
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
function viewPrompt(item: HistoryItem) {
  showingPromptText.value = item.prompt
  showingPrompt.value = true
}
function onHistoryWheel(e: WheelEvent) {
  if (e.deltaY !== 0) {
    const el = e.currentTarget as HTMLElement
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
}

watch(manualApiKey, (value) => localStorage.setItem(STORAGE_KEY, value))
watch(selectedApiKeyId, async () => { modelError.value = ''; modelOk.value = false; if (!loading.value) await checkSelectedKeyModels() })

onMounted(() => {
  window.addEventListener('beforeunload', (e) => {
    if (generating.value) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
  manualApiKey.value = localStorage.getItem(STORAGE_KEY) || ''
  loadSession()
})
</script>

<template>
  <main class="page">
    <header class="topbar" v-motion :initial="{ opacity: 0, y: -20 }" :enter="{ opacity: 1, y: 0, transition: { duration: 600 } }">
      <div class="title-area">
        <img :src="'./logo.png?v=20260509'" alt="logo" class="logo" v-motion :initial="{ scale: 0 }" :enter="{ scale: 1, transition: { type: 'spring', stiffness: 200, damping: 10 } }" />
        <div><h1 v-motion :initial="{ opacity: 0, x: -20 }" :enter="{ opacity: 1, x: 0, transition: { delay: 100 } }">{{ t.title }}</h1></div>
      </div>
      <div class="user-info">
        <div v-motion :initial="{ opacity: 0, scale: 0.9 }" :enter="{ opacity: 1, scale: 1, transition: { delay: 300 } }"><span>{{ t.currentUser }}</span><strong>{{ userLabel }}</strong></div>
        <div v-motion :initial="{ opacity: 0, scale: 0.9 }" :enter="{ opacity: 1, scale: 1, transition: { delay: 400 } }"><span>{{ t.balance }}</span><strong>{{ balanceLabel }}</strong></div>
      </div>
    </header>

    <section v-motion :initial="{ opacity: 0, y: 20 }" :enter="{ opacity: 1, y: 0, transition: { delay: 600 } }" class="notice" :class="{ error: sessionError || modelError || (session.apiKeyError && !hasManualKey), success: !sessionError && modelOk }">
      <div class="notice-copy">
        <strong v-if="loading">{{ t.loadingUser }}</strong>
        <strong v-else-if="sessionError">{{ t.userLoadFailed }}</strong>
        <strong v-else-if="checkingModels">{{ t.checkingModels }}</strong>
        <strong v-else>{{ keyStatusText }}</strong>
        <p v-if="sessionError">{{ sessionError }}</p>
        <p v-else-if="session.apiKeyError && !apiKeys.length">{{ session.apiKeyError }}</p>
        <p v-else-if="modelOk">{{ t.pureImageOk }}</p>
        <p v-else-if="apiKeys.length === 0">{{ t.noGroup3Key }}</p>
        <p v-else>{{ t.pureImageHint }}</p>
      </div>
      <div class="notice-actions">
        <label class="notice-key-select"><span>{{ t.apiKeyLabel }}</span><select v-model="selectedApiKeyId" :disabled="loading || creatingKey || !!sessionError || apiKeys.length === 0"><option value="">{{ t.chooseKey }}</option><option v-for="key in apiKeys" :key="key.id" :value="String(key.id)">{{ key.name }}{{ key.group?.name ? ` (${key.group.name})` : '' }}</option></select></label>
        <button v-if="apiKeys.length === 0 && !sessionError" class="secondary" type="button" :disabled="loading || creatingKey" @click="createImageKey">{{ creatingKey ? t.creatingKey : t.createKey }}</button>
        <button class="secondary" type="button" :disabled="loading" @click="showManualKey = !showManualKey">{{ showManualKey ? t.collapse : t.manualKey }}</button>
      </div>
    </section>

    <section v-if="showManualKey" v-motion :initial="{ opacity: 0, height: 0 }" :enter="{ opacity: 1, height: 'auto' }" :leave="{ opacity: 0, height: 0 }" class="manual-key"><label><span>{{ t.manualKey }}</span><input v-model="manualApiKey" type="password" autocomplete="off" :placeholder="t.manualPlaceholder" /></label></section>

    <section class="layout">
      <form v-motion :initial="{ opacity: 0, x: -30 }" :enter="{ opacity: 1, x: 0, transition: { delay: 700 } }" class="panel controls" @submit.prevent="submit">
        <div class="tabs"><button type="button" :class="{ active: endpoint === 'generations' }" @click="endpoint = 'generations'">{{ t.generateImage }}</button><button type="button" :class="{ active: endpoint === 'edits' }" @click="endpoint = 'edits'">{{ t.editImage }}</button></div>
        <label class="field prompt"><span>{{ t.prompt }}</span><textarea v-model="form.prompt" :disabled="!!sessionError" :placeholder="t.promptPlaceholder"></textarea></label>
        <div v-if="endpoint === 'edits'" class="upload"><label><input :disabled="!!sessionError" type="file" accept="image/*" @change="onPickFile" /><strong>{{ uploadName || t.uploadEdit }}</strong><small>{{ t.uploadSupport }}</small></label></div>
        <div class="grid-fields"><label class="field"><span>{{ t.size }}</span><select v-model="form.size" :disabled="!!sessionError"><option v-for="item in sizeOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label class="field"><span>{{ t.quality }}</span><select v-model="form.quality" :disabled="!!sessionError"><option v-for="item in qualityOptions" :key="item" :value="item">{{ item }}</option></select></label></div>
        <div class="examples">
          <button type="button" :disabled="!!sessionError" @click="useExample('赛博朋克风格的女武神，手持发光的科幻巨剑，背景是霓虹闪烁的未来都市，极其细致，8k分辨率')">赛博女武神</button>
          <button type="button" :disabled="!!sessionError" @click="useExample('一只戴着墨镜的柴犬在沙滩上冲浪，阳光明媚，写实摄影，极高画质')">冲浪柴犬</button>
          <button type="button" :disabled="!!sessionError" @click="useExample('一个可爱的 3D 卡通宇航员，站在发光的月球上，皮克斯风格，纯色背景，高质量')">卡通宇航员</button>
          <button type="button" :disabled="!!sessionError" @click="useExample('夜晚星空下的露营帐篷，发光的篝火，柔和的风格')">星空露营</button>
          <button type="button" :disabled="!!sessionError" @click="useExample('一辆霓虹赛博朋克跑车在雨夜的街道上飞驰，电影级光影')">赛博跑车</button>
          <button type="button" :disabled="!!sessionError" @click="useExample('一只可爱的布偶猫戴着皇冠，水彩画风格')">手绘布偶猫</button>
        </div>
        <p v-if="modelError && !hasManualKey" class="inline-error">{{ modelError }}</p><p v-if="actionError" class="inline-error">{{ actionError }}</p>
        <button class="btn" :disabled="!canGenerate" type="submit">
          <strong>
            <span v-if="generating">{{ t.generating }}</span>
            <span v-else-if="sessionError">{{ t.userUnavailable }}</span>
            <span v-else-if="creatingKey">{{ t.creatingKey }}</span>
            <span v-else-if="checkingModels">{{ t.checkingKey }}</span>
            <span v-else-if="!hasSelectedKey && !hasManualKey">{{ t.chooseOrFillKey }}</span>
            <span v-else-if="hasSelectedKey && !modelOk && !hasManualKey">{{ t.choosePureKey }}</span>
            <span v-else>{{ endpoint === 'generations' ? t.generateImage : t.editImage }}</span>
          </strong>
          <div id="container-stars"><div id="stars"></div></div>
          <div id="glow"><div class="circle"></div><div class="circle"></div></div>
        </button>
      </form>
      <section class="panel preview-panel" v-motion :initial="{ opacity: 0, x: 30 }" :enter="{ opacity: 1, x: 0, transition: { delay: 800 } }">
        <div class="preview">
          <div v-if="generating" class="loader-wrapper">
            <span class="loader-letter">G</span><span class="loader-letter">e</span><span class="loader-letter">n</span><span class="loader-letter">e</span><span class="loader-letter">r</span><span class="loader-letter">a</span><span class="loader-letter">t</span><span class="loader-letter">i</span><span class="loader-letter">n</span><span class="loader-letter">g</span>
            <div class="loader"></div>
          </div>
          <img v-else-if="latestImage" :src="imageSrc(latestImage)" alt="Generated image" v-motion :initial="{ opacity: 0, scale: 0.95 }" :enter="{ opacity: 1, scale: 1, transition: { duration: 500 } }" />
          <div v-else class="empty-preview">
            <div class="empty-icon" v-motion :initial="{ rotate: -180, scale: 0 }" :enter="{ rotate: 0, scale: 1, transition: { type: 'spring', stiffness: 200 } }">✨</div>
            <h2>{{ t.waitingImage }}</h2><p>{{ t.resultHere }}</p>
          </div>
          <div v-if="latestImage && !generating" class="preview-actions">
            <button class="action-btn" type="button" @click="viewPrompt(latestImage)" v-motion-pop-visible>查看提示词</button>
            <button class="action-btn" type="button" @click="selectedImage = null" v-motion-pop-visible>关闭预览</button>
            <button class="action-btn" type="button" @click="downloadImage(latestImage)" v-motion-pop-visible>{{ t.downloadOpen }}</button>
            <button class="action-btn" type="button" @click="refreshHistory" v-motion-pop-visible>{{ t.refreshHistory }}</button>
          </div>
        </div>
        <div class="history">
          <div class="history-head">
            <div><strong>{{ t.recent }}</strong><span style="margin-left: 8px; font-size: 11px; color: #fe53bb;">(提示：历史记录仅保存1天，请及时下载)</span></div>
            <span>{{ session.history.filter(i => !failedImageIds.has(i.id)).length }} {{ t.imageUnit }}</span>
          </div>
          <div v-if="session.history.length === 0" class="empty-history">{{ t.noHistory }}</div>
          <div v-else class="history-list" @wheel="onHistoryWheel">
            <button v-show="!failedImageIds.has(item.id)" v-for="(item, index) in session.history" :key="item.id" type="button" class="history-item" :class="{ active: latestImage?.id === item.id }" @click="selectedImage = item" v-motion :initial="{ opacity: 0, x: 20 }" :enter="{ opacity: 1, x: 0, transition: { delay: index * 100 } }">
              <img :src="imageSrc(item)" alt="history" @error="failedImageIds.add(item.id)" /><span>{{ item.prompt }}</span>
            </button>
          </div>
        </div>
      </section>
    </section>

    <Transition name="fade">
      <div v-if="showingPrompt || showingError" class="prompt-modal-overlay" @click="showingPrompt = false; showingError = false">
        <div class="prompt-modal-content" @click.stop v-motion :initial="{ opacity: 0, scale: 0.8 }" :enter="{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 300 } }">
          <template v-if="showingError">
            <h3 style="color: #ef4444;">生成失败</h3>
            <p>{{ showingErrorText }}</p>
            <div class="modal-actions">
              <button class="action-btn" @click="showingError = false">关闭</button>
            </div>
          </template>
          <template v-else>
            <h3>图片生成提示词</h3>
            <p>{{ showingPromptText }}</p>
            <div class="modal-actions">
              <button class="action-btn" @click="showingPrompt = false">关闭</button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </main>
</template>
