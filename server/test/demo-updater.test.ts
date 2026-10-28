import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

const SCRIPT = new URL('../../deploy/demo-update.sh', import.meta.url).pathname
const BACKUP_HELPER = new URL('../../deploy/demo-backup.cjs', import.meta.url).pathname
const SQLITE = new URL('../../server/node_modules/better-sqlite3', import.meta.url).pathname

let dir: string
let fix: string
let opt: string
let data: string

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function seedDatabase(file: string, table: string, rows: number) {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, note TEXT)`)
  const insert = db.prepare(`INSERT INTO ${table} (note) VALUES (?)`)
  for (let i = 0; i < rows; i++) insert.run(`row-${i}`)
  db.close()
}

function seedInstall(version: string, dependencies = '{"hono":"^4.13.12"}') {
  mkdirSync(join(opt, 'server', 'dist'), { recursive: true })
  mkdirSync(join(opt, 'server', 'node_modules', 'hono'), { recursive: true })
  mkdirSync(join(opt, 'public'), { recursive: true })
  mkdirSync(join(data), { recursive: true })
  writeFileSync(join(opt, 'server', 'dist', 'index.js'), '// old build\n')
  writeFileSync(join(opt, 'server', 'node_modules', 'hono', 'index.js'), '// old deps\n')
  writeFileSync(join(opt, 'server', 'package.json'), `{"name":"keynest-server","version":"${version}","dependencies":${dependencies}}`)
  writeFileSync(join(opt, 'public', 'index.html'), '<html>old</html>')
  writeFileSync(join(opt, '.release-id'), version)
  seedDatabase(join(data, 'keynest.db'), 'users', 3)
  seedDatabase(join(data, 'keynest_demo.db'), 'properties', 2)
}

function buildFixture(opts: { version?: string; dependencies?: string } = {}) {
  const version = opts.version ?? '1.7.0'
  fix = join(dir, 'fixture')
  mkdirSync(join(fix, 'bin'), { recursive: true })
  mkdirSync(join(fix, 'pkg', 'dist'), { recursive: true })
  writeFileSync(join(fix, 'pkg', 'dist', 'index.html'), '<html>new</html>')
  mkdirSync(join(fix, 'pkg', 'server', 'dist'), { recursive: true })
  mkdirSync(join(fix, 'pkg', 'server', 'node_modules', 'hono'), { recursive: true })
  writeFileSync(join(fix, 'pkg', 'server', 'dist', 'index.js'), '// new build\n')
  writeFileSync(join(fix, 'pkg', 'server', 'node_modules', 'hono', 'index.js'), '// new deps\n')
  writeFileSync(
    join(fix, 'pkg', 'server', 'package.json'),
    `{"name":"keynest-server","version":"${version}","dependencies":${opts.dependencies ?? '{"hono":"^4.13.12"}'}}`,
  )
  execFileSync('tar', ['-czf', join(fix, 'app.tar.gz'), '-C', join(fix, 'pkg'), '.'])
  const hash = execFileSync('sha256sum', [join(fix, 'app.tar.gz')], { encoding: 'utf8' }).split(/\s+/)[0]!
  const arch = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim()
    .replace('x86_64', 'amd64')
    .replace('aarch64', 'arm64')
  writeFileSync(join(fix, 'checksums.txt'), `${hash}  keynest_${version}_linux_${arch}.tar.gz\n`)
  writeFileSync(join(fix, 'latest.json'), `{"tag_name":"v${version}"}\n`)
  writeFileSync(join(fix, 'version.txt'), `${version}\n`)

  writeExecutable(join(fix, 'bin', 'curl'), `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  *'"'*) echo "url malformada: $url" >&2; exit 1 ;; esac
case "$url" in
  *releases/latest*) cat "$FIXTURE/latest.json" ;;
  *checksums.txt*) if [ -n "$out" ]; then cat "$FIXTURE/checksums.txt" > "$out"; else cat "$FIXTURE/checksums.txt"; fi ;;
  *.tar.gz) if [ -n "$out" ]; then cp "$FIXTURE/app.tar.gz" "$out"; else cat "$FIXTURE/app.tar.gz"; fi ;;
  */health) exit "\${FAKE_HEALTH:-0}" ;;
  */api/version) printf '{"version":"%s"}\\n' "\${FAKE_VERSION:-$(cat "$FIXTURE/version.txt")}" ;;
  *) echo "unexpected url $url" >&2; exit 1 ;;
esac
`)

  writeExecutable(join(fix, 'bin', 'systemctl'), `#!/bin/sh
cmd=$1; shift
case "$cmd" in
  show) echo "" ;;
  is-active) echo "\${FAKE_ACTIVE:-active}" ;;
  restart) echo "restart $*" >> "$FIXTURE/systemctl.log" ;;
esac
exit 0
`)

  writeExecutable(join(fix, 'bin', 'logger'), `#!/bin/sh
echo "$*" >> "$FIXTURE/logger.log"
`)
}

function runDemoUpdater(env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync('sh', [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${join(fix, 'bin')}:/usr/bin:/bin`,
        FIXTURE: fix,
        DEMO_OPT_DIR: opt,
        DEMO_DATA_DIR: data,
        DEMO_SERVICE: 'keynest-demo',
        DEMO_PORT: '8090',
        DEMO_SQLITE: SQLITE,
        DEMO_BACKUP_HELPER: BACKUP_HELPER,
        DEMO_NODE: join(fix, 'node'),
        DEMO_HEALTH_TIMEOUT: '2',
        TMPDIR: join(dir, 'tmp'),
        ...env,
      },
    })
    return { code: 0, stdout }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string }
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '' }
  }
}

