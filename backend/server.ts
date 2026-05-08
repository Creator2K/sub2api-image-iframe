import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import fs from 'node:fs/promises'
import { request } from 'undici'
import { config } from './config.js'
import { ensureDataDirs, readHistory, addHistory, publicHistoryUrl } from './history.js'
import { ensureUserImageApiKey, sub2UserByJwt } from './sub2api.js'
import { generateImage, editImage } from './chatgpt2api.js'

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

function mapHistoryResponse(userId: string, items: any[]) {
  return items.map((item) => ({
    ...item,
    proxiedUrl: item.proxiedUrl || publicHistoryUrl(userId, item.id),
  }))
}

async function resolveImageApiKey(token: string, userId: string, manualApiKey?: unknown): Promise<string> {
  const manual = String(manualApiKey || '').trim()
  if (manual) return manual
  const ensured = await ensureUserImageApiKey(token, userId)
  return ensured.apiKey.key
}

async function main() {
  await ensureDataDirs()

  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 })

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
    let ensured: Awaited<ReturnType<typeof ensureUserImageApiKey>> | null = null
    let apiKeyError = ''
    try {
      ensured = await ensureUserImageApiKey(token, userId)
    } catch (error: any) {
      apiKeyError = error?.message || String(error)
    }
    const history = await readHistory(userId)
    return {
      user,
      imageGroup: ensured?.group || null,
      imageKey: ensured
        ? { id: ensured.apiKey.id, name: ensured.apiKey.name, group_id: ensured.apiKey.group_id, created: ensured.created }
        : null,
      apiKeyError,
      history: mapHistoryResponse(userId, history),
    }
  })

  app.get<{ Querystring: SessionQuery }>('/api/history', async (req) => {
    const { userId } = await validatedSession(req)
    return { items: mapHistoryResponse(userId, await readHistory(userId)) }
  })

  app.get<{ Params: { userId: string; itemId: string } }>('/api/history/:userId/:itemId/image', async (req, reply) => {
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
    const upstream = await request(item.imageUrl, { method: 'GET', bodyTimeout: 60000, headersTimeout: 60000 })
    reply.code(upstream.statusCode)
    const contentType = upstream.headers['content-type']
    if (contentType) reply.header('content-type', contentType)
    return reply.send(upstream.body)
  })

  app.post<{ Body: any; Querystring: SessionQuery }>('/api/images/generations', async (req) => {
    const { userId, token } = await validatedSession(req)
    const payload = (req.body || {}) as Record<string, any>
    const prompt = String(payload.prompt || '').trim()
    if (!prompt) throw Object.assign(new Error('Prompt is required'), { statusCode: 400 })
    const apiKey = await resolveImageApiKey(token, userId, payload.manual_api_key)
    const images = await generateImage(apiKey, { ...payload, prompt })
    const history = await addHistory(userId, images.map((img) => ({
      endpoint: 'generations',
      prompt,
      model: payload.model || 'gpt-image-2',
      imageUrl: img.imageUrl,
      mimeType: img.mimeType,
      revisedPrompt: img.revisedPrompt,
    })))
    return { images, history: mapHistoryResponse(userId, history) }
  })

  app.post<{ Querystring: SessionQuery }>('/api/images/edits', async (req) => {
    const { userId, token } = await validatedSession(req)
    const parts = req.parts()
    const fields: Record<string, any> = {}
    let imageFile: any = null
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'image') imageFile = part
      else if (part.type === 'field') fields[part.fieldname] = part.value
    }
    const prompt = String(fields.prompt || '').trim()
    if (!prompt) throw Object.assign(new Error('Edit prompt is required'), { statusCode: 400 })
    if (!imageFile) throw Object.assign(new Error('Image file is required'), { statusCode: 400 })
    const apiKey = await resolveImageApiKey(token, userId, fields.manual_api_key)
    const images = await editImage(apiKey, { ...fields, prompt }, imageFile)
    const history = await addHistory(userId, images.map((img) => ({
      endpoint: 'edits',
      prompt,
      model: fields.model || 'gpt-image-2',
      imageUrl: img.imageUrl,
      mimeType: img.mimeType,
      revisedPrompt: img.revisedPrompt,
    })))
    return { images, history: mapHistoryResponse(userId, history) }
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
