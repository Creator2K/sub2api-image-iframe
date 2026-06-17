import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import fs from 'node:fs/promises'
import { request } from 'undici'
import { nanoid } from 'nanoid'
import { config } from './config.js'
import {
  ensureDataDirs,
  readHistory,
  addHistory,
  publicHistoryUrl,
} from './history.js'
import { createUserApiKeyForGroup, ensureUserImageApiKey, getUserApiKeyById, listUserApiKeys, sub2UserByJwt } from './sub2api.js'
import { generateImage, editImage, listModels } from './image-api.js'

const IMAGE_MODEL = 'gpt-image-2'
const ALLOWED_IMAGE_SIZES = new Set(['1024x1024', '1536x864', '1440x1080', '1080x1440', '864x1536'])
const FIXED_IMAGE_QUALITY = '1K'
const ALLOWED_EDIT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const JOB_TTL_MS = 24 * 60 * 60 * 1000

type ImageJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

interface ImageJob {
  id: string
  userId: string
  endpoint: 'generations' | 'edits'
  status: ImageJobStatus
  createdAt: string
  updatedAt: string
  error?: string
  statusCode?: number
  result?: { images: any[]; history: any[] }
}

const jobs = new Map<string, ImageJob>()

interface SessionQuery {
  user_id?: string
  token?: string
  theme?: string
  lang?: string
}

function requireSession(req: any): { userId: string; token: string } {
  const userId = String(req.headers['x-sub2api-user-id'] || req.query?.user_id || '')
  const token = String(req.headers['x-sub2api-token'] || req.query?.token || '')
  if (!userId || !token) throw Object.assign(new Error('Missing iframe user_id or token'), { statusCode: 401 })
  return { userId, token }
}

async function validatedSession(req: any) {
  const session = requireSession(req)
  const user = await sub2UserByJwt(session.userId, session.token)
  return { ...session, user }
}

function publicKeyInfo(k: any) {
  return {
    id: k.id,
    name: k.name,
    group_id: k.group_id,
    status: k.status,
    group: k.group ? { id: k.group.id, name: k.group.name, platform: k.group.platform } : undefined,
  }
}

function mapHistoryResponse(userId: string, items: any[]) {
  return items.map((item) => {
    const itemUserId = String(item?.userId || userId)
    const proxiedUrl = item.proxiedUrl || publicHistoryUrl(itemUserId, item.id)
    return { ...item, imageUrl: proxiedUrl, proxiedUrl }
  })
}

function publicImagesFromHistory(userId: string, history: any[], count: number) {
  return mapHistoryResponse(userId, history)
    .slice(0, count)
    .map((item) => ({
      imageUrl: item.proxiedUrl,
      proxiedUrl: item.proxiedUrl,
      mimeType: item.mimeType,
      revisedPrompt: item.revisedPrompt,
    }))
}

function publicJob(job: ImageJob) {
  return {
    id: job.id,
    endpoint: job.endpoint,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    statusCode: job.statusCode,
    result: job.result,
  }
}

function createImageJob(userId: string, endpoint: ImageJob['endpoint']) {
  cleanupJobs()
  const now = new Date().toISOString()
  const job: ImageJob = {
    id: nanoid(12),
    userId: String(userId),
    endpoint,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  }
  jobs.set(job.id, job)
  return job
}

function updateJob(job: ImageJob, patch: Partial<ImageJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
}

function failJob(job: ImageJob, error: any) {
  updateJob(job, {
    status: 'failed',
    error: error?.message || String(error),
    statusCode: Number(error?.statusCode || 500),
  })
}

function balanceOf(user: any): number | undefined {
  const balance = Number(user?.balance)
  return Number.isFinite(balance) ? balance : undefined
}

async function fetchBalanceForAudit(userId: string, token: string, log: any, meta: Record<string, unknown>) {
  try {
    return balanceOf(await sub2UserByJwt(userId, token))
  } catch (error: any) {
    log.warn({ err: error, userId, ...meta }, 'image billing audit balance fetch failed')
    return undefined
  }
}

