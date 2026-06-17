import { request } from 'undici'
import { config } from './config.js'

export interface Sub2User {
  id: number
  email?: string
  username?: string
  role?: string
  balance?: number
  status?: string
}

export interface Sub2Group {
  id: number
  name: string
  platform: string
  status: string
  subscription_type?: string
  allow_image_generation?: boolean
  is_exclusive?: boolean
}

export interface Sub2ApiKey {
  id: number
  user_id: number
  key: string
  name: string
  group_id: number | null
  status: string
  group?: Sub2Group
}

async function parseJsonResponse<T>(res: Awaited<ReturnType<typeof request>>): Promise<T> {
  const text = await res.body.text()
  let payload: any
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Invalid JSON from Sub2API: HTTP ${res.statusCode} ${text.slice(0, 200)}`)
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(payload?.message || payload?.error || `Sub2API HTTP ${res.statusCode}`)
  }
  if (payload && typeof payload === 'object' && 'code' in payload) {
    if (payload.code !== 0) throw new Error(payload.message || `Sub2API code ${payload.code}`)
    return payload.data as T
  }
  return payload as T
}

async function sub2Request(path: string, options: Parameters<typeof request>[1]) {
  return request(`${config.sub2apiBaseUrl}${path}`, {
    bodyTimeout: config.requestTimeoutMs,
    headersTimeout: config.requestTimeoutMs,
    ...options,
  })
}

export async function sub2UserByJwt(userId: string, jwt: string): Promise<Sub2User> {
  const res = await sub2Request('/api/v1/user/profile', {
    method: 'GET',
    headers: { Authorization: `Bearer ${jwt}` },
  })
  const user = await parseJsonResponse<Sub2User>(res)
  if (String(user.id) !== String(userId)) {
    throw new Error('iframe user_id 与 token 不匹配')
  }
  return user
}

async function userGet<T>(jwt: string, path: string): Promise<T> {
  const res = await sub2Request(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${jwt}` },
  })
  return parseJsonResponse<T>(res)
}

async function userJson<T>(jwt: string, method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await sub2Request(path, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return parseJsonResponse<T>(res)
}

function unwrapItems<T>(data: any): T[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

export async function getAvailableImageGroups(jwt: string): Promise<Sub2Group[]> {
  const groups = await userGet<Sub2Group[]>(jwt, '/api/v1/groups/available')
  return groups.filter((g) => g.platform === 'openai' && g.status === 'active' && g.allow_image_generation !== false)
}

export async function listUserApiKeys(jwt: string): Promise<Sub2ApiKey[]> {
  const list = await userGet<any>(jwt, '/api/v1/keys?page=1&page_size=100')
  return unwrapItems<Sub2ApiKey>(list).filter((k) => k.status === 'active')
}

export async function getUserApiKeyById(jwt: string, userId: string, keyId: number): Promise<Sub2ApiKey> {
  const keys = await listUserApiKeys(jwt)
  const key = keys.find((k) => k.id === keyId && String(k.user_id) === String(userId))
  if (!key) throw new Error('未找到当前用户的可用 API Key')
  return key
}

export async function ensureUserImageApiKey(jwt: string, userId: string): Promise<{ apiKey: Sub2ApiKey; group: Sub2Group; created: boolean }> {
  const userGroups = await getAvailableImageGroups(jwt)
  const group = userGroups.find((g) => Number(g.id) === config.imageGroupId)

  if (!group) {
    throw new Error(`当前用户没有可用的 OpenAI 生图分组。请确认 group_id=${config.imageGroupId} 的分组已启用，并且该用户可见或拥有对应订阅。`)
  }

  const keys = await listUserApiKeys(jwt)
  const existing = keys.find((k) => k.group_id === group.id)
  if (existing) return { apiKey: existing, group, created: false }

  if (!config.autoCreateKey) {
    throw new Error('当前用户没有该生图分组下的可用 API Key，请先在 Sub2API 创建或启用 SUB2API_AUTO_CREATE_KEY。')
  }

  const created = await userJson<Sub2ApiKey>(jwt, 'POST', '/api/v1/keys', {
    name: config.imageKeyName,
    group_id: group.id,
  })
  return { apiKey: created, group, created: true }
}


export async function createUserApiKeyForGroup(jwt: string, groupId: number, name?: string): Promise<Sub2ApiKey> {
  return userJson<Sub2ApiKey>(jwt, 'POST', '/api/v1/keys', {
    name: name || config.imageKeyName,
    group_id: groupId,
  })
}
