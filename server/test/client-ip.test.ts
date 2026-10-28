import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from 'hono'
import type { AppEnv } from '../src/auth.js'
import { clientIp } from '../src/auth.js'

const originalTrustProxy = process.env.TRUST_PROXY

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY
  else process.env.TRUST_PROXY = originalTrustProxy
})

function ctx(remoteAddress: string | undefined, xff?: string): Context<AppEnv> {
  return {
    req: {
      raw: { socket: { remoteAddress } },
      header: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? xff : undefined),
    },
  } as unknown as Context<AppEnv>
}

describe('client IP resolution', () => {
  it('ignores forwarded headers when no proxy is trusted', () => {
    delete process.env.TRUST_PROXY
    expect(clientIp(ctx('203.0.113.10', '198.51.100.99'))).toBe('203.0.113.10')
  })

  it('ignores forwarded headers from loopback when no proxy is trusted', () => {
    process.env.TRUST_PROXY = 'false'
    expect(clientIp(ctx('127.0.0.1', '198.51.100.99'))).toBe('127.0.0.1')
  })

  it('falls back to unknown instead of a spoofable header when there is no socket', () => {
    process.env.TRUST_PROXY = 'false'
    expect(clientIp(ctx(undefined, '198.51.100.99'))).toBe('unknown')
  })

  it('uses the hop appended by the trusted proxy', () => {
    process.env.TRUST_PROXY = 'true'
    expect(clientIp(ctx('127.0.0.1', '198.51.100.1, 203.0.113.7'))).toBe('203.0.113.7')
  })

  it('uses the socket address behind a trusted proxy without forwarded headers', () => {
    process.env.TRUST_PROXY = 'true'
    expect(clientIp(ctx('203.0.113.10'))).toBe('203.0.113.10')
  })

  it('rejects a forwarded hop that is not an IP address', () => {
    process.env.TRUST_PROXY = 'true'
    for (const spoofed of ['local', '"203.0.113.7"', '203.0.113.7\r\nX-Evil: 1', '', ' ', 'unknown']) {
      expect(clientIp(ctx('127.0.0.1', `${spoofed}, local`)), spoofed).toBe('127.0.0.1')
    }
  })

  it('normalizes the socket address discarded by the proxy layer', () => {
    process.env.TRUST_PROXY = 'false'
    expect(clientIp(ctx(' 203.0.113.10 '))).toBe('203.0.113.10')
    expect(clientIp(ctx('203.0.113.10:51234'))).toBe('203.0.113.10')
    expect(clientIp(ctx('[2001:db8::1]:443'))).toBe('2001:db8::1')
    expect(clientIp(ctx('2001:db8::1'))).toBe('2001:db8::1')
    expect(clientIp(ctx('   '))).toBe('unknown')
  })
})
