import type { DB } from './db.js'

/** Predicado SQL reutilizable: sustituir @T@ por el alias de cleanings. */
export function assignedSql(alias: string): string {
  return `json_valid(${alias}.assignee_ids) AND json_type(${alias}.assignee_ids) = 'array' AND EXISTS (SELECT 1 FROM json_each(${alias}.assignee_ids) WHERE json_each.type = 'text' AND json_each.value = ?)`
}

/* Mismo criterio en JS para filas ya cargadas. Un JSON roto o un escalar no
   asignan a nadie: antes `JSON.parse(...).includes` lanzaba y convertía la
   página del enlace personal en un 500. */
export function isAssignedTo(assigneeIds: unknown, personId: string): boolean {
  if (typeof assigneeIds !== 'string' || !assigneeIds) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(assigneeIds)
  } catch {
    return false
  }
  return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') && parsed.includes(personId)
}

export interface PersonProperty {
  id: string
  name: string
  address: string
  photo: string
  instructions: string
  checklist: string[]
}

/* Inmuebles que el enlace personal puede ver: solo aquellos donde la persona
   tiene alguna limpieza vigente asignada. Antes se devolvían todos, con sus
   direcciones e instrucciones, a cualquier token válido. La proyección es
   explícita: no se añaden campos nuevos por accidente. */
export function personProperties(db: DB, personId: string): PersonProperty[] {
  const rows = db.prepare(
    `SELECT DISTINCT p.id, p.name, p.address, p.photo, p.instructions, p.checklist
       FROM properties p
       JOIN cleanings c ON c.property_id = p.id
      WHERE c.status != 'archivada'
        AND ${assignedSql('c')}
      ORDER BY p.name`,
  ).all(personId) as Array<{ id: string; name: string; address: string | null; photo: string | null; instructions: string | null; checklist: string | null }>

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address ?? '',
    photo: p.photo ?? '',
    instructions: p.instructions ?? '',
    checklist: JSON.parse(p.checklist || '[]'),
  }))
}
