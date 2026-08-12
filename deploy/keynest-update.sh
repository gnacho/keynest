#!/bin/sh
# keynest-update.sh — auto-actualizador de Keynest (versionado en el repo).
#
# Reemplaza al antiguo cron rogue del CT 226. Diferencias con el original:
#  1. Descarga de la release ESTABLE (releases/latest, tag v*) — nunca de main.
#  2. Verifica sha256 contra checksums.txt antes de desplegar.
#  3. Marker con la versión SEMVER real, no un ID numérico de release.
#  4. Despliegue con backup y sin tocar datos (SQLite en /var/lib o /opt/keynest/data).
#
# Ejecutado por: deploy/keynest-update.timer (systemd, cadencia semanal) o por
# POST /api/update/apply con SKIP_RESTART=1 (el server hace exit y systemd relanza).
set -eu

APP=keynest
REPO=gnacho/keynest
OPT_DIR=/opt/keynest
MARKER=/opt/keynest/.release-id
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

log() { logger -t "$APP-update" "$@"; }

# El apply in-app escribe un flag en el dir de datos (ver update.js / el .path
# de systemd). Borrarlo AL PRINCIPIO permite re-disparar el apply a voluntad.
rm -f /var/lib/keynest/.update-requested /opt/keynest/data/.update-requested 2>/dev/null || true

echo "STEP:detect"
# Última release ESTABLE (no prerelease, no main).
VER=$(curl -fsSL --max-time 20 "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"tag_name": *"\(v\?[0-9][^"]*\)".*/\1/p' | head -n1)
[ -n "$VER" ] || { log "no se pudo resolver la última release estable"; exit 4; }
VER_NO_V=$(printf '%s' "$VER" | sed 's/^v//')

# ¿Ya instalado? Marker semver (fuente de verdad para /api/update/status).
if [ -f "$MARKER" ] && [ "$(cat "$MARKER" 2>/dev/null || true)" = "$VER_NO_V" ]; then
  log "al día ($VER_NO_V)"; exit 0
fi

echo "STEP:download"
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
expected=$(awk -v f="$TARBALL" '$2=="'"$TARBALL"'" || index($0, "  '"$TARBALL"'") {print $1; exit}' "$TMP_DIR/checksums.txt" 2>/dev/null || true)
[ -n "$expected" ] || { log "checksums.txt sin entrada para $TARBALL (¿release sin checksums?)"; exit 5; }
got=$(sha256sum "$TMP_DIR/app.tar.gz" | awk '{print $1}')
[ "$expected" = "$got" ] || { log "SHA256 NO coincide para $TARBALL"; exit 5; }
log "sha256 verificado: $TARBALL"

echo "STEP:extract"
mkdir -p "$TMP_DIR/pkg"
tar -xzf "$TMP_DIR/app.tar.gz" -C "$TMP_DIR/pkg"

echo "STEP:deploy"
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
  ln -sfn "$RELEASE_DIR" "$OPT_DIR/current"
  [ -x "$OPT_DIR/node/bin/node" ] && ln -sfn "$OPT_DIR/node/bin/node" "$RELEASE_DIR/server/node" 2>/dev/null || true
else
  # Plano: backup + reemplazo quirúrgico (preserva .env y config local).
  # NUNCA volar server/ entero: el .env (SESSION_SECRET/ENC_KEY/VAPID/PORT) y
  # otros ficheros locales viven ahí y el tarball NO los trae. Solo se
  # reemplazan src, node_modules y package.json.
  [ -d "$OPT_DIR/public" ] && cp -a "$OPT_DIR/public" "$OPT_DIR/public.bak-$TS"
  [ -d "$OPT_DIR/server" ] && cp -a "$OPT_DIR/server" "$OPT_DIR/server.bak-$TS"
  rm -rf "$OPT_DIR/public"
  mkdir -p "$OPT_DIR/public"
  cp -a "$TMP_DIR/pkg/dist/." "$OPT_DIR/public/"
  mkdir -p "$OPT_DIR/server"
  rm -rf "$OPT_DIR/server/src"
  cp -a "$TMP_DIR/pkg/server/src" "$OPT_DIR/server/src"
  if [ -d "$TMP_DIR/pkg/server/node_modules" ]; then
    rm -rf "$OPT_DIR/server/node_modules"
    cp -a "$TMP_DIR/pkg/server/node_modules" "$OPT_DIR/server/node_modules"
  fi
  cp "$TMP_DIR/pkg/server/package.json" "$OPT_DIR/server/package.json"
  # El .env NO se toca (queda en server/.env). chown solo sobre lo nuevo.
  chown -R "$APP:$APP" "$OPT_DIR/public" "$OPT_DIR/server/src" \
    "$OPT_DIR/server/node_modules" "$OPT_DIR/server/package.json" 2>/dev/null || true
fi
# Datos NUNCA se tocan: SQLite y uploads viven en $DATA_DIR (fuera de server/).

echo "STEP:restart"
printf '%s' "$VER_NO_V" > "$MARKER"
chmod 0644 "$MARKER"
if [ "${SKIP_RESTART:-0}" != "1" ]; then
  systemctl restart "$APP"
fi
log "actualizado a $VER_NO_V"

# Rollback manual:
#   rm -rf /opt/keynest/{public,server} && mv /opt/keynest/server.bak-$TS /opt/keynest/server \
#   && mv /opt/keynest/public.bak-$TS /opt/keynest/public && systemctl restart keynest
