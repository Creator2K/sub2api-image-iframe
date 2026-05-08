import fs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { config } from './config.js'

export interface ImageHistoryItem {
  id: string
  userId: string
  prompt: string
  model?: string
  endpoint: 'generations' | 'edits'
  imageUrl: string
  proxiedUrl?: string
  mimeType?: string
  revisedPrompt?: string
  createdAt: string
}

function safeUserId(userId: string): string {
  return String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function userDir(userId: string): string {
  return path.join(config.dataDir, 'users', safeUserId(userId))
}

function historyPath(userId: string): string {
  return path.join(userDir(userId), 'history.json')
}

export async function ensureDataDirs() {
  await fs.mkdir(path.join(config.dataDir, 'users'), { recursive: true })
  await fs.mkdir(path.join(config.dataDir, 'tmp'), { recursive: true })
}

export async function readHistory(userId: string): Promise<ImageHistoryItem[]> {
  try {
    const raw = await fs.readFile(historyPath(userId), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function addHistory(userId: string, items: Omit<ImageHistoryItem, 'id' | 'userId' | 'createdAt'>[], limit = 30): Promise<ImageHistoryItem[]> {
  const dir = userDir(userId)
  await fs.mkdir(dir, { recursive: true })
  const existing = await readHistory(userId)
  const now = new Date().toISOString()
  const created = items.map((item) => ({ ...item, id: nanoid(12), userId: String(userId), createdAt: now }))
  const next = [...created, ...existing].slice(0, limit)
  await fs.writeFile(historyPath(userId), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function publicHistoryUrl(userId: string, itemId: string): string {
  return `${config.publicBaseUrl}/api/history/${encodeURIComponent(userId)}/${encodeURIComponent(itemId)}/image`
}
