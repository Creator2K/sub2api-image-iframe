import { request } from 'undici'
import FormData from 'form-data'
import { TextDecoder } from 'node:util'
import { config } from './config.js'

export interface ImageResult {
  imageUrl: string
  mimeType?: string
  revisedPrompt?: string
}

export interface GeneratePayload {
  prompt: string
  model?: string
  size?: string
  quality?: string
  n?: number
}

function headersForApiKey(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

function pickImages(payload: any): ImageResult[] {
  if (Array.isArray(payload?.urls)) {
    return payload.urls.map((url: any) => typeof url === 'string' ? { imageUrl: url } : null).filter(Boolean)
  }
  const data = Array.isArray(payload?.data) ? payload.data : []
  return data.map((item: any) => {
    if (item.url) return { imageUrl: item.url, revisedPrompt: item.revised_prompt }
    if (item.image_url) return { imageUrl: item.image_url, revisedPrompt: item.revised_prompt }
    if (item.b64_json) {
      return {
        imageUrl: `data:image/png;base64,${item.b64_json}`,
        mimeType: 'image/png',
        revisedPrompt: item.revised_prompt,
      }
    }
    return null
  }).filter(Boolean)
}

function pickImagesDeep(payload: any): ImageResult[] {
  const candidates = [
    payload,
    payload?.result,
    payload?.data && !Array.isArray(payload.data) ? payload.data : null,
    payload?.image?.generation?.result,
    payload?.image_generation_result,
  ].filter(Boolean)
  for (const candidate of candidates) {
    const images = pickImages(candidate)
    if (images.length) return images
  }
  return []
}

function compactText(text: string, limit = 240): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function imageApiError(message: string, statusCode: number, meta: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { statusCode, ...meta })
}

function friendlyUpstreamError(statusCode: number, bodyText = '') {
  const body = compactText(bodyText)
  if (statusCode === 504) {
    return {
      message: '图片接口处理超时（上游返回 504）。这通常是图片编辑耗时过长或上游网关超时，请稍后重试；如果反复出现，建议换小一点的原图或指定较小尺寸。',
      code: 'UPSTREAM_IMAGE_TIMEOUT',
      body,
    }
  }
  if (statusCode === 429) {
    return {
      message: '图片接口当前请求过多，请稍后再试。',
      code: 'UPSTREAM_RATE_LIMITED',
      body,
    }
  }
  if (statusCode >= 500) {
    return {
      message: `图片接口暂时不可用（上游 HTTP ${statusCode}），请稍后重试。`,
      code: 'UPSTREAM_IMAGE_ERROR',
      body,
    }
  }
  return {
    message: body ? `图片接口返回异常：${body}` : `图片接口返回异常（HTTP ${statusCode}）。`,
    code: 'UPSTREAM_BAD_RESPONSE',
    body,
  }
}

async function parseJson(res: Awaited<ReturnType<typeof request>>): Promise<any> {
  const text = await res.body.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    const statusCode = res.statusCode >= 400 ? res.statusCode : 502
    const friendly = friendlyUpstreamError(res.statusCode, text)
    throw imageApiError(friendly.message, statusCode, {
      code: friendly.code,
      upstreamStatusCode: res.statusCode,
      upstreamBody: friendly.body,
    })
  }
}

function getHeader(res: Awaited<ReturnType<typeof request>>, name: string): string {
  const value = res.headers[name] || res.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(',') : String(value || '')
}

async function* readLines(body: Awaited<ReturnType<typeof request>>['body']): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true })
    let newline = buffered.search(/\r?\n/)
    while (newline >= 0) {
      const line = buffered.slice(0, newline).replace(/\r$/, '')
      buffered = buffered.slice(buffered[newline] === '\r' ? newline + 2 : newline + 1)
      yield line
      newline = buffered.search(/\r?\n/)
    }
  }
  buffered += decoder.decode()
  if (buffered) yield buffered.replace(/\r$/, '')
}

function upstreamErrorFromPayload(payload: any, fallbackStatusCode: number) {
  if (!payload?.error && payload?.status !== 'failed') return null
  const error = payload?.error
  const code = typeof error === 'object' ? error?.code : undefined
  const message = typeof error === 'string'
    ? error
    : (error?.message || payload?.message || code || `Image API HTTP ${fallbackStatusCode}`)
  return imageApiError(message, fallbackStatusCode, {
    code: code || 'UPSTREAM_IMAGE_REJECTED',
    upstreamStatusCode: fallbackStatusCode,
    upstreamBody: compactText(message),
  })
}

async function parseImageSseResponse(res: Awaited<ReturnType<typeof request>>): Promise<ImageResult[]> {
  let lastPayloadText = ''
  for await (const line of readLines(res.body)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue

    const payloadText = trimmed.slice(5).trim()
    if (!payloadText || payloadText === '[DONE]') break
    lastPayloadText = payloadText

    let payload: any
    try {
      payload = JSON.parse(payloadText)
    } catch {
      throw imageApiError('图片接口返回了无效的 SSE JSON。', 502, {
        code: 'UPSTREAM_BAD_SSE_RESPONSE',
        upstreamStatusCode: res.statusCode,
        upstreamBody: compactText(payloadText),
      })
    }

    const upstreamError = upstreamErrorFromPayload(payload, res.statusCode >= 300 ? res.statusCode : 400)
    if (upstreamError) throw upstreamError

    const images = pickImagesDeep(payload)
    if (images.length) return images
  }

  throw imageApiError('Image API did not return data[].url or data[].b64_json', 502, {
    code: 'UPSTREAM_EMPTY_IMAGE_RESULT',
    upstreamStatusCode: res.statusCode,
    upstreamBody: compactText(lastPayloadText),
  })
}

