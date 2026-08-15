// sse.js — hub de Server-Sent Events (contrato de eventos, skill api-stack).
// Portado del patrón de la app deltos: eventos NOMBRADOS <dominio>.changed
// (cleaning.changed, maintenance.changed, …), id monótono, heartbeat ': ping'
// cada 20 s (crítico tras Nginx Proxy Manager) y resync vía Last-Event-ID.
//
// Los eventos NO llevan datos del dominio: son notificaciones de cambio; el
// cliente refetchea el bootstrap vía REST al recibirlos (y hace refetch total
// inmediato con 'sync.resync' si perdió eventos al reconectar).

// Dominio singular para el nombre del evento (entity plural del dominio).
const DOMAIN = {
  properties: 'property',
  reservations: 'reservation',
  cleanings: 'cleaning',
  maintenance: 'maintenance',
  people: 'person',
  users: 'user',
  settings: 'settings',
  expenses: 'expense',
}

export function eventName(entity) {
  return `${DOMAIN[entity] ?? entity}.changed`
}

export function createHub(maxClients = 20) {
  const clients = new Set()
  let seq = 0 // id monótono de eventos SSE (en memoria; ver contrato)

  function send(stream, event, data) {
    seq += 1
    return stream.writeSSE({ id: String(seq), event, data: JSON.stringify(data) })
  }

  return {
    maxClients,
    size: () => clients.size,
    seq: () => seq,
    add(stream) {
      clients.add(stream)
    },
    remove(stream) {
      clients.delete(stream)
    },
    hello(stream) {
      return send(stream, 'hello', { ok: true }).catch(() => {})
    },
    // Tras una reconexión con Last-Event-ID, si se perdieron eventos se manda
    // UN 'sync.resync' y el cliente refetchea todo vía REST (los eventos no
    // llevan datos, así que no hay histórico que reenviar).
    resync(stream, lastEventId) {
      const last = parseInt(lastEventId || '', 10)
      if (Number.isFinite(last) && last < seq) {
        return send(stream, 'sync.resync', { type: 'changed', entity: '*' }).catch(() => {})
      }
    },
    broadcast(entity) {
      const event = eventName(entity)
      const data = JSON.stringify({ type: 'changed', entity })
      seq += 1
      const id = String(seq)
      for (const stream of clients) {
        stream.writeSSE({ id, event, data }).catch(() => clients.delete(stream))
      }
    },
    shutdown() {
      for (const stream of clients) {
        stream.writeSSE({ event: 'shutdown', data: '{}' }).catch(() => {})
      }
      clients.clear()
    },
  }
}
