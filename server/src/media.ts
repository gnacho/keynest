import crypto from 'node:crypto'
import { lstatSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import type { Context, Hono } from 'hono'
import type { AppEnv } from './auth.js'
import { currentUser, sessionFromCookie } from './auth.js'
import type { DB } from './db.js'

/**
 * Entrega autenticada de fotos y avatares.
 *
 * Los ficheros subidos viven en <dataDir>/photos y <dataDir>/avatars, ya con
 * permisos 0700. Aquí se cierra el acceso HTTP: solo se sirven con sesión
 * válida o con una firma HMAC de corta vida ligada a la ruta exacta. Las
 * páginas públicas de proveedor y limpieza reciben URLs firmadas en su JSON,
 * así siguen viendo sus fotos sin exponer el resto del directorio.
 */

const MEDIA_DIRS = ['photos', 'avatars'] as const
type MediaDir = (typeof MEDIA_DIRS)[number]

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export interface SignOptions {
  ttlMs?: number
  now?: number
}

export interface ResolvedMedia {
  file: string
  contentType: string
}

function mediaSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is required')
  return secret
}

function signatureFor(path: string, exp: number): string {
  return crypto.createHmac('sha256', mediaSecret()).update(`${path}\n${exp}`).digest('base64url')
}

/** Añade `exp` y `sig` a una ruta canónica `/photos/...` o `/avatars/...`. */
export function signMediaPath(path: string, options: SignOptions = {}): string {
  const now = options.now ?? Date.now()
  const exp = now + (options.ttlMs ?? DEFAULT_TTL_MS)
  return `${path}?exp=${exp}&sig=${signatureFor(path, exp)}`
}

/** Valida que la firma corresponde a esa ruta exacta y que no ha caducado. */
export function verifyMediaSignature(path: string, exp: unknown, sig: unknown, now = Date.now()): boolean {
  if (typeof exp !== 'string' || !/^\d{1,16}$/.test(exp)) return false
  if (typeof sig !== 'string' || sig.length === 0) return false
  const expiresAt = Number(exp)
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now) return false
  const expected = signatureFor(path, expiresAt)
  const provided = Buffer.from(sig)
  const wanted = Buffer.from(expected)
  if (provided.length !== wanted.length) return false
  return crypto.timingSafeEqual(provided, wanted)
}

const MEDIA_KEYS = new Set(['photo', 'photos', 'avatar'])

function isMediaPath(value: string): boolean {
  return (value.startsWith('/photos/') || value.startsWith('/avatars/')) && !value.includes('?exp=')
}

/** Firma las rutas de medios (`photo`, `photos`, `avatar`) de una carga JSON pública.
 *  Si `photos` llega como string JSON (formato interno de la BD), se devuelve como
 *  array de rutas firmadas: los dos frontends aceptan ambas formas (`parseJson`),
 *  pero un cliente externo que hiciera `JSON.parse(photos)` debe contar con ello. */
export function signMediaPayload<T>(value: T, options: SignOptions = {}): T {
  if (Array.isArray(value)) {
    return value.map((item) => signMediaPayload(item, options)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (MEDIA_KEYS.has(key)) output[key] = signMediaValue(item, options)
      else output[key] = signMediaPayload(item, options)
    }
    return output as unknown as T
  }
  return value
}

function signMediaValue(value: unknown, options: SignOptions): unknown {
  if (typeof value === 'string') {
    if (isMediaPath(value)) return signMediaPath(value, options)
    if (value.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(value)
        if (Array.isArray(parsed)) return parsed.map((item) => signMediaValue(item, options))
      } catch {
        return value
      }
    }
    return value
  }
  if (Array.isArray(value)) return value.map((item) => signMediaValue(item, options))
  return value
}

interface MediaTarget {
  dirName: MediaDir
  filename: string
  contentType: string
}

/** Valida la forma de la ruta sin tocar el disco (evita oráculos de existencia). */
export function parseMediaPath(urlPath: string): MediaTarget | null {
  const match = /^\/(photos|avatars)\/([^/\\\0]+)$/.exec(urlPath)
  if (!match) return null
  const dirName = match[1] as MediaDir
  const filename = match[2]
  if (filename !== basename(filename) || filename.includes('..') || filename.startsWith('.')) return null
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  const contentType = CONTENT_TYPES[extension]
  if (!contentType) return null
  return { dirName, filename, contentType }
}

/** Traduce una ruta HTTP a un fichero real dentro del data dir, o null. */
export function resolveMediaFile(dataDir: string, urlPath: string): ResolvedMedia | null {
  const target = parseMediaPath(urlPath)
  if (!target) return null
  const root = resolve(dataDir, target.dirName)
  const file = resolve(root, target.filename)
  if (!file.startsWith(root + sep)) return null
  try {
    const rootStat = lstatSync(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null
    if (!lstatSync(file).isFile()) return null
  } catch {
    return null
  }
  return { file, contentType: target.contentType }
}

/** Avisa al arrancar si una raíz de medios no es un directorio normal. */
function warnUnsafeRoots(dataDir: string): void {
  for (const dirName of MEDIA_DIRS) {
    const root = resolve(dataDir, dirName)
    try {
      const stat = lstatSync(root)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        console.warn(`[media] ${root} no es un directorio normal: las imágenes de ${dirName} no se servirán`)
      }
    } catch {
      // Todavía no existe: se crea al subir el primer fichero.
    }
  }
}

export interface MediaRouteOptions {
  dataDir: string
  prodDb: DB
  demoDb: DB
}

const PHOTO_CACHE = 'private, max-age=86400'
const AVATAR_CACHE = 'private, no-cache'

/** Registra la entrega de `/photos/:file` y `/avatars/:file`. */
export function registerMediaRoutes(app: Hono<AppEnv>, options: MediaRouteOptions): void {
  warnUnsafeRoots(options.dataDir)
  const handler = async (c: Context<AppEnv>) => {
    const urlPath = c.req.path
    if (!parseMediaPath(urlPath)) return c.text('no encontrado', 404)

    // Autorizar antes de mirar el disco: un anónimo recibe 401 exista o no el
    // fichero, así que la ruta no sirve para enumerar nombres.
    const session = sessionFromCookie(options.prodDb, c)
    const user = session ? currentUser(options.prodDb, options.demoDb, c, session) : null
    const signed = verifyMediaSignature(urlPath, c.req.query('exp'), c.req.query('sig'))
    // La sesión demo se emite sin credenciales, así que no autoriza medios del
    // tenant real: sus páginas usan URLs firmadas como cualquier enlace público.
    if (!signed && (!user || user.is_demo)) return c.text('no autorizado', 401)

    const resolved = resolveMediaFile(options.dataDir, urlPath)
    if (!resolved) return c.text('no encontrado', 404)

    const body = await readFile(resolved.file).catch(() => null)
    if (!body) return c.text('no encontrado', 404)
    c.header('Content-Type', resolved.contentType)
    c.header('X-Content-Type-Options', 'nosniff')
    // Las fotos se guardan con nombre único (uuid + marca de tiempo); los
    // avatares conservan el nombre al re-subirse, así que se revalidan siempre.
    c.header('Cache-Control', urlPath.startsWith('/avatars/') ? AVATAR_CACHE : PHOTO_CACHE)
    return c.body(body)
  }

  app.get('/photos/:file', handler)
  app.get('/avatars/:file', handler)
  app.all('/photos/*', (c) => c.text('no encontrado', 404))
  app.all('/avatars/*', (c) => c.text('no encontrado', 404))
}
