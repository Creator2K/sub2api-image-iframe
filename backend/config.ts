import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'

const envFile = process.env.IMAGE_APP_ENV_FILE || path.resolve(process.cwd(), '.env')
if (fs.existsSync(envFile)) dotenv.config({ path: envFile })
else dotenv.config()

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
}

function cleanBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

export const config = {
  host: process.env.IMAGE_APP_HOST || '0.0.0.0',
  port: num('IMAGE_APP_PORT', 8787),
  publicBaseUrl: cleanBaseUrl(process.env.IMAGE_APP_PUBLIC_BASE_URL || `http://localhost:${num('IMAGE_APP_PORT', 8787)}`),
  dataDir: path.resolve(process.cwd(), process.env.IMAGE_APP_DATA_DIR || './data'),
  corsOrigins: (process.env.IMAGE_APP_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  sub2apiBaseUrl: cleanBaseUrl(process.env.SUB2API_BASE_URL || 'http://localhost:8080'),
  imageGroupName: process.env.SUB2API_IMAGE_GROUP_NAME || 'OpenAI生图',
  imageGroupId: num('SUB2API_IMAGE_GROUP_ID', 3),
  imageKeyName: process.env.SUB2API_IMAGE_KEY_NAME || 'OpenAI生图',
  autoCreateKey: bool('SUB2API_AUTO_CREATE_KEY', true),

  requestTimeoutMs: num('IMAGE_APP_REQUEST_TIMEOUT_MS', 180000),
}
