import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../..', import.meta.url).pathname

describe('production build hygiene', () => {
  it('does not enable source maps unconditionally', () => {
    const config = readFileSync(join(root, 'app/vite.config.ts'), 'utf8')
    expect(config).not.toMatch(/sourcemap:\s*true/)
    expect(config).toMatch(/sourcemap:\s*(false|process\.env)/)
  })

  it('limits host metadata to administrators', () => {
    const source = readFileSync(join(root, 'server/src/index.ts'), 'utf8')
    const at = source.indexOf("app.get('/api/system/info'")
    expect(at).toBeGreaterThan(-1)
    const body = source.slice(at, at + 400)
    expect(body).toMatch(/requireAdmin/)
  })

  // Norma de la casa: guion normal en todo lo que lee una persona. Se ignoran
  // los comentarios, que no llegan ni a la UI ni a las notificaciones.
  it('keeps em dashes and en dashes out of user-facing texts', () => {
    const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const ficheros = ['es', 'en'].map((l) => join(root, `app/src/i18n/locales/${l}/translation.json`))
    ficheros.push(join(root, 'server/src/push.ts'))
    for (const f of ficheros) {
      const resto = sinComentarios(readFileSync(f, 'utf8'))
      expect(resto, f).not.toMatch(/[—–]/)
    }
  })

  it('ships no map files when the frontend build exists', () => {
    const assets = join(root, 'app/dist/assets')
    if (!existsSync(assets)) return
    const maps = readdirSync(assets).filter((name) => name.endsWith('.map'))
    expect(maps).toEqual([])
  })
})
