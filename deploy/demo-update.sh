#!/bin/sh
# demo-update.sh — actualiza la demo pública de Keynest desde la última release.
#
# La demo se desplegaba a mano (copiar dist, reiniciar y escribir el marker), y
# ese camino ya dejó el marker atrás: la API decía una versión y el código era
# otra. Este script hace lo mismo pero en orden y con vuelta atrás:
#   1. Resuelve la última release ESTABLE (releases/latest, nunca main).
#   2. Verifica sha256 contra checksums.txt antes de tocar nada.
#   3. Copia verificada de las dos bases SQLite y del código anterior.
#   4. Sustituye frontend, backend y package.json. Solo reemplaza node_modules
#      cuando cambian las dependencias (descargarlo siempre es más lento y
#      arriesga módulos nativos).
#   5. Reinicia y espera servicio activo, /health 200 y la versión esperada.
#      El marker se escribe SOLO después: un arranque fallido nunca deja la
#      demo "al día" con código roto.
#   6. Si no arranca, restaura el código del backup, vuelve al marker anterior
#      y sale con código 7.
#
# Uso: demo-update.sh [--force]
#   --force  reinstala aunque el marker ya coincida con la última release
set -eu

APP=${DEMO_SERVICE:-keynest-demo}
REPO=${GITHUB_REPO:-gnacho/keynest}
OPT_DIR=${DEMO_OPT_DIR:-/opt/keynest-demo-app}
MARKER=${RELEASE_MARKER:-$OPT_DIR/.release-id}
DATA_DIR=${DEMO_DATA_DIR:-$OPT_DIR/data}
HEALTH_TIMEOUT=${DEMO_HEALTH_TIMEOUT:-30}
NODE_BIN=${DEMO_NODE:-node}
SQLITE=${DEMO_SQLITE:-$OPT_DIR/server/node_modules/better-sqlite3}
BACKUP_HELPER=${DEMO_BACKUP_HELPER:-$(dirname "$0")/demo-backup.cjs}
BACKUP_KEEP=${DEMO_BACKUP_KEEP:-5}
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1
TMP_DIR=$(mktemp -d)

log() { logger -t keynest-demo-update "$@" 2>/dev/null || echo "$*" >&2; }

marker_read() { cat "$MARKER" 2>/dev/null || true; }
marker_write() {
  printf '%s' "$1" > "$MARKER"
  chmod 0644 "$MARKER" 2>/dev/null || true
}

# Puerto real: el unit de la demo lo define con Environment=; se acepta también
# un .env por si la instalación migra a EnvironmentFile.
resolve_port() {
  for f in "$OPT_DIR/server/.env" $(systemctl show "$APP" -p EnvironmentFiles --value 2>/dev/null | tr ' ' '\n' | sed 's/(.*//'); do
    [ -n "$f" ] || continue
    [ -f "$f" ] || continue
    p=$(sed -n 's/^PORT=//p' "$f" | tail -n1 | sed 's/#.*//;s/[[:space:]]//g;s/^"//;s/"$//')
    case "$p" in ''|*[!0-9]*) continue ;; esac
    echo "$p"; return 0
  done
  p=$(systemctl show "$APP" -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^PORT=//p' | tail -n1 | sed 's/^"//;s/"$//')
  case "$p" in ''|*[!0-9]*) echo 8090; return 0 ;; esac
  echo "$p"
}

