// routes-cancellations.ts - endpoint del aviso de cancelaciones recientes (#340).
//
// Va montado en el router `guarded` (sesion por cookie, c.get('db') apunta a
// la BD real o a la demo segun la sesion). La logica de lectura vive en
// cancellations.ts para poder probarla sin arrancar la app.
import type { Hono } from 'hono'
import { recentCancellations } from './cancellations.js'
import type { DB, UserRow } from './db.js'

interface CancellationsEnv {
  Bindings: { incoming?: { socket?: { remoteAddress?: string } } }
  Variables: { db: DB; user: UserRow }
}

export function registerCancellationRoutes(app: Hono<CancellationsEnv>): void {
  app.get('/cancellations/recent', (c) => {
    return c.json({ cancellations: recentCancellations(c.get('db')) })
  })
}
