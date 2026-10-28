#!/bin/sh
# keynest-update.sh — auto-actualizador de Keynest (versionado en el repo).
#
# Reemplaza al antiguo cron rogue del CT 226. Diferencias con el original:
#  1. Descarga de la release ESTABLE (releases/latest, tag v*) — nunca de main.
#  2. Verifica sha256 contra checksums.txt antes de desplegar.
#  3. Marker con la versión SEMVER real, no un ID numérico de release.
#  4. Despliegue con backup y sin tocar datos (SQLite en /var/lib o /opt/keynest/data).
#  5. El marker SOLO avanza tras comprobar servicio activo, /health y versión
#     efectiva; si no arranca, se vuelve al release anterior y se sale con error.
#  6. Los flags de apply y rollback se buscan en ambos layouts de datos.
#
# Ejecutado por: deploy/keynest-update.timer (systemd, cadencia semanal) o por
# POST /api/update/apply / /api/updates/rollback (flag + .path).
set -eu

APP=${APP:-keynest}
REPO=${GITHUB_REPO:-gnacho/keynest}
OPT_DIR=${KEYNEST_OPT_DIR:-/opt/keynest}
MARKER=${RELEASE_MARKER:-$OPT_DIR/.release-id}
DATA_DIRS=${KEYNEST_DATA_DIRS:-"/var/lib/keynest /opt/keynest/data"}
HEALTH_TIMEOUT=${KEYNEST_HEALTH_TIMEOUT:-20}
TMP_DIR=$(mktemp -d)

# Progreso (#232): JSON {step,pct,ts} que el server expone en
# /api/update/progress mientras el apply corre. Se escribe en los data dirs
# posibles (plano/capistrano); el server lee el suyo. Stale a los 15 min.
PROG_FILES=""
for d in $DATA_DIRS; do
  [ -d "$d" ] && PROG_FILES="$PROG_FILES $d/update-progress.json"
done
prog() { # $1=step $2=pct
  for f in $PROG_FILES; do
    printf '{"step":"%s","pct":%s,"ts":%s}' "$1" "$2" "$(date +%s000)" > "$f" 2>/dev/null || true
    chmod 0644 "$f" 2>/dev/null || true
  done
}
PROG_OK=0
trap 'rm -rf "$TMP_DIR"' INT TERM
trap 'rm -rf "$TMP_DIR"; [ "$PROG_OK" = 1 ] || prog error 0' EXIT

log() { logger -t "$APP-update" "$@" 2>/dev/null || echo "$*" >&2; }

marker_read() { cat "$MARKER" 2>/dev/null || true; }
marker_write() {
  printf '%s' "$1" > "$MARKER"
  chmod 0644 "$MARKER" 2>/dev/null || true
}

# Flags de apply/rollback: la UI los escribe en el data dir escribible, que
# depende del layout. Se buscan y se limpian en TODOS los data dirs conocidos.
flag_find() { # $1=nombre del flag; imprime la ruta encontrada
  for d in $DATA_DIRS; do
    if [ -f "$d/$1" ]; then echo "$d/$1"; return 0; fi
  done
  return 1
}
flag_clear() { # $1=nombre del flag
  for d in $DATA_DIRS; do rm -f "$d/$1" 2>/dev/null || true; done
}

# Puerto real del servicio: .env del release, EnvironmentFile del unit o
# Environment=. `systemctl show -p Environment` NO refleja el EnvironmentFile,
# así que se leen los ficheros antes de caer al valor por defecto.
resolve_port() {
  for f in "$OPT_DIR/server/.env" $(systemctl show "$APP" -p EnvironmentFiles --value 2>/dev/null | tr ' ' '\n' | sed 's/(ignore_errors=.*//;s/(.*//'); do
    [ -n "$f" ] || continue
    [ -f "$f" ] || continue
    p=$(sed -n 's/^PORT=//p' "$f" | tail -n1 | sed 's/#.*//;s/[[:space:]]//g;s/^"//;s/"$//;s/^'\''//;s/'\''$//')
    case "$p" in ''|*[!0-9]*) continue ;; esac
    echo "$p"; return 0
  done
  p=$(systemctl show "$APP" -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^PORT=//p' | tail -n1 | sed 's/^"//;s/"$//')
  case "$p" in ''|*[!0-9]*) echo 8081; return 0 ;; esac
  echo "$p"
}