async function parseImageResponse(res: Awaited<ReturnType<typeof request>>): Promise<ImageResult[]> {
  if (getHeader(res, 'content-type').includes('text/event-stream')) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const friendly = friendlyUpstreamError(res.statusCode, `SSE HTTP ${res.statusCode}`)
      throw imageApiError(friendly.message, res.statusCode, {
        code: friendly.code,
        upstreamStatusCode: res.statusCode,
        upstreamBody: friendly.body,
      })
    }
    return parseImageSseResponse(res)
  }

  const payload = await parseJson(res)
  const upstreamError = upstreamErrorFromPayload(payload, res.statusCode >= 300 ? res.statusCode : 400)
  if (upstreamError) throw upstreamError
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const errorMsg = typeof payload?.error === 'string' ? payload.error : (payload?.error?.message || payload?.message || `Image API HTTP ${res.statusCode}`)
    const statusCode = res.statusCode >= 300 ? res.statusCode : 400
    const friendly = statusCode >= 500 ? friendlyUpstreamError(statusCode, errorMsg) : null
    throw imageApiError(friendly?.message || errorMsg, statusCode, {
      code: friendly?.code || 'UPSTREAM_IMAGE_REJECTED',
      upstreamStatusCode: res.statusCode,
      upstreamBody: compactText(errorMsg),
    })
  }
  const images = pickImagesDeep(payload)
  if (!images.length) throw imageApiError('Image API did not return data[].url or data[].b64_json', 502, {
    code: 'UPSTREAM_EMPTY_IMAGE_RESULT',
    upstreamStatusCode: res.statusCode,
    upstreamBody: compactText(JSON.stringify(payload || {})),
  })
  return images
}

async function requestWithTimeout(url: string, options: Parameters<typeof request>[1]) {
  try {
    return await request(url, options)
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.code === 'UND_ERR_ABORTED' || error?.code === 'UND_ERR_BODY_TIMEOUT' || error?.code === 'UND_ERR_HEADERS_TIMEOUT') {
      throw Object.assign(new Error(`Image API request timed out after ${Math.round(config.requestTimeoutMs / 1000)}s`), { statusCode: 504 })
    }
    throw error
  }
}

export async function listModels(apiKey: string): Promise<string[]> {
  const res = await requestWithTimeout(`${config.sub2apiBaseUrl}/v1/models`, {
    method: 'GET',
    headers: headersForApiKey(apiKey),
    bodyTimeout: config.requestTimeoutMs,
    headersTimeout: config.requestTimeoutMs,
  })
  const payload = await parseJson(res)
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(payload?.error?.message || payload?.message || `Models API HTTP ${res.statusCode}`)
  }
  const data = Array.isArray(payload?.data) ? payload.data : []
  return data.map((m: any) => String(m?.id || m?.name || '')).filter(Boolean)
}

export async function generateImage(apiKey: string, payload: GeneratePayload): Promise<ImageResult[]> {
  const body: Record<string, unknown> = {
    model: payload.model || 'gpt-image-2',
    prompt: payload.prompt,
    n: payload.n || 1,
    stream: true,
  }
  if (payload.size) body.size = payload.size
  if (payload.quality) body.quality = payload.quality

  const res = await requestWithTimeout(`${config.sub2apiBaseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { ...headersForApiKey(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    bodyTimeout: config.requestTimeoutMs,
    headersTimeout: config.requestTimeoutMs,
  })
  return parseImageResponse(res)
}

export async function editImage(apiKey: string, fields: Record<string, any>, file: { buffer: Buffer; filename?: string; mimetype?: string }): Promise<ImageResult[]> {
  const form = new FormData()
  form.append('image', file.buffer, {
    filename: file.filename || 'image.png',
    contentType: file.mimetype || 'image/png',
    knownLength: file.buffer.length,
  })
  form.append('prompt', String(fields.prompt || ''))
  form.append('model', String(fields.model || 'gpt-image-2'))
  if (fields.size) form.append('size', String(fields.size))
  form.append('n', String(fields.n || 1))
  form.append('stream', 'true')
  if (fields.quality) form.append('quality', String(fields.quality))

  // Do not pass the `form-data` stream directly to undici here.
  // Some upstream OpenAI-compatible image edit endpoints do not handle chunked
  // multipart uploads reliably, which can leave the request waiting forever.
  // Buffering the multipart body lets us send a fixed Content-Length.
  const body = form.getBuffer()
  const headers = {
    ...headersForApiKey(apiKey),
    ...form.getHeaders(),
    'content-length': String(body.length),
  }

  const res = await requestWithTimeout(`${config.sub2apiBaseUrl}/v1/images/edits`, {
    method: 'POST',
    headers,
    body,
    bodyTimeout: config.requestTimeoutMs,
    headersTimeout: config.requestTimeoutMs,
  })
  return parseImageResponse(res)
}