function backupDirs(): string[] {
  if (!existsSync(opt)) return []
  return readdirSync(opt)
    .filter((name) => name.startsWith('backup-'))
    .map((name) => join(opt, name))
}

function newestBackup(): string {
  const dirs = backupDirs()
  expect(dirs.length).toBeGreaterThan(0)
  // El nombre lleva PID y segundos: el orden cronológico es el de mtime.
  return dirs.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1)!
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-demo-update-'))
  opt = join(dir, 'opt')
  data = join(opt, 'data')
  mkdirSync(join(dir, 'tmp'), { recursive: true })
  buildFixture()
  writeExecutable(join(fix, 'node'), `#!/bin/sh\nexec ${process.execPath} "$@"\n`)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('demo updater', () => {
  it('deploys the release with a verified backup and refreshes the marker', () => {
    seedInstall('1.6.1')

    const run = runDemoUpdater()

    expect(run.code).toBe(0)
    const backup = newestBackup()
    // Copia de seguridad verificada de las dos bases antes de tocar código.
    for (const file of ['keynest.db', 'keynest_demo.db']) {
      const copy = new Database(join(backup, 'data', file), { readonly: true })
      expect(copy.pragma('quick_check', { simple: true })).toBe('ok')
      copy.close()
    }
    expect(readFileSync(join(backup, 'server', 'dist', 'index.js'), 'utf8')).toBe('// old build\n')
    expect(readFileSync(join(backup, 'version'), 'utf8').trim()).toBe('1.6.1')
    // Código nuevo y marker alineado con lo que de verdad corre.
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toBe('// new build\n')
    expect(readFileSync(join(opt, 'public', 'index.html'), 'utf8')).toBe('<html>new</html>')
    expect(JSON.parse(readFileSync(join(opt, 'server', 'package.json'), 'utf8')).version).toBe('1.7.0')
    expect(readFileSync(join(opt, '.release-id'), 'utf8').trim()).toBe('1.7.0')
    // El reinicio ocurre después de la copia: si no, el backup no serviría.
    const log = readFileSync(join(fix, 'logger.log'), 'utf8')
    expect(log.indexOf('backup')).toBeLessThan(log.indexOf('reiniciando'))
  })

  it('stops without touching anything when the marker already matches', () => {
    seedInstall('1.7.0')

    const run = runDemoUpdater()

    expect(run.code).toBe(0)
    expect(backupDirs()).toHaveLength(0)
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toBe('// old build\n')
  })

  it('restores code and marker when the new build does not become healthy', () => {
    seedInstall('1.6.1')

    const run = runDemoUpdater({ FAKE_HEALTH: '1' })

    expect(run.code).toBe(7)
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toBe('// old build\n')
    expect(readFileSync(join(opt, 'public', 'index.html'), 'utf8')).toBe('<html>old</html>')
    expect(readFileSync(join(opt, '.release-id'), 'utf8').trim()).toBe('1.6.1')
  })

  it('replaces node_modules only when the dependencies change', () => {
    seedInstall('1.6.1')

    expect(runDemoUpdater().code).toBe(0)
    expect(readFileSync(join(opt, 'server', 'node_modules', 'hono', 'index.js'), 'utf8')).toBe('// old deps\n')

    rmSync(join(opt, '.release-id'))
    writeFileSync(join(opt, '.release-id'), '1.6.1')
    buildFixture({ version: '1.7.1', dependencies: '{"hono":"^5.0.0"}' })

    expect(runDemoUpdater().code).toBe(0)
    expect(readFileSync(join(opt, 'server', 'node_modules', 'hono', 'index.js'), 'utf8')).toBe('// new deps\n')
  })

  it('keeps only the configured number of backups', () => {
    seedInstall('1.6.1')

    expect(runDemoUpdater({ DEMO_BACKUP_KEEP: '2' }).code).toBe(0)
    buildFixture({ version: '1.7.1' })
    expect(runDemoUpdater({ DEMO_BACKUP_KEEP: '2' }).code).toBe(0)
    buildFixture({ version: '1.7.2' })
    expect(runDemoUpdater({ DEMO_BACKUP_KEEP: '2' }).code).toBe(0)

    const kept = backupDirs()
    expect(kept).toHaveLength(2)
    expect(readFileSync(join(opt, '.release-id'), 'utf8').trim()).toBe('1.7.2')
    for (const backup of kept) {
      expect(existsSync(join(backup, 'data', 'keynest.db'))).toBe(true)
      expect(existsSync(join(backup, 'data', 'keynest.db-wal'))).toBe(false)
    }
  })

  it('refuses to deploy when the checksum does not match', () => {
    seedInstall('1.6.1')
    const arch = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim()
      .replace('x86_64', 'amd64')
      .replace('aarch64', 'arm64')
    writeFileSync(join(fix, 'checksums.txt'), `${'0'.repeat(64)}  keynest_1.7.0_linux_${arch}.tar.gz\n`)

    const run = runDemoUpdater()

    expect(run.code).toBe(5)
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toBe('// old build\n')
    expect(backupDirs()).toHaveLength(0)
    expect(readFileSync(join(opt, '.release-id'), 'utf8').trim()).toBe('1.6.1')
  })
})