function logImageBillingAudit(log: any, meta: {
  userId: string
  endpoint: 'generations' | 'edits'
  requestedN: number
  returnedImageCount: number
  balanceBefore?: number
  balanceAfter?: number
  jobId?: string
  apiKeyId?: unknown
  manualApiKey?: boolean
  status: 'succeeded' | 'failed'
  error?: string
}) {
  const balanceDelta = meta.balanceBefore !== undefined && meta.balanceAfter !== undefined
    ? Number((meta.balanceAfter - meta.balanceBefore).toFixed(6))
    : undefined
  const chargedAmount = meta.balanceBefore !== undefined && meta.balanceAfter !== undefined
    ? Number((meta.balanceBefore - meta.balanceAfter).toFixed(6))
    : undefined
  const entry = {
    ...meta,
    apiKeyId: meta.manualApiKey ? undefined : meta.apiKeyId,
    balanceDelta,
    chargedAmount,
  }
  if (meta.status === 'failed') log.warn(entry, 'image billing audit')
  else log.info(entry, 'image billing audit')
}

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (Date.parse(job.createdAt) < cutoff) jobs.delete(id)
  }
}

function runJob(job: ImageJob, task: () => Promise<{ images: any[]; history: any[] }>, log: any) {
  setImmediate(async () => {
    updateJob(job, { status: 'running' })
    try {
      const result = await task()
      updateJob(job, { status: 'succeeded', result })
    } catch (error: any) {
      log.warn({ err: error, jobId: job.id }, 'image job failed')
      failJob(job, error)
    }
  })
}

async function resolveImageApiKey(token: string, userId: string, selectedApiKeyId?: unknown, manualApiKey?: unknown): Promise<string> {
  const manual = String(manualApiKey || '').trim()
  if (manual) {
    await assertPureImageKey(manual)
    return manual
  }
  const id = Number(selectedApiKeyId || 0)
  if (id > 0) {
    const selected = await getUserApiKeyById(token, userId, id)
    if (Number(selected.group_id) !== config.imageGroupId) {
      throw Object.assign(new Error('此密钥不是正确的分组，请选择正确的分组'), { statusCode: 403 })
    }
    await assertPureImageKey(selected.key)
    return selected.key
  }
  const ensured = await ensureUserImageApiKey(token, userId)
  if (Number(ensured.apiKey.group_id) !== config.imageGroupId) {
    throw Object.assign(new Error('此密钥不是正确的分组，请选择正确的分组'), { statusCode: 403 })
  }
  await assertPureImageKey(ensured.apiKey.key)
  return ensured.apiKey.key
}

async function assertPureImageKey(apiKey: string) {
  const models = await listModels(apiKey)
  if (models.length !== 1 || models[0] !== IMAGE_MODEL) {
    throw Object.assign(new Error('此密钥不是正确的分组，请选择正确的分组'), { statusCode: 403 })
  }
}

function normalizeImageParams(payload: Record<string, any>, mode: 'generations' | 'edits') {
  const out: Record<string, any> = { ...payload }
  if (!out.size || out.size === 'auto') delete out.size
  else if (!ALLOWED_IMAGE_SIZES.has(String(out.size))) throw Object.assign(new Error('Invalid image size'), { statusCode: 400 })
  const n = Number(out.n || 1)
  if (!Number.isInteger(n) || n < 1 || n > 4) throw Object.assign(new Error('Only n=1 to 4 is allowed'), { statusCode: 400 })
  out.n = n
  out.quality = FIXED_IMAGE_QUALITY
  out.model = IMAGE_MODEL
  delete out.style
  delete out.response_format
  delete out.user
  if (mode === 'edits') {
    delete out.mask
  }
  if (out.api_key_id != null && !Number.isInteger(Number(out.api_key_id))) {
    throw Object.assign(new Error('Invalid API Key'), { statusCode: 400 })
  }
  return out
}

