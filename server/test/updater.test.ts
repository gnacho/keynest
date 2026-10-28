import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = new URL('../../deploy/keynest-update.sh', import.meta.url).pathname

let dir: string
let fix: string
let opt: string
let altData: string

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function buildFixture(opts: { omitServerDist?: boolean } = {}) {
  rmSync(join(dir, 'fixture'), { recursive: true, force: true })
  fix = join(dir, 'fixture')
  mkdirSync(join(fix, 'bin'), { recursive: true })
  mkdirSync(join(fix, 'pkg', 'dist'), { recursive: true })
  writeFileSync(join(fix, 'pkg', 'dist', 'index.html'), '<html>new</html>')
  if (!opts.omitServerDist) {
    mkdirSync(join(fix, 'pkg', 'server', 'dist'), { recursive: true })
    writeFileSync(join(fix, 'pkg', 'server', 'dist', 'index.js'), '// new build\n')
    writeFileSync(join(fix, 'pkg', 'server', 'package.json'), '{"name":"keynest-server","version":"1.7.0"}')
  }
  execFileSync('tar', ['-czf', join(fix, 'app.tar.gz'), '-C', join(fix, 'pkg'), '.'])
  const hash = execFileSync('sha256sum', [join(fix, 'app.tar.gz')], { encoding: 'utf8' }).split(/\s+/)[0]!
  // El actualizador elige el tarball con `uname -m`, así que el nombre del
  // checksum debe seguir la arquitectura del runner (arm64 en CI).
  const arch = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim()
    .replace('x86_64', 'amd64')
    .replace('aarch64', 'arm64')
  writeFileSync(join(fix, 'checksums.txt'), `${hash}  keynest_1.7.0_linux_${arch}.tar.gz\n`)
  writeFileSync(join(fix, 'latest.json'), '{"tag_name":"v1.7.0"}\n')

  writeExecutable(join(fix, 'bin', 'curl'), `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in *'"'*) echo "url malformada: $url" >&2; exit 1 ;; esac
case "$url" in
  *releases/latest*) cat "$FIXTURE/latest.json" ;;
  *checksums.txt*) if [ -n "$out" ]; then cat "$FIXTURE/checksums.txt" > "$out"; else cat "$FIXTURE/checksums.txt"; fi ;;
  *.tar.gz) if [ -n "$out" ]; then cp "$FIXTURE/app.tar.gz" "$out"; else cat "$FIXTURE/app.tar.gz"; fi ;;
  */health) exit "\${FAKE_HEALTH:-0}" ;;
  */api/version) printf '{"version":"%s","build":"test"}\\n' "\${FAKE_VERSION:-1.7.0}" ;;
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

function runUpdater(env: Record<string, string>) {
  try {
    const stdout = execFileSync('sh', [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${join(fix, 'bin')}:/usr/bin:/bin`,
        FIXTURE: fix,
        KEYNEST_OPT_DIR: opt,
        RELEASE_MARKER: join(opt, '.release-id'),
        KEYNEST_DATA_DIRS: `${altData} ${join(opt, 'data')}`,
        KEYNEST_HEALTH_TIMEOUT: '2',
        TMPDIR: join(dir, 'tmp'),
        ...env,
      },
    })
    return { code: 0, stdout }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { code: e.status ?? 1, stdout: e.stdout ?? '' }
  }
}

