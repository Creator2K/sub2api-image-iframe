import { request } from 'undici'
import FormData from 'form-data'
import type { MultipartFile } from '@fastify/multipart'
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
  style?: string
  n?: number
  response_format?: 'url' | 'b64_json'
}

function headersForApiKey(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

function pickImages(payload: any): ImageResult[] {
  const data = Array.isArray(payload?.data) ? payload.data : []
  return data.map((item: any) => {
    if (item.url) {
      return { imageUrl: item.url, revisedPrompt: item.revised_prompt }
    }
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

async function parseImageResponse(res: Awaited<ReturnType<typeof request>>): Promise<ImageResult[]> {
  const text = await res.body.text()
  let payload: any
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`生图出口返回非 JSON：HTTP ${res.statusCode} ${text.slice(0, 200)}`)
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(payload?.error?.message || payload?.message || `生图出口 HTTP ${res.statusCode}`)
  }
  const images = pickImages(payload)
  if (!images.length) throw new Error('生图出口未返回图片 data[].url 或 data[].b64_json')
  return images
}

export async function generateImage(apiKey: string, payload: GeneratePayload): Promise<ImageResult[]> {
  const body: Record<string, unknown> = {
    model: payload.model || 'gpt-image-2',
    prompt: payload.prompt,
    size: payload.size || '1024x1024',
    n: payload.n || 1,
  }
  if (payload.quality) body.quality = payload.quality
  if (payload.style) body.style = payload.style
  if (payload.response_format) body.response_format = payload.response_format

  const res = await request(`${config.chatgpt2apiBaseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      ...headersForApiKey(apiKey),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    bodyTimeout: config.chatgpt2apiTimeoutMs,
    headersTimeout: config.chatgpt2apiTimeoutMs,
  })
  return parseImageResponse(res)
}

export async function editImage(apiKey: string, fields: Record<string, any>, file: MultipartFile): Promise<ImageResult[]> {
  const form = new FormData()
  form.append('image', file.file, {
    filename: file.filename || 'image.png',
    contentType: file.mimetype || 'image/png',
  })
  form.append('prompt', String(fields.prompt || ''))
  form.append('model', String(fields.model || 'gpt-image-2'))
  form.append('size', String(fields.size || '1024x1024'))
  form.append('n', String(fields.n || 1))
  if (fields.quality) form.append('quality', String(fields.quality))
  if (fields.response_format) form.append('response_format', String(fields.response_format))

  const res = await request(`${config.chatgpt2apiBaseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: {
      ...headersForApiKey(apiKey),
      ...form.getHeaders(),
    },
    body: form as any,
    bodyTimeout: config.chatgpt2apiTimeoutMs,
    headersTimeout: config.chatgpt2apiTimeoutMs,
  })
  return parseImageResponse(res)
}
