import fs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { config } from './config.js'

const HISTORY_TTL_MS = 24 * 60 * 60 * 1000

export interface ImageHistoryItem {
  id: string
  userId: string
  prompt: string
  model?: string
  endpoint: 'generations' | 'edits'
  imageUrl: string
  proxiedUrl?: string
  accessToken?: string
  mimeType?: string
  revisedPrompt?: string
  createdAt: string
}

export function safeUserId(userId: string): string {
  return String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function userDir(userId: string): string {
  return path.join(config.dataDir, 'users', safeUserId(userId))
}

function historyPath(userId: string): string {
  return path.join(userDir(userId), 'history.json')
}

function isHistoryItemFresh(item: ImageHistoryItem, now = Date.now()): boolean {
  const createdAt = Date.parse(item.createdAt)
  return Number.isFinite(createdAt) && now - createdAt < HISTORY_TTL_MS
}

function pruneHistory(items: ImageHistoryItem[], now = Date.now()): ImageHistoryItem[] {
  return items.filter((item) => isHistoryItemFresh(item, now))
}

export async function listHistoryUserIds(): Promise<string[]> {
  try {
    const root = path.join(config.dataDir, 'users')
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function ensureDataDirs() {
  await fs.mkdir(path.join(config.dataDir, 'users'), { recursive: true })
  await fs.mkdir(path.join(config.dataDir, 'tmp'), { recursive: true })
}

export async function readHistory(userId: string): Promise<ImageHistoryItem[]> {
  try {
    const file = historyPath(userId)
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : []
    const fresh = pruneHistory(items)
    if (fresh.length !== items.length) {
      await fs.writeFile(file, JSON.stringify(fresh, null, 2), 'utf8')
    }
    return fresh
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
  const created = items.map((item) => ({ ...item, id: nanoid(12), userId: String(userId), accessToken: nanoid(24), createdAt: now }))
  const next = pruneHistory([...created, ...existing]).slice(0, limit)
  await fs.writeFile(historyPath(userId), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function publicHistoryUrl(userId: string, itemId: string, accessToken?: string): string {
  const base = `${config.publicBaseUrl}/api/history/${encodeURIComponent(userId)}/${encodeURIComponent(itemId)}/image`
  return accessToken ? `${base}?access_token=${encodeURIComponent(accessToken)}` : base
}
