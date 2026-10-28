import crypto from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { kvGet, type DB } from './db.js'
import { migrateLegacySecrets } from './secrets-migration.js'

const SECRETS_FILE = 'secrets.env'

function loadSecretsFile(file: string): void {
  if ((statSync(file).mode & 0o777) !== 0o600) throw new Error('External secrets file must have mode 0600')
  const values = Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
  if (!/^[a-f0-9]{64}$/.test(values.ENC_KEY || '') || !/^[a-f0-9]{64}$/.test(values.SESSION_SECRET || '')) {
    throw new Error('External secrets file is invalid')
  }
  process.env.ENC_KEY = values.ENC_KEY
  process.env.SESSION_SECRET = values.SESSION_SECRET
}

function hasEncryptedData(db: DB): boolean {
  const people = db.prepare('SELECT COUNT(*) count FROM people WHERE token_cipher IS NOT NULL').get() as { count: number }
  const tasks = db.prepare('SELECT COUNT(*) count FROM maintenance_tasks WHERE token_cipher IS NOT NULL').get() as { count: number }
  return people.count + tasks.count > 0 || kvGet(db, 'tedee_token') !== undefined
}

export function ensureExternalSecrets(dataDir: string, databases: DB[]): void {
  const file = join(dataDir, SECRETS_FILE)
  if (process.env.ENC_KEY && process.env.SESSION_SECRET) return
  if (existsSync(file)) {
    loadSecretsFile(file)
    return
  }

  const oldEnvEnc = process.env.ENC_KEY
  const oldEnvSession = process.env.SESSION_SECRET
  const partialExternalConfig = Boolean(oldEnvEnc) !== Boolean(oldEnvSession)
  const legacy = databases.map((db) => ({
    db,
    encKey: kvGet(db, 'enc_key') ?? oldEnvEnc,
    sessionSecret: kvGet(db, 'session_secret') ?? oldEnvSession,
    hasLegacyStorage: kvGet(db, 'enc_key') !== undefined || kvGet(db, 'session_secret') !== undefined || partialExternalConfig,
    hasEncryptedData: hasEncryptedData(db),
  }))
  const toMigrate = legacy.filter((entry) => entry.hasLegacyStorage)
  if (toMigrate.length === 0) throw new Error('ENC_KEY and SESSION_SECRET are required')
  for (const entry of toMigrate) {
    if (!entry.encKey && entry.hasEncryptedData) throw new Error('Legacy secret configuration is incomplete')
  }

  const encKey = crypto.randomBytes(32).toString('hex')
  const sessionSecret = crypto.randomBytes(32).toString('hex')
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporary, `ENC_KEY=${encKey}\nSESSION_SECRET=${sessionSecret}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
  chmodSync(file, 0o600)
  process.env.ENC_KEY = encKey
  process.env.SESSION_SECRET = sessionSecret
  for (const entry of toMigrate) migrateLegacySecrets(entry.db, { encKey: entry.encKey, sessionSecret: entry.sessionSecret, revokeCredentials: true })
}
