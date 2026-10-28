/** Campos de la orden que ve el proveedor en su enlace público.
 *  DTO explícito: nunca se devuelve la fila completa, para no filtrar
 *  `token_cipher`, `token_hash` ni la tarifa horaria del asignado. */
const TASK_FIELDS = [
  'id',
  'property_id',
  'title',
  'description',
  'category',
  'urgent',
  'notes',
  'date',
  'scheduled_date',
  'status',
  'cost',
  'assignee_id',
  'created_at',
  'completed_at',
] as const

const PERSON_FIELDS = ['id', 'name', 'phone', 'specialty'] as const

const PROPERTY_FIELDS = ['id', 'name', 'address', 'photo', 'instructions'] as const

function pick<T extends readonly string[]>(source: unknown, fields: T): Record<string, unknown> {
  const row = (source ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in row) out[field] = row[field]
  }
  return out
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function workOrderPayload(task: unknown, property: unknown, assignee: unknown) {
  const fields = pick(task, TASK_FIELDS)
  return {
    type: 'workorder' as const,
    task: { ...fields, checks: parseList((task as Record<string, unknown>).checks), photos: parseList((task as Record<string, unknown>).photos) },
    property: pick(property, PROPERTY_FIELDS),
    assignee: assignee ? pick(assignee, PERSON_FIELDS) : null,
  }
}
