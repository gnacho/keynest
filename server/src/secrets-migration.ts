import crypto from 'node:crypto'
import { decryptSecret, encryptSecret, kvGet, type DB } from './db.js'

function decryptLegacySecret(ciphertext: string, secret: string): string {
  if (secret.length < 32) throw new Error('legacy ENC_KEY is invalid')
  if (!ciphertext.startsWith('gcm:')) return ciphertext
  const key = Buffer.from(secret.padEnd(64, secret).slice(0, 64), 'hex')
  const [, iv, tag, data] = ciphertext.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8')
}

export function migrateLegacySecrets(db: DB, legacy?: { encKey?: string; sessionSecret?: string; revokeCredentials?: boolean }): boolean {
  const legacyEncKey = legacy?.encKey ?? kvGet(db, 'enc_key')
  const legacySessionSecret = legacy?.sessionSecret ?? kvGet(db, 'session_secret')
  if (legacyEncKey === undefined && legacySessionSecret === undefined && !legacy?.revokeCredentials) return false
  if (!process.env.ENC_KEY || process.env.ENC_KEY.length < 32) throw new Error('ENC_KEY is required')
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET is required')
  const rotateSecret = (ciphertext: string): string => {
    if (!ciphertext.startsWith('gcm:')) return encryptSecret(db, ciphertext)
    try {
      decryptSecret(db, ciphertext)
      return ciphertext
    } catch {
      if (!legacyEncKey) throw new Error('legacy ENC_KEY is required to rotate ciphertext')
      return encryptSecret(db, decryptLegacySecret(ciphertext, legacyEncKey))
    }
  }

  db.transaction(() => {
    if (legacyEncKey !== undefined) {
      const people = db.prepare('SELECT id, token_cipher FROM people WHERE token_cipher IS NOT NULL').all() as Array<{ id: string; token_cipher: string }>
      const updatePerson = db.prepare('UPDATE people SET token_cipher = ? WHERE id = ?')
      for (const row of people) updatePerson.run(rotateSecret(row.token_cipher), row.id)

      const tasks = db.prepare('SELECT id, token_cipher FROM maintenance_tasks WHERE token_cipher IS NOT NULL').all() as Array<{ id: string; token_cipher: string }>
      const updateTask = db.prepare('UPDATE maintenance_tasks SET token_cipher = ? WHERE id = ?')
      for (const row of tasks) updateTask.run(rotateSecret(row.token_cipher), row.id)

      const tedeeCipher = kvGet(db, 'tedee_token')
      if (tedeeCipher) {
        db.prepare('UPDATE kv SET value = ? WHERE key = ?').run(rotateSecret(tedeeCipher), 'tedee_token')
      }
      db.prepare('DELETE FROM kv WHERE key = ?').run('enc_key')
    }
    if (legacySessionSecret !== undefined) db.prepare('DELETE FROM kv WHERE key = ?').run('session_secret')
    db.prepare('DELETE FROM sessions').run()
    db.prepare('DELETE FROM login_tokens').run()
  })()
  return true
}
