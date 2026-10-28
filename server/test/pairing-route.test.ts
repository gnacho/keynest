import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

/** Extrae el cuerpo de una ruta para inspeccionarlo sin arrancar la app. */
function routeBody(needle: string): string {
  const at = source.indexOf(needle)
  if (at < 0) throw new Error(`route not found: ${needle}`)
  return source.slice(at, at + 1400)
}

describe('airbnb session upload', () => {
  it('applies a rate limit before checking the pairing code', () => {
    const body = routeBody("app.post('/api/airbnb/session'")
    const limitAt = body.indexOf('rateLimitAction')
    const codeAt = body.indexOf('pairingVigente')
    expect(limitAt).toBeGreaterThan(-1)
    expect(codeAt).toBeGreaterThan(-1)
    expect(limitAt).toBeLessThan(codeAt)
    expect(body).toMatch(/429/)
  })

  it('uses a dedicated bucket for the pairing attempts', () => {
    const body = routeBody("app.post('/api/airbnb/session'")
    expect(body).toMatch(/rateLimitAction\(prodDb, 'airbnb:pairing'/)
  })
})
