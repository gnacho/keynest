import { isIP, type LookupFunction } from 'node:net'
import { lookup, type LookupAddress } from 'node:dns'
import { request as httpsRequest, type Agent } from 'node:https'

export type PublicRequest = typeof httpsRequest

interface FetchPublicOptions {
  resolver?: PublicResolver
  request?: PublicRequest
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  deadlineAt?: number
}

export type PublicResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void

function blockedDestination(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = 'ERR_BLOCKED_DESTINATION'
  return error
}

function ipv6Groups(address: string): number[] | null {
  const parts = address.toLowerCase().split('::')
  if (parts.length > 2) return null
  const parse = (value: string): number[] | null => {
    if (!value) return []
    const groups = value.split(':')
    const output: number[] = []
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      if (group.includes('.')) {
        if (i !== groups.length - 1 || !isIP(group)) return null
        const bytes = group.split('.').map(Number)
        output.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3])
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null
        output.push(Number.parseInt(group, 16))
      }
    }
    return output
  }
  const head = parse(parts[0])
  const tail = parts.length === 2 ? parse(parts[1]) : []
  if (!head || !tail || head.length + tail.length > 8) return null
  if (parts.length === 1 && head.length !== 8) return null
  if (parts.length === 2 && head.length + tail.length === 8) return null
  return [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail]
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)
    )
  }
  if (family !== 6) return false
  const groups = ipv6Groups(address)
  if (!groups || groups[0] < 0x2000 || groups[0] > 0x3fff) return false
  if (groups[0] === 0x2002) return false
  if (groups[0] === 0x2001 && (groups[1] <= 0x01ff || groups[1] === 0x0db8)) return false
  return true
}

export function createPublicLookup(resolver: PublicResolver = lookup as PublicResolver): LookupFunction {
  return (hostname, options, callback) => {
    if (isIP(hostname)) {
      if (!isPublicIp(hostname)) {
        callback(blockedDestination('Destination must resolve only to public IP addresses'), '', 0)
        return
      }
      callback(null, hostname, isIP(hostname))
      return
    }
    resolver(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 0)
        return
      }
      if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address))) {
        callback(blockedDestination('Destination must resolve only to public IP addresses'), '', 0)
        return
      }
      if (options.all) {
        callback(null, addresses)
        return
      }
      callback(null, addresses[0].address, addresses[0].family)
    })
  }
}

export function setAgentRequestDeadline(agent: Agent, timeoutMs: number): void {
  const createConnection = agent.createConnection.bind(agent)
  agent.createConnection = (options, callback) => {
    const socket = createConnection(options, callback)
    if (!socket) return socket
    const timer = setTimeout(() => socket.destroy(new Error('Outbound request timed out')), timeoutMs)
    timer.unref()
    socket.once('close', () => clearTimeout(timer))
    return socket
  }
}

export function assertPublicUrl(value: string | URL): void {
  parsePublicUrl(value)
}

function parsePublicUrl(value: string | URL): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw blockedDestination('Destination must be an HTTPS URL without embedded credentials')
  }
  if (isIP(url.hostname) && !isPublicIp(url.hostname)) {
    throw blockedDestination('Destination must resolve only to public IP addresses')
  }
  return url
}

export async function fetchPublicText(value: string | URL, options: FetchPublicOptions = {}): Promise<string> {
  const url = parsePublicUrl(value)
  const requestImpl = options.request ?? httpsRequest
  const timeoutMs = options.timeoutMs ?? 20000
  const deadlineAt = options.deadlineAt ?? Date.now() + timeoutMs
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let req: ReturnType<PublicRequest> | undefined
    const finish = (error: Error | null, text = '') => {
      if (settled) return
      settled = true
      clearTimeout(totalTimer)
      if (error) reject(error)
      else resolve(text)
    }
    const totalTimer = setTimeout(() => {
      finish(new Error('Outbound request timed out'))
      req?.destroy()
    }, Math.max(1, deadlineAt - Date.now()))
    req = requestImpl(url, {
      method: 'GET',
      headers: { accept: 'text/calendar,text/plain;q=0.9,*/*;q=0.1' },
      lookup: createPublicLookup(options.resolver),
      timeout: Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now())),
    }, (response) => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume()
        const redirectsLeft = options.maxRedirects ?? 5
        if (redirectsLeft <= 0) {
          finish(new Error('Too many redirects'))
          return
        }
        try {
          const next = parsePublicUrl(new URL(response.headers.location, url))
          fetchPublicText(next, { ...options, deadlineAt, maxRedirects: redirectsLeft - 1 })
            .then((text) => finish(null, text), (error) => finish(error))
        } catch (error) {
          finish(error as Error)
        }
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) {
          finish(new Error('Response exceeds the configured size limit'))
          req?.destroy()
          return
        }
        chunks.push(chunk)
      })
      response.on('error', (error) => finish(error))
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          finish(new Error(`HTTP ${status}`))
          return
        }
        finish(null, Buffer.concat(chunks).toString('utf8'))
      })
    })
    req.on('error', (error) => finish(error))
    req.on('timeout', () => {
      finish(new Error('Outbound request timed out'))
      req?.destroy()
    })
    req.end()
  })
}
