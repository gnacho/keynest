import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { kvGet, kvSet } from './db.js'

const REPO = process.env.GITHUB_REPO || 'gnacho/keynest'
const MARKER = '/opt/keynest/.release-id'
const UPDATE_SCRIPT = process.env.UPDATE_SCRIPT || '/opt/keynest/keynest-update.sh'
const CACHE_KEY = 'gh_latest_release'
const CACHE_TTL = 5 * 60 * 1000

// Versión semver instalada (marker lo escribe keynest-update.sh tras cada deploy).
function currentId() {
  try {
    return readFileSync(MARKER, 'utf8').trim()
  } catch {
    return ''
  }
}

// Última release ESTABLE (releases/latest, tag v*), no la prerelease "latest" de main.
// Caché en kv con TTL 5 min para no pegar a la API de GitHub en cada llamada.
async function latestId(prodDb) {
  const cached = kvGet(prodDb, CACHE_KEY)
  if (cached) {
    try {
      const c = JSON.parse(cached)
      if (Date.now() - c.at < CACHE_TTL) return c.id
    } catch { /* noop */ }
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'keynest-updater', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = await res.json()
  const id = String(data.tag_name ?? '').replace(/^v/, '')
  kvSet(prodDb, CACHE_KEY, JSON.stringify({ at: Date.now(), id }))
  return id
}

// Comparación semver numérica: '1.10.0' > '1.9.0'; prefijos 'v' y pre-release ignorados.
function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

export async function updateStatus(prodDb) {
  const current = currentId()
  const latest = await latestId(prodDb).catch(() => null)
  const available = Boolean(latest && current && compareSemver(latest, current) > 0)
  return { current, latest, available }
}

export function applyUpdate() {
  return new Promise((resolve) => {
    // El script del repo (deploy/keynest-update.sh) hace el deploy con checksums;
    // SKIP_RESTART=1: el server sale y systemd (Restart=always) relanza con lo nuevo.
    execFile(UPDATE_SCRIPT, { env: { ...process.env, SKIP_RESTART: '1' } }, (err) => {
      resolve(!err)
    })
  })
}
