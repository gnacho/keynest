// update.js — estado y aplicación de actualizaciones. Detecta la última release
// ESTABLE (releases/latest, tag v*) y, si hay versión nueva, la aplica ejecutando
// keynest-update.sh (deploy/, versionado: releases + checksums + marker semver).
// El server NO se auto-aplica en runtime: el endpoint escribe un flag en el dir
// de datos (escribible) y un systemd .path (keynest-update.path) lo detecta y
// lanza keynest-update.service (root, oneshot) on-demand. El script hace el
// deploy + systemctl restart. El apply es asíncrono: el front sondea
// /api/version hasta que el build cambia.
// Incluye historial de actualizaciones (#153), readiness checks (#155) y
// rollback vía flag (#154).
import { writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statSync, accessSync, constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { kvGet, kvSet } from './db.js'

const REPO = process.env.GITHUB_REPO || 'gnacho/keynest'
const MARKER = process.env.RELEASE_MARKER || '/opt/keynest/.release-id'
const OPT_DIR = process.env.KEYNEST_OPT_DIR || '/opt/keynest'
const CACHE_KEY = 'gh_latest_release'
const CACHE_TTL = 5 * 60 * 1000
const UPDATE_FLAG = '.update-requested'
const ROLLBACK_FLAG = '.rollback-requested'

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
// Devuelve {id, body} para que la UI muestre el changelog del release (#232).
async function latestInfo(prodDb) {
  const cached = kvGet(prodDb, CACHE_KEY)
  if (cached) {
    try {
      const c = JSON.parse(cached)
      if (Date.now() - c.at < CACHE_TTL) return { id: c.id, body: c.body ?? '' }
    } catch { /* noop */ }
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'keynest-updater', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = await res.json()
  const id = String(data.tag_name ?? '').replace(/^v/, '')
  const body = typeof data.body === 'string' ? data.body : ''
  kvSet(prodDb, CACHE_KEY, JSON.stringify({ at: Date.now(), id, body }))
  return { id, body }
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

export async function updateStatus(prodDb, dataDir) {
  const current = currentId()
  const latest = await latestInfo(prodDb).catch(() => null)
  const available = Boolean(latest && current && compareSemver(latest.id, current) > 0)
  const readiness = await readinessChecks(prodDb, dataDir, latest?.id ?? null)
  return { current, latest: latest?.id ?? null, available, notes: latest?.body ?? '', readiness }
}

// Progreso del apply (#232): keynest-update.sh escribe update-progress.json
// {step,pct,ts} en el data dir en cada STEP. Solo se considera vivo si el ts
// es reciente (15 min); un fichero viejo de una corrida muerta no se reporta.
const PROGRESS_TTL = 15 * 60 * 1000
const PROGRESS_FILE = 'update-progress.json'

export function updateProgress(dataDir) {
  try {
    const raw = readFileSync(join(dataDir, PROGRESS_FILE), 'utf8')
    const p = JSON.parse(raw)
    if (!p.ts || Date.now() - p.ts > PROGRESS_TTL) return null
    return { step: String(p.step ?? ''), pct: Number(p.pct) || 0, ts: p.ts }
  } catch {
    return null
  }
}

// Readiness checks pre-apply (#155): espacio en disco, permisos de escritura,
// update concurrente en curso y asset de la release alcanzable. Cada check
// devuelve { ok, detail } para mostrarse en la UI antes de habilitar el botón.
export async function readinessChecks(prodDb, dataDir, latest) {
  const results = {
    disk: { ok: true, detail: '' },
    writable: { ok: true, detail: '' },
    concurrent: { ok: true, detail: '' },
    asset: { ok: true, detail: '' },
  }
  // Disco: 200 MB libres son ~6 tarballs; el apply necesita descarga + backups.
  try {
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync('df', ['-B1', OPT_DIR], { encoding: 'utf8', timeout: 5000 })
    const line = out.trim().split('\n').pop() || ''
    const parts = line.split(/\s+/).filter(Boolean)
    const free = parts.length >= 4 ? Number(parts[3]) : NaN
    if (Number.isFinite(free) && free > 0) {
      const MB = 1024 * 1024
      if (free < 200 * MB) {
        results.disk = { ok: false, detail: `solo ${Math.round(free / MB)} MB libres en ${OPT_DIR}` }
      } else {
        results.disk = { ok: true, detail: `${Math.round(free / MB)} MB libres en ${OPT_DIR}` }
      }
    }
  } catch {
    results.disk = { ok: true, detail: 'disco no comprobable' }
  }
  // Escritura: el apply escribe el flag en dataDir; verificar que existe y es escribible.
  try {
    const probe = join(dataDir, '.update-write-probe')
    writeFileSync(probe, 'ok')
    accessSync(probe, constants.W_OK)
    results.writable = { ok: true, detail: 'directorio de datos escribible' }
  } catch {
    results.writable = { ok: false, detail: 'no se puede escribir en el directorio de datos' }
  }
  // Concurrente: hay un flag de update/rollback pendiente o un apply en curso.
  try {
    const flag = [join(dataDir, UPDATE_FLAG), join(dataDir, ROLLBACK_FLAG)].find((f) => {
      try { statSync(f); return true } catch { return false }
    })
    if (flag) {
      results.concurrent = { ok: false, detail: 'hay una actualización o rollback en curso' }
    } else {
      results.concurrent = { ok: true, detail: 'sin actualización en curso' }
    }
  } catch {
    results.concurrent = { ok: true, detail: 'estado no comprobable' }
  }
  // Asset: HEAD a la release si hay versión disponible.
  if (latest) {
    try {
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
      const base = `https://github.com/${REPO}/releases/download/v${latest}`
      const res = await fetch(`${base}/keynest_${latest}_linux_${arch}.tar.gz`, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      })
      results.asset = res.ok
        ? { ok: true, detail: `asset ${arch} alcanzable (${res.status})` }
        : { ok: false, detail: `asset ${arch} responde ${res.status}` }
    } catch {
      results.asset = { ok: false, detail: 'no se pudo comprobar el asset de la release' }
    }
  }
  return results
}

// Rollback (#154): registra la entrada y escribe el flag que el .path de systemd
// detecta para lanzar keynest-update.service (que restaura el backup). Devuelve
// true si el flag se escribió.
export function requestRollback(prodDb, userId, dataDir) {
  const cur = currentId()
  recordUpdate(prodDb, userId, cur, cur, Date.now())
  try {
    const flag = join(dataDir, ROLLBACK_FLAG)
    writeFileSync(flag, new Date().toISOString())
    return true
  } catch {
    return false
  }
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
