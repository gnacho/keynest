import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const installer = readFileSync(new URL('../../install.sh', import.meta.url), 'utf8')

describe('fresh install secrets', () => {
  it('generates independent external encryption and session keys', () => {
    expect(installer).toMatch(/SESSION_SECRET=\$\(head -c 32 \/dev\/urandom/)
    expect(installer).toMatch(/ENC_KEY=\$\(head -c 32 \/dev\/urandom/)
    expect(installer).toMatch(/^SESSION_SECRET=\$SESSION_SECRET$/m)
    expect(installer).toMatch(/^ENC_KEY=\$ENC_KEY$/m)
    expect(installer).toContain('chmod 0600 "$ENV_FILE"')
  })
})
