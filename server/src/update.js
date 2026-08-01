import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { kvGet, kvSet } from './db.js'

const REPO = process.env.GITHUB_REPO || 'gnacho/keynest'
const MARKER = '/opt/keynest/.release-id'
const CACHE_KEY = 'gh_latest_release'
const CACHE_TTL = 5 * 60 * 1000

function currentId() {
  try {
    return readFileSync(MARKER, 'utf8').trim()
  } catch {
    return ''
  }
}

async function latestId(prodDb) {
  const cached = kvGet(prodDb, CACHE_KEY)
  if (cached) {
    try {
      const c = JSON.parse(cached)
      if (Date.now() - c.at < CACHE_TTL) return c.id
    } catch { /* noop */ }
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/latest`, {
    headers: { 'User-Agent': 'keynest-updater' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = await res.json()
  const id = String(data.id ?? '')
  kvSet(prodDb, CACHE_KEY, JSON.stringify({ at: Date.now(), id }))
  return id
}

export async function updateStatus(prodDb) {
  const current = currentId()
  const latest = await latestId(prodDb).catch(() => null)
  return { current, latest, available: Boolean(latest && latest !== current) }
}

export function applyUpdate() {
  return new Promise((resolve) => {
    execFile('/usr/local/bin/keynest-update.sh', { env: { ...process.env, SKIP_RESTART: '1' } }, (err) => {
      resolve(!err)
    })
  })
}
