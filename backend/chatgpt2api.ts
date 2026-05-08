import { request } from 'undici'
import FormData from 'form-data'
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
  const data = Array.isArray(payload?.data) ? payload.data : []
  return data.map((item: any) => {
    if (item.url) return { imageUrl: item.url, revisedPrompt: item.revised_prompt }
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

async function parseJson(res: Awaited<ReturnType<typeof request>>): Promise<any> {
  const text = await res.body.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    const statusCode = res.statusCode >= 400 ? res.statusCode : 502
    throw Object.assign(
      new Error(`Image API returned non-JSON: HTTP ${res.statusCode} ${text.slice(0, 200)}`),
      { statusCode }
    )
  }
}

async function parseImageResponse(res: Awaited<ReturnType<typeof request>>): Promise<ImageResult[]> {
  const payload = await parseJson(res)
  const isFailedStatus = payload?.status === 'failed' || payload?.error
  if (res.statusCode < 200 || res.statusCode >= 300 || isFailedStatus) {
    const errorMsg = typeof payload?.error === 'string' ? payload.error : (payload?.error?.message || payload?.message || `Image API HTTP ${res.statusCode}`)
    throw Object.assign(
      new Error(errorMsg),
      { statusCode: res.statusCode >= 300 ? res.statusCode : 400 }
    )
  }
  const images = pickImages(payload)
  if (!images.length) throw Object.assign(new Error('Image API did not return data[].url or data[].b64_json'), { statusCode: 502 })
  return images
}

async function requestWithDeadline(url: string, options: Parameters<typeof request>[1]) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.chatgpt2apiTimeoutMs)
  try {
    return await request(url, { ...options, signal: controller.signal })
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.code === 'UND_ERR_ABORTED') {
      throw Object.assign(new Error(`Image API request timed out after ${Math.round(config.chatgpt2apiTimeoutMs / 1000)}s`), { statusCode: 504 })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function listModels(apiKey: string): Promise<string[]> {
  const res = await requestWithDeadline(`${config.chatgpt2apiBaseUrl}/v1/models`, {
    method: 'GET',
    headers: headersForApiKey(apiKey),
    bodyTimeout: config.chatgpt2apiTimeoutMs,
    headersTimeout: config.chatgpt2apiTimeoutMs,
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
  }
  if (payload.size) body.size = payload.size
  if (payload.quality) body.quality = payload.quality

  const res = await requestWithDeadline(`${config.chatgpt2apiBaseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { ...headersForApiKey(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    bodyTimeout: config.chatgpt2apiTimeoutMs,
    headersTimeout: config.chatgpt2apiTimeoutMs,
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

  const res = await requestWithDeadline(`${config.chatgpt2apiBaseUrl}/v1/images/edits`, {
    method: 'POST',
    headers,
    body,
    bodyTimeout: config.chatgpt2apiTimeoutMs,
    headersTimeout: config.chatgpt2apiTimeoutMs,
  })
  return parseImageResponse(res)
}