# Servicio activo, /health 200 y versión servida igual a la esperada.
wait_healthy() { # $1 = versión esperada (vacío = cualquiera)
  esperada=$1
  i=0
  while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
    if [ "$(systemctl is-active "$APP" 2>/dev/null || true)" = "active" ] &&
       curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
      efectiva=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/version" 2>/dev/null \
        | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
      if [ -n "$esperada" ] && [ "$efectiva" != "$esperada" ]; then
        log "versión servida $efectiva no coincide con $esperada"
        return 1
      fi
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

deps_of() { # $1 = package.json; imprime el bloque de dependencias
  "$NODE_BIN" -e 'const p=require(process.argv[1]);process.stdout.write(JSON.stringify(p.dependencies||{}))' "$1" 2>/dev/null || true
}

# Retención: cada copia pesa decenas de MB y esto se ejecuta en cada release.
# Se ordena por mtime (-t), no por nombre: dos corridas en el mismo segundo no
# deben dejar el orden en manos del azar. shellcheck desaconseja leer `ls`, pero
# en sh sin `sort -z` es la única forma de ordenar por fecha en vez de por nombre.
prune_backups() {
  case "$BACKUP_KEEP" in ''|*[!0-9]*) return 0 ;; esac
  [ "$BACKUP_KEEP" -gt 0 ] || return 0
  keep=0
  # shellcheck disable=SC2045
  for d in $(ls -1dt "$OPT_DIR"/backup-*/ 2>/dev/null); do
    keep=$((keep + 1))
    [ "$keep" -le "$BACKUP_KEEP" ] && continue
    rm -rf "$d"
    log "backup antiguo eliminado: $d"
  done
}

# Restaura el código del backup y deja el marker en la versión que vuelve a correr.
restore_backup() {
  [ -n "${BK:-}" ] && [ -d "$BK" ] || return 1
  rm -rf "$OPT_DIR/public" "$OPT_DIR/server/dist"
  cp -a "$BK/public/." "$OPT_DIR/public/" 2>/dev/null || true
  cp -a "$BK/server/dist" "$OPT_DIR/server/dist"
  cp -a "$BK/server/package.json" "$OPT_DIR/server/package.json"
  if [ -d "$BK/server/node_modules" ]; then
    rm -rf "$OPT_DIR/server/node_modules"
    cp -a "$BK/server/node_modules" "$OPT_DIR/server/node_modules"
  fi
  chown -R "$APP:$APP" "$OPT_DIR/public" "$OPT_DIR/server/dist" \
    "$OPT_DIR/server/node_modules" "$OPT_DIR/server/package.json" 2>/dev/null || true
  systemctl restart "$APP" 2>/dev/null || true
  if wait_healthy ""; then
    marker_write "${RESTORE_VERSION:-}"
    return 0
  fi
  return 1
}

DEPLOY_STARTED=0
ROLLED_BACK=0
on_exit() {
  code=$?
  trap - EXIT INT TERM
  rm -rf "$TMP_DIR"
  if [ "$code" -ne 0 ] && [ "$DEPLOY_STARTED" -eq 1 ] && [ "$ROLLED_BACK" -eq 0 ]; then
    log "fallo durante el despliegue (código $code); restaurando el código anterior"
    if restore_backup; then
      log "restauración completada; marker en $(marker_read)"
    else
      log "restauración incompleta; revisar la demo a mano"
    fi
    code=7
  fi
  exit "$code"
}
trap on_exit EXIT INT TERM

PORT=$(resolve_port)
CUR_VER=$(marker_read)

