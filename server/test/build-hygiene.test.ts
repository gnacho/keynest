import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
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

  // Norma de la casa: guion normal en todo lo que escribimos, tambien en
  // comentarios y documentacion. El patron va con escapes para que este propio
  // test no contenga los caracteres que prohibe.
  it('keeps em dashes and en dashes out of every source file, comments included', () => {
    const extensiones = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.sh', '.css', '.html', '.yml', '.yaml', '.txt'])
    const dirsOmitidos = new Set(['node_modules', 'dist', '.git', 'coverage', 'assets', 'build'])
    const ficherosOmitidos = new Set(['package-lock.json'])
    const revisados: string[] = []
    const pendientes = [root]
    while (pendientes.length > 0) {
      const dir = pendientes.pop()!
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        if (dirsOmitidos.has(entrada.name)) continue
        const ruta = join(dir, entrada.name)
        if (entrada.isDirectory()) pendientes.push(ruta)
        else if (extensiones.has(extname(entrada.name)) && !ficherosOmitidos.has(entrada.name)) revisados.push(ruta)
      }
    }
    expect(revisados.length).toBeGreaterThan(50)
    for (const f of revisados) {
      const contenido = readFileSync(f, 'utf8')
      expect(contenido.includes('\u2014') || contenido.includes('\u2013'), f).toBe(false)
    }
  })

  it('ships no map files when the frontend build exists', () => {
    const assets = join(root, 'app/dist/assets')
    if (!existsSync(assets)) return
    const maps = readdirSync(assets).filter((name) => name.endsWith('.map'))
    expect(maps).toEqual([])
  })
})