# Espera a que el servicio esté sano. $1 = versión esperada (vacío = cualquiera).
wait_healthy() {
  esperada=$1
  url="http://127.0.0.1:$PORT"
  i=0
  while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
    if [ "$(systemctl is-active "$APP" 2>/dev/null || true)" = "active" ] &&
       curl -fsS --max-time 3 "$url/health" >/dev/null 2>&1; then
      efectiva=$(curl -fsS --max-time 3 "$url/api/version" 2>/dev/null \
        | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
      if [ -n "$esperada" ] && [ -n "$efectiva" ] && [ "$efectiva" != "$esperada" ]; then
        log "versión efectiva $efectiva no coincide con la esperada $esperada"
        return 1
      fi
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# Release Capistrano inmediatamente anterior al actual (no "el segundo más alto":
# si current está en medio de la lista, el segundo más alto no es su anterior).
capistrano_previous() {
  cur=$(readlink -f "$OPT_DIR/current" 2>/dev/null || true)
  [ -n "$cur" ] || return 1
  cur_name=$(basename "$cur")
  prev=""
  for r in $(ls -1 "$OPT_DIR/releases" 2>/dev/null | grep -E '^v[0-9]' | sort -V); do
    [ "$r" = "$cur_name" ] && break
    prev=$r
  done
  [ -n "$prev" ] || return 1
  echo "$prev"
}

# Directorio de backup más reciente. El glob con barra final solo casa
# directorios (los sidecars de versión son ficheros y quedan fuera) y -t ordena
# por mtime: el nombre no ordena cronológicamente cuando conviven formatos.
newest_backup_dir() {
  # "$@" porque el glob del llamante expande a N directorios; sin esto se
  # quedaba con el primero en orden alfabético y restauraba un release viejo.
  d=$(ls -1dt "$@" 2>/dev/null | head -n1)
  [ -n "$d" ] || return 0
  printf '%s' "${d%/}"
}

# Versión guardada junto a un backup de server. Acepta el nombre nuevo
# (server-<ts>.version) y el antiguo (server.bak-<ts>.version) de backups
# creados por la versión anterior de este script.
sidecar_version() {
  ts=${1##*/server.bak-}
  cat "$OPT_DIR/server-$ts.version" 2>/dev/null || cat "$1.version" 2>/dev/null || true
}

# Revertir al release previo (Capistrano) o a los backups de esta corrida (plano)
# y comprobar que el servicio vuelve a estar sano.
rollback_to_previous() { # $1 = versión anterior conocida (puede ir vacía)
  anterior=$1
  if [ -L "$OPT_DIR/current" ]; then
    prev=$(capistrano_previous || true)
    if [ -n "$prev" ]; then
      ln -sfn "$OPT_DIR/releases/$prev" "$OPT_DIR/current"
      log "rollback a $prev tras fallo de salud"
      systemctl restart "$APP" 2>/dev/null || true
      wait_healthy "" && marker_write "${prev#v}" && return 0
      return 1
    fi
    return 1
  fi
  [ -n "${B_PUB:-}" ] && [ -n "${B_SRV:-}" ] || return 1
  rm -rf "$OPT_DIR/public" "$OPT_DIR/server"
  cp -a "$B_PUB" "$OPT_DIR/public"
  cp -a "$B_SRV" "$OPT_DIR/server"
  chown -R "$APP:$APP" "$OPT_DIR/public" "$OPT_DIR/server" 2>/dev/null || true
  log "rollback restaurado desde $B_PUB / $B_SRV"
  systemctl restart "$APP" 2>/dev/null || true
  if wait_healthy ""; then
    if [ -n "$anterior" ]; then
      marker_write "$anterior"
    else
      # Sin sidecar (backups antiguos) el marker se toma de lo que el servicio
      # restaurado responde de verdad: nunca dejar marker nuevo con código viejo.
      servida=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/version" 2>/dev/null \
        | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
      [ -n "$servida" ] && marker_write "$servida"
    fi
    return 0
  fi
  return 1
}

# Red de seguridad: cualquier fallo con set -e DESPUÉS de empezar a mutar el
# árbol pasa por el rollback. Sin esto, un tarball incompleto o un disco lleno a
# mitad de la copia dejaba public/ y server/dist borrados sin vuelta atrás.
DEPLOY_STARTED=0
ROLLED_BACK=0
on_exit() {
  code=$?
  trap - EXIT
  rm -rf "$TMP_DIR"
  if [ "$code" -ne 0 ] && [ "$DEPLOY_STARTED" -eq 1 ] && [ "$ROLLED_BACK" -eq 0 ]; then
    log "fallo durante el despliegue (código $code); restaurando"
    prog rollback 95 2>/dev/null || true
    if rollback_to_previous "${CUR_VER:-}"; then
      log "rollback completado; marker en $(marker_read)"
    else
      log "rollback incompleto; revisar el servicio"
    fi
    code=7
  fi
  # La UI solo pasa a fase de error si recibe step=error; sin esto la barra
  # se quedaba clavada en el último paso y el temporal no se limpiaba nunca.
  [ "$code" -eq 0 ] || prog error 0 2>/dev/null || true
  exit "$code"
}
trap on_exit EXIT

# El apply in-app escribe un flag en el dir de datos (ver update.ts y el .path
# de systemd). Borrarlo AL PRINCIPIO permite re-disparar el apply a voluntad.
flag_clear .update-requested
PORT=$(resolve_port)

# Rollback (#154): si existe .rollback-requested (POST /api/updates/rollback),
# restaurar en vez de actualizar.
if flag_find .rollback-requested >/dev/null 2>&1; then
  echo "STEP:rollback"
  prog rollback 20
  flag_clear .rollback-requested
  if [ -L "$OPT_DIR/current" ]; then
    PREV=$(capistrano_previous || true)
    if [ -n "$PREV" ] && [ -d "$OPT_DIR/releases/$PREV" ]; then
      ln -sfn "$OPT_DIR/releases/$PREV" "$OPT_DIR/current"
      systemctl restart "$APP"
      if wait_healthy ""; then
        marker_write "${PREV#v}"
        log "rollback a $PREV verificado"
        prog done 100; PROG_OK=1
        exit 0
      fi
      log "rollback a $PREV no arrancó"
      exit 7
    fi
    log "rollback solicitado sin release anterior disponible"
    exit 6
  fi
  # Plano: restaurar el public/server más reciente por fecha y su versión.
  B_PUB=$(newest_backup_dir "$OPT_DIR"/public.bak-*/)
  B_SRV=$(newest_backup_dir "$OPT_DIR"/server.bak-*/)
  if [ -n "$B_PUB" ] && [ -n "$B_SRV" ]; then
    RESTAURADA=$(sidecar_version "$B_SRV")
    if ! rollback_to_previous "$RESTAURADA"; then
      log "rollback restaurado pero el servicio no arrancó"
      exit 7
    fi
    log "rollback restaurado desde $B_PUB / $B_SRV (versión ${RESTAURADA:-desconocida})"
    prog done 100; PROG_OK=1
    exit 0
  fi
  log "rollback solicitado pero sin backups disponibles"
  exit 6
fi

echo "STEP:detect"
prog detect 5
# Última release ESTABLE (no prerelease, no main).
VER=$(curl -fsSL --max-time 20 "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"tag_name": *"\(v\?[0-9][^"]*\)".*/\1/p' | head -n1)
[ -n "$VER" ] || { log "no se pudo resolver la última release estable"; exit 4; }
VER_NO_V=$(printf '%s' "$VER" | sed 's/^v//')
CUR_VER=$(marker_read)

# ¿Ya instalado? Marker semver (fuente de verdad para /api/update/status).
# Solo es fiable porque el marker se escribe DESPUÉS de verificar el arranque.
if [ -n "$CUR_VER" ] && [ "$CUR_VER" = "$VER_NO_V" ]; then
  log "al día ($VER_NO_V)"; PROG_OK=1; exit 0
fi

echo "STEP:download"
prog download 25
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
TARBALL="${APP}_${VER_NO_V}_linux_${ARCH}.tar.gz"
BASE="https://github.com/$REPO/releases/download/$VER"
curl -fL --max-time 120 "$BASE/$TARBALL" -o "$TMP_DIR/app.tar.gz"
# Cache-buster: la URL de checksums.txt es estable entre versiones y la CDN
# sirve la copia vieja justo tras publicar → el tarball nuevo "no está en
# checksums". Añadir ?nc=<ts> fuerza la revalidación.
TS=$(date +%s)
curl -fL --max-time 30 "$BASE/checksums.txt?nc=$TS" -o "$TMP_DIR/checksums.txt"

echo "STEP:verify"
prog verify 45
expected=$(awk -v f="$TARBALL" '$2=="'"$TARBALL"'" || index($0, "  '"$TARBALL"'") {print $1; exit}' "$TMP_DIR/checksums.txt" 2>/dev/null || true)
[ -n "$expected" ] || { log "checksums.txt sin entrada para $TARBALL (¿release sin checksums?)"; exit 5; }
got=$(sha256sum "$TMP_DIR/app.tar.gz" | awk '{print $1}')
[ "$expected" = "$got" ] || { log "SHA256 NO coincide para $TARBALL"; exit 5; }
log "sha256 verificado: $TARBALL"

echo "STEP:extract"
prog extract 60
mkdir -p "$TMP_DIR/pkg"
tar -xzf "$TMP_DIR/app.tar.gz" -C "$TMP_DIR/pkg"

echo "STEP:deploy"
prog deploy 80
TS=$(date +%Y%m%d-%H%M%S)
# Dos layouts posibles:
#  - Capistrano (install.sh): /opt/keynest/current → releases/vX, datos en /var/lib/keynest.
#  - Plano (deploy manual del CT 226): /opt/keynest/{public,server}, datos en /opt/keynest/data.
if [ -L "$OPT_DIR/current" ]; then
  # Capistrano: nueva release + flip de symlink (la anterior queda intacta = rollback).
  RELEASE_DIR="$OPT_DIR/releases/v$VER_NO_V"
  mkdir -p "$RELEASE_DIR"
  cp -a "$TMP_DIR/pkg/dist" "$RELEASE_DIR/dist"
  cp -a "$TMP_DIR/pkg/server" "$RELEASE_DIR/server"
  chown -R "$APP:$APP" "$RELEASE_DIR"
  # A partir de aquí sí hay algo que revertir: antes del flip el release en
  # marcha está sano y bajar de versión sería un daño gratuito.
  DEPLOY_STARTED=1
  ln -sfn "$RELEASE_DIR" "$OPT_DIR/current"
  [ -x "$OPT_DIR/node/bin/node" ] && ln -sfn "$OPT_DIR/node/bin/node" "$RELEASE_DIR/server/node" 2>/dev/null || true
else
  # Plano: backup + reemplazo quirúrgico (preserva .env y config local).
  # NUNCA volar server/ entero: el .env (SESSION_SECRET/ENC_KEY/VAPID/PORT) y
  # otros ficheros locales viven ahí y el tarball NO los trae. Solo se
  # reemplazan src, node_modules y package.json.
  # Los backups se asignan SOLO si la copia terminó bien: un snapshot a medias
  # no debe usarse para restaurar (borraría el .env vivo y las claves).
  if [ -d "$OPT_DIR/public" ] && [ -d "$OPT_DIR/server" ]; then
    pub_tmp="$OPT_DIR/public.bak-$TS"
    srv_tmp="$OPT_DIR/server.bak-$TS"
    if cp -a "$OPT_DIR/public" "$pub_tmp" && cp -a "$OPT_DIR/server" "$srv_tmp"; then
      B_PUB=$pub_tmp
      B_SRV=$srv_tmp
      # Sidecar FUERA del patrón server.bak-*: si se llamara server.bak-<ts>.version
      # el glob del rollback lo puede elegir como si fuera el directorio.
      printf '%s' "$CUR_VER" > "$OPT_DIR/server-$TS.version"
    else
      rm -rf "$pub_tmp" "$srv_tmp"
      log "no se pudo preparar el backup previo; se aborta sin tocar nada"
      exit 8
    fi
  fi
  DEPLOY_STARTED=1
  rm -rf "$OPT_DIR/public"
  mkdir -p "$OPT_DIR/public"
  cp -a "$TMP_DIR/pkg/dist/." "$OPT_DIR/public/"
  mkdir -p "$OPT_DIR/server"
  rm -rf "$OPT_DIR/server/src" "$OPT_DIR/server/dist"
  cp -a "$TMP_DIR/pkg/server/dist" "$OPT_DIR/server/dist"
  if [ -d "$TMP_DIR/pkg/server/node_modules" ]; then
    rm -rf "$OPT_DIR/server/node_modules"
    cp -a "$TMP_DIR/pkg/server/node_modules" "$OPT_DIR/server/node_modules"
  fi
  cp "$TMP_DIR/pkg/server/package.json" "$OPT_DIR/server/package.json"
  # El .env NO se toca (queda en server/.env). chown solo sobre lo nuevo.
  chown -R "$APP:$APP" "$OPT_DIR/public" "$OPT_DIR/server/dist" \
    "$OPT_DIR/server/node_modules" "$OPT_DIR/server/package.json" 2>/dev/null || true
fi
# Datos NUNCA se tocan: SQLite y uploads viven en $DATA_DIR (fuera de server/).

echo "STEP:restart"
prog restart 90
systemctl restart "$APP"
# El marker NO se escribe aquí: primero tiene que arrancar y responder con la
# versión esperada. Si no, un reinicio fallido dejaría "al día" una versión rota.
if ! wait_healthy "$VER_NO_V"; then
  log "la versión $VER_NO_V no arrancó; revirtiendo"
  prog rollback 95
  ROLLED_BACK=1
  if rollback_to_previous "$CUR_VER"; then
    log "rollback completado; marker en $(marker_read)"
  else
    log "rollback incompleto; revisar el servicio"
  fi
  exit 7
fi
marker_write "$VER_NO_V"
prog done 100
PROG_OK=1
log "actualizado a $VER_NO_V (salud y versión verificadas)"

# Rollback manual: escribir <data dir>/.rollback-requested. systemd lo detecta
# (keynest-update.path) y este script restaura el public/server más reciente por
# fecha, más su versión. No mover a mano los directorios .bak-*.
