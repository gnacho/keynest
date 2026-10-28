import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { Agent } from 'node:https'
import { describe, expect, it } from 'vitest'
import { createPublicLookup, fetchPublicText, isPublicIp, setAgentRequestDeadline, type PublicRequest, type PublicResolver } from '../src/outbound.js'

describe('outbound destination policy', () => {
  it('accepts only globally routable IP addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '192.0.3.1', '198.51.101.1', '203.0.114.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
      expect(isPublicIp(ip), ip).toBe(true)
    }
    for (const ip of [
      '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
      '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
      '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
      '::', '::1', '::ffff:8.8.8.8', '64:ff9b::1', 'fd00::1', 'fe80::1',
      'ff02::1', '2001::1', '2001:db8::1', '2002::1', 'not-an-ip',
    ]) {
      expect(isPublicIp(ip), ip).toBe(false)
    }
  })

  it('rejects the whole DNS answer when any address is private', async () => {
    const resolver: PublicResolver = (_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])
    }
    const lookup = createPublicLookup(resolver)

    const error = await new Promise<Error | null>((resolve) => {
      lookup('fictitious.test', { all: false }, (err) => resolve(err))
    })
    expect(error?.message).toMatch(/public/)
  })

  it('returns a validated public DNS address for the socket', async () => {
    const resolver: PublicResolver = (_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    }
    const lookup = createPublicLookup(resolver)

    const result = await new Promise<{ address: string; family?: number }>((resolve, reject) => {
      lookup('fictitious.test', { all: false }, (err, address, family) => {
        if (err) reject(err)
        else resolve({ address: address as string, family })
      })
    })
    expect(result).toEqual({ address: '8.8.8.8', family: 4 })
  })

  it('fetches HTTPS text using the validated socket lookup', async () => {
    const resolver: PublicResolver = (_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    }
    let sawLookup = false
    const request = ((_url: URL, options: { lookup?: unknown }, callback: (response: EventEmitter) => void) => {
      sawLookup = typeof options.lookup === 'function'
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      req.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
        response.statusCode = 200
        response.headers = {}
        callback(response)
        response.emit('data', Buffer.from('BEGIN:VCALENDAR'))
        response.emit('end')
      }
      req.destroy = () => undefined
      return req
    }) as unknown as PublicRequest

    await expect(fetchPublicText('https://calendar.test/feed', { resolver, request })).resolves.toBe('BEGIN:VCALENDAR')
    expect(sawLookup).toBe(true)
  })

  it('destroys an agent socket when the total request deadline expires', async () => {
    const agent = new Agent()
    let destroyed = false
    const socket = new EventEmitter() as EventEmitter & { destroy: () => void }
    socket.destroy = () => { destroyed = true }
    agent.createConnection = () => socket as never
    setAgentRequestDeadline(agent, 10)

    agent.createConnection({} as never)
    await delay(30)

    expect(destroyed).toBe(true)
    agent.destroy()
  })

  it('destroys an agent socket that receives more bytes than allowed', () => {
    const agent = new Agent()
    let destroyed = false
    const socket = new EventEmitter() as EventEmitter & { destroy: () => void }
    socket.destroy = () => { destroyed = true }
    agent.createConnection = () => socket as never
    setAgentRequestDeadline(agent, 1000, 16)

    agent.createConnection({} as never)
    socket.emit('data', Buffer.alloc(32))

    expect(destroyed).toBe(true)
    agent.destroy()
  })

  it('enforces a total deadline even without a socket timeout event', async () => {
    const resolver: PublicResolver = (_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    }
    let destroyed = false
    const request = ((_url: URL, _options: unknown, _callback: (response: EventEmitter) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      req.end = () => undefined
      req.destroy = () => { destroyed = true }
      return req
    }) as unknown as PublicRequest

    const outcome = await Promise.race([
      fetchPublicText('https://calendar.example/stalled', { resolver, request, timeoutMs: 10 }).catch((error) => (error as Error).message),
      delay(80).then(() => 'deadline-missing'),
    ])
    expect(outcome).toBe('Outbound request timed out')
    expect(destroyed).toBe(true)
  })

  it('follows a redirect when both destinations are public', async () => {
    const resolver: PublicResolver = (_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    }
    let requests = 0
    const request = ((_url: URL, _options: unknown, callback: (response: EventEmitter) => void) => {
      requests++
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      req.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void }
        response.statusCode = requests === 1 ? 302 : 200
        response.headers = requests === 1 ? { location: 'https://calendar.example/final' } : {}
        response.resume = () => undefined
        callback(response)
        if (requests === 2) response.emit('data', Buffer.from('PUBLIC-CALENDAR'))
        response.emit('end')
      }
      req.destroy = () => undefined
      return req
    }) as unknown as PublicRequest

    await expect(fetchPublicText('https://calendar.example/start', { resolver, request })).resolves.toBe('PUBLIC-CALENDAR')
    expect(requests).toBe(2)
  })

  it('stops a response that exceeds the byte limit', async () => {
    const resolver: PublicResolver = (_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    }
    let destroyed = false
    const request = ((_url: URL, _options: unknown, callback: (response: EventEmitter) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      req.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
        response.statusCode = 200
        response.headers = {}
        callback(response)
        response.emit('data', Buffer.alloc(1025))
      }
      req.destroy = () => { destroyed = true }
      return req
    }) as unknown as PublicRequest

    await expect(fetchPublicText('https://calendar.example/large', { resolver, request, maxBytes: 1024 })).rejects.toThrow(/size limit/)
    expect(destroyed).toBe(true)
  })

  it('rejects a redirect to a private address before connecting', async () => {
    const resolver: PublicResolver = (_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    }
    let requests = 0
    const request = ((_url: URL, _options: unknown, callback: (response: EventEmitter) => void) => {
      requests++
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      req.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void }
        response.statusCode = 302
        response.headers = { location: 'https://127.0.0.1/private' }
        response.resume = () => undefined
        callback(response)
        response.emit('end')
      }
      req.destroy = () => undefined
      return req
    }) as unknown as PublicRequest

    await expect(fetchPublicText('https://calendar.test/redirect', { resolver, request })).rejects.toThrow(/public/)
    expect(requests).toBe(1)
  })
})
