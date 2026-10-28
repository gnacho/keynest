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

  it('ships no map files when the frontend build exists', () => {
    const assets = join(root, 'app/dist/assets')
    if (!existsSync(assets)) return
    const maps = readdirSync(assets).filter((name) => name.endsWith('.map'))
    expect(maps).toEqual([])
  })
})