function flatLayout() {
  mkdirSync(join(opt, 'server', 'dist'), { recursive: true })
  mkdirSync(join(opt, 'public'), { recursive: true })
  writeFileSync(join(opt, 'server', 'dist', 'index.js'), '// old build\n')
  writeFileSync(join(opt, 'server', 'package.json'), '{"name":"keynest-server","version":"1.6.0"}')
  writeFileSync(join(opt, 'server', '.env'), 'PORT=18099\n')
  writeFileSync(join(opt, 'public', 'index.html'), '<html>old</html>')
  writeFileSync(join(opt, '.release-id'), '1.6.0')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-updater-'))
  opt = join(dir, 'opt')
  altData = join(dir, 'var-lib')
  mkdirSync(opt, { recursive: true })
  mkdirSync(altData, { recursive: true })
  mkdirSync(join(dir, 'tmp'), { recursive: true })
  buildFixture()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('updater health gating', () => {
  it('advances the marker only after the new version answers health and version', () => {
    flatLayout()

    const result = runUpdater({})

    expect(result.code).toBe(0)
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.7.0')
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toContain('new build')
    const backups = execFileSync('sh', ['-c', `ls -1d "${opt}"/server.bak-* | head -n1`], { encoding: 'utf8' }).trim()
    const sidecar = execFileSync('sh', ['-c', `ls -1 "${opt}"/server-*.version | head -n1`], { encoding: 'utf8' }).trim()
    expect(statSync(backups).isDirectory()).toBe(true)
    expect(readFileSync(sidecar, 'utf8')).toBe('1.6.0')
  })

  it('keeps the previous marker and restores the old release when health fails', () => {
    flatLayout()

    const result = runUpdater({ FAKE_HEALTH: '22' })

    expect(result.code).toBe(7)
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.0')
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toContain('old build')
    expect(readFileSync(join(fix, 'logger.log'), 'utf8')).toMatch(/revirtiendo|rollback/i)
  })

  it('does not accept a rollout that serves a different version', () => {
    flatLayout()

    const result = runUpdater({ FAKE_VERSION: '1.6.0' })

    expect(result.code).toBe(7)
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.0')
    expect(readFileSync(join(fix, 'logger.log'), 'utf8')).toMatch(/no coincide/)
  })
})

describe('rollback flag handling', () => {
  function capistranoLayout() {
    mkdirSync(join(opt, 'releases', 'v1.6.0'), { recursive: true })
    mkdirSync(join(opt, 'releases', 'v1.7.0'), { recursive: true })
    symlinkSync(join(opt, 'releases', 'v1.7.0'), join(opt, 'current'))
    writeFileSync(join(opt, '.release-id'), '1.7.0')
  }

  it('honours a rollback requested in the alternate data directory', () => {
    capistranoLayout()
    writeFileSync(join(altData, '.rollback-requested'), 'now')

    const result = runUpdater({ FAKE_VERSION: '1.6.0' })

    expect(result.code).toBe(0)
    expect(existsSync(join(opt, 'releases', 'v1.6.0'))).toBe(true)
    expect(execFileSync('readlink', ['-f', join(opt, 'current')], { encoding: 'utf8' }).trim())
      .toBe(join(opt, 'releases', 'v1.6.0'))
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.0')
    expect(existsSync(join(altData, '.rollback-requested'))).toBe(false)
  })

  it('watches both flags in both data layouts', () => {
    const unit = readFileSync(new URL('../../deploy/keynest-update.path', import.meta.url), 'utf8')

    for (const flag of ['.update-requested', '.rollback-requested']) {
      for (const dataDir of ['/var/lib/keynest', '/opt/keynest/data']) {
        expect(unit).toContain(`PathExists=${dataDir}/${flag}`)
      }
    }
  })
})

describe('manual rollback in the flat layout', () => {
  function backupDir(prefix: 'public' | 'server', name: string, content: string, mtime: number) {
    const target = join(opt, `${prefix}.bak-${name}`)
    mkdirSync(join(target, 'dist'), { recursive: true })
    if (prefix === 'server') writeFileSync(join(target, 'dist', 'index.js'), content)
    else writeFileSync(join(target, 'dist', 'index.html'), content)
    utimesSync(target, mtime, mtime)
    return target
  }

  it('restores the backup directory and ignores version sidecars', () => {
    flatLayout()
    const srv = backupDir('server', '20261028-041500', '// restored server\n', 2000)
    backupDir('public', '20261028-041500', '<html>restored</html>', 2000)
    writeFileSync(`${srv}.version`, '1.6.1')
    writeFileSync(join(altData, '.rollback-requested'), 'now')

    const result = runUpdater({ FAKE_VERSION: '1.6.1' })

    expect(result.code).toBe(0)
    expect(statSync(join(opt, 'server')).isDirectory()).toBe(true)
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toContain('restored server')
    expect(readFileSync(join(opt, 'public', 'dist', 'index.html'), 'utf8')).toBe('<html>restored</html>')
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.1')
  })

  it('picks the newest public backup by mtime, not by name', () => {
    flatLayout()
    backupDir('server', '20261028-041500', '// restored server\n', 2000)
    backupDir('public', '20261028-041500', '<html>newest</html>', 2000)
    backupDir('public', '308-20261027-171518', '<html>older-manual</html>', 1000)
    writeFileSync(join(altData, '.rollback-requested'), 'now')

    const result = runUpdater({ FAKE_VERSION: '1.6.1' })

    expect(result.code).toBe(0)
    expect(readFileSync(join(opt, 'public', 'dist', 'index.html'), 'utf8')).toBe('<html>newest</html>')
  })

  it('records the version the restored service reports when no sidecar exists', () => {
    flatLayout()
    backupDir('server', '20261028-041500', '// restored server\n', 2000)
    backupDir('public', '20261028-041500', '<html>restored</html>', 2000)
    writeFileSync(join(altData, '.rollback-requested'), 'now')

    const result = runUpdater({ FAKE_VERSION: '1.6.1' })

    expect(result.code).toBe(0)
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.1')
  })

  it('ignores alphabetical order when it disagrees with mtime', () => {
    flatLayout()
    backupDir('server', '20261028-041500', '// restored server\n', 3000)
    backupDir('server', '1565-20261022-000000', '// ancient server\n', 1000)
    backupDir('public', '20261028-041500', '<html>newest</html>', 3000)
    backupDir('public', '1565-20261022-000000', '<html>ancient</html>', 1000)
    writeFileSync(join(altData, '.rollback-requested'), 'now')

    const result = runUpdater({ FAKE_VERSION: '1.6.1' })

    expect(result.code).toBe(0)
    expect(readFileSync(join(opt, 'public', 'dist', 'index.html'), 'utf8')).toBe('<html>newest</html>')
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toContain('restored server')
  })

  it('reports a missing snapshot instead of aborting silently', () => {
    flatLayout()
    writeFileSync(join(altData, '.rollback-requested'), 'now')

    const result = runUpdater({})

    expect(result.code).toBe(6)
    expect(readFileSync(join(fix, 'logger.log'), 'utf8')).toMatch(/sin backups/)
  })
})

describe('updater resilience', () => {
  it('strips quotes and comments from the configured port', () => {
    flatLayout()
    writeFileSync(join(opt, 'server', '.env'), 'PORT="18099" # comentario\n')

    const result = runUpdater({})

    expect(result.code).toBe(0)
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.7.0')
  })

  it('rolls back when the package is incomplete before the health gate', () => {
    buildFixture({ omitServerDist: true })
    flatLayout()

    const result = runUpdater({})

    expect(result.code).toBe(7)
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.0')
    expect(statSync(join(opt, 'server')).isDirectory()).toBe(true)
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toContain('old build')
    expect(readFileSync(join(opt, 'public', 'index.html'), 'utf8')).toBe('<html>old</html>')
  })

  it('does not downgrade a healthy release when it fails before the flip', () => {
    mkdirSync(join(opt, 'releases', 'v1.5.0'), { recursive: true })
    mkdirSync(join(opt, 'releases', 'v1.6.0'), { recursive: true })
    symlinkSync(join(opt, 'releases', 'v1.6.0'), join(opt, 'current'))
    writeFileSync(join(opt, '.release-id'), '1.6.0')
    writeFileSync(join(opt, 'releases', 'v1.7.0'), 'no es un directorio')

    const result = runUpdater({})

    expect(result.code).not.toBe(0)
    expect(execFileSync('readlink', ['-f', join(opt, 'current')], { encoding: 'utf8' }).trim())
      .toBe(join(opt, 'releases', 'v1.6.0'))
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.0')
  })

  it('aborts without touching the tree when the snapshot cannot be copied', () => {
    flatLayout()
    writeFileSync(join(opt, 'server', 'unreadable.txt'), 'x')
    chmodSync(join(opt, 'server', 'unreadable.txt'), 0o000)

    const result = runUpdater({})

    expect(result.code).not.toBe(0)
    expect(readFileSync(join(opt, '.release-id'), 'utf8')).toBe('1.6.0')
    expect(readFileSync(join(opt, 'server', '.env'), 'utf8')).toContain('PORT')
    expect(readFileSync(join(opt, 'server', 'dist', 'index.js'), 'utf8')).toContain('old build')
    const leftovers = execFileSync('sh', ['-c', `ls -1d "${opt}"/server.bak-* 2>/dev/null | wc -l`], { encoding: 'utf8' }).trim()
    expect(leftovers).toBe('0')
  })

  it('cleans temporary files and reports the failure step', () => {
    flatLayout()

    const result = runUpdater({ FAKE_HEALTH: '22' })

    expect(result.code).toBe(7)
    expect(readdirSync(join(dir, 'tmp'))).toHaveLength(0)
    expect(readFileSync(join(altData, 'update-progress.json'), 'utf8')).toContain('"step":"error"')
  })

  it('cleans temporary files after a successful update', () => {
    flatLayout()

    expect(runUpdater({}).code).toBe(0)
    expect(readdirSync(join(dir, 'tmp'))).toHaveLength(0)
  })
})