function toPublicHistoryUserId(userId: string): string {
  return String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function sanitizeRequestUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl, 'http://local')
    for (const key of ['token', 'api_key', 'manual_api_key', 'key']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]')
    }
    return `${url.pathname}${url.search}`
  } catch {
    return rawUrl.replace(/([?&](?:token|api_key|manual_api_key|key)=)[^&]+/gi, '$1[redacted]')
  }
}

function shouldSkipRequestLog(method: string, url: string, statusCode: number) {
  if (statusCode >= 400) return false
  if (url === '/api/health') return true
  if (method === 'GET' && url.startsWith('/api/jobs/')) return true
  if (method === 'GET' && /^\/assets\//.test(url)) return true
  if (method === 'GET' && url.startsWith('/logo.png')) return true
  return false
}

async function main() {
  await ensureDataDirs()
  const app = Fastify({
    logger: true,
    disableRequestLogging: true,
    bodyLimit: 25 * 1024 * 1024,
  })

  app.addHook('onResponse', async (req, reply) => {
    const url = sanitizeRequestUrl(req.url)
    const statusCode = reply.statusCode
    if (shouldSkipRequestLog(req.method, url, statusCode)) return
    req.log.info({
      req: {
        method: req.method,
        url,
        host: req.headers.host,
        remoteAddress: req.ip,
      },
      res: { statusCode },
      responseTime: Math.round(Number((reply as any).elapsedTime || 0)),
    }, 'request completed')
  })

  await app.register(cors, {
    origin(origin, cb) {
      if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) cb(null, true)
      else cb(new Error('CORS origin not allowed'), false)
    },
  })
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } })

  app.get('/api/health', async () => ({ ok: true }))

  app.get<{ Querystring: SessionQuery }>('/api/session', async (req) => {
    const { userId, token, user } = await validatedSession(req)
    let apiKeys: any[] = []
    let ensured: Awaited<ReturnType<typeof ensureUserImageApiKey>> | null = null
    let apiKeyError = ''
    try {
      ensured = await ensureUserImageApiKey(token, userId)
      apiKeys = await listUserApiKeys(token)
    } catch (error: any) {
      apiKeyError = error?.message || String(error)
      try { apiKeys = await listUserApiKeys(token) } catch {}
    }
    const history = await readHistory(userId)
    return {
      user,
      imageGroup: ensured?.group || { id: config.imageGroupId, name: config.imageGroupName },
      imageKey: ensured ? { ...publicKeyInfo(ensured.apiKey), created: ensured.created } : null,
      apiKeys: apiKeys.map(publicKeyInfo),
      apiKeyError,
      history: mapHistoryResponse(userId, history),
    }
  })

  app.post<{ Body: { group_id?: number; name?: string }; Querystring: SessionQuery }>('/api/keys', async (req) => {
    const { token } = await validatedSession(req)
    const groupId = Number(req.body?.group_id || 0)
    if (!groupId) throw Object.assign(new Error('group_id is required'), { statusCode: 400 })
    if (groupId !== config.imageGroupId) throw Object.assign(new Error('Only image group can be created here'), { statusCode: 400 })
    const key = await createUserApiKeyForGroup(token, groupId, req.body?.name)
    return { key: publicKeyInfo(key) }
  })

  app.get<{ Params: { id: string }; Querystring: SessionQuery }>('/api/keys/:id/models', async (req) => {
    const { userId, token } = await validatedSession(req)
    const key = await getUserApiKeyById(token, userId, Number(req.params.id))
    const models = await listModels(key.key)
    const supportsImage2 = Number(key.group_id) === config.imageGroupId && models.length === 1 && models[0] === IMAGE_MODEL
    return { models, supportsImage2 }
  })

  app.get<{ Querystring: SessionQuery }>('/api/history', async (req) => {
    const { userId } = await validatedSession(req)
    return { items: mapHistoryResponse(userId, await readHistory(userId)) }
  })

  app.get<{ Params: { id: string }; Querystring: SessionQuery }>('/api/jobs/:id', async (req) => {
    const { userId } = await validatedSession(req)
    const job = jobs.get(req.params.id)
    if (!job || job.userId !== String(userId)) {
      throw Object.assign(new Error('Job not found'), { statusCode: 404 })
    }
    return { job: publicJob(job) }
  })

  app.get<{ Params: { userId: string; itemId: string } }>('/api/history/:userId/:itemId/image', async (req, reply) => {
    if (req.params.userId !== toPublicHistoryUserId(req.params.userId)) {
      return reply.code(400).send({ error: 'invalid user id' })
    }
    const items = await readHistory(req.params.userId)
    const item = items.find((x) => x.id === req.params.itemId)
    if (!item) return reply.code(404).send({ error: 'not found' })
    if (item.imageUrl.startsWith('data:')) {
      const match = item.imageUrl.match(/^data:([^;]+);base64,(.*)$/)
      if (!match) return reply.code(404).send({ error: 'invalid data url' })
      const buf = Buffer.from(match[2], 'base64')
      reply.header('content-type', match[1])
      return reply.send(buf)
    }
    try {
      const upstream = await request(item.imageUrl, { method: 'GET', bodyTimeout: 60000, headersTimeout: 60000 })
      reply.code(upstream.statusCode)
      const contentType = upstream.headers['content-type']
      if (contentType) reply.header('content-type', contentType)
      return reply.send(upstream.body)
    } catch (error: any) {
      req.log.warn({ err: error, itemId: req.params.itemId }, 'failed to proxy history image')
      return reply.code(502).send({ error: 'failed to load history image' })
    }
  })

  app.post<{ Body: any; Querystring: SessionQuery }>('/api/images/generations/jobs', async (req, reply) => {
    const { userId, token, user } = await validatedSession(req)
    const payload = normalizeImageParams((req.body || {}) as Record<string, any>, 'generations')
    const prompt = String(payload.prompt || '').trim()
    if (!prompt) throw Object.assign(new Error('Prompt is required'), { statusCode: 400 })
    const apiKey = await resolveImageApiKey(token, userId, payload.api_key_id, payload.manual_api_key)
    const balanceBefore = balanceOf(user)
    const job = createImageJob(userId, 'generations')
    runJob(job, async () => {
      let images: any[] = []
      try {
        req.log.info({ jobId: job.id, n: Number(payload.n || 1), apiKeyId: payload.manual_api_key ? undefined : payload.api_key_id }, 'calling image generation api')
        images = await generateImage(apiKey, { ...payload, prompt })
        const balanceAfter = await fetchBalanceForAudit(userId, token, req.log, { jobId: job.id, endpoint: 'generations' })
        logImageBillingAudit(req.log, {
          userId, jobId: job.id, endpoint: 'generations', requestedN: Number(payload.n || 1), returnedImageCount: images.length,
          balanceBefore, balanceAfter, apiKeyId: payload.api_key_id, manualApiKey: !!payload.manual_api_key, status: 'succeeded',
        })
      } catch (error: any) {
        const balanceAfter = await fetchBalanceForAudit(userId, token, req.log, { jobId: job.id, endpoint: 'generations', status: 'failed' })
        logImageBillingAudit(req.log, {
          userId, jobId: job.id, endpoint: 'generations', requestedN: Number(payload.n || 1), returnedImageCount: images.length,
          balanceBefore, balanceAfter, apiKeyId: payload.api_key_id, manualApiKey: !!payload.manual_api_key,
          status: 'failed', error: error?.message || String(error),
        })
        throw error
      }
      const history = await addHistory(userId, images.map((img) => ({
        endpoint: 'generations', prompt, model: IMAGE_MODEL, imageUrl: img.imageUrl,
        mimeType: img.mimeType, revisedPrompt: img.revisedPrompt,
      })))
      return { images: publicImagesFromHistory(userId, history, images.length), history: mapHistoryResponse(userId, history) }
    }, req.log)
    return reply.code(202).send({ job: publicJob(job) })
  })

  app.post<{ Querystring: SessionQuery }>('/api/images/edits/jobs', async (req, reply) => {
    const { userId, token, user } = await validatedSession(req)
    const parts = req.parts()
    const fields: Record<string, any> = {}
    let imageFile: { buffer: Buffer; filename?: string; mimetype?: string } | null = null
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'image') {
        req.log.info({ filename: part.filename, mimetype: part.mimetype }, 'edit image upload received')
        if (!ALLOWED_EDIT_MIME_TYPES.has(part.mimetype)) {
          throw Object.assign(new Error('Only PNG / JPG / WebP images are allowed'), { statusCode: 400 })
        }
        imageFile = {
          buffer: await part.toBuffer(),
          filename: part.filename,
          mimetype: part.mimetype,
        }
        req.log.info({ bytes: imageFile.buffer.length }, 'edit image upload buffered')
      } else if (part.type === 'field') {
        fields[part.fieldname] = part.value
      }
    }
    const payload = normalizeImageParams(fields, 'edits')
    const prompt = String(payload.prompt || '').trim()
    if (!prompt) throw Object.assign(new Error('Edit prompt is required'), { statusCode: 400 })
    if (!imageFile) throw Object.assign(new Error('Image file is required'), { statusCode: 400 })
    const apiKey = await resolveImageApiKey(token, userId, payload.api_key_id, payload.manual_api_key)
    const balanceBefore = balanceOf(user)
    const job = createImageJob(userId, 'edits')
    runJob(job, async () => {
      req.log.info({ jobId: job.id, fields: Object.keys(payload), n: Number(payload.n || 1), imageBytes: imageFile.buffer.length }, 'calling image edit api')
      let images: any[] = []
      try {
        images = await editImage(apiKey, { ...payload, prompt }, imageFile)
        req.log.info({ jobId: job.id, count: images.length }, 'image edit api completed')
        const balanceAfter = await fetchBalanceForAudit(userId, token, req.log, { jobId: job.id, endpoint: 'edits' })
        logImageBillingAudit(req.log, {
          userId, jobId: job.id, endpoint: 'edits', requestedN: Number(payload.n || 1), returnedImageCount: images.length,
          balanceBefore, balanceAfter, apiKeyId: payload.api_key_id, manualApiKey: !!payload.manual_api_key, status: 'succeeded',
        })
      } catch (error: any) {
        const balanceAfter = await fetchBalanceForAudit(userId, token, req.log, { jobId: job.id, endpoint: 'edits', status: 'failed' })
        logImageBillingAudit(req.log, {
          userId, jobId: job.id, endpoint: 'edits', requestedN: Number(payload.n || 1), returnedImageCount: images.length,
          balanceBefore, balanceAfter, apiKeyId: payload.api_key_id, manualApiKey: !!payload.manual_api_key,
          status: 'failed', error: error?.message || String(error),
        })
        throw error
      }
      const history = await addHistory(userId, images.map((img) => ({
        endpoint: 'edits', prompt, model: IMAGE_MODEL, imageUrl: img.imageUrl,
        mimeType: img.mimeType, revisedPrompt: img.revisedPrompt,
      })))
      return { images: publicImagesFromHistory(userId, history, images.length), history: mapHistoryResponse(userId, history) }
    }, req.log)
    return reply.code(202).send({ job: publicJob(job) })
  })

  const publicDir = path.resolve(process.cwd(), 'dist/public')
  try {
    await fs.access(publicDir)
    await app.register(fastifyStatic, { root: publicDir, prefix: '/' })
    app.setNotFoundHandler(async (_req, reply) => reply.sendFile('index.html'))
  } catch {
    app.log.warn('dist/public not found; API-only mode')
  }

  await app.listen({ host: config.host, port: config.port })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
