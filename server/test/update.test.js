import { test, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('currentId reads the release marker from RELEASE_MARKER env override', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keynest-marker-'))
  const marker = join(dir, '.release-id')
  writeFileSync(marker, '9.9.9')
  process.env.RELEASE_MARKER = marker
  try {
    const mod = await import('../src/update.js?marker-override')
    expect(mod.currentId()).toBe('9.9.9')
  } finally {
    delete process.env.RELEASE_MARKER
  }
})

test('currentId returns empty when the marker path does not exist', async () => {
  process.env.RELEASE_MARKER = '/nonexistent/does-not-exist/.release-id'
  try {
    const mod = await import('../src/update.js?marker-missing')
    expect(mod.currentId()).toBe('')
  } finally {
    delete process.env.RELEASE_MARKER
  }
})
