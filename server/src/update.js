// update.js — estado y aplicación de actualizaciones. Detecta la última release
// ESTABLE (releases/latest, tag v*) y, si hay versión nueva, la aplica ejecutando
// keynest-update.sh (deploy/, versionado: releases + checksums + marker semver).
// El server NO se auto-aplica en runtime: el endpoint escribe un flag en el dir
// de datos (escribible) y un systemd .path (keynest-update.path) lo detecta y
// lanza keynest-update.service (root, oneshot) on-demand. El script hace el
// deploy + systemctl restart. El apply es asíncrono: el front sondea
// /api/version hasta que el build cambia.
// Incluye historial de actualizaciones (#153).
import { writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { kvGet, kvSet } from './db.js'

const REPO = process.env.GITHUB_REPO || 'gnacho/keynest'
const MARKER = '/opt/keynest/.release-id'
const CACHE_KEY = 'gh_latest_release'
const CACHE_TTL = 5 * 60 * 1000

// Versión semver instalada (marker lo escribe keynest-update.sh tras cada deploy).
export function currentId() {
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

// Registra una entrada en update_history antes de ejecutar el apply.
// Se escribe ANTES de lanzar el script para que quede constancia aunque
// el proceso muera durante el deploy.
function recordUpdate(db, userId, fromVer, toVer, startTime) {
  try {
    db.prepare(`INSERT INTO update_history
      (event_id, timestamp, action, channel, version_from, version_to, initiated_by, status, duration_ms)
      VALUES (?, ?, 'update', 'stable', ?, ?, ?, 'started', 0)`)
      .run(randomUUID(), Date.now(), fromVer, toVer, userId)
  } catch { /* si la tabla no existe aún, no bloquear el apply */ }
}

// GET /api/updates/history — últimas 30 entradas.
export function getUpdateHistory(db) {
  try {
    return db.prepare('SELECT * FROM update_history ORDER BY timestamp DESC LIMIT 30').all()
  } catch { return [] }
}

// consumePendingUpdate — si hay un apply pendiente (status='started') y la
// versión actual ya cambió, lo marca como 'applied' y devuelve los datos
// para mostrar un toast de confirmación. Si la versión NO cambió (falló),
// actualiza a 'failed' y devuelve null.
export function consumePendingUpdate(db) {
  try {
    const pending = db.prepare(
      "SELECT * FROM update_history WHERE status = 'started' AND action = 'update' ORDER BY timestamp DESC LIMIT 1"
    ).get()
    if (!pending) return null
    const cur = currentId()
    if (cur && cur !== pending.version_from) {
      db.prepare("UPDATE update_history SET status = 'applied' WHERE event_id = ?").run(pending.event_id)
      return { from: pending.version_from, to: cur }
    }
    // No cambió: marcar como failed
    db.prepare("UPDATE update_history SET status = 'failed' WHERE event_id = ?").run(pending.event_id)
    return null
  } catch { return null }
}

// El endpoint de apply NO ejecuta el script directamente (el servicio va
// sandboxeado: User=keynest + ProtectSystem=full + no-root, así que un hijo
// hereda el sandbox y no puede escribir /opt/keynest ni systemctl restart).
// En su lugar registra el intento en update_history y escribe un flag en el
// dir de datos (escribible); un systemd .path (keynest-update.path) lo detecta
// y lanza keynest-update.service (root, oneshot) on-demand. Tras el deploy, el
// server reinicia y consumePendingUpdate() (en /api/version) marca el registro
// como 'applied' cuando el marker cambia. Devuelve true si el flag se escribió.
export function requestUpdate(prodDb, userId, dataDir) {
  recordUpdate(prodDb, userId, currentId(), 'pending', Date.now())
  const flag = join(dataDir, '.update-requested')
  try {
    writeFileSync(flag, new Date().toISOString())
    return true
  } catch {
    return false
  }
}