VER=$(curl -fsSL --max-time 20 "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"tag_name": *"\(v\?[0-9][^"]*\)".*/\1/p' | head -n1)
[ -n "$VER" ] || { log "no se pudo resolver la última release estable"; exit 4; }
VER_NO_V=$(printf '%s' "$VER" | sed 's/^v//')

if [ "$FORCE" -eq 0 ] && [ -n "$CUR_VER" ] && [ "$CUR_VER" = "$VER_NO_V" ]; then
  log "al día ($VER_NO_V)"
  exit 0
fi

log "actualizando la demo de ${CUR_VER:-desconocida} a $VER_NO_V"
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
TARBALL="keynest_${VER_NO_V}_linux_${ARCH}.tar.gz"
BASE="https://github.com/$REPO/releases/download/$VER"
curl -fL --max-time 180 "$BASE/$TARBALL" -o "$TMP_DIR/app.tar.gz"
# Cache-buster: la URL de checksums.txt es estable y la CDN sirve la copia
# anterior justo después de publicar, así que el tarball nuevo "no está".
curl -fL --max-time 30 "$BASE/checksums.txt?nc=$(date +%s)" -o "$TMP_DIR/checksums.txt"

expected=$(awk -v f="$TARBALL" 'index($0, "  '"$TARBALL"'") {print $1; exit}' "$TMP_DIR/checksums.txt" 2>/dev/null || true)
[ -n "$expected" ] || { log "checksums.txt sin entrada para $TARBALL"; exit 5; }
got=$(sha256sum "$TMP_DIR/app.tar.gz" | awk '{print $1}')
[ "$expected" = "$got" ] || { log "SHA256 NO coincide para $TARBALL"; exit 5; }

mkdir -p "$TMP_DIR/pkg"
tar -xzf "$TMP_DIR/app.tar.gz" -C "$TMP_DIR/pkg"
[ -f "$TMP_DIR/pkg/server/dist/index.js" ] && [ -f "$TMP_DIR/pkg/server/package.json" ] && [ -d "$TMP_DIR/pkg/dist" ] || {
  log "el paquete no tiene dist/, server/dist/ y server/package.json"
  exit 6
}

# ¿Hacen falta dependencias nuevas? Solo entonces se reemplaza node_modules.
NEW_DEPS=$(deps_of "$TMP_DIR/pkg/server/package.json")
OLD_DEPS=$(deps_of "$OPT_DIR/server/package.json")
NEED_DEPS=0
if [ "$NEW_DEPS" != "$OLD_DEPS" ] || [ ! -d "$OPT_DIR/server/node_modules" ]; then
  NEED_DEPS=1
fi

BK="$OPT_DIR/backup-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BK"
"$NODE_BIN" "$BACKUP_HELPER" "$DATA_DIR" "$BK" "$SQLITE" || {
  log "no se pudo verificar la copia de las bases; se aborta sin tocar código"
  rm -rf "$BK"
  exit 8
}
for part in public server/dist server/package.json; do
  [ -e "$OPT_DIR/$part" ] || continue
  mkdir -p "$BK/$(dirname "$part")"
  cp -a "$OPT_DIR/$part" "$BK/$part"
done
if [ "$NEED_DEPS" -eq 1 ] && [ -d "$OPT_DIR/server/node_modules" ]; then
  cp -a "$OPT_DIR/server/node_modules" "$BK/server/node_modules"
fi
printf '%s' "$CUR_VER" > "$BK/version"
chmod -R go-rwx "$BK" 2>/dev/null || true
RESTORE_VERSION=$CUR_VER
log "backup en $BK (bases verificadas)"

DEPLOY_STARTED=1
rm -rf "$OPT_DIR/public"
mkdir -p "$OPT_DIR/public"
cp -a "$TMP_DIR/pkg/dist/." "$OPT_DIR/public/"
rm -rf "$OPT_DIR/server/dist"
cp -a "$TMP_DIR/pkg/server/dist" "$OPT_DIR/server/dist"
if [ "$NEED_DEPS" -eq 1 ]; then
  rm -rf "$OPT_DIR/server/node_modules"
  cp -a "$TMP_DIR/pkg/server/node_modules" "$OPT_DIR/server/node_modules"
fi
cp "$TMP_DIR/pkg/server/package.json" "$OPT_DIR/server/package.json"
chown -R "$APP:$APP" "$OPT_DIR/public" "$OPT_DIR/server/dist" \
  "$OPT_DIR/server/package.json" 2>/dev/null || true
[ "$NEED_DEPS" -eq 1 ] && chown -R "$APP:$APP" "$OPT_DIR/server/node_modules" 2>/dev/null || true

log "reiniciando $APP con $VER_NO_V"
systemctl restart "$APP"
if ! wait_healthy "$VER_NO_V"; then
  log "la versión $VER_NO_V no arrancó; restaurando"
  ROLLED_BACK=1
  if restore_backup; then
    log "restauración completada; marker en $(marker_read)"
  else
    log "restauración incompleta; revisar la demo a mano"
  fi
  exit 7
fi
marker_write "$VER_NO_V"
prune_backups
log "demo actualizada a $VER_NO_V (salud y versión verificadas)"
