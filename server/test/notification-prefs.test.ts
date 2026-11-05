// Paridad entre los tipos de alerta del servidor y los toggles de ajustes.
// Regresión #335: tedee_keypad_bateria se enviaba pero no se podía desactivar
// porque faltaba en el frontend y en las traducciones.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TIPOS_ALERTA } from '../src/push.js'

const root = new URL('../..', import.meta.url).pathname

function tiposDelFrontend(): string[] {
  const source = readFileSync(join(root, 'app/src/components/settings/settings-cards.tsx'), 'utf8')
  const bloque = source.match(/const TIPOS_NOTIF = \[([\s\S]*?)\] as const/)
  expect(bloque).not.toBeNull()
  return [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
}

function clavesDeIdioma(locale: string): string[] {
  const json = JSON.parse(readFileSync(join(root, `app/src/i18n/locales/${locale}/translation.json`), 'utf8'))
  return Object.keys(json.aj?.notifTipo ?? {}).sort()
}

describe('preferencias de notificación', () => {
  it('el frontend ofrece un toggle por cada tipo de alerta del servidor', () => {
    expect(tiposDelFrontend()).toEqual([...TIPOS_ALERTA].sort())
  })

  it('cada tipo tiene etiqueta en castellano y en inglés', () => {
    expect(clavesDeIdioma('es')).toEqual([...TIPOS_ALERTA].sort())
    expect(clavesDeIdioma('en')).toEqual([...TIPOS_ALERTA].sort())
  })
})
