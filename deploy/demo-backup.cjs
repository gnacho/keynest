#!/usr/bin/env node
// demo-backup.cjs — copia verificada de las bases SQLite de la demo.
//
// Uso: node demo-backup.cjs <dataDir> <backupDir> <ruta a better-sqlite3>
//
// Usa la API de backup de SQLite (incluye el contenido de WAL) en vez de copiar
// el fichero, y verifica cada copia abriéndola aparte y ejecutando quick_check.
// La ruta del módulo se pasa explícitamente porque este fichero vive en
// deploy/ y no resuelve node_modules del servidor.

const { existsSync, mkdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const [dataDir, backupDir, sqlitePath] = process.argv.slice(2)
if (!dataDir || !backupDir || !sqlitePath) {
  console.error('uso: demo-backup.cjs <dataDir> <backupDir> <better-sqlite3>')
  process.exit(2)
}

const Database = require(sqlitePath)
const TABLES = ['keynest.db', 'keynest_demo.db']

async function main() {
  mkdirSync(join(backupDir, 'data'), { recursive: true, mode: 0o700 })
  for (const file of TABLES) {
    const source = join(dataDir, file)
    if (!existsSync(source)) {
      console.log(`${file}: no existe, se omite`)
      continue
    }
    const target = join(backupDir, 'data', file)
    const origin = new Database(source, { readonly: true, fileMustExist: true })
    await origin.backup(target)
    origin.close()

    const copy = new Database(target, { readonly: true, fileMustExist: true })
    const check = copy.pragma('quick_check', { simple: true })
    const tables = copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n
    copy.close()
    if (check !== 'ok' || tables < 1) {
      console.error(`${file}: copia no válida (quick_check=${check}, tablas=${tables})`)
      process.exit(1)
    }
    // La copia ya lleva dentro el contenido del WAL. Los sidecars que crea la
    // apertura de verificación no aportan nada y confunden al restaurar.
    for (const suffix of ['-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true })
    console.log(`${file}: copia verificada (quick_check=ok, tablas=${tables})`)
  }
}

main().catch((error) => {
  console.error(`fallo al copiar: ${error.message}`)
  process.exit(1)
})
